use super::*;

struct TestRepo {
    dir: std::path::PathBuf,
    path: String,
}

impl TestRepo {
    fn new() -> Self {
        // this counter stop name clash when tests run in parallel
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let unique = format!(
            "gitroot-cmd-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            n
        );
        let dir = std::env::temp_dir().join(unique);
        let remote_dir = dir.join("remote.git");
        let repo_dir = dir.join("repo");
        std::fs::create_dir_all(&repo_dir).unwrap();

        let run = |cwd: &std::path::Path, args: &[&str]| {
            let out = std::process::Command::new("git")
                .arg("-C")
                .arg(cwd)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        };

        run(
            &dir,
            &[
                "init",
                "--bare",
                "-q",
                "-b",
                "main",
                remote_dir.to_str().unwrap(),
            ],
        );
        run(&repo_dir, &["init", "-q", "-b", "main"]);
        run(&repo_dir, &["config", "user.email", "test@example.com"]);
        run(&repo_dir, &["config", "user.name", "Test"]);
        run(
            &repo_dir,
            &["remote", "add", "origin", remote_dir.to_str().unwrap()],
        );

        let path = repo_dir.to_string_lossy().to_string();
        std::fs::write(repo_dir.join("README.md"), "hello\n").unwrap();
        run(&repo_dir, &["add", "README.md"]);
        run(&repo_dir, &["commit", "-q", "-m", "initial"]);
        run(&repo_dir, &["push", "-q", "-u", "origin", "HEAD:main"]);

        TestRepo { dir, path }
    }

    fn write(&self, name: &str, contents: &str) {
        std::fs::write(self.dir.join("repo").join(name), contents).unwrap();
    }

    fn write_bytes(&self, name: &str, contents: &[u8]) {
        std::fs::write(self.dir.join("repo").join(name), contents).unwrap();
    }

    fn git(&self, args: &[&str]) -> crate::git::GitOutput {
        run_git(&self.path, args).unwrap()
    }

    // note: this need explicit add, "commit -am" only work for files git already know about
    fn commit_new_file(&self, name: &str, contents: &str, message: &str) {
        self.write(name, contents);
        let out = self.git(&["add", name]);
        assert!(out.success, "add {name} failed: {}", out.stderr);
        let out = self.git(&["commit", "-q", "-m", message]);
        assert!(out.success, "commit {name} failed: {}", out.stderr);
    }
}

impl Drop for TestRepo {
    fn drop(&mut self) {
        std::fs::remove_dir_all(&self.dir).ok();
    }
}

#[test]
fn staging_toggles_the_real_index() {
    let repo = TestRepo::new();
    repo.write("a.txt", "content\n");

    let before = status_sync(repo.path.clone()).unwrap();
    assert_eq!(before.len(), 1);
    assert!(!before[0].staged, "untracked file should start unstaged");

    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    let staged = status_sync(repo.path.clone()).unwrap();
    assert!(staged[0].staged, "should be staged after stage_file");

    unstage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    let unstaged = status_sync(repo.path.clone()).unwrap();
    assert!(!unstaged[0].staged, "should be unstaged after unstage_file");
}

#[test]
fn file_diff_covers_untracked_unstaged_and_staged() {
    let repo = TestRepo::new();

    repo.write("new.txt", "hello\n");
    let diff = file_diff_sync(repo.path.clone(), "new.txt".to_string(), false).unwrap();
    assert!(diff.contains("new file mode"), "diff was: {diff}");
    assert!(diff.contains("+hello"), "diff was: {diff}");

    repo.write("README.md", "hello\nmodified\n");
    let diff = file_diff_sync(repo.path.clone(), "README.md".to_string(), false).unwrap();
    assert!(diff.contains("+modified"), "diff was: {diff}");

    stage_file_sync(repo.path.clone(), "README.md".to_string()).unwrap();
    let staged_diff = file_diff_sync(repo.path.clone(), "README.md".to_string(), true).unwrap();
    assert!(staged_diff.contains("+modified"), "diff was: {staged_diff}");
    let unstaged_diff = file_diff_sync(repo.path.clone(), "README.md".to_string(), false).unwrap();
    assert!(unstaged_diff.is_empty(), "diff was: {unstaged_diff}");
}

