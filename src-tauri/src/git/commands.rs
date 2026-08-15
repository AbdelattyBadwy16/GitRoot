use super::{
    head_used_to_point_at, looks_like_auth_error, looks_like_network_error,
    looks_like_no_tracking_error, looks_like_non_fast_forward_error, run_git, run_git_with_stdin,
    GitOutput,
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
    pub non_fast_forward: bool,
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
            non_fast_forward: false,
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
            non_fast_forward: false,
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
            non_fast_forward: false,
            raw_stderr: None,
            data: json!({ "remote": remote }),
            command: command.to_string(),
        }
    }

    fn non_fast_forward_failure(command: &str, remote: &str, rewound: bool) -> Self {
        Self {
            success: false,
            auth_error: false,
            network_error: false,
            conflict: false,
            non_fast_forward: true,
            raw_stderr: None,
            data: json!({ "remote": remote, "rewound": rewound }),
            command: command.to_string(),
        }
    }

    fn failure(command: &str, stderr: String) -> Self {
        Self {
            success: false,
            auth_error: false,
            network_error: false,
            conflict: false,
            non_fast_forward: false,
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
            non_fast_forward: false,
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

    fn from_remote_failure(repo_path: &str, command: &str, stderr: String, remote: &str) -> Self {
        if looks_like_auth_error(&stderr) {
            Self::auth_failure(command, remote)
        } else if looks_like_network_error(&stderr) {
            Self::network_failure(command, remote)
        } else if looks_like_non_fast_forward_error(&stderr) {
            // was the remote's *actual current* tip ever our own HEAD before? if so, this isn't
            // "someone else's new work" - it's us having reset past commits we ourselves already
            // pushed, and the fix is a force-push, not a pull (which would just bring them right
            // back). this has to ask the remote directly (`ls-remote`, no local state changed) -
            // the cached `@{u}` tracking ref is exactly what's stale here (a rejected push never
            // updates it), so checking against it would just rediscover our own last-known state.
            let rewound = remote_branch_tip(repo_path, remote)
                .is_some_and(|tip| head_used_to_point_at(repo_path, &tip));
            Self::non_fast_forward_failure(command, remote, rewound)
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

// the remote's actual current tip for `upstream` (e.g. "origin/main"), fetched fresh with
// `ls-remote` rather than read from the local `origin/main` tracking ref - that local copy is
// only ever as fresh as the last fetch/pull/successful push, so it's the wrong thing to trust
// right after a push was *rejected*.
fn remote_branch_tip(repo_path: &str, upstream: &str) -> Option<String> {
    let (remote_name, branch) = upstream.split_once('/')?;
    let ref_name = format!("refs/heads/{branch}");
    let out = run_git(
        repo_path,
        &["ls-remote", "--exit-code", remote_name, &ref_name],
    )
    .ok()?;
    if !out.success {
        return None;
    }
    out.stdout.split_whitespace().next().map(str::to_string)
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
    let mut command = display_command(&pull_args);

    let before = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;
    let mut result = run_git(&repo_path, &pull_args)?;

    // no upstream configured yet (fresh repo, remote added after the fact, branch created
    // without --track...) - retry with the remote+branch spelled out explicitly, which works
    // even when the local branch has zero commits yet ("unborn" - `branch --set-upstream-to`
    // alone fails on those, since the branch is not a real ref until it has a commit) rather
    // than surfacing git's raw "there is no tracking information" wall of text
    if !result.success && looks_like_no_tracking_error(&result.stderr) {
        let branch = super::current_branch_name(&repo_path).unwrap_or_default();
        let retry_args = ["pull", "--no-rebase", "origin", branch.as_str()];
        let retried = run_git(&repo_path, &retry_args)?;
        if retried.success {
            command = display_command(&retry_args);
            // the branch is a real ref now (it just got its first commit), so this can
            // succeed where it couldn't before - link it for next time too
            let _ = run_git(
                &repo_path,
                &[
                    "branch",
                    "--set-upstream-to",
                    &format!("origin/{branch}"),
                    &branch,
                ],
            );
        }
        result = retried;
    }

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
            &repo_path,
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
            &repo_path,
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

// only reachable after a plain push was rejected with `non_fast_forward: true, rewound: true` -
// i.e. the local branch was reset past commits still sitting on the remote. `--force-with-lease`
// (not a bare `--force`) still refuses if the remote moved again for some *other* reason since
// gitroot last saw it, so this can't silently clobber someone else's genuinely new work.
#[tauri::command]
pub async fn force_push(repo_path: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || force_push_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn force_push_sync(repo_path: String) -> Result<CommandResult, String> {
    let remote = upstream_ref(&repo_path).unwrap_or_else(|| "origin".to_string());
    let before = run_git(&repo_path, &["rev-parse", "@{u}"])?.stdout;

    let push_args = ["push", "--force-with-lease"];
    let command = display_command(&push_args);
    let result = run_git(&repo_path, &push_args)?;

    if !result.success {
        return Ok(CommandResult::from_remote_failure(
            &repo_path,
            &command,
            result.stderr,
            &remote,
        ));
    }

    let after = run_git(&repo_path, &["rev-parse", "HEAD"])?.stdout;

    Ok(CommandResult::ok(
        &command,
        json!({
            "remote": remote,
            "before": short_hash(&before),
            "after": short_hash(&after),
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
pub async fn stash(
    repo_path: String,
    message: Option<String>,
    paths: Option<Vec<String>>,
) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || stash_sync(repo_path, message, paths))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn stash_sync(
    repo_path: String,
    message: Option<String>,
    paths: Option<Vec<String>>,
) -> Result<CommandResult, String> {
    let status_out = run_git(&repo_path, &["status", "--porcelain"])?;
    let status_lines: Vec<&str> = status_out
        .stdout
        .lines()
        .filter(|l| !l.is_empty())
        .collect();
    // total changed files (tracked or not) - only for the before/after summary text, so it has
    // to count untracked ones too now that a selection can target them specifically
    let before_count = status_lines.len();
    // the default "stash everything" form (no pathspec) never touches untracked files, so that's
    // the right fallback count for how many actually got stashed when nothing was selected
    let tracked_count = status_lines.iter().filter(|l| !l.starts_with("??")).count();

    // an explicit (non-empty) pathspec restricts the stash to just those files. by itself that
    // still never picks up an untracked file even if it's named directly - `--include-untracked`
    // is required for that, and (confirmed against real git) stays scoped to just the pathspec's
    // matches rather than sweeping in every other untracked file too.
    let selected: Option<Vec<String>> = paths.filter(|p| !p.is_empty());

    let mut args: Vec<String> = vec!["stash".to_string(), "push".to_string()];
    if let Some(m) = message.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        args.push("-m".to_string());
        args.push(m.to_string());
    }
    if let Some(p) = &selected {
        args.push("--include-untracked".to_string());
        args.push("--".to_string());
        args.extend(p.iter().cloned());
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let command = display_command(&arg_refs);

    let result = run_git(&repo_path, &arg_refs)?;

    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }

    let stashed_count = selected.as_ref().map_or(tracked_count, Vec::len);
    let remaining = selected
        .as_ref()
        .map_or(0, |p| before_count.saturating_sub(p.len()));

    Ok(CommandResult::ok(
        &command,
        json!({
            "files": stashed_count as u32,
            "before": format!("{before_count} changed file{}", if before_count == 1 { "" } else { "s" }),
            "after": if remaining > 0 {
                format!("{remaining} file{} still changed", if remaining == 1 { "" } else { "s" })
            } else {
                "working directory clean".to_string()
            },
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

// ===== stash list / selective restore =====

#[derive(Debug, Serialize)]
pub struct StashInfo {
    pub stash_ref: String,
    pub message: String,
    pub branch: Option<String>,
    pub date: String,
}

#[tauri::command]
pub async fn list_stashes(repo_path: String) -> Result<Vec<StashInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || list_stashes_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn list_stashes_sync(repo_path: String) -> Result<Vec<StashInfo>, String> {
    let out = run_git(&repo_path, &["stash", "list", "--format=%gd%x1f%gs%x1f%cr"])?;
    if !out.success {
        return Err(out.stderr);
    }

    let stashes = out
        .stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\x1f').collect();
            if parts.len() < 3 {
                return None;
            }
            let subject = parts[1];
            // git's default stash message is "WIP on <branch>: <hash> <msg>", or
            // "On <branch>: <msg>" when made with `stash push -m "..."`
            let branch = subject
                .strip_prefix("WIP on ")
                .or_else(|| subject.strip_prefix("On "))
                .and_then(|rest| rest.split(':').next())
                .map(|b| b.trim().to_string())
                .filter(|b| !b.is_empty());
            Some(StashInfo {
                stash_ref: parts[0].to_string(),
                message: subject.to_string(),
                branch,
                date: parts[2].to_string(),
            })
        })
        .collect();

    Ok(stashes)
}

#[tauri::command]
pub async fn apply_stash(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || apply_stash_sync(repo_path, stash_ref))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn apply_stash_sync(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    let command = display_command(&["stash", "apply", &stash_ref]);
    let result = run_git(&repo_path, &["stash", "apply", &stash_ref])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "stashRef": stash_ref }),
    ))
}

#[tauri::command]
pub async fn pop_stash(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || pop_stash_sync(repo_path, stash_ref))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn pop_stash_sync(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    let command = display_command(&["stash", "pop", &stash_ref]);
    let result = run_git(&repo_path, &["stash", "pop", &stash_ref])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "stashRef": stash_ref }),
    ))
}

#[tauri::command]
pub async fn drop_stash(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    tauri::async_runtime::spawn_blocking(move || drop_stash_sync(repo_path, stash_ref))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn drop_stash_sync(repo_path: String, stash_ref: String) -> Result<CommandResult, String> {
    let command = display_command(&["stash", "drop", &stash_ref]);
    let result = run_git(&repo_path, &["stash", "drop", &stash_ref])?;
    if !result.success {
        return Ok(CommandResult::failure(&command, result.stderr));
    }
    Ok(CommandResult::ok(
        &command,
        json!({ "stashRef": stash_ref }),
    ))
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
                "{name} already has {ahead} commit{} of its own. switch away instead of undoing its creation.",
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
            "that's already the current commit, nothing to revert.".to_string(),
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
            "{}\n\ngitroot backed this out automatically (git revert --abort). your repo is unchanged.",
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
        "that change isn't there anymore, the file may have changed. refresh and try again."
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
        "that change isn't there anymore, the file may have changed. refresh and try again."
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

// what's already in the index vs HEAD - the counterpart to unstaged_diff, needed for a file
// that's entirely staged already (e.g. right after undoing a commit, which keeps everything
// staged) where the unstaged diff has nothing to show at all
fn staged_diff(repo_path: &str, path: &str) -> Result<GitOutput, String> {
    run_git(repo_path, &["diff", "--cached", "--", path])
}

#[derive(Debug, Serialize)]
pub struct FileHunks {
    pub hunks: Vec<String>,
    pub whole_file_only: bool,
    // true if these are staged hunks (nothing unstaged to show), false for the normal
    // unstaged case - tells the frontend whether "stage"/"discard" or "unstage" applies
    pub staged: bool,
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

    if diff.stdout.trim().is_empty() {
        // nothing unstaged - fall back to what's staged, so a fully-staged file (right after
        // undoing a commit, say) is not just a silent dead end
        let staged = staged_diff(&repo_path, &path)?;
        if !staged.success {
            return Err(staged.stderr);
        }
        if !staged.stdout.trim().is_empty() {
            let (_, hunks) = split_into_hunks(&staged.stdout);
            let whole_file_only = hunks.is_empty();
            return Ok(FileHunks {
                hunks,
                whole_file_only,
                staged: true,
            });
        }
    }

    let (_, hunks) = split_into_hunks(&diff.stdout);
    let whole_file_only = hunks.is_empty() && !diff.stdout.trim().is_empty();
    Ok(FileHunks {
        hunks,
        whole_file_only,
        staged: false,
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
            false,
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
            false,
        )
    })
    .await
    .map_err(|e| format!("internal error: {e}"))?
}

// counterpart to discard_hunk_lines but for staged content: removes the selected lines from
// the index only (--cached), leaving the working tree untouched - real `git reset -p`
// semantics, not a discard. Used when file_hunks came back in "staged" mode.
#[tauri::command]
pub async fn unstage_hunk_lines(
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
            &["apply", "--cached", "--reverse", "--recount"],
            true,
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
    staged: bool,
) -> Result<(), String> {
    let diff = if staged {
        staged_diff(repo_path, path)?
    } else {
        unstaged_diff(repo_path, path)?
    };
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

// git's own conflict-marker convention (see "how conflicts are presented" in git-merge(1)): a
// line starting with 7 `<` and a label, a line of exactly 7 `=`, and a line starting with 7 `>`
// and a label. the conflict dialog warns before staging a file that still has these - someone
// new to git can easily save the file without actually removing the markers.
fn has_conflict_markers_sync(repo_path: &str, path: &str) -> bool {
    let full_path = std::path::Path::new(repo_path).join(path);
    let Ok(contents) = std::fs::read_to_string(full_path) else {
        // binary, or the file's already gone (staged/deleted since) - nothing to warn about
        return false;
    };
    contents.lines().any(|line| {
        line.starts_with("<<<<<<< ")
            || line == "<<<<<<<"
            || line == "======="
            || line.starts_with(">>>>>>> ")
            || line == ">>>>>>>"
    })
}

#[tauri::command]
pub async fn has_conflict_markers(repo_path: String, path: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || has_conflict_markers_sync(&repo_path, &path))
        .await
        .map_err(|e| format!("internal error: {e}"))
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

// ===== file-level change preview (reset / revert / merge / rebase) =====

#[derive(Debug, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: String, // "added" | "deleted" | "modified" | "renamed"
}

// git's plain --name-status output quotes any path with non-ASCII bytes (or other "unusual"
// characters) as a C-style escaped string - e.g. an arabic filename comes back as
// "a file with spaces \330\271\330\261\330\250\331\212.txt" instead of the real UTF-8 name.
// -z sides-steps that entirely: it disables path quoting and NUL-separates every token, so
// this parses a flat stream of tokens instead of tab-separated lines.
fn parse_name_status(stdout: &str) -> Vec<FileChange> {
    let mut tokens = stdout.trim_end_matches('\0').split('\0');
    let mut files = Vec::new();
    while let Some(code) = tokens.next() {
        if code.is_empty() {
            continue;
        }
        let first = code.chars().next().unwrap_or(' ');
        let status = match first {
            'A' => "added",
            'D' => "deleted",
            'R' | 'C' => "renamed",
            _ => "modified",
        };
        // renames/copies are "R100\0old\0new\0" - two paths follow, we want the new one
        if matches!(first, 'R' | 'C') && tokens.next().is_none() {
            break;
        }
        let Some(path) = tokens.next() else { break };
        files.push(FileChange {
            path: path.to_string(),
            status: status.to_string(),
        });
    }
    files
}

#[tauri::command]
pub async fn diff_name_status(repo_path: String, range: String) -> Result<Vec<FileChange>, String> {
    tauri::async_runtime::spawn_blocking(move || diff_name_status_sync(repo_path, range))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn diff_name_status_sync(repo_path: String, range: String) -> Result<Vec<FileChange>, String> {
    let out = run_git(&repo_path, &["diff", "--name-status", "-z", &range])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(parse_name_status(&out.stdout))
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
