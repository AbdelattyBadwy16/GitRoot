use super::*;
use std::collections::HashSet;
use std::process::Command as StdCommand;

// real repo with a fork + merge, so layout is tested against an actual
// branch/merge, not just a straight line
fn build_test_repo() -> String {
    let dir = std::env::temp_dir().join(format!(
        "sprout-log-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();

    let git = |args: &[&str]| {
        let out = StdCommand::new("git").arg("-C").arg(&path).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    };
    let write = |name: &str, contents: &str| std::fs::write(dir.join(name), contents).unwrap();

    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "user.name", "Test"]);

    write("a.txt", "1\n");
    git(&["add", "a.txt"]);
    git(&["commit", "-q", "-m", "base"]);

    git(&["checkout", "-q", "-b", "feature"]);
    write("b.txt", "1\n");
    git(&["add", "b.txt"]);
    git(&["commit", "-q", "-m", "feature work"]);

    git(&["checkout", "-q", "main"]);
    write("c.txt", "1\n");
    git(&["add", "c.txt"]);
    git(&["commit", "-q", "-m", "main work"]);

    git(&["merge", "--no-ff", "-q", "feature", "-m", "merge feature"]);

    path
}

#[test]
fn lays_out_a_merge_without_overlap_and_keeps_mainline_straight() {
    let repo = build_test_repo();
    let graph = commit_graph_sync(repo.clone(), 1000).expect("commit_graph should succeed");

    // 4 commits: base, feature work, main work, merge
    assert_eq!(graph.commits.len(), 4);

    // no two commits may share a (lane, row) - that's an overlap on screen
    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    for c in &graph.commits {
        assert!(seen.insert((c.lane, c.row)), "duplicate position {:?} for {}", (c.lane, c.row), c.hash);
    }

    assert_eq!(graph.edges.len(), 4); // base->none, feature->base, main->base, merge->{main,feature}

    let merge = graph.commits.iter().find(|c| c.parents.len() == 2).expect("a merge commit exists");
    let by_hash: std::collections::HashMap<&str, &GraphCommit> =
        graph.commits.iter().map(|c| (c.hash.as_str(), c)).collect();
    let first_parent = by_hash[merge.parents[0].as_str()];
    // git convention: first parent is the branch you were on, so the
    // mainline should continue straight down in the same lane
    assert_eq!(merge.lane, first_parent.lane);

    assert!(graph.commits.iter().all(|c| c.on_remote), "with no remote, every commit should count as on_remote");

    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn stashed_changes_never_appear_as_graph_nodes() {
    // `git stash` creates real commit objects reachable only via
    // refs/stash - the graph must not pull those in as history
    let repo = build_test_repo();

    let git = |args: &[&str]| {
        StdCommand::new("git").arg("-C").arg(&repo).args(args).output().unwrap()
    };
    std::fs::write(std::path::Path::new(&repo).join("a.txt"), "changed\n").unwrap();
    let stash_out = git(&["stash"]);
    assert!(stash_out.status.success(), "{}", String::from_utf8_lossy(&stash_out.stderr));

    let graph = commit_graph_sync(repo.clone(), 1000).expect("commit_graph should succeed");

    assert_eq!(graph.commits.len(), 4, "stash must not add graph nodes");
    for c in &graph.commits {
        assert!(
            !c.message.contains("WIP on") && !c.message.contains("index on"),
            "stash plumbing commit leaked into the graph: {} {}",
            c.hash,
            c.message
        );
        assert!(
            c.refs.iter().all(|r| r != "refs/stash"),
            "refs/stash leaked into a graph node's refs: {:?}",
            c.refs
        );
    }

    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn distinguishes_pushed_commits_from_local_only_ones() {
    // base -> pushed  (both local main and origin/main point here)
    //      -> local   (committed, never pushed)
    let dir = std::env::temp_dir().join(format!(
        "sprout-log-remote-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    let remote_dir = dir.join("remote.git");
    let repo_dir = dir.join("repo");
    std::fs::create_dir_all(&repo_dir).unwrap();

    let git = |args: &[&str]| {
        let out = StdCommand::new("git").arg("-C").arg(&repo_dir).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    };

    StdCommand::new("git").arg("init").arg("--bare").arg("-q").arg(&remote_dir).output().unwrap();
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "user.name", "Test"]);
    git(&["remote", "add", "origin", remote_dir.to_str().unwrap()]);

    std::fs::write(repo_dir.join("a.txt"), "1\n").unwrap();
    git(&["add", "a.txt"]);
    git(&["commit", "-q", "-m", "pushed commit"]);
    git(&["push", "-q", "-u", "origin", "HEAD:main"]);

    std::fs::write(repo_dir.join("b.txt"), "1\n").unwrap();
    git(&["add", "b.txt"]);
    git(&["commit", "-q", "-m", "local only commit"]);

    let repo_path = repo_dir.to_string_lossy().to_string();
    let graph = commit_graph_sync(repo_path, 1000).expect("commit_graph should succeed");
    assert_eq!(graph.commits.len(), 2);

    let pushed = graph.commits.iter().find(|c| c.message == "pushed commit").unwrap();
    let local = graph.commits.iter().find(|c| c.message == "local only commit").unwrap();
    assert!(pushed.on_remote, "commit that was pushed should be on_remote");
    assert!(!local.on_remote, "commit that was never pushed should NOT be on_remote");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn pages_a_long_history_without_reshuffling_earlier_lanes() {
    let dir = std::env::temp_dir().join(format!(
        "sprout-log-page-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    let git = |args: &[&str]| {
        let out = StdCommand::new("git").arg("-C").arg(&path).args(args).output().unwrap();
        assert!(out.status.success(), "git {:?} failed: {}", args, String::from_utf8_lossy(&out.stderr));
    };
    git(&["init", "-q"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "user.name", "Test"]);
    for i in 0..25 {
        std::fs::write(dir.join("f.txt"), format!("{i}\n")).unwrap();
        git(&["add", "f.txt"]);
        git(&["commit", "-q", "-m", &format!("commit {i}")]);
    }

    let page1 = commit_graph_sync(path.clone(), 10).expect("commit_graph should succeed");
    assert_eq!(page1.commits.len(), 10);
    assert!(page1.has_more);

    let full = commit_graph_sync(path.clone(), 100).expect("commit_graph should succeed");
    assert_eq!(full.commits.len(), 25);
    assert!(!full.has_more);

    // every commit on page 1 must land on the same (lane, row) once the
    // page grows, or "load more" would visibly reshuffle the screen
    let page1_positions: HashMap<&str, (usize, usize)> =
        page1.commits.iter().map(|c| (c.hash.as_str(), (c.lane, c.row))).collect();
    for c in &full.commits {
        if let Some(&pos) = page1_positions.get(c.hash.as_str()) {
            assert_eq!((c.lane, c.row), pos, "commit {} moved when the page grew", c.hash);
        }
    }

    std::fs::remove_dir_all(&dir).ok();
}