#[test]
fn commit_requires_staged_files_and_reports_count_and_branch() {
    let repo = TestRepo::new();
    repo.write("a.txt", "content\n");

    let result = commit_sync(repo.path.clone(), "should not commit".to_string()).unwrap();
    assert!(!result.success);
    assert!(!result.auth_error);

    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    let result = commit_sync(repo.path.clone(), "add a.txt".to_string()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["files"], 1);
    assert_eq!(result.data["branch"], "main");
    assert_eq!(result.command, r#"git commit -m "add a.txt""#);

    let log = repo.git(&["log", "--oneline", "-1"]);
    assert!(log.stdout.contains("add a.txt"));
}

#[test]
fn stash_saves_tracked_changes_but_not_untracked() {
    let repo = TestRepo::new();
    repo.write("README.md", "hello\nmodified\n");
    repo.write("scratch.txt", "wip\n");

    let result = stash_sync(repo.path.clone()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["files"], 1);

    let status_out = repo.git(&["status", "--porcelain"]);
    assert!(status_out.stdout.contains("scratch.txt"));
    assert!(!status_out.stdout.contains("README.md"));

    let stash_list = repo.git(&["stash", "list"]);
    assert_eq!(stash_list.stdout.lines().count(), 1);
}

#[test]
fn pull_reports_zero_when_already_up_to_date() {
    let repo = TestRepo::new();
    let result = pull_sync(repo.path.clone()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["commits"], 0);
    assert_eq!(result.data["remote"], "origin/main");
    assert_eq!(result.data["before"], result.data["after"]);
    assert_eq!(
        result.data["before"].as_str().unwrap().len(),
        7,
        "should be a short hash"
    );
}

#[test]
fn push_then_pull_round_trip_reports_real_commit_counts() {
    let repo_a = TestRepo::new();

    let clone_dir = repo_a.dir.join("repo-b");
    let out = std::process::Command::new("git")
        .args([
            "clone",
            "-q",
            repo_a.dir.join("remote.git").to_str().unwrap(),
            clone_dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let repo_b_path = clone_dir.to_string_lossy().to_string();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.email", "b@example.com"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.name", "B"])
        .output()
        .unwrap();

    std::fs::write(clone_dir.join("from-b.txt"), "hi\n").unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["add", "from-b.txt"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["commit", "-q", "-m", "from b"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["push", "-q"])
        .output()
        .unwrap();

    let pull_result = pull_sync(repo_a.path.clone()).unwrap();
    assert!(pull_result.success);
    assert_eq!(pull_result.data["commits"], 1);

    repo_a.write("from-a.txt", "hi\n");
    stage_file_sync(repo_a.path.clone(), "from-a.txt".to_string()).unwrap();
    commit_sync(repo_a.path.clone(), "from a".to_string()).unwrap();

    let push_result = push_sync(repo_a.path.clone()).unwrap();
    assert!(push_result.success);
    assert_eq!(push_result.data["commits"], 1);
    assert_eq!(push_result.data["remote"], "origin/main");
    assert_ne!(push_result.data["before"], push_result.data["after"]);
    let local_head = short_hash(&repo_a.git(&["rev-parse", "HEAD"]).stdout);
    assert_eq!(push_result.data["after"], local_head);
}

fn push_conflicting_readme_edit_from_a_collaborator(repo: &TestRepo) {
    let clone_dir = repo.dir.join("repo-b");
    let out = std::process::Command::new("git")
        .args([
            "clone",
            "-q",
            repo.dir.join("remote.git").to_str().unwrap(),
            clone_dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let repo_b_path = clone_dir.to_string_lossy().to_string();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.email", "b@example.com"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.name", "B"])
        .output()
        .unwrap();
    std::fs::write(clone_dir.join("README.md"), "hello\nfrom b\n").unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["commit", "-q", "-am", "b edits readme"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["push", "-q"])
        .output()
        .unwrap();
}

#[test]
fn pull_pauses_on_merge_conflict_instead_of_reporting_a_dead_end_error() {
    let repo = TestRepo::new();
    push_conflicting_readme_edit_from_a_collaborator(&repo);

    repo.write("README.md", "hello\nfrom a\n");
    stage_file_sync(repo.path.clone(), "README.md".to_string()).unwrap();
    commit_sync(repo.path.clone(), "a edits readme".to_string()).unwrap();

    let result = pull_sync(repo.path.clone()).unwrap();
    assert!(!result.success);
    assert!(
        result.conflict,
        "a real conflict should pause, not fail outright"
    );
    assert_eq!(result.data["files"], serde_json::json!(["README.md"]));
    assert_eq!(
        result.data["target"], "origin/main",
        "the details panel needs a real name to fill in the {{target}} placeholder"
    );
    assert!(std::path::Path::new(&repo.path)
        .join(".git/MERGE_HEAD")
        .exists());

    repo.write("README.md", "resolved\n");
    repo.git(&["add", "README.md"]);
    let finished = continue_merge_sync(repo.path.clone()).unwrap();
    assert!(finished.success, "stderr: {:?}", finished.raw_stderr);
}

#[test]
fn pull_forces_merge_semantics_even_when_pull_rebase_is_configured_globally() {
    let repo = TestRepo::new();
    repo.git(&["config", "pull.rebase", "true"]);
    push_conflicting_readme_edit_from_a_collaborator(&repo);

    repo.write("README.md", "hello\nfrom a\n");
    stage_file_sync(repo.path.clone(), "README.md".to_string()).unwrap();
    commit_sync(repo.path.clone(), "a edits readme".to_string()).unwrap();

    let result = pull_sync(repo.path.clone()).unwrap();
    assert!(result.conflict);
    assert_eq!(result.command, "git pull --no-rebase");
    assert!(
        std::path::Path::new(&repo.path)
            .join(".git/MERGE_HEAD")
            .exists(),
        "should be a real merge in progress, not a rebase, regardless of pull.rebase"
    );
    assert!(!std::path::Path::new(&repo.path)
        .join(".git/rebase-merge")
        .exists());

    abort_merge_sync(&repo.path).unwrap();
    assert!(!std::path::Path::new(&repo.path)
        .join(".git/MERGE_HEAD")
        .exists());
}

#[test]
fn push_sets_upstream_automatically_for_a_brand_new_branch() {
    // this test is for a bug where push failed on branch with no upstream
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("feature.txt", "new stuff\n");
    stage_file_sync(repo.path.clone(), "feature.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add feature.txt".to_string()).unwrap();

    let result = push_sync(repo.path.clone()).unwrap();
    assert!(
        result.success,
        "push should set upstream and succeed, not fail: {:?}",
        result.raw_stderr
    );
    assert_eq!(result.command, "git push --set-upstream origin feature");
    assert_eq!(result.data["commits"], 1);

    let upstream = repo.git(&["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    assert_eq!(upstream.stdout.trim(), "origin/feature");
    let remote_branches = repo.git(&["ls-remote", "--heads", "origin", "feature"]);
    assert!(
        !remote_branches.stdout.is_empty(),
        "remote should now have the feature branch"
    );
}

#[test]
fn display_command_quotes_arguments_that_would_otherwise_split() {
    assert_eq!(display_command(&["pull"]), "git pull");
    assert_eq!(
        display_command(&["commit", "-m", "fix login bug"]),
        r#"git commit -m "fix login bug""#
    );
    assert_eq!(
        display_command(&["commit", "-m", r#"say "hi""#]),
        r#"git commit -m "say \"hi\"""#
    );
}

#[test]
fn fingerprint_changes_on_commits_edits_and_branch_switches_only() {
    let repo = TestRepo::new();

    let f0 = repo_fingerprint_sync(repo.path.clone()).unwrap();
    assert_eq!(f0, repo_fingerprint_sync(repo.path.clone()).unwrap());

    repo.write("README.md", "hello\nedited\n");
    let f1 = repo_fingerprint_sync(repo.path.clone()).unwrap();
    assert_ne!(f0, f1);

    stage_file_sync(repo.path.clone(), "README.md".to_string()).unwrap();
    commit_sync(repo.path.clone(), "edit readme".to_string()).unwrap();
    let f2 = repo_fingerprint_sync(repo.path.clone()).unwrap();
    assert_ne!(f1, f2);

    repo.git(&["checkout", "-q", "-b", "other"]);
    let f3 = repo_fingerprint_sync(repo.path.clone()).unwrap();
    assert_ne!(f2, f3);
}

#[test]
fn lists_branches_with_current_flag_and_switches_between_them() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.git(&["checkout", "-q", "main"]);

    let branches = list_branches_sync(repo.path.clone()).unwrap();
    let names: Vec<&str> = branches.iter().map(|b| b.name.as_str()).collect();
    assert!(names.contains(&"main"));
    assert!(names.contains(&"feature"));

    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert!(main.is_current);
    let feature = branches.iter().find(|b| b.name == "feature").unwrap();
    assert!(!feature.is_current);

    let result = switch_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["branch"], "feature");
    assert_eq!(result.command, "git checkout feature");
    assert_eq!(result.data["before"], "main");
    assert_eq!(result.data["after"], "feature");

    let branches_after = list_branches_sync(repo.path.clone()).unwrap();
    assert!(
        branches_after
            .iter()
            .find(|b| b.name == "feature")
            .unwrap()
            .is_current
    );
    assert!(
        !branches_after
            .iter()
            .find(|b| b.name == "main")
            .unwrap()
            .is_current
    );
}

#[test]
fn reports_ahead_and_behind_counts_against_the_upstream() {
    let repo = TestRepo::new();

    repo.git(&["checkout", "-q", "-b", "feature"]);
    let branches = list_branches_sync(repo.path.clone()).unwrap();
    let feature = branches.iter().find(|b| b.name == "feature").unwrap();
    assert!(feature.upstream.is_none());
    assert_eq!((feature.ahead, feature.behind), (0, 0));
    repo.git(&["checkout", "-q", "main"]);

    repo.write("a.txt", "one\n");
    repo.git(&["add", "a.txt"]);
    repo.git(&["commit", "-q", "-m", "a"]);
    repo.write("b.txt", "two\n");
    repo.git(&["add", "b.txt"]);
    repo.git(&["commit", "-q", "-m", "b"]);
    let branches = list_branches_sync(repo.path.clone()).unwrap();
    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert_eq!((main.ahead, main.behind), (2, 0));

    push_sync(repo.path.clone()).unwrap();
    let clone_dir = repo.dir.join("repo-b");
    let out = std::process::Command::new("git")
        .args([
            "clone",
            "-q",
            repo.dir.join("remote.git").to_str().unwrap(),
            clone_dir.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(out.status.success());
    let repo_b_path = clone_dir.to_string_lossy().to_string();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.email", "b@example.com"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["config", "user.name", "B"])
        .output()
        .unwrap();
    std::fs::write(clone_dir.join("c.txt"), "three\n").unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["add", "c.txt"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["commit", "-q", "-m", "c"])
        .output()
        .unwrap();
    std::process::Command::new("git")
        .arg("-C")
        .arg(&repo_b_path)
        .args(["push", "-q"])
        .output()
        .unwrap();

    repo.git(&["fetch", "-q"]);
    let branches = list_branches_sync(repo.path.clone()).unwrap();
    let main = branches.iter().find(|b| b.name == "main").unwrap();
    assert_eq!(
        (main.ahead, main.behind),
        (0, 1),
        "main's own commits were pushed; one new one landed from elsewhere"
    );
}

#[test]
fn switch_branch_fails_safely_instead_of_discarding_uncommitted_changes() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("README.md", "feature version\n");
    repo.git(&["add", "README.md"]);
    repo.git(&["commit", "-q", "-m", "change readme on feature"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("README.md", "uncommitted conflicting edit\n");

    let result = switch_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(!result.success);
    assert!(
        result.raw_stderr.is_some(),
        "failure should carry git's real explanation"
    );

    let status = repo.git(&["status", "--porcelain"]);
    assert!(status.stdout.contains("README.md"));
    let branches = list_branches_sync(repo.path.clone()).unwrap();
    assert!(
        branches
            .iter()
            .find(|b| b.name == "main")
            .unwrap()
            .is_current
    );
}

#[test]
fn create_branch_creates_and_switches_from_the_given_start_point() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();

    let result =
        create_branch_sync(repo.path.clone(), "feature".to_string(), "main".to_string()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["branch"], "feature");
    assert_eq!(result.data["from"], "main");

    let branches = list_branches_sync(repo.path.clone()).unwrap();
    let feature = branches.iter().find(|b| b.name == "feature").unwrap();
    assert!(feature.is_current, "creating a branch should switch to it");
}

#[test]
fn revert_to_commit_undoes_commits_by_adding_new_ones_not_deleting_history() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();

    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();

    let before_count: u32 = repo
        .git(&["rev-list", "--count", "HEAD"])
        .stdout
        .trim()
        .parse()
        .unwrap();

    let result = revert_to_commit_sync(repo.path.clone(), target).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(result.data["commits"], 1);

    let after_count: u32 = repo
        .git(&["rev-list", "--count", "HEAD"])
        .stdout
        .trim()
        .parse()
        .unwrap();
    assert_eq!(after_count, before_count + 1);
    let log = repo.git(&["log", "--oneline", "--all"]);
    assert!(
        log.stdout.contains("add a"),
        "original commit must still be in history:\n{}",
        log.stdout
    );

    assert!(!repo.dir.join("repo").join("a.txt").exists());
}

#[test]
fn revert_to_commit_rejects_a_target_outside_current_branch_history() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "other"]);
    repo.write("only-on-other.txt", "1\n");
    stage_file_sync(repo.path.clone(), "only-on-other.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "commit on other".to_string()).unwrap();
    let other_head = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();

    repo.git(&["checkout", "-q", "main"]);
    let result = revert_to_commit_sync(repo.path.clone(), other_head).unwrap();
    assert!(!result.success);
    assert!(result
        .raw_stderr
        .unwrap()
        .contains("isn't in your current branch's history"));
}

#[test]
fn revert_to_commit_backs_out_cleanly_instead_of_leaving_a_mid_revert_state() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();

    repo.write("a.txt", "uncommitted, in the way\n");

    let result = revert_to_commit_sync(repo.path.clone(), target).unwrap();
    assert!(!result.success);
    assert!(
        result
            .raw_stderr
            .unwrap()
            .contains("gitroot backed this out automatically"),
        "should explain that it cleaned up after the failed revert"
    );
    assert!(!repo
        .dir
        .join("repo")
        .join(".git")
        .join("REVERT_HEAD")
        .exists());
    let status = repo.git(&["status", "--porcelain"]);
    assert!(status.stdout.contains("a.txt"));
}

#[test]
fn stage_hunk_and_discard_hunk_operate_independently() {
    let repo = TestRepo::new();
    let lines: Vec<String> = (1..=20).map(|i| format!("line{i}")).collect();
    repo.write("f.txt", &(lines.join("\n") + "\n"));
    stage_file_sync(repo.path.clone(), "f.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add f".to_string()).unwrap();

    let mut edited = lines.clone();
    edited[1] = "line2-CHANGED".to_string();
    edited[17] = "line18-CHANGED".to_string();
    repo.write("f.txt", &(edited.join("\n") + "\n"));

    let hunks = file_hunks_sync(repo.path.clone(), "f.txt".to_string())
        .unwrap()
        .hunks;
    assert_eq!(
        hunks.len(),
        2,
        "two well-separated edits should be two hunks:\n{hunks:?}"
    );
    assert!(hunks[0].contains("line2-CHANGED"));
    assert!(hunks[1].contains("line18-CHANGED"));

    apply_one_hunk(&repo.path, "f.txt", 0, &["apply", "--cached"]).unwrap();

    let staged_diff = run_git(&repo.path, &["diff", "--cached", "--", "f.txt"]).unwrap();
    assert!(staged_diff.stdout.contains("line2-CHANGED"));
    assert!(
        !staged_diff.stdout.contains("line18-CHANGED"),
        "second hunk must not have been staged too"
    );

    let remaining = file_hunks_sync(repo.path.clone(), "f.txt".to_string())
        .unwrap()
        .hunks;
    assert_eq!(remaining.len(), 1, "only the unstaged hunk should remain");
    assert!(remaining[0].contains("line18-CHANGED"));

    apply_one_hunk(&repo.path, "f.txt", 0, &["apply", "--reverse"]).unwrap();

    let after_discard = file_hunks_sync(repo.path.clone(), "f.txt".to_string())
        .unwrap()
        .hunks;
    assert!(
        after_discard.is_empty(),
        "discarded hunk should leave nothing unstaged: {after_discard:?}"
    );

    let content = std::fs::read_to_string(repo.dir.join("repo").join("f.txt")).unwrap();
    assert!(content.contains("line2-CHANGED"));
    assert!(!content.contains("line18-CHANGED"));
}

#[test]
fn file_hunks_and_staging_work_for_a_brand_new_untracked_file() {
    let repo = TestRepo::new();
    repo.write("brand-new.txt", "hello\nworld\n");

    let result = file_hunks_sync(repo.path.clone(), "brand-new.txt".to_string()).unwrap();
    assert_eq!(
        result.hunks.len(),
        1,
        "a new file's whole content should be one hunk:\n{:?}",
        result.hunks
    );
    assert!(
        !result.whole_file_only,
        "it split into a real hunk, so this shouldn't be set"
    );
    assert!(result.hunks[0].contains("+hello"));
    assert!(result.hunks[0].contains("+world"));

    apply_one_hunk(&repo.path, "brand-new.txt", 0, &["apply", "--cached"]).unwrap();
    let staged = run_git(&repo.path, &["diff", "--cached", "--", "brand-new.txt"]).unwrap();
    assert!(
        staged.stdout.contains("+hello") && staged.stdout.contains("+world"),
        "staged diff was: {}",
        staged.stdout
    );
    let status = run_git(&repo.path, &["status", "--porcelain"]).unwrap();
    assert!(
        status.stdout.contains("A  brand-new.txt"),
        "status was: {}",
        status.stdout
    );
}

#[test]
fn stage_hunk_lines_stages_only_the_selected_lines_within_one_hunk() {
    let repo = TestRepo::new();
    repo.write("f.txt", "a\nb\nc\n");
    stage_file_sync(repo.path.clone(), "f.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add f".to_string()).unwrap();

    repo.write("f.txt", "a\nNEW1\nNEW2\nNEW3\nb\nc\n");
    let result = file_hunks_sync(repo.path.clone(), "f.txt".to_string()).unwrap();
    assert_eq!(
        result.hunks.len(),
        1,
        "three adjacent additions should still be one hunk:\n{:?}",
        result.hunks
    );
    let hunk = &result.hunks[0];
    // index 0 is the "@@" line, real content start at index 1
    assert_eq!(hunk.lines().nth(2).unwrap(), "+NEW1");
    assert_eq!(hunk.lines().nth(3).unwrap(), "+NEW2");
    assert_eq!(hunk.lines().nth(4).unwrap(), "+NEW3");

    let selected: HashSet<usize> = [3].into_iter().collect();
    apply_selected_hunk_lines(
        &repo.path,
        "f.txt",
        0,
        &selected,
        false,
        &["apply", "--cached", "--recount"],
    )
    .unwrap();

    let staged = run_git(&repo.path, &["diff", "--cached", "--", "f.txt"]).unwrap();
    assert!(
        staged.stdout.contains("+NEW2"),
        "staged diff was: {}",
        staged.stdout
    );
    assert!(
        !staged.stdout.contains("NEW1") && !staged.stdout.contains("NEW3"),
        "only NEW2 should be staged: {}",
        staged.stdout
    );

    let content = std::fs::read_to_string(repo.dir.join("repo").join("f.txt")).unwrap();
    assert_eq!(content, "a\nNEW1\nNEW2\nNEW3\nb\nc\n");
    let remaining = file_hunks_sync(repo.path.clone(), "f.txt".to_string()).unwrap();
    assert_eq!(remaining.hunks.len(), 1);
    assert!(remaining.hunks[0].contains("+NEW1") && remaining.hunks[0].contains("+NEW3"));
    assert!(
        !remaining.hunks[0].contains("+NEW2"),
        "NEW2 is staged now, shouldn't still show as a pending addition: {}",
        remaining.hunks[0]
    );
}

#[test]
fn discard_hunk_lines_removes_only_the_selected_lines_from_the_working_tree() {
    let repo = TestRepo::new();
    repo.write("f.txt", "a\nb\nc\n");
    stage_file_sync(repo.path.clone(), "f.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add f".to_string()).unwrap();
    repo.write("f.txt", "a\nNEW1\nNEW2\nNEW3\nb\nc\n");

    let selected: HashSet<usize> = [2].into_iter().collect();
    apply_selected_hunk_lines(
        &repo.path,
        "f.txt",
        0,
        &selected,
        true,
        &["apply", "--reverse", "--recount"],
    )
    .unwrap();

    let content = std::fs::read_to_string(repo.dir.join("repo").join("f.txt")).unwrap();
    assert_eq!(content, "a\nNEW2\nNEW3\nb\nc\n", "only NEW1 should be gone");
}

#[test]
fn stage_hunk_lines_splits_a_brand_new_file_into_chosen_lines() {
    let repo = TestRepo::new();
    repo.write("new.txt", "one\ntwo\nthree\nfour\n");

    let result = file_hunks_sync(repo.path.clone(), "new.txt".to_string()).unwrap();
    assert_eq!(result.hunks.len(), 1);
    let hunk = &result.hunks[0];
    assert_eq!(hunk.lines().nth(1).unwrap(), "+one");
    assert_eq!(hunk.lines().nth(2).unwrap(), "+two");
    assert_eq!(hunk.lines().nth(3).unwrap(), "+three");
    assert_eq!(hunk.lines().nth(4).unwrap(), "+four");

    let selected: HashSet<usize> = [1, 3].into_iter().collect();
    apply_selected_hunk_lines(
        &repo.path,
        "new.txt",
        0,
        &selected,
        false,
        &["apply", "--cached", "--recount"],
    )
    .unwrap();

    let staged = run_git(&repo.path, &["show", ":new.txt"]).unwrap();
    assert_eq!(
        staged.stdout, "one\nthree\n",
        "index should hold exactly the two selected lines"
    );

    let content = std::fs::read_to_string(repo.dir.join("repo").join("new.txt")).unwrap();
    assert_eq!(content, "one\ntwo\nthree\nfour\n");
    let remaining = file_hunks_sync(repo.path.clone(), "new.txt".to_string()).unwrap();
    assert!(remaining.hunks.iter().any(|h| h.contains("+two")));
    assert!(remaining.hunks.iter().any(|h| h.contains("+four")));
    assert!(!remaining
        .hunks
        .iter()
        .any(|h| h.contains("+one") || h.contains("+three")));
}

#[test]
fn selecting_zero_lines_fails_clearly_instead_of_applying_an_empty_patch() {
    let repo = TestRepo::new();
    repo.write("f.txt", "hello\n");
    let empty: HashSet<usize> = HashSet::new();
    let err = apply_selected_hunk_lines(
        &repo.path,
        "f.txt",
        0,
        &empty,
        false,
        &["apply", "--cached", "--recount"],
    )
    .unwrap_err();
    assert!(err.contains("select at least one line"), "error was: {err}");
}

#[test]
fn a_changed_binary_file_reports_whole_file_only_instead_of_looking_clean() {
    let repo = TestRepo::new();
    repo.write_bytes("image.bin", &[0, 1, 2, 3, 4]);
    stage_file_sync(repo.path.clone(), "image.bin".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add binary".to_string()).unwrap();
    repo.write_bytes("image.bin", &[5, 6, 7, 8, 9, 10]);

    let result = file_hunks_sync(repo.path.clone(), "image.bin".to_string()).unwrap();
    assert!(
        result.hunks.is_empty(),
        "a binary diff has no line hunks to split: {:?}",
        result.hunks
    );
    assert!(
        result.whole_file_only,
        "the file really did change — this must not look like a clean file"
    );
}

#[test]
fn discard_file_reverts_a_tracked_file_and_deletes_an_untracked_one() {
    let repo = TestRepo::new();
    repo.write("tracked.txt", "original\n");
    stage_file_sync(repo.path.clone(), "tracked.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add tracked".to_string()).unwrap();
    repo.write("tracked.txt", "modified\n");
    repo.write("untracked.txt", "scratch\n");

    discard_file_sync(repo.path.clone(), "tracked.txt".to_string()).unwrap();
    let content = std::fs::read_to_string(repo.dir.join("repo").join("tracked.txt")).unwrap();
    assert_eq!(
        content, "original\n",
        "discarding a tracked file should restore its last committed content"
    );

    discard_file_sync(repo.path.clone(), "untracked.txt".to_string()).unwrap();
    assert!(
        !repo.dir.join("repo").join("untracked.txt").exists(),
        "discarding an untracked file should remove it — there's no earlier version to restore"
    );
}

#[test]
fn discarding_a_new_untracked_file_s_only_hunk_removes_it_from_disk() {
    let repo = TestRepo::new();
    repo.write("scratch.txt", "throwaway\n");

    apply_one_hunk(&repo.path, "scratch.txt", 0, &["apply", "--reverse"]).unwrap();

    assert!(
        !repo.dir.join("repo").join("scratch.txt").exists(),
        "discarding a new file's only hunk should remove it"
    );
    let status = run_git(&repo.path, &["status", "--porcelain"]).unwrap();
    assert!(
        !status.stdout.contains("scratch.txt"),
        "status was: {}",
        status.stdout
    );
}

#[test]
fn hunk_operations_fail_clearly_when_the_hunk_no_longer_exists() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();
    let err = apply_one_hunk(&repo.path, "a.txt", 0, &["apply", "--cached"]).unwrap_err();
    assert!(err.contains("isn't there anymore"), "error was: {err}");
}

#[test]
fn recognizes_common_auth_failure_messages_but_not_other_errors() {
    assert!(looks_like_auth_error(
        "fatal: Authentication failed for 'https://example.com/repo.git'"
    ));
    assert!(looks_like_auth_error(
        "remote: Support for password authentication was removed\nfatal: Authentication failed"
    ));
    assert!(looks_like_auth_error(
        "Permission denied (publickey).\nfatal: Could not read from remote repository."
    ));
    assert!(looks_like_auth_error(
        "fatal: could not read Username for 'https://example.com': terminal prompts disabled"
    ));
    assert!(!looks_like_auth_error(
        "CONFLICT (content): Merge conflict in README.md"
    ));
    assert!(!looks_like_auth_error(
        "fatal: repository 'https://example.com/x.git' not found"
    ));
}

#[test]
fn recognizes_unreachable_remote_as_network_not_auth() {
    let stderr = "ssh: connect to host gitlab.corp.example.com port 22: Operation timed out\r\nfatal: Could not read from remote repository.\n\nPlease make sure you have the correct access rights\nand the repository exists.";
    assert!(looks_like_network_error(stderr));
    assert!(!looks_like_auth_error(stderr));

    let result = CommandResult::from_remote_failure("git pull", stderr.to_string(), "origin/main");
    assert!(!result.success);
    assert!(result.network_error);
    assert!(!result.auth_error);
    assert_eq!(result.data["remote"], "origin/main");
    assert_eq!(result.command, "git pull");

    assert!(looks_like_network_error(
        "fatal: unable to access 'https://example.com/x.git/': Could not resolve host: example.com"
    ));
    assert!(looks_like_network_error(
        "ssh: connect to host example.com port 22: Connection refused"
    ));
    assert!(!looks_like_network_error(
        "fatal: Authentication failed for 'https://example.com/repo.git'"
    ));
}

#[test]
fn commit_reports_before_head_so_it_can_be_undone() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    let head_before = short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout);

    let result = commit_sync(repo.path.clone(), "add a".to_string()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["beforeHead"], head_before);
}

