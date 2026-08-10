use super::{
    looks_like_auth_error, looks_like_network_error, run_git, run_git_with_stdin, GitOutput,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Debug, Serialize)]
pub struct CommandResult {
    pub success: bool,
    pub auth_error: bool,
    pub network_error: bool,
    pub conflict: bool,
    pub raw_stderr: Option<String>,
    pub data: Value,
    pub command: String,
}

fn display_command(args: &[&str]) -> String {
    let mut command = String::from("git");
    for arg in args {
        command.push(' ');
        command.push_str(&quote_for_display(arg));
    }
    command
}

fn short_hash(full: &str) -> String {
    full.trim().chars().take(7).collect()
}

fn quote_for_display(arg: &str) -> String {
    let needs_quoting = arg.is_empty()
        || arg.chars().any(|c| {
            c.is_whitespace()
                || matches!(
                    c,
                    '"' | '\''
                        | '\\'
                        | '$'
                        | '`'
                        | '*'
                        | '?'
                        | '['
                        | ']'
                        | '('
                        | ')'
                        | '&'
                        | ';'
                        | '|'
                        | '<'
                        | '>'
                        | '~'
                        | '#'
                )
        });
    if !needs_quoting {
        return arg.to_string();
    }
    let escaped = arg.replace('\\', "\\\\").replace('"', "\\\"");
    format!("\"{escaped}\"")
}

impl CommandResult {
    fn ok(command: &str, data: Value) -> Self {
        Self {
            success: true,
            auth_error: false,
            network_error: false,
            conflict: false,
            raw_stderr: None,
            data,
            command: command.to_string(),
        }
    }

    fn auth_failure(command: &str, remote: &str) -> Self {
        Self {
            success: false,
            auth_error: true,
            network_error: false,
            conflict: false,
            raw_stderr: None,
            data: json!({ "remote": remote }),
            command: command.to_string(),
        }
    }

    fn network_failure(command: &str, remote: &str) -> Self {
        Self {
            success: false,
            auth_error: false,
            network_error: true,
            conflict: false,
            raw_stderr: None,
            data: json!({ "remote": remote }),
            command: command.to_string(),
        }
    }

    fn failure(command: &str, stderr: String) -> Self {
        Self {
            success: false,
            auth_error: false,
            network_error: false,
            conflict: false,
            raw_stderr: Some(stderr),
            data: json!({}),
            command: command.to_string(),
        }
    }

    fn conflict(command: &str, branch: &str, files: Vec<String>) -> Self {
        Self {
            success: false,
            auth_error: false,
            network_error: false,
            conflict: true,
            raw_stderr: None,
            data: json!({ "branch": branch, "files": files }),
            command: command.to_string(),
        }
    }

    fn conflict_with_target(command: &str, branch: &str, target: &str, files: Vec<String>) -> Self {
        let mut result = Self::conflict(command, branch, files);
        result.data["target"] = json!(target);
        result
    }

    fn from_remote_failure(command: &str, stderr: String, remote: &str) -> Self {
        if looks_like_auth_error(&stderr) {
            Self::auth_failure(command, remote)
        } else if looks_like_network_error(&stderr) {
            Self::network_failure(command, remote)
        } else {
            Self::failure(command, stderr)
        }
    }
}

fn upstream_ref(repo_path: &str) -> Option<String> {
    let out = run_git(
        repo_path,
        &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    )
    .ok()?;
    if out.success {
        Some(out.stdout.trim().to_string())
    } else {
        None
    }
}

#[tauri::command]
pub async fn pull(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || pull_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn pull_sync(repo_path: String) -> Result<CommandResult, String> {
    let remote = upstream_ref(&repo_path).unwrap_or_else(|| "origin".to_string());
    // this force pull to always use merge, not rebase, so we get same result on every machine
    let pull_args = ["pull", "--no-rebase"];
    let command = display_command(&pull_args);

    let before = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let result = run_git(&repo_path, &pull_args)?;

    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
            return Ok(CommandResult::conflict_with_target(
                &command,
                &current_branch,
                &remote,
                unmerged,
            ));
        }
        return Ok(CommandResult::from_remote_failure(
            &command,
            result.stderr,
            &remote,
        ));
    }

    let after = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let commits = if before.trim() == after.trim() {
        0
    } else {
        let range = format!("{}..{}", before.trim(), after.trim());
        run_git(&repo_path, &["rev-list", "--count", &range])?
            .stdout
            .trim()
            .parse::<u32>()
            .unwrap_or(0)
    };

    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "remote": remote,
            "before": short_hash(&before),
            "after": short_hash(&after),
        }),
    ))
}

