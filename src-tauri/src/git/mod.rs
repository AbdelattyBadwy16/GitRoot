pub mod commands;
pub mod log;

use serde::Serialize;
use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

// raw result of a git subprocess - no interpretation, no wording (that's the frontend's job)
#[derive(Debug, Serialize)]
pub struct GitOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

// hard kill timeout - ConnectTimeout below only covers SSH's TCP connect, not a DNS hang when the VPN is off
const GIT_TIMEOUT: Duration = Duration::from_secs(20);

// every git call in the app goes through here, always as an argument array, never a shell string
pub fn run_git(repo_path: &str, args: &[&str]) -> Result<GitOutput, String> {
    run_git_full(repo_path, args, None, GIT_TIMEOUT)
}

// like run_git, but feeds stdin_data to the process - for `git apply`, which reads its patch from stdin
pub fn run_git_with_stdin(
    repo_path: &str,
    args: &[&str],
    stdin_data: &str,
) -> Result<GitOutput, String> {
    run_git_full(repo_path, args, Some(stdin_data), GIT_TIMEOUT)
}

// lets tests use a short timeout instead of waiting out the real one
#[cfg(test)]
fn run_git_with_timeout(
    repo_path: &str,
    args: &[&str],
    timeout: Duration,
) -> Result<GitOutput, String> {
    run_git_full(repo_path, args, None, timeout)
}

fn run_git_full(
    repo_path: &str,
    args: &[&str],
    stdin_data: Option<&str>,
    timeout: Duration,
) -> Result<GitOutput, String> {
    let mut command = Command::new("git");
    command
        .arg("-C")
        .arg(repo_path)
        .args(args)
        // fail fast instead of hanging on a credential prompt with nowhere to show it
        .env("GIT_TERMINAL_PROMPT", "0")
        // same for SSH specifically - BatchMode disables its prompts, ConnectTimeout caps the TCP connect
        .env(
            "GIT_SSH_COMMAND",
            "ssh -o BatchMode=yes -o ConnectTimeout=10",
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        // never inherit our own stdin - that could hang exactly like GIT_TIMEOUT exists to prevent
        .stdin(if stdin_data.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        });

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to run git: {e}"))?;

    if let Some(data) = stdin_data {
        let mut stdin_pipe = child.stdin.take().expect("stdin was piped");
        let data = data.to_string();
        // own thread - writing/reading the same pipe as the process can deadlock if a buffer fills
        std::thread::spawn(move || {
            let _ = stdin_pipe.write_all(data.as_bytes());
            // dropping stdin_pipe here closes it, signaling EOF to git
        });
    }

    // read stdout/stderr on their own threads while waiting, or a chatty command could block on a full pipe buffer
    let mut stdout_pipe = child.stdout.take().expect("stdout was piped");
    let mut stderr_pipe = child.stderr.take().expect("stderr was piped");
    let stdout_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stdout_pipe.read_to_end(&mut buf);
        buf
    });
    let stderr_reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        let _ = stderr_pipe.read_to_end(&mut buf);
        buf
    });

    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break Some(status),
            Ok(None) if start.elapsed() < timeout => {
                std::thread::sleep(Duration::from_millis(50));
            }
            Ok(None) => break None, // timed out
            Err(e) => return Err(format!("failed to wait on git: {e}")),
        }
    };

    let Some(status) = status else {
        let _ = child.kill();
        let _ = child.wait();
        // not joining the reader threads - if git spawned ssh as a child, killing git alone won't close ssh's pipe copy
        return Ok(GitOutput {
            success: false,
            stdout: String::new(),
            // phrased to match looks_like_network_error's check, so a hang reads the same as an immediate connection failure
            stderr: "gitroot: timed out waiting for git — the remote may be unreachable (check your network or VPN)".to_string(),
        });
    };

    let stdout = stdout_reader.join().unwrap_or_default();
    let stderr = stderr_reader.join().unwrap_or_default();

    Ok(GitOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).to_string(),
        stderr: String::from_utf8_lossy(&stderr).to_string(),
    })
}

// true if stderr looks like a credential/auth failure rather than some other kind of error
pub fn looks_like_auth_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    const MARKERS: [&str; 8] = [
        "authentication failed",
        "could not read username",
        "could not read password",
        "permission denied (publickey)",
        "invalid username or password",
        "terminal prompts disabled",
        "fatal: authentication",
        "403",
    ];
    MARKERS.iter().any(|m| lower.contains(m))
}

// true if the remote just couldn't be reached, as opposed to a credentials problem
pub fn looks_like_network_error(stderr: &str) -> bool {
    let lower = stderr.to_lowercase();
    const MARKERS: [&str; 6] = [
        // broad on purpose so this also catches our own "timed out waiting for git" message
        "timed out",
        "could not resolve host",
        "could not resolve hostname",
        "connection refused",
        "network is unreachable",
        "could not read from remote repository",
    ];
    MARKERS.iter().any(|m| lower.contains(m))
}

#[derive(Debug, Serialize)]
pub struct RepoInfo {
    pub name: String,
    pub path: String,
    pub current_branch: String,
}

// symbolic-ref works even before the first commit (rev-parse --abbrev-ref fails there); falls back to rev-parse for detached HEAD
fn current_branch_name(path: &str) -> Result<String, String> {
    let symbolic = run_git(path, &["symbolic-ref", "--short", "HEAD"])?;
    if symbolic.success {
        return Ok(symbolic.stdout.trim().to_string());
    }
    let fallback = run_git(path, &["rev-parse", "--abbrev-ref", "HEAD"])?;
    Ok(fallback.stdout.trim().to_string())
}