#[test]
fn commit_reports_no_before_head_on_the_very_first_commit_ever() {
    let dir = std::env::temp_dir().join(format!(
        "gitroot-first-commit-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    run_git(&path, &["init", "-q", "-b", "main"]).unwrap();
    run_git(&path, &["config", "user.email", "test@example.com"]).unwrap();
    run_git(&path, &["config", "user.name", "Test"]).unwrap();
    std::fs::write(dir.join("a.txt"), "1\n").unwrap();
    stage_file_sync(path.clone(), "a.txt".to_string()).unwrap();

    let result = commit_sync(path.clone(), "first ever".to_string()).unwrap();
    assert!(result.success);
    assert!(
        result.data["beforeHead"].is_null(),
        "there's no prior commit to undo back to"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn uncommit_to_moves_head_back_and_keeps_the_change_staged() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    let before_commit = short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout);
    assert!(
        commit_sync(repo.path.clone(), "add a".to_string())
            .unwrap()
            .success
    );

    let undo = uncommit_to_sync(repo.path.clone(), before_commit.clone()).unwrap();
    assert!(undo.success);
    assert_eq!(undo.data["after"], before_commit);

    let head = short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout);
    assert_eq!(head, before_commit);
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.contains("A  a.txt"),
        "the change should still be staged, not lost: {}",
        status.stdout
    );
}

