use super::*;

#[test]
fn recognizes_timeouts_and_connection_failures_as_network_not_auth() {
    assert!(looks_like_network_error(
        "ssh: connect to host example.com port 22: Operation timed out"
    ));
    assert!(looks_like_network_error(
        "gitroot: timed out waiting for git — the remote may be unreachable (check your network or VPN)"
    ));
    assert!(!looks_like_network_error(
        "fatal: Authentication failed for 'https://example.com/repo.git'"
    ));
}

#[test]
fn hard_timeout_kills_a_hung_git_process() {
    // ext:: run "sleep" as a fake remote, so it looks like it hang
    let dir = std::env::temp_dir().join(format!(
        "gitroot-timeout-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    let git = |args: &[&str]| {
        let out = Command::new("git")
            .arg("-C")
            .arg(&path)
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
    git(&["init", "-q", "-b", "main"]);
    git(&["config", "user.email", "test@example.com"]);
    git(&["config", "user.name", "Test"]);
    git(&["remote", "add", "origin", "ext::sleep 120"]);
    // ext:: is blocked by default, need to allow it here
    git(&["config", "protocol.ext.allow", "always"]);

    let start = Instant::now();
    let result = run_git_with_timeout(&path, &["fetch"], Duration::from_secs(2))
        .expect("run_git_with_timeout itself should not error");
    let elapsed = start.elapsed();

    assert!(!result.success);
    assert!(
        result.stderr.contains("timed out"),
        "stderr was: {}",
        result.stderr
    );
    assert!(
        elapsed < Duration::from_secs(10),
        "took {elapsed:?} — timeout did not actually bound the wait"
    );

    std::fs::remove_dir_all(&dir).ok();
}

fn temp_dir(label: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!(
        "gitroot-{label}-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn current_branch_name_works_before_the_first_commit() {
    // this test is for a bug where rev-parse fail on repo with zero commit
    let dir = temp_dir("branch-name-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .arg("init")
        .arg("-q")
        .arg("-b")
        .arg("main")
        .output()
        .unwrap();

    let branch = current_branch_name(&path).expect("should resolve even with zero commits");
    assert!(
        !branch.is_empty(),
        "branch name should not be empty before any commit exists"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn init_repo_creates_a_working_repo_and_reports_a_real_branch_name() {
    let dir = temp_dir("init-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();

    let info = init_repo_sync(path.clone(), None)
        .expect("init_repo_sync should succeed on an empty folder");
    assert_eq!(info.path, path);
    assert!(
        !info.current_branch.is_empty(),
        "should have a real branch name, not the empty string this bug used to produce"
    );

    let check = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["rev-parse", "--is-inside-work-tree"])
        .output()
        .unwrap();
    assert!(check.status.success());
    assert_eq!(String::from_utf8_lossy(&check.stdout).trim(), "true");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn init_repo_links_the_given_remote_url_as_origin() {
    let dir = temp_dir("init-remote-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();

    init_repo_sync(
        path.clone(),
        Some("https://example.com/team/project.git".to_string()),
    )
    .expect("init_repo_sync with a remote should succeed");

    let remotes = Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["remote", "-v"])
        .output()
        .unwrap();
    let remotes = String::from_utf8_lossy(&remotes.stdout);
    assert!(
        remotes.contains("origin") && remotes.contains("https://example.com/team/project.git"),
        "remotes were: {remotes}"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn repo_name_from_url_handles_https_and_scp_style_urls() {
    assert_eq!(
        repo_name_from_url("https://github.com/user/my-repo.git"),
        "my-repo"
    );
    assert_eq!(
        repo_name_from_url("https://github.com/user/my-repo"),
        "my-repo"
    );
    assert_eq!(
        repo_name_from_url("https://github.com/user/my-repo/"),
        "my-repo"
    );
    assert_eq!(
        repo_name_from_url("git@github.com:user/my-repo.git"),
        "my-repo"
    );
    assert_eq!(repo_name_from_url("git@github.com:my-repo.git"), "my-repo");
    assert_eq!(
        repo_name_from_url("  https://github.com/user/spaced.git  "),
        "spaced"
    );
}

#[test]
fn clone_repo_creates_a_named_subfolder_with_real_history() {
    let dir = temp_dir("clone-test");
    let remote_dir = dir.join("remote.git");
    let dest_dir = dir.join("destination");
    std::fs::create_dir_all(&remote_dir).unwrap();
    std::fs::create_dir_all(&dest_dir).unwrap();
    let remote_path = remote_dir.to_string_lossy().to_string();

    let seed_dir = dir.join("seed");
    std::fs::create_dir_all(&seed_dir).unwrap();
    let seed_path = seed_dir.to_string_lossy().to_string();
    let git = |cwd: &str, args: &[&str]| {
        let out = Command::new("git")
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
    git(
        &dir.to_string_lossy(),
        &["init", "--bare", "-q", "-b", "main", &remote_path],
    );
    git(&seed_path, &["init", "-q", "-b", "main"]);
    git(&seed_path, &["config", "user.email", "test@example.com"]);
    git(&seed_path, &["config", "user.name", "Test"]);
    git(&seed_path, &["remote", "add", "origin", &remote_path]);
    std::fs::write(seed_dir.join("README.md"), "hello\n").unwrap();
    git(&seed_path, &["add", "README.md"]);
    git(&seed_path, &["commit", "-q", "-m", "initial"]);
    git(&seed_path, &["push", "-q", "-u", "origin", "HEAD:main"]);

    let dest_path = dest_dir.to_string_lossy().to_string();
    let info =
        clone_repo_sync(remote_path.clone(), dest_path.clone()).expect("clone should succeed");
    assert_eq!(info.name, "remote");
    assert_eq!(
        info.path,
        dest_dir.join("remote").to_string_lossy().to_string()
    );
    assert_eq!(info.current_branch, "main");
    assert!(
        dest_dir.join("remote").join("README.md").exists(),
        "cloned working tree should have the real file"
    );

    let second = clone_repo_sync(remote_path, dest_path);
    assert!(
        second.is_err(),
        "cloning into an already-used name should fail, not overwrite"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn check_git_available_finds_the_real_git_this_whole_suite_depends_on() {
    let info = check_git_available_sync().unwrap();
    assert!(info.available);
    assert!(info.version.is_some());
}

#[test]
fn check_git_identity_reads_the_repo_s_configured_name_and_email() {
    let dir = temp_dir("identity-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["init", "-q", "-b", "main"])
        .output()
        .unwrap();
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["config", "user.name", "Ada Lovelace"])
        .output()
        .unwrap();
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["config", "user.email", "ada@example.com"])
        .output()
        .unwrap();

    let identity = check_git_identity_sync(path.clone()).unwrap();
    assert_eq!(identity.name.as_deref(), Some("Ada Lovelace"));
    assert_eq!(identity.email.as_deref(), Some("ada@example.com"));

    std::fs::remove_dir_all(&dir).ok();
}

// important: we do not test set_git_identity_sync here, because it write to the real
// ~/.gitconfig on your machine, and a test must never touch that for real
#[test]
fn git_config_value_returns_none_for_a_key_that_was_never_set() {
    let dir = temp_dir("identity-unset-test");
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();
    Command::new("git")
        .arg("-C")
        .arg(&path)
        .args(["init", "-q", "-b", "main"])
        .output()
        .unwrap();

    assert_eq!(
        git_config_value(&path, "gitroot.definitely-not-a-real-key"),
        None
    );

    std::fs::remove_dir_all(&dir).ok();
}