// validates path is a git repo and returns basic info, called when the user picks a folder
#[tauri::command]
pub async fn open_repo(path: String) -> Result<RepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || open_repo_sync(path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn open_repo_sync(path: String) -> Result<RepoInfo, String> {
    let check = run_git(&path, &["rev-parse", "--is-inside-work-tree"])?;
    if !check.success || check.stdout.trim() != "true" {
        return Err("that folder isn't a git repository.".to_string());
    }

    let current_branch = current_branch_name(&path)?;

    let name = std::path::Path::new(&path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.clone());

    Ok(RepoInfo {
        name,
        path,
        current_branch,
    })
}

// git init + optional remote - doesn't auto-pull, that's a separate explicit command
#[tauri::command]
pub async fn init_repo(path: String, remote_url: Option<String>) -> Result<RepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || init_repo_sync(path, remote_url))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn init_repo_sync(path: String, remote_url: Option<String>) -> Result<RepoInfo, String> {
    let out = run_git(&path, &["init"])?;
    if !out.success {
        return Err(out.stderr);
    }

    if let Some(url) = remote_url {
        let url = url.trim();
        if !url.is_empty() {
            let out = run_git(&path, &["remote", "add", "origin", url])?;
            if !out.success {
                return Err(out.stderr);
            }
        }
    }

    open_repo_sync(path)
}

// last path segment of a URL minus ".git" - handles both https and git@host:path forms
fn repo_name_from_url(url: &str) -> String {
    let trimmed = url.trim().trim_end_matches('/');
    let last = trimmed.rsplit('/').next().unwrap_or(trimmed);
    let last = last.rsplit(':').next().unwrap_or(last);
    let name = last.strip_suffix(".git").unwrap_or(last).trim();
    if name.is_empty() {
        "repository".to_string()
    } else {
        name.to_string()
    }
}

// clones into a new subfolder of destination_dir (named after the repo), then opens it
#[tauri::command]
pub async fn clone_repo(url: String, destination_dir: String) -> Result<RepoInfo, String> {
    tauri::async_runtime::spawn_blocking(move || clone_repo_sync(url, destination_dir))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn clone_repo_sync(url: String, destination_dir: String) -> Result<RepoInfo, String> {
    let url = url.trim().to_string();
    if url.is_empty() {
        return Err("enter a repository URL to clone.".to_string());
    }
    let name = repo_name_from_url(&url);
    let target = std::path::Path::new(&destination_dir).join(&name);
    if target.exists() {
        return Err(format!(
            "\"{name}\" already exists in that folder — choose a different destination or remove it first."
        ));
    }

    // run from destination_dir - the target doesn't exist yet, so it can't be -C'd into
    let out = run_git(&destination_dir, &["clone", "--", &url, &name])?;
    if !out.success {
        if looks_like_auth_error(&out.stderr) {
            return Err("you're not logged in to reach this remote.".to_string());
        }
        if looks_like_network_error(&out.stderr) {
            return Err(
                "couldn't reach that remote — check your network or VPN connection.".to_string(),
            );
        }
        return Err(out.stderr);
    }

    open_repo_sync(target.to_string_lossy().to_string())
}

#[derive(Debug, Serialize)]
pub struct GitAvailability {
    pub available: bool,
    pub version: Option<String>,
}

// checked once at startup - nothing else in the app works until this is true
#[tauri::command]
pub async fn check_git_available() -> Result<GitAvailability, String> {
    tauri::async_runtime::spawn_blocking(check_git_available_sync)
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn check_git_available_sync() -> Result<GitAvailability, String> {
    match Command::new("git").arg("--version").output() {
        Ok(out) if out.status.success() => Ok(GitAvailability {
            available: true,
            version: Some(String::from_utf8_lossy(&out.stdout).trim().to_string()),
        }),
        _ => Ok(GitAvailability {
            available: false,
            version: None,
        }),
    }
}

#[derive(Debug, Serialize)]
pub struct GitIdentity {
    pub name: Option<String>,
    pub email: Option<String>,
}

fn git_config_value(repo_path: &str, key: &str) -> Option<String> {
    let out = run_git(repo_path, &["config", key]).ok()?;
    if !out.success {
        return None;
    }
    let value = out.stdout.trim();
    if value.is_empty() {
        None
    } else {
        Some(value.to_string())
    }
}

// the name/email every commit here gets attributed to - git refuses to commit until both are set
#[tauri::command]
pub async fn check_git_identity(repo_path: String) -> Result<GitIdentity, String> {
    tauri::async_runtime::spawn_blocking(move || check_git_identity_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn check_git_identity_sync(repo_path: String) -> Result<GitIdentity, String> {
    Ok(GitIdentity {
        name: git_config_value(&repo_path, "user.name"),
        email: git_config_value(&repo_path, "user.email"),
    })
}

// sets the identity globally, so every repo on this machine picks it up, not just this one
#[tauri::command]
pub async fn set_git_identity(
    repo_path: String,
    name: String,
    email: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || set_git_identity_sync(repo_path, name, email))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn set_git_identity_sync(repo_path: String, name: String, email: String) -> Result<(), String> {
    let out = run_git(&repo_path, &["config", "--global", "user.name", &name])?;
    if !out.success {
        return Err(out.stderr);
    }
    let out = run_git(&repo_path, &["config", "--global", "user.email", &email])?;
    if !out.success {
        return Err(out.stderr);
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/mod_tests.rs"]
mod tests;