#[test]
fn hard_reset_to_refuses_on_a_dirty_tree_but_succeeds_once_it_s_clean() {
    let repo = TestRepo::new();
    let before = short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout);
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();

    repo.write("scratch.txt", "wip\n");
    let blocked = hard_reset_to_sync(repo.path.clone(), before.clone()).unwrap();
    assert!(!blocked.success);
    assert_ne!(
        short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout),
        before,
        "should not have reset yet"
    );

    std::fs::remove_file(repo.dir.join("repo").join("scratch.txt")).unwrap();
    let result = hard_reset_to_sync(repo.path.clone(), before.clone()).unwrap();
    assert!(result.success);
    assert_eq!(short_hash(&repo.git(&["rev-parse", "HEAD"]).stdout), before);
    assert!(
        !repo.dir.join("repo").join("a.txt").exists(),
        "the undone commit's file should be gone too"
    );
}

#[test]
fn push_reports_had_upstream_so_undo_knows_a_revert_is_safe() {
    let repo = TestRepo::new();
    repo.write("a.txt", "1\n");
    stage_file_sync(repo.path.clone(), "a.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add a".to_string()).unwrap();

    let result = push_sync(repo.path.clone()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["hadUpstream"], true);
}

#[test]
fn push_reports_no_upstream_on_a_brand_new_branch() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("feature.txt", "new stuff\n");
    stage_file_sync(repo.path.clone(), "feature.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "add feature.txt".to_string()).unwrap();

    let result = push_sync(repo.path.clone()).unwrap();
    assert!(result.success);
    assert_eq!(result.data["hadUpstream"], false);
}