#[tauri::command]
pub async fn push(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || push_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn push_sync(repo_path: String) -> Result<CommandResult, String> {
    let has_upstream = upstream_ref(&repo_path).is_some();
    let remote = upstream_ref(&repo_path).unwrap_or_else(|| "origin".to_string());

    let (commits, before) = if has_upstream {
        let count = run_git(&repo_path, &["rev-list", "--count", "@{u}..HEAD"])?
            .stdout
            .trim()
            .parse::<u32>()
            .unwrap_or(0);
        let upstream_hash = run_git(&repo_path, &["rev-parse", "@{u}"])?.stdout;
        (count, short_hash(&upstream_hash))
    } else {
        let count = run_git(
            &repo_path,
            &["rev-list", "--count", "HEAD", "--not", "--remotes"],
        )?
        .stdout
        .trim()
        .parse::<u32>()
        .unwrap_or(0);
        (count, "no upstream yet".to_string())
    };

    let branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let push_args: Vec<&str> = if has_upstream {
        vec!["push"]
    } else {
        vec!["push", "--set-upstream", "origin", branch.as_str()]
    };
    let command = display_command(&push_args);

    let result = run_git(&repo_path, &push_args)?;

    if !result.success {
        return Ok(CommandResult::from_remote_failure(
            &command,
            result.stderr,
            &remote,
        ));
    }

    let after = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "remote": remote,
            "before": before,
            "after": short_hash(&after),
            "hadUpstream": has_upstream,
        }),
    ))
}

#[tauri::command]
pub async fn hard_reset_to(
    repo_path: String,
    target_hash: String,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || hard_reset_to_sync(repo_path, target_hash))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn hard_reset_to_sync(repo_path: String, target_hash: String) -> Result<CommandResult, String> {
    let command = display_command(&["reset", "--hard", &target_hash]);
    let status = run_git(&repo_path, &["status", "--porcelain"])?;
    if !status.stdout.trim().is_empty() {
        return Ok(CommandResult::failure(
            &command,
            "you have uncommitted changes - commit or stash them first, then undo.".to_string(),
        ));
    }
    let old_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let result = run_git(&repo_path, &["reset", "--hard", &target_hash])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "before": short_hash(&old_head), "after": short_hash(&target_hash) }),
    ))
}

#[derive(Debug, Serialize)]
pub struct ResetPreflight {
    pub current_branch: String,
    pub target: String,
    pub commits: u32,
    pub already_pushed_count: u32,
    pub has_uncommitted_changes: bool,
}

#[tauri::command]
pub async fn reset_preflight(
    repo_path: String,
    target_hash: String,
) -> Result<ResetPreflight, String> {
    tauri::async_runtime::spawn_blocking(move || reset_preflight_sync(repo_path, target_hash))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn reset_preflight_sync(repo_path: String, target_hash: String) -> Result<ResetPreflight, String> {
    let current_branch = super::current_branch_name(&repo_path)?;
    let range = format!("{target_hash}..HEAD");
    let commits = rev_list_count(&repo_path, &range)?;

    let upstream = upstream_ref(&repo_path);
    let already_pushed_count = match &upstream {
        Some(u) => {
            let not_pushed = run_git(&repo_path, &["rev-list", "--count", &range, "--not", u])?
                .stdout
                .trim()
                .parse::<u32>()
                .unwrap_or(0);
            commits.saturating_sub(not_pushed)
        }
        None => 0,
    };

    let status = run_git(&repo_path, &["status", "--porcelain"])?;
    let has_uncommitted_changes = !status.stdout.trim().is_empty();

    Ok(ResetPreflight {
        current_branch,
        target: target_hash,
        commits,
        already_pushed_count,
        has_uncommitted_changes,
    })
}

#[tauri::command]
pub async fn reset_to_commit(
    repo_path: String,
    target_hash: String,
    mode: String,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || reset_to_commit_sync(repo_path, target_hash, mode))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn reset_to_commit_sync(
    repo_path: String,
    target_hash: String,
    mode: String,
) -> Result<CommandResult, String> {
    let flag = match mode.as_str() {
        "soft" => "--soft",
        "mixed" => "--mixed",
        "hard" => "--hard",
        _ => {
            return Ok(CommandResult::failure(
                "git reset",
                "unknown reset mode".to_string(),
            ))
        }
    };
    let command = display_command(&["reset", flag, &target_hash]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let commits = rev_list_count(&repo_path, &format!("{target_hash}..HEAD"))?;
    let old_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    let result = run_git(&repo_path, &["reset", flag, &target_hash])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "branch": current_branch,
            "target": target_hash,
            "mode": mode,
            "before": short_hash(&old_head),
            "after": short_hash(&target_hash),
        }),
    ))
}

