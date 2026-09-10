use super::*;
use std::process::Command as StdCommand;

fn build_test_repo() -> String {
    let dir = std::env::temp_dir().join(format!(
        "gitroot-raw-test-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.to_string_lossy().to_string();

    let git = |args: &[&str]| {
        let out = StdCommand::new("git")
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
    std::fs::write(dir.join("a.txt"), "1\n").unwrap();
    git(&["add", "a.txt"]);
    git(&["commit", "-q", "-m", "base"]);

    path
}

#[test]
fn tokenize_splits_on_plain_whitespace() {
    assert_eq!(tokenize("log --oneline -5"), vec!["log", "--oneline", "-5"]);
}

#[test]
fn tokenize_keeps_a_quoted_argument_together() {
    assert_eq!(
        tokenize(r#"commit -m "fix: something with spaces""#),
        vec!["commit", "-m", "fix: something with spaces"]
    );
}

#[test]
fn tokenize_handles_single_quotes_too() {
    assert_eq!(tokenize("commit -m 'wip'"), vec!["commit", "-m", "wip"]);
}

#[test]
fn tokenize_of_blank_input_is_empty() {
    assert!(tokenize("   ").is_empty());
    assert!(tokenize("").is_empty());
}

#[test]
fn runs_a_real_command_and_reports_success() {
    let repo = build_test_repo();
    let result =
        run_raw_command_sync(repo.clone(), "log --oneline".to_string()).expect("should succeed");

    assert!(result.success);
    assert_eq!(result.command, "git log --oneline");
    assert!(result.stdout.contains("base"));
    assert!(result.stderr.is_empty());

    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn a_quoted_commit_message_survives_the_round_trip() {
    let repo = build_test_repo();
    std::fs::write(std::path::Path::new(&repo).join("a.txt"), "2\n").unwrap();
    StdCommand::new("git")
        .arg("-C")
        .arg(&repo)
        .args(["add", "a.txt"])
        .output()
        .unwrap();

    let result = run_raw_command_sync(repo.clone(), r#"commit -m "fix: two words""#.to_string())
        .expect("should succeed");
    assert!(result.success, "stderr: {}", result.stderr);

    let log = run_raw_command_sync(repo.clone(), "log -1 --format=%s".to_string())
        .expect("should succeed");
    assert_eq!(log.stdout.trim(), "fix: two words");

    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn a_failing_command_reports_success_false_with_stderr_instead_of_erroring() {
    let repo = build_test_repo();
    let result = run_raw_command_sync(repo.clone(), "not-a-real-git-command".to_string())
        .expect("should not error");

    assert!(!result.success);
    assert!(!result.stderr.is_empty());

    std::fs::remove_dir_all(&repo).ok();
}

#[test]
fn empty_input_is_reported_instead_of_running_bare_git() {
    let repo = build_test_repo();
    let result = run_raw_command_sync(repo.clone(), "   ".to_string()).expect("should not error");

    assert!(!result.success);
    assert_eq!(result.stderr, "nothing to run");

    std::fs::remove_dir_all(&repo).ok();
}