#[test]
fn stash_pop_brings_back_what_stash_set_aside() {
    let repo = TestRepo::new();
    repo.write("README.md", "hello\nmodified\n");

    assert!(stash_sync(repo.path.clone()).unwrap().success);
    assert!(
        repo.git(&["status", "--porcelain"]).stdout.is_empty(),
        "working tree should be clean after stash"
    );

    let pop_result = stash_pop_sync(repo.path.clone()).unwrap();
    assert!(pop_result.success);
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.contains("README.md"),
        "the change should be back: {}",
        status.stdout
    );
    assert!(
        repo.git(&["stash", "list"]).stdout.is_empty(),
        "stash entry should be consumed by pop"
    );
}

#[test]
fn list_stashes_reports_every_entry_newest_first_with_branch_parsed_out() {
    let repo = TestRepo::new(); // starts on "main"
    repo.write("README.md", "hello\nfirst change\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success);

    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("README.md", "hello\nsecond change\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success);

    let stashes = list_stashes_sync(repo.path.clone()).unwrap();
    assert_eq!(stashes.len(), 2, "{stashes:?}");
    assert_eq!(stashes[0].stash_ref, "stash@{0}");
    assert_eq!(stashes[0].branch.as_deref(), Some("feature"));
    assert_eq!(stashes[1].stash_ref, "stash@{1}");
    assert_eq!(stashes[1].branch.as_deref(), Some("main"));
}

#[test]
fn list_stashes_is_empty_for_a_repo_with_no_stashes() {
    let repo = TestRepo::new();
    assert!(list_stashes_sync(repo.path.clone()).unwrap().is_empty());
}

#[test]
fn apply_stash_keeps_the_entry_so_it_can_still_be_dropped_later() {
    let repo = TestRepo::new();
    repo.write("README.md", "hello\nchanged\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success);

    let result = apply_stash_sync(repo.path.clone(), "stash@{0}".to_string()).unwrap();
    assert!(result.success);
    let status = repo.git(&["status", "--porcelain"]);
    assert!(status.stdout.contains("README.md"), "{}", status.stdout);
    assert_eq!(
        list_stashes_sync(repo.path.clone()).unwrap().len(),
        1,
        "apply should not consume the stash entry"
    );
}

#[test]
fn pop_stash_targets_a_specific_entry_not_just_the_top_of_the_stack() {
    let repo = TestRepo::new();
    repo.commit_new_file("b.txt", "1\n", "add b.txt");
    // plain `git stash` only picks up tracked changes, so both entries need to
    // touch files git already knows about (README.md from TestRepo::new, b.txt here)
    repo.write("README.md", "hello\nfirst change\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success); // becomes stash@{0}, then {1}
    repo.write("b.txt", "2\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success); // stash@{0}, pushes README's to {1}

    // pop the OLDER entry (now stash@{1}), the newer one (stash@{0}) should be untouched
    let result = pop_stash_sync(repo.path.clone(), "stash@{1}".to_string()).unwrap();
    assert!(result.success, "{:?}", result.raw_stderr);

    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.contains("README.md"),
        "the older stash's change should be restored: {}",
        status.stdout
    );
    let remaining = list_stashes_sync(repo.path.clone()).unwrap();
    assert_eq!(remaining.len(), 1, "only the popped entry should be gone");
}

#[test]
fn drop_stash_removes_only_the_targeted_entry() {
    let repo = TestRepo::new();
    repo.commit_new_file("b.txt", "1\n", "add b.txt");
    repo.write("README.md", "hello\nfirst change\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success);
    repo.write("b.txt", "2\n");
    assert!(stash_sync(repo.path.clone()).unwrap().success);

    let result = drop_stash_sync(repo.path.clone(), "stash@{1}".to_string()).unwrap();
    assert!(result.success, "{:?}", result.raw_stderr);

    let remaining = list_stashes_sync(repo.path.clone()).unwrap();
    assert_eq!(remaining.len(), 1, "only the other entry should remain");
    assert!(
        !repo.git(&["status", "--porcelain"]).stdout.contains("README.md"),
        "a dropped entry's change must not come back to the working tree"
    );
}

#[test]
fn undo_create_branch_deletes_it_and_switches_back_when_nothing_was_committed_on_it() {
    let repo = TestRepo::new();
    create_branch_sync(repo.path.clone(), "feature".to_string(), "main".to_string()).unwrap();

    let result =
        undo_create_branch_sync(repo.path.clone(), "feature".to_string(), "main".to_string())
            .unwrap();
    assert!(result.success);

    let branches = list_branches_sync(repo.path.clone()).unwrap();
    assert!(
        branches.iter().all(|b| b.name != "feature"),
        "feature should be deleted"
    );
    assert!(
        branches
            .iter()
            .find(|b| b.name == "main")
            .unwrap()
            .is_current
    );
}

#[test]
fn undo_create_branch_refuses_once_the_branch_has_its_own_commits() {
    let repo = TestRepo::new();
    create_branch_sync(repo.path.clone(), "feature".to_string(), "main".to_string()).unwrap();
    repo.write("feature.txt", "real work\n");
    stage_file_sync(repo.path.clone(), "feature.txt".to_string()).unwrap();
    commit_sync(repo.path.clone(), "real work".to_string()).unwrap();

    let result =
        undo_create_branch_sync(repo.path.clone(), "feature".to_string(), "main".to_string())
            .unwrap();
    assert!(!result.success);
    let branches = list_branches_sync(repo.path.clone()).unwrap();
    assert!(
        branches.iter().any(|b| b.name == "feature"),
        "feature and its commit should not have been touched"
    );
}

// ===== merge =====

#[test]
fn merge_preview_reports_fast_forward_when_current_branch_has_no_new_commits() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("a.txt", "1\n", "on feature");
    repo.git(&["checkout", "-q", "main"]);

    let preview = merge_preview_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert_eq!(preview.outcome, "fastForward");
    assert_eq!(preview.commits, 1);
    assert!(preview.files.is_empty());
    assert_eq!(preview.current_branch, "main");
}

#[test]
fn merge_preview_reports_clean_when_both_sides_diverged_without_touching_the_same_lines() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("feature.txt", "1\n", "on feature");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file("main.txt", "1\n", "on main");

    let preview = merge_preview_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert_eq!(preview.outcome, "clean");
    assert_eq!(preview.commits, 1);
    assert!(preview.files.is_empty());
}

#[test]
fn merge_preview_names_the_conflicting_files_without_touching_the_working_tree() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("README.md", "feature version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on feature"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("README.md", "main version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on main"]);

    let preview = merge_preview_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert_eq!(preview.outcome, "conflict");
    assert_eq!(preview.files, vec!["README.md".to_string()]);

    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.is_empty(),
        "merge-tree must not touch the working directory: {}",
        status.stdout
    );
}

#[test]
fn merge_branch_fast_forwards_without_creating_a_merge_commit() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("a.txt", "1\n", "on feature");
    let feature_head = repo
        .git(&["rev-parse", "feature"])
        .stdout
        .trim()
        .to_string();
    repo.git(&["checkout", "-q", "main"]);

    let result = merge_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(result.data["fastForward"], true);
    assert_eq!(result.data["commits"], 1);

    let head = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    assert_eq!(
        head, feature_head,
        "a fast-forward just moves the pointer to feature's tip"
    );
    let parents = repo.git(&["rev-list", "--parents", "-1", "HEAD"]).stdout;
    // rev-list --parents also print the commit itself, so 2 means 1 real parent
    assert_eq!(
        parents.trim().split(' ').count(),
        2,
        "fast-forward must not create a merge commit"
    );
}