#[tauri::command]
pub async fn stash(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || stash_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn stash_sync(repo_path: String) -> Result<CommandResult, String> {
    let command = display_command(&["stash"]);
    let status_out = run_git(&repo_path, &["status", "--porcelain"])?;
    let files = status_out
        .stdout
        .lines()
        .filter(|l| !l.is_empty() && !l.starts_with("??"))
        .count() as u32;

    let result = run_git(&repo_path, &["stash"])?;

    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    Ok(CommandResult::ok(
        &command,
        json!({
            "files": files,
            "before": format!("{files} changed file{}", if files == 1 { "" } else { "s" }),
            "after": "working directory clean",
        }),
    ))
}

#[tauri::command]
pub async fn stash_pop(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || stash_pop_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn stash_pop_sync(repo_path: String) -> Result<CommandResult, String> {
    let command = display_command(&["stash", "pop"]);
    let result = run_git(&repo_path, &["stash", "pop"])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(&command, json!({})))
}

#[derive(Debug, Serialize)]
pub struct FileStatus {
    pub path: String,
    pub staged: bool,
    pub status_label: String,
}

#[tauri::command]
pub async fn status(repo_path: String) -> Result<Vec<FileStatus>, String> {
    tauri::async_runtime::spawn_blocking(move || status_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn status_sync(repo_path: String) -> Result<Vec<FileStatus>, String> {
    let out = run_git(&repo_path, &["status", "--porcelain=v1"])?;
    if !out.success {
        return Err(out.stderr);
    }

    let mut files = Vec::new();
    for line in out.stdout.lines() {
        if line.len() < 4 {
            continue;
        }
        let x = line.chars().next().unwrap();
        let y = line.chars().nth(1).unwrap();
        // a rename line looks like "R  old -> new", we want the new path
        let raw_path = &line[3..];
        let path = raw_path
            .split(" -> ")
            .last()
            .unwrap_or(raw_path)
            .to_string();

        let staged = x != ' ' && x != '?';
        let status_label = match (x, y) {
            ('?', '?') => "untracked".to_string(),
            (_, 'M') if staged => "modified (+ more unstaged)".to_string(),
            _ if staged => "staged".to_string(),
            (_, 'M') => "modified".to_string(),
            (_, 'D') => "deleted".to_string(),
            _ => "changed".to_string(),
        };

        files.push(FileStatus {
            path,
            staged,
            status_label,
        });
    }

    Ok(files)
}

#[tauri::command]
pub async fn stage_file(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || stage_file_sync(repo_path, path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn stage_file_sync(repo_path: String, path: String) -> Result<(), String> {
    let out = run_git(&repo_path, &["add", "--", &path])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

#[tauri::command]
pub async fn unstage_file(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || unstage_file_sync(repo_path, path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn unstage_file_sync(repo_path: String, path: String) -> Result<(), String> {
    let out = run_git(&repo_path, &["restore", "--staged", "--", &path])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

#[tauri::command]
pub async fn discard_file(repo_path: String, path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || discard_file_sync(repo_path, path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn discard_file_sync(repo_path: String, path: String) -> Result<(), String> {
    let tracked = run_git(&repo_path, &["ls-files", "--error-unmatch", "--", &path])?.success;
    if !tracked {
        let full = std::path::Path::new(&repo_path).join(&path);
        return std::fs::remove_file(&full).map_err(|e| format!("couldn't remove {path}: {e}"));
    }
    let out = run_git(&repo_path, &["restore", "--", &path])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

#[tauri::command]
pub async fn file_diff(repo_path: String, path: String, staged: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || file_diff_sync(repo_path, path, staged))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn file_diff_sync(repo_path: String, path: String, staged: bool) -> Result<String, String> {
    let tracked = run_git(&repo_path, &["ls-files", "--error-unmatch", "--", &path])?.success;

    if !tracked {
        let out = run_git(
            &repo_path,
            &["diff", "--no-index", "--", "/dev/null", &path],
        )?;
        // --no-index return exit code 1 when there is a diff, that is not a real error here
        if out.success || !out.stdout.is_empty() {
            return Ok(out.stdout);
        }
        return Err(out.stderr);
    }

    let out = if staged {
        run_git(&repo_path, &["diff", "--cached", "--", &path])?
    } else {
        run_git(&repo_path, &["diff", "--", &path])?
    };
    if !out.success {
        return Err(out.stderr);
    }
    Ok(out.stdout)
}

#[tauri::command]
pub async fn commit(repo_path: String, message: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || commit_sync(repo_path, message))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn commit_sync(repo_path: String, message: String) -> Result<CommandResult, String> {
    let command = display_command(&["commit", "-m", &message]);
    let staged = run_git(&repo_path, &["diff", "--cached", "--name-only"])?;
    let files = staged.stdout.lines().filter(|l| !l.is_empty()).count() as u32;

    if files == 0 {
        return Ok(CommandResult::failure(
            &command,
            "no files are staged. check at least one file before committing.".to_string(),
        ));
    }

    let old_head = run_git(&repo_path, &["rev-parse", "HEAD"])?;
    let before_head = old_head.success.then(|| short_hash(&old_head.stdout));

    let result = run_git(&repo_path, &["commit", "-m", &message])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let branch = run_git(&repo_path, &["rev-parse", "--abbrev-ref", "HEAD"])?
        .stdout
        .trim()
        .to_string();
    let new_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    Ok(CommandResult::ok(
        &command,
        json!({
            "files": files,
            "branch": branch,
            "before": format!("{files} file{} staged", if files == 1 { "" } else { "s" }),
            "after": short_hash(&new_head),
            "beforeHead": before_head,
        }),
    ))
}

#[tauri::command]
pub async fn uncommit_to(repo_path: String, target_hash: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || uncommit_to_sync(repo_path, target_hash))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn uncommit_to_sync(repo_path: String, target_hash: String) -> Result<CommandResult, String> {
    let command = display_command(&["reset", "--soft", &target_hash]);
    let old_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let result = run_git(&repo_path, &["reset", "--soft", &target_hash])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "before": short_hash(&old_head), "after": short_hash(&target_hash) }),
    ))
}

#[tauri::command]
pub async fn repo_fingerprint(repo_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || repo_fingerprint_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn repo_fingerprint_sync(repo_path: String) -> Result<String, String> {
    let head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let branch = super::current_branch_name(&repo_path)?;
    let status = run_git(&repo_path, &["status", "--porcelain"])?.stdout;
    Ok(format!("{}|{}|{}", head.trim(), branch, status))
}

#[derive(Debug, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_current: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
}

fn ahead_behind(repo_path: &str, branch: &str, upstream: &str) -> (u32, u32) {
    let range = format!("{upstream}...{branch}");
    let Ok(out) = run_git(repo_path, &["rev-list", "--left-right", "--count", &range]) else {
        return (0, 0);
    };
    if !out.success {
        return (0, 0);
    }
    let mut parts = out.stdout.split_whitespace();
    let behind = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    let ahead = parts.next().and_then(|s| s.parse().ok()).unwrap_or(0);
    (ahead, behind)
}

#[tauri::command]
pub async fn list_branches(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_branches_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn list_branches_sync(repo_path: String) -> Result<Vec<BranchInfo>, String> {
    let out = run_git(
        &repo_path,
        &[
            "for-each-ref",
            "refs/heads",
            "--format=%(HEAD)|%(refname:short)|%(upstream:short)",
        ],
    )?;
    if !out.success {
        return Err(out.stderr);
    }

    let branches = out
        .stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('|').collect();
            if parts.len() < 2 {
                return None;
            }
            let name = parts[1].to_string();
            let upstream = parts
                .get(2)
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let (ahead, behind) = match &upstream {
                Some(u) => ahead_behind(&repo_path, &name, u),
                None => (0, 0),
            };
            Some(BranchInfo {
                is_current: parts[0] == "*",
                name,
                upstream,
                ahead,
                behind,
            })
        })
        .collect();

    Ok(branches)
}

#[tauri::command]
pub async fn switch_branch(repo_path: String, branch: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || switch_branch_sync(repo_path, branch))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn switch_branch_sync(repo_path: String, branch: String) -> Result<CommandResult, String> {
    let command = display_command(&["checkout", &branch]);
    let previous_branch =
        super::current_branch_name(&repo_path).unwrap_or_else(|_| "unknown".to_string());
    let result = run_git(&repo_path, &["checkout", &branch])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "branch": branch.clone(), "before": previous_branch, "after": branch }),
    ))
}

#[tauri::command]
pub async fn create_branch(
    repo_path: String,
    name: String,
    start_point: String,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || create_branch_sync(repo_path, name, start_point))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn create_branch_sync(
    repo_path: String,
    name: String,
    start_point: String,
) -> Result<CommandResult, String> {
    let command = display_command(&["checkout", "-b", &name, &start_point]);
    let result = run_git(&repo_path, &["checkout", "-b", &name, &start_point])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "branch": name.clone(), "from": start_point.clone(), "before": start_point, "after": name }),
    ))
}

