use super::{run_git, run_git_network};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct RawCommandOutput {
    pub command: String,
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
}

const NETWORK_SUBCOMMANDS: [&str; 6] = ["fetch", "pull", "push", "clone", "ls-remote", "remote"];

#[tauri::command]
pub async fn run_raw_command(repo_path: String, input: String) -> Result<RawCommandOutput, String> {
    tauri::async_runtime::spawn_blocking(move || run_raw_command_sync(repo_path, input))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn run_raw_command_sync(repo_path: String, input: String) -> Result<RawCommandOutput, String> {
    let trimmed = input.trim();
    let args = tokenize(trimmed);
    if args.is_empty() {
        return Ok(RawCommandOutput {
            command: "git".to_string(),
            success: false,
            stdout: String::new(),
            stderr: "nothing to run".to_string(),
        });
    }

    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let is_network = NETWORK_SUBCOMMANDS.contains(&arg_refs[0]);
    let out = if is_network {
        run_git_network(&repo_path, &arg_refs)?
    } else {
        run_git(&repo_path, &arg_refs)?
    };

    Ok(RawCommandOutput {
        command: format!("git {trimmed}"),
        success: out.success,
        stdout: out.stdout,
        stderr: out.stderr,
    })
}

fn tokenize(input: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut in_token = false;
    let mut chars = input.chars().peekable();

    while let Some(c) = chars.next() {
        match c {
            '"' | '\'' => {
                in_token = true;
                let quote = c;
                for next in chars.by_ref() {
                    if next == quote {
                        break;
                    }
                    current.push(next);
                }
            }
            c if c.is_whitespace() => {
                if in_token {
                    tokens.push(std::mem::take(&mut current));
                    in_token = false;
                }
            }
            _ => {
                in_token = true;
                current.push(c);
            }
        }
    }
    if in_token {
        tokens.push(current);
    }
    tokens
}

#[cfg(test)]
#[path = "tests/raw_tests.rs"]
mod tests;