#[test]
fn merge_branch_creates_a_merge_commit_when_both_sides_diverged_cleanly() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("feature.txt", "1\n", "on feature");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file("main.txt", "1\n", "on main");

    let result = merge_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(result.data["fastForward"], false);

    let parents = repo.git(&["rev-list", "--parents", "-1", "HEAD"]).stdout;
    // same here, 3 means 2 real parents so it is a real merge commit
    assert_eq!(
        parents.trim().split(' ').count(),
        3,
        "a real merge commit has two parents"
    );
    assert!(repo.dir.join("repo").join("feature.txt").exists());
    assert!(repo.dir.join("repo").join("main.txt").exists());
}

#[test]
fn merge_branch_pauses_on_conflict_and_continue_merge_finishes_it_once_resolved() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("README.md", "feature version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on feature"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("README.md", "main version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on main"]);

    let result = merge_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(!result.success);
    assert!(
        result.conflict,
        "a real conflict should pause, not fail outright"
    );
    assert_eq!(result.data["files"], serde_json::json!(["README.md"]));
    assert!(std::path::Path::new(&repo.path)
        .join(".git/MERGE_HEAD")
        .exists());

    let blocked = continue_merge_sync(repo.path.clone()).unwrap();
    assert!(
        blocked.conflict,
        "continuing before resolving should stay paused"
    );

    repo.write("README.md", "resolved\n");
    repo.git(&["add", "README.md"]);
    let finished = continue_merge_sync(repo.path.clone()).unwrap();
    assert!(finished.success, "stderr: {:?}", finished.raw_stderr);
    assert!(!std::path::Path::new(&repo.path)
        .join(".git/MERGE_HEAD")
        .exists());
    let parents = repo.git(&["rev-list", "--parents", "-1", "HEAD"]).stdout;
    assert_eq!(
        parents.trim().split(' ').count(),
        3,
        "a real merge commit has two parents"
    );
}