#[tauri::command]
pub async fn undo_create_branch(
    repo_path: String,
    name: String,
    start_point: String,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        undo_create_branch_sync(repo_path, name, start_point)
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

fn undo_create_branch_sync(
    repo_path: String,
    name: String,
    start_point: String,
) -> Result<CommandResult, String> {
    let command = format!(
        "{} && {}",
        display_command(&["checkout", &start_point]),
        display_command(&["branch", "-d", &name])
    );

    let ahead = run_git(
        &repo_path,
        &["rev-list", "--count", &format!("{start_point}..{name}")],
    )?
    .stdout
    .trim()
    .parse::<u32>()
    .unwrap_or(0);
    if ahead > 0 {
        return Ok(CommandResult::failure(
            &command,
            format!(
                "{name} already has {ahead} commit{} of its own — switch away instead of undoing its creation.",
                if ahead == 1 { "" } else { "s" }
            ),
        ));
    }

    let checkout = run_git(&repo_path, &["checkout", &start_point])?;
    if !checkout.success {
        return Ok(CommandResult::failure(&command, checkout.stderr));
    }
    let delete = run_git(&repo_path, &["branch", "-d", &name])?;
    if !delete.success {
        return Ok(CommandResult::failure(&command, delete.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "before": name, "after": start_point }),
    ))
}