#[test]
fn abort_merge_restores_the_pre_merge_state() {
    let repo = TestRepo::new();
    let before = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.write("README.md", "feature version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on feature"]);
    repo.git(&["checkout", "-q", "main"]);
    repo.write("README.md", "main version\n");
    repo.git(&["commit", "-q", "-am", "conflicting change on main"]);
    let main_head = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    assert_ne!(before, main_head);

    let result = merge_branch_sync(repo.path.clone(), "feature".to_string()).unwrap();
    assert!(result.conflict);

    abort_merge_sync(&repo.path).unwrap();
    assert!(!std::path::Path::new(&repo.path)
        .join(".git/MERGE_HEAD")
        .exists());
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.is_empty(),
        "abort should leave a clean working tree: {}",
        status.stdout
    );
    assert_eq!(
        repo.git(&["rev-parse", "HEAD"]).stdout.trim(),
        main_head,
        "abort should not move HEAD"
    );
}

// ===== rebase =====

#[test]
fn rebase_preflight_reports_zero_already_pushed_when_the_branch_has_no_upstream() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("a.txt", "1\n", "feature commit");

    let preflight = rebase_preflight_sync(repo.path.clone(), "main".to_string()).unwrap();
    assert!(!preflight.has_upstream);
    assert_eq!(preflight.total_commits, 1);
    assert_eq!(preflight.already_pushed_count, 0);
}

#[test]
fn rebase_preflight_detects_commits_already_pushed_to_the_remote_tracking_branch() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("f1.txt", "1\n", "f1");
    repo.commit_new_file("f2.txt", "1\n", "f2");
    repo.git(&["push", "-q", "-u", "origin", "feature"]);
    repo.commit_new_file("f3.txt", "1\n", "f3 not pushed yet");

    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file("main2.txt", "1\n", "main moved on");
    repo.git(&["checkout", "-q", "feature"]);

    let preflight = rebase_preflight_sync(repo.path.clone(), "main".to_string()).unwrap();
    assert!(preflight.has_upstream);
    assert_eq!(preflight.upstream.as_deref(), Some("origin/feature"));
    assert_eq!(preflight.total_commits, 3);
    assert_eq!(
        preflight.already_pushed_count, 2,
        "f1 and f2 were pushed, f3 wasn't"
    );
}

#[test]
fn rebase_branch_replays_commits_onto_the_target_with_new_hashes() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("f1.txt", "1\n", "f1");
    let old_hash = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file("main.txt", "1\n", "on main");
    repo.git(&["checkout", "-q", "feature"]);

    let result = rebase_branch_sync(repo.path.clone(), "main".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(result.data["commits"], 1);

    let new_hash = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    assert_ne!(old_hash, new_hash, "a replayed commit gets a new hash");
    let is_descendant = repo.git(&["merge-base", "--is-ancestor", "main", "HEAD"]);
    assert!(
        is_descendant.success,
        "feature should now sit on top of main"
    );
    assert!(repo.dir.join("repo").join("main.txt").exists());
    assert!(repo.dir.join("repo").join("f1.txt").exists());
}

#[test]
fn rebase_status_reports_not_in_progress_outside_a_rebase() {
    let repo = TestRepo::new();
    let status = rebase_status_sync(&repo.path).unwrap();
    assert!(!status.in_progress);
}

#[test]
fn rebase_branch_pauses_on_conflict_with_correct_progress_and_continue_rebase_finishes_it() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("f.txt", "feature edit\n", "feature edit (will conflict)");
    repo.commit_new_file("other.txt", "unrelated\n", "unrelated feature commit");
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file(
        "f.txt",
        "main edit\n",
        "main edit (conflicts with feature edit)",
    );
    repo.git(&["checkout", "-q", "feature"]);

    let result = rebase_branch_sync(repo.path.clone(), "main".to_string()).unwrap();
    assert!(!result.success);
    assert!(
        result.conflict,
        "a real conflict should pause, not fail outright"
    );
    assert_eq!(result.data["files"], serde_json::json!(["f.txt"]));

    let status = rebase_status_sync(&repo.path).unwrap();
    assert!(status.in_progress);
    assert_eq!(
        (status.current, status.total),
        (1, 2),
        "stuck on the first of two commits being replayed"
    );

    repo.write("f.txt", "resolved\n");
    repo.git(&["add", "f.txt"]);
    let finished = continue_rebase_sync(repo.path.clone()).unwrap();
    assert!(finished.success, "stderr: {:?}", finished.raw_stderr);

    let status_after = rebase_status_sync(&repo.path).unwrap();
    assert!(
        !status_after.in_progress,
        "rebase should be done - no unrelated conflicts left"
    );
    assert!(repo.dir.join("repo").join("other.txt").exists());
}

#[test]
fn abort_rebase_restores_the_pre_rebase_state() {
    let repo = TestRepo::new();
    repo.git(&["checkout", "-q", "-b", "feature"]);
    repo.commit_new_file("f.txt", "feature edit\n", "feature edit (will conflict)");
    let feature_head = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.git(&["checkout", "-q", "main"]);
    repo.commit_new_file("f.txt", "main edit\n", "main edit (conflicts)");
    repo.git(&["checkout", "-q", "feature"]);

    let result = rebase_branch_sync(repo.path.clone(), "main".to_string()).unwrap();
    assert!(result.conflict);

    abort_rebase_sync(&repo.path).unwrap();
    let status = rebase_status_sync(&repo.path).unwrap();
    assert!(!status.in_progress);
    assert_eq!(
        repo.git(&["rev-parse", "HEAD"]).stdout.trim(),
        feature_head,
        "abort should restore feature's original tip"
    );
    let git_status = repo.git(&["status", "--porcelain"]);
    assert!(
        git_status.stdout.is_empty(),
        "abort should leave a clean working tree: {}",
        git_status.stdout
    );
}

// ===== diff_name_status =====

#[test]
fn diff_name_status_classifies_added_deleted_modified_and_renamed_files() {
    let repo = TestRepo::new(); // starts with README.md = "hello\n"
    repo.commit_new_file("modme.txt", "modme original\n", "add modme.txt");
    repo.commit_new_file("deleteme.txt", "deleteme original\n", "add deleteme.txt");
    let base = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();

    repo.commit_new_file("new.txt", "brand new content\n", "add new.txt");
    repo.write("modme.txt", "changed\n");
    repo.git(&["commit", "-q", "-am", "modify modme.txt"]);
    repo.git(&["rm", "-q", "deleteme.txt"]);
    repo.git(&["commit", "-q", "-am", "delete deleteme.txt"]);
    repo.git(&["mv", "README.md", "renamed.txt"]);
    repo.git(&["commit", "-q", "-am", "rename README.md"]);

    let mut files = diff_name_status_sync(repo.path.clone(), format!("{base}..HEAD")).unwrap();
    files.sort_by(|a, b| a.path.cmp(&b.path));

    assert_eq!(files.len(), 4, "{files:?}");
    assert_eq!(files[0].path, "deleteme.txt");
    assert_eq!(files[0].status, "deleted");
    assert_eq!(files[1].path, "modme.txt");
    assert_eq!(files[1].status, "modified");
    assert_eq!(files[2].path, "new.txt");
    assert_eq!(files[2].status, "added");
    assert_eq!(files[3].path, "renamed.txt");
    assert_eq!(files[3].status, "renamed");
}

#[test]
fn diff_name_status_returns_empty_for_an_identical_range() {
    let repo = TestRepo::new();
    let head = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();

    let files = diff_name_status_sync(repo.path.clone(), format!("{head}..{head}")).unwrap();
    assert!(files.is_empty());
}

// ===== reset =====

#[test]
fn reset_preflight_reports_zero_already_pushed_when_target_and_head_are_all_local() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.commit_new_file("a.txt", "1\n", "add a");

    let preflight = reset_preflight_sync(repo.path.clone(), target).unwrap();
    assert_eq!(preflight.commits, 1);
    assert_eq!(preflight.already_pushed_count, 0);
    assert!(!preflight.has_uncommitted_changes);
}

#[test]
fn reset_preflight_detects_commits_already_pushed_to_the_remote_tracking_branch() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.commit_new_file("a.txt", "1\n", "pushed commit");
    repo.git(&["push", "-q", "origin", "HEAD:main"]);
    repo.commit_new_file("b.txt", "1\n", "local only commit");
    repo.write("c.txt", "uncommitted\n");

    let preflight = reset_preflight_sync(repo.path.clone(), target).unwrap();
    assert_eq!(preflight.commits, 2);
    assert_eq!(
        preflight.already_pushed_count, 1,
        "only the first commit was pushed"
    );
    assert!(preflight.has_uncommitted_changes);
}

#[test]
fn reset_to_commit_soft_keeps_the_change_staged() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.commit_new_file("a.txt", "1\n", "add a");

    let result =
        reset_to_commit_sync(repo.path.clone(), target.clone(), "soft".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(result.data["commits"], 1);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]).stdout.trim(), target);
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.contains("A  a.txt"),
        "change should stay staged: {}",
        status.stdout
    );
}

#[test]
fn reset_to_commit_mixed_keeps_the_change_but_unstaged() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.commit_new_file("a.txt", "1\n", "add a");

    let result =
        reset_to_commit_sync(repo.path.clone(), target.clone(), "mixed".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]).stdout.trim(), target);
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.contains("?? a.txt"),
        "change should be unstaged: {}",
        status.stdout
    );
}

#[test]
fn reset_to_commit_hard_discards_the_change_entirely() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    repo.commit_new_file("a.txt", "1\n", "add a");

    let result =
        reset_to_commit_sync(repo.path.clone(), target.clone(), "hard".to_string()).unwrap();
    assert!(result.success, "stderr: {:?}", result.raw_stderr);
    assert_eq!(repo.git(&["rev-parse", "HEAD"]).stdout.trim(), target);
    assert!(!repo.dir.join("repo").join("a.txt").exists());
    let status = repo.git(&["status", "--porcelain"]);
    assert!(
        status.stdout.is_empty(),
        "hard reset should leave a clean tree: {}",
        status.stdout
    );
}

#[test]
fn reset_to_commit_rejects_an_unknown_mode() {
    let repo = TestRepo::new();
    let target = repo.git(&["rev-parse", "HEAD"]).stdout.trim().to_string();
    let result = reset_to_commit_sync(repo.path.clone(), target, "banana".to_string()).unwrap();
    assert!(!result.success);
}

// note: git revert of a full target..HEAD range is always a byte-exact undo of a clean linear
// history, so it can't actually conflict on its own - continue/abort just need to behave sanely
// when there is nothing in progress, which is what they will see in real use most of the time
#[test]
fn continue_revert_fails_cleanly_when_nothing_is_in_progress() {
    let repo = TestRepo::new();
    let result = continue_revert_sync(repo.path.clone()).unwrap();
    assert!(!result.success);
}

#[test]
fn abort_revert_fails_cleanly_when_nothing_is_in_progress() {
    let repo = TestRepo::new();
    assert!(abort_revert_sync(&repo.path).is_err());
}