#[tauri::command]
pub async fn revert_to_commit(repo_path: String, target: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || revert_to_commit_sync(repo_path, target))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn revert_to_commit_sync(repo_path: String, target: String) -> Result<CommandResult, String> {
    let range = format!("{target}..HEAD");
    let command = display_command(&["revert", "--no-edit", &range]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();

    let is_ancestor = run_git(
        &repo_path,
        &["merge-base", "--is-ancestor", &target, "HEAD"],
    )?;
    if !is_ancestor.success {
        return Ok(CommandResult::failure(
            &command,
            "that commit isn't in your current branch's history, so there's nothing to revert to."
                .to_string(),
        ));
    }

    let commits = run_git(&repo_path, &["rev-list", "--count", &range])?
        .stdout
        .trim()
        .parse::<u32>()
        .unwrap_or(0);
    if commits == 0 {
        return Ok(CommandResult::failure(
            &command,
            "that's already the current commit — nothing to revert.".to_string(),
        ));
    }

    let before_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    let result = run_git(
        &repo_path,
        &["-c", "core.editor=true", "revert", "--no-edit", &range],
    )?;
    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            return Ok(CommandResult::conflict_with_target(
                &command,
                &current_branch,
                &target,
                unmerged,
            ));
        }
        // git refused before it even started a conflict (for example uncommitted changes in the
        // way) - nothing to resolve, so clean up and just fail normally
        let _ = run_git(&repo_path, &["revert", "--abort"]);
        let message = format!(
            "{}\n\ngitroot backed this out automatically (git revert --abort) — your repo is unchanged.",
            result.stderr.trim()
        );
        return Ok(CommandResult::failure(&command, message));
    }

    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "target": target,
            "before": short_hash(&before_head),
            "after": short_hash(&after_head),
        }),
    ))
}

#[tauri::command]
pub async fn continue_revert(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || continue_revert_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn continue_revert_sync(repo_path: String) -> Result<CommandResult, String> {
    let command = display_command(&["revert", "--continue"]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let unmerged = conflicted_files_sync(&repo_path)?;
    if !unmerged.is_empty() {
        return Ok(CommandResult::conflict(&command, &current_branch, unmerged));
    }

    let result = run_git(
        &repo_path,
        &["-c", "core.editor=true", "revert", "--continue"],
    )?;
    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            return Ok(CommandResult::conflict(&command, &current_branch, unmerged));
        }
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    Ok(CommandResult::ok(
        &command,
        json!({ "branch": current_branch, "after": short_hash(&after_head) }),
    ))
}

#[tauri::command]
pub async fn abort_revert(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort_revert_sync(&repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn abort_revert_sync(repo_path: &str) -> Result<(), String> {
    let out = run_git(repo_path, &["revert", "--abort"])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

fn split_into_hunks(diff: &str) -> (String, Vec<String>) {
    let mut header_lines: Vec<&str> = Vec::new();
    let mut hunks: Vec<Vec<&str>> = Vec::new();
    for line in diff.lines() {
        if line.starts_with("@@") {
            hunks.push(vec![line]);
        } else if let Some(current) = hunks.last_mut() {
            current.push(line);
        } else {
            header_lines.push(line);
        }
    }
    let header = header_lines.join("\n");
    let hunks = hunks.into_iter().map(|lines| lines.join("\n")).collect();
    (header, hunks)
}

fn single_hunk_patch(diff: &str, hunk_index: usize) -> Result<String, String> {
    let (header, hunks) = split_into_hunks(diff);
    let hunk = hunks.get(hunk_index).ok_or_else(|| {
        "that change isn't there anymore — the file may have changed. refresh and try again."
            .to_string()
    })?;
    Ok(format!("{header}\n{hunk}\n"))
}

fn selected_hunk_patch(
    diff: &str,
    hunk_index: usize,
    selected: &HashSet<usize>,
    reverse: bool,
) -> Result<String, String> {
    let (header, hunks) = split_into_hunks(diff);
    let hunk = hunks.get(hunk_index).ok_or_else(|| {
        "that change isn't there anymore — the file may have changed. refresh and try again."
            .to_string()
    })?;
    let body = rebuild_hunk_from_selection(hunk, selected, reverse)?;
    Ok(format!("{header}\n{body}"))
}

fn rebuild_hunk_from_selection(
    hunk: &str,
    selected: &HashSet<usize>,
    reverse: bool,
) -> Result<String, String> {
    let mut body = String::new();
    let mut any_change = false;
    let mut last_included = true;

    for (i, line) in hunk.lines().enumerate() {
        if i == 0 {
            body.push_str(line);
            body.push('\n');
            continue;
        }
        if let Some(rest) = line.strip_prefix('\\') {
            if last_included {
                body.push('\\');
                body.push_str(rest);
                body.push('\n');
            }
            continue;
        }
        let marker = line.get(0..1).unwrap_or(" ");
        let rest = if line.len() > 1 { &line[1..] } else { "" };
        let selected = selected.contains(&i);
        match marker {
            "+" => {
                if selected {
                    body.push('+');
                    body.push_str(rest);
                    body.push('\n');
                    any_change = true;
                    last_included = true;
                } else if reverse {
                    body.push(' ');
                    body.push_str(rest);
                    body.push('\n');
                    last_included = true;
                } else {
                    last_included = false;
                }
            }
            "-" => {
                if selected {
                    body.push('-');
                    body.push_str(rest);
                    body.push('\n');
                    any_change = true;
                    last_included = true;
                } else if reverse {
                    last_included = false;
                } else {
                    body.push(' ');
                    body.push_str(rest);
                    body.push('\n');
                    last_included = true;
                }
            }
            _ => {
                body.push(' ');
                body.push_str(rest);
                body.push('\n');
                last_included = true;
            }
        }
    }

    if !any_change {
        return Err("select at least one line to stage or discard.".to_string());
    }

    Ok(body)
}

fn unstaged_diff(repo_path: &str, path: &str) -> Result<GitOutput, String> {
    let tracked = run_git(repo_path, &["ls-files", "--error-unmatch", "--", path])?.success;
    if !tracked {
        let out = run_git(repo_path, &["diff", "--no-index", "--", "/dev/null", path])?;
        // --no-index return exit code 1 when there is a diff, so "has output" means success here
        let success = out.success || !out.stdout.is_empty();
        return Ok(GitOutput { success, ..out });
    }
    run_git(repo_path, &["diff", "--", path])
}

#[derive(Debug, Serialize)]
pub struct FileHunks {
    pub hunks: Vec<String>,
    pub whole_file_only: bool,
}

#[tauri::command]
pub async fn file_hunks(repo_path: String, path: String) -> Result<FileHunks, String> {
    tauri::async_runtime::spawn_blocking(move || file_hunks_sync(repo_path, path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn file_hunks_sync(repo_path: String, path: String) -> Result<FileHunks, String> {
    let diff = unstaged_diff(&repo_path, &path)?;
    if !diff.success {
        return Err(diff.stderr);
    }
    let (_, hunks) = split_into_hunks(&diff.stdout);
    let whole_file_only = hunks.is_empty() && !diff.stdout.trim().is_empty();
    Ok(FileHunks {
        hunks,
        whole_file_only,
    })
}

#[tauri::command]
pub async fn stage_hunk(repo_path: String, path: String, hunk_index: usize) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_one_hunk(&repo_path, &path, hunk_index, &["apply", "--cached"])
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

#[tauri::command]
pub async fn discard_hunk(
    repo_path: String,
    path: String,
    hunk_index: usize,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_one_hunk(&repo_path, &path, hunk_index, &["apply", "--reverse"])
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

#[tauri::command]
pub async fn stage_hunk_lines(
    repo_path: String,
    path: String,
    hunk_index: usize,
    lines: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_selected_hunk_lines(
            &repo_path,
            &path,
            hunk_index,
            &lines.into_iter().collect(),
            false,
            &["apply", "--cached", "--recount"],
        )
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

#[tauri::command]
pub async fn discard_hunk_lines(
    repo_path: String,
    path: String,
    hunk_index: usize,
    lines: Vec<usize>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        apply_selected_hunk_lines(
            &repo_path,
            &path,
            hunk_index,
            &lines.into_iter().collect(),
            true,
            &["apply", "--reverse", "--recount"],
        )
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

fn apply_selected_hunk_lines(
    repo_path: &str,
    path: &str,
    hunk_index: usize,
    selected: &HashSet<usize>,
    reverse: bool,
    apply_args: &[&str],
) -> Result<(), String> {
    let diff = unstaged_diff(repo_path, path)?;
    if !diff.success {
        return Err(diff.stderr);
    }
    let patch = selected_hunk_patch(&diff.stdout, hunk_index, selected, reverse)?;
    let result = run_git_with_stdin(repo_path, apply_args, &patch)?;
    if !result.success {
        return Err(result.stderr);
    }
    Ok(())
}

fn apply_one_hunk(
    repo_path: &str,
    path: &str,
    hunk_index: usize,
    apply_args: &[&str],
) -> Result<(), String> {
    let diff = unstaged_diff(repo_path, path)?;
    if !diff.success {
        return Err(diff.stderr);
    }
    let patch = single_hunk_patch(&diff.stdout, hunk_index)?;
    let result = run_git_with_stdin(repo_path, apply_args, &patch)?;
    if !result.success {
        return Err(result.stderr);
    }
    Ok(())
}

fn rev_list_count(repo_path: &str, range: &str) -> Result<u32, String> {
    let out = run_git(repo_path, &["rev-list", "--count", range])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(out.stdout.trim().parse().unwrap_or(0))
}

fn conflicted_files_sync(repo_path: &str) -> Result<Vec<String>, String> {
    let out = run_git(repo_path, &["diff", "--name-only", "--diff-filter=U"])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(out
        .stdout
        .lines()
        .filter(|l| !l.is_empty())
        .map(|s| s.to_string())
        .collect())
}

#[tauri::command]
pub async fn conflicted_files(repo_path: String) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || conflicted_files_sync(&repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

// ===== merge =====

#[derive(Debug, Serialize)]
pub struct MergePreview {
    pub outcome: String,
    pub commits: u32,
    pub files: Vec<String>,
    pub current_branch: String,
}

// merge-tree output on conflict is: tree id line, then one line per conflicted file
// (mode, object, stage, path), then blank line, then messages. no blank line before file lines.
fn parse_merge_tree_conflict_files(stdout: &str) -> Vec<String> {
    let mut files: Vec<String> = Vec::new();
    for line in stdout.lines().skip(1) {
        if line.is_empty() {
            break;
        }
        if let Some(path) = line.split('\t').nth(1) {
            if !files.iter().any(|f| f == path) {
                files.push(path.to_string());
            }
        }
    }
    files
}

#[tauri::command]
pub async fn merge_preview(repo_path: String, target: String) -> Result<MergePreview, String> {
    tauri::async_runtime::spawn_blocking(move || merge_preview_sync(repo_path, target))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn merge_preview_sync(repo_path: String, target: String) -> Result<MergePreview, String> {
    let current_branch = super::current_branch_name(&repo_path)?;
    let commits = rev_list_count(&repo_path, &format!("HEAD..{target}"))?;

    let is_ff = run_git(
        &repo_path,
        &["merge-base", "--is-ancestor", "HEAD", &target],
    )?
    .success;
    if is_ff {
        return Ok(MergePreview {
            outcome: "fastForward".to_string(),
            commits,
            files: vec![],
            current_branch,
        });
    }

    let mt = run_git(&repo_path, &["merge-tree", "--write-tree", "HEAD", &target])?;
    if mt.success {
        return Ok(MergePreview {
            outcome: "clean".to_string(),
            commits,
            files: vec![],
            current_branch,
        });
    }

    let files = parse_merge_tree_conflict_files(&mt.stdout);
    if files.is_empty() {
        return Err(mt.stderr);
    }
    Ok(MergePreview {
        outcome: "conflict".to_string(),
        commits,
        files,
        current_branch,
    })
}

#[tauri::command]
pub async fn merge_branch(repo_path: String, target: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || merge_branch_sync(repo_path, target))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn merge_branch_sync(repo_path: String, target: String) -> Result<CommandResult, String> {
    let command = display_command(&["merge", "--no-edit", &target]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let commits = rev_list_count(&repo_path, &format!("HEAD..{target}"))?;
    let was_fast_forward = run_git(
        &repo_path,
        &["merge-base", "--is-ancestor", "HEAD", &target],
    )?
    .success;
    let before_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    // core.editor=true so git never try to open an editor here, there is no terminal for it
    let result = run_git(
        &repo_path,
        &["-c", "core.editor=true", "merge", "--no-edit", &target],
    )?;

    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            return Ok(CommandResult::conflict_with_target(
                &command,
                &current_branch,
                &target,
                unmerged,
            ));
        }
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "branch": current_branch,
            "target": target,
            "fastForward": was_fast_forward,
            "before": short_hash(&before_head),
            "after": short_hash(&after_head),
        }),
    ))
}

#[tauri::command]
pub async fn continue_merge(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || continue_merge_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn continue_merge_sync(repo_path: String) -> Result<CommandResult, String> {
    let command = display_command(&["commit", "--no-edit"]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let unmerged = conflicted_files_sync(&repo_path)?;
    if !unmerged.is_empty() {
        return Ok(CommandResult::conflict(&command, &current_branch, unmerged));
    }

    let result = run_git(
        &repo_path,
        &["-c", "core.editor=true", "commit", "--no-edit"],
    )?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    // we don't put "target" here, only the frontend still remember which branch this was
    Ok(CommandResult::ok(
        &command,
        json!({ "branch": current_branch, "after": short_hash(&after_head) }),
    ))
}

#[tauri::command]
pub async fn abort_merge(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort_merge_sync(&repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn abort_merge_sync(repo_path: &str) -> Result<(), String> {
    let out = run_git(repo_path, &["merge", "--abort"])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

// ===== rebase =====

#[derive(Debug, Serialize)]
pub struct RebasePreflight {
    pub current_branch: String,
    pub target: String,
    pub total_commits: u32,
    pub already_pushed_count: u32,
    pub has_upstream: bool,
    pub upstream: Option<String>,
}

#[tauri::command]
pub async fn rebase_preflight(
    repo_path: String,
    target: String,
) -> Result<RebasePreflight, String> {
    tauri::async_runtime::spawn_blocking(move || rebase_preflight_sync(repo_path, target))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn rebase_preflight_sync(repo_path: String, target: String) -> Result<RebasePreflight, String> {
    let current_branch = super::current_branch_name(&repo_path)?;
    let range = format!("{target}..HEAD");
    let total_commits = rev_list_count(&repo_path, &range)?;

    let upstream = upstream_ref(&repo_path);
    let already_pushed_count = match &upstream {
        Some(u) => {
            let not_pushed = run_git(&repo_path, &["rev-list", "--count", &range, "--not", u])?
                .stdout
                .trim()
                .parse::<u32>()
                .unwrap_or(0);
            total_commits.saturating_sub(not_pushed)
        }
        None => 0,
    };

    Ok(RebasePreflight {
        current_branch,
        target,
        total_commits,
        already_pushed_count,
        has_upstream: upstream.is_some(),
        upstream,
    })
}

#[tauri::command]
pub async fn rebase_branch(repo_path: String, target: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || rebase_branch_sync(repo_path, target))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn rebase_branch_sync(repo_path: String, target: String) -> Result<CommandResult, String> {
    let command = display_command(&["rebase", &target]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let commits = rev_list_count(&repo_path, &format!("{target}..HEAD"))?;
    let before_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    let result = run_git(&repo_path, &["-c", "core.editor=true", "rebase", &target])?;

    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            return Ok(CommandResult::conflict_with_target(
                &command,
                &current_branch,
                &target,
                unmerged,
            ));
        }
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    Ok(CommandResult::ok(
        &command,
        json!({
            "commits": commits,
            "branch": current_branch,
            "target": target,
            "before": short_hash(&before_head),
            "after": short_hash(&after_head),
        }),
    ))
}

#[derive(Debug, Serialize)]
pub struct RebaseStatus {
    pub in_progress: bool,
    pub current: u32,
    pub total: u32,
}

fn rebase_status_sync(repo_path: &str) -> Result<RebaseStatus, String> {
    let git_dir = std::path::Path::new(repo_path).join(".git");
    // git use "rebase-merge" folder normally, and "rebase-apply" folder for the older backend,
    // and the file names inside are different too (msgnum/end vs next/last)
    for (subdir, current_file, total_file) in [
        ("rebase-merge", "msgnum", "end"),
        ("rebase-apply", "next", "last"),
    ] {
        let dir = git_dir.join(subdir);
        if !dir.is_dir() {
            continue;
        }
        let read_num = |name: &str| -> u32 {
            std::fs::read_to_string(dir.join(name))
                .ok()
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(0)
        };
        return Ok(RebaseStatus {
            in_progress: true,
            current: read_num(current_file),
            total: read_num(total_file),
        });
    }
    Ok(RebaseStatus {
        in_progress: false,
        current: 0,
        total: 0,
    })
}

#[tauri::command]
pub async fn rebase_status(repo_path: String) -> Result<RebaseStatus, String> {
    tauri::async_runtime::spawn_blocking(move || rebase_status_sync(&repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

#[tauri::command]
pub async fn continue_rebase(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || continue_rebase_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn continue_rebase_sync(repo_path: String) -> Result<CommandResult, String> {
    let command = display_command(&["rebase", "--continue"]);
    let current_branch = super::current_branch_name(&repo_path).unwrap_or_default();
    let unmerged = conflicted_files_sync(&repo_path)?;
    if !unmerged.is_empty() {
        return Ok(CommandResult::conflict(&command, &current_branch, unmerged));
    }

    let result = run_git(
        &repo_path,
        &["-c", "core.editor=true", "rebase", "--continue"],
    )?;
    if !result.success {
        let unmerged = conflicted_files_sync(&repo_path)?;
        if !unmerged.is_empty() {
            return Ok(CommandResult::conflict(&command, &current_branch, unmerged));
        }
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let after_head = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    Ok(CommandResult::ok(
        &command,
        json!({ "branch": current_branch, "after": short_hash(&after_head) }),
    ))
}

#[tauri::command]
pub async fn abort_rebase(repo_path: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || abort_rebase_sync(&repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn abort_rebase_sync(repo_path: &str) -> Result<(), String> {
    let out = run_git(repo_path, &["rebase", "--abort"])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/commands_tests.rs"]
mod tests;
