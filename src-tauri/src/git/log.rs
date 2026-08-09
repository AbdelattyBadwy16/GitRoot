use super::run_git;
use serde::Serialize;
use std::collections::{HashMap, HashSet};

// one commit before any layout is computed
struct RawCommit {
    hash: String,
    parents: Vec<String>,
    author: String,
    date: String,
    message: String,
    refs: Vec<String>,
}

// a commit positioned on the graph: row 0 = newest, growing downward
#[derive(Debug, Serialize, Clone)]
pub struct GraphCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub date: String,
    pub message: String,
    pub refs: Vec<String>,
    pub lane: usize,
    pub row: usize,
    // true if reachable from a remote-tracking branch, i.e. actually pushed (always true when there's no remote)
    pub on_remote: bool,
}

// a line from a commit to one parent; frontend decides straight vs curved
#[derive(Debug, Serialize)]
pub struct GraphEdge {
    pub from: String,
    pub to: String,
    pub from_lane: usize,
    pub from_row: usize,
    pub to_lane: usize,
    pub to_row: usize,
}

#[derive(Debug, Serialize)]
pub struct CommitGraphData {
    pub commits: Vec<GraphCommit>,
    pub edges: Vec<GraphEdge>,
    pub lane_count: usize,
    // true if there's more history past `commits` - read a page at a time, not all at once
    pub has_more: bool,
}

// assigns each commit a lane, reusing/freeing lanes as branches fork and merge - mirrors git log --graph, requires topo order
fn assign_lanes(commits: &[RawCommit]) -> Vec<(usize, usize)> {
    // lanes[i] = Some(hash) this lane is waiting to place, or None if free
    let mut lanes: Vec<Option<String>> = Vec::new();
    let mut positions: Vec<(usize, usize)> = Vec::with_capacity(commits.len());

    for (row, commit) in commits.iter().enumerate() {
        // lanes already waiting for this commit - normally one, but a merge point can have two
        let waiting: Vec<usize> = lanes
            .iter()
            .enumerate()
            .filter(|(_, h)| h.as_deref() == Some(commit.hash.as_str()))
            .map(|(i, _)| i)
            .collect();

        let lane = if let Some(&first) = waiting.first() {
            first
        } else if let Some(free) = lanes.iter().position(|h| h.is_none()) {
            lanes[free] = Some(commit.hash.clone());
            free
        } else {
            lanes.push(Some(commit.hash.clone()));
            lanes.len() - 1
        };

        // any other lane waiting for this commit has now converged - free it
        for &other in waiting.iter().skip(1) {
            lanes[other] = None;
        }

        positions.push((lane, row));

        // point this lane at whatever it should wait for next
        match commit.parents.first() {
            None => lanes[lane] = None, // root commit, nothing more upstream
            Some(first_parent) => lanes[lane] = Some(first_parent.clone()),
        }

        // extra parents (merges) each need their own lane unless already tracked
        for extra_parent in commit.parents.iter().skip(1) {
            let already_tracked = lanes
                .iter()
                .any(|h| h.as_deref() == Some(extra_parent.as_str()));
            if already_tracked {
                continue;
            }
            if let Some(free) = lanes.iter().position(|h| h.is_none()) {
                lanes[free] = Some(extra_parent.clone());
            } else {
                lanes.push(Some(extra_parent.clone()));
            }
        }
    }

    positions
}

// commits reachable from any remote-tracking ref (i.e. actually pushed); everything counts as on-remote if there are no remotes
fn commits_reachable_from_remotes(
    repo_path: &str,
    raw: &[RawCommit],
    index_by_hash: &HashMap<&str, usize>,
) -> Result<HashSet<String>, String> {
    let tips = run_git(
        repo_path,
        &["for-each-ref", "refs/remotes", "--format=%(objectname)"],
    )?;
    if !tips.success {
        return Err(tips.stderr);
    }
    let tip_hashes: Vec<&str> = tips.stdout.lines().filter(|l| !l.is_empty()).collect();

    if tip_hashes.is_empty() {
        return Ok(raw.iter().map(|c| c.hash.clone()).collect());
    }

    let mut reachable: HashSet<String> = HashSet::new();
    let mut stack: Vec<&str> = tip_hashes;
    while let Some(hash) = stack.pop() {
        if !reachable.insert(hash.to_string()) {
            continue; // already visited via another path
        }
        if let Some(&i) = index_by_hash.get(hash) {
            for parent in &raw[i].parents {
                stack.push(parent.as_str());
            }
        }
        // a tip older than anything in `raw` just can't be walked further - harmless
    }
    Ok(reachable)
}

// off the main thread so re-fetching a big repo's history never freezes the window
#[tauri::command]
pub async fn commit_graph(repo_path: String, limit: usize) -> Result<CommitGraphData, String> {
    tauri::async_runtime::spawn_blocking(move || commit_graph_sync(repo_path, limit))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

// limit pages the history in; "load more" re-requests a larger limit (not an offset) so earlier commits never reshuffle
fn commit_graph_sync(repo_path: String, limit: usize) -> Result<CommitGraphData, String> {
    // \x1f separates fields - unlike '|' or ',', it can't appear in a commit subject
    let format = "%H%x1f%P%x1f%an%x1f%ad%x1f%s%x1f%D";
    let pretty = format!("--pretty=format:{format}");
    // ask for one more than we'll show, to know if there's more history
    let max_count = format!("--max-count={}", limit + 1);
    // not --all - that would also pull in refs/stash's internal WIP commits
    let out = run_git(
        &repo_path,
        &[
            "log",
            "--branches",
            "--tags",
            "--remotes",
            "--topo-order",
            "--date=relative",
            &max_count,
            &pretty,
        ],
    )?;

    if !out.success {
        // An empty repo (no commits yet) isn't an error — just no graph.
        if out.stderr.contains("does not have any commits") {
            return Ok(CommitGraphData {
                commits: vec![],
                edges: vec![],
                lane_count: 0,
                has_more: false,
            });
        }
        return Err(out.stderr);
    }

    let mut raw: Vec<RawCommit> = out
        .stdout
        .lines()
        .filter(|l| !l.is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.split('\u{1f}').collect();
            if parts.len() < 6 {
                return None;
            }
            let parents = parts[1].split_whitespace().map(|s| s.to_string()).collect();
            let refs = parts[5]
                .split(", ")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect();
            Some(RawCommit {
                hash: parts[0].to_string(),
                parents,
                author: parts[2].to_string(),
                date: parts[3].to_string(),
                message: parts[4].to_string(),
                refs,
            })
        })
        .collect();

    let has_more = raw.len() > limit;
    raw.truncate(limit);

    let positions = assign_lanes(&raw);
    let lane_count = positions
        .iter()
        .map(|(lane, _)| lane + 1)
        .max()
        .unwrap_or(0);

    let index_by_hash: HashMap<&str, usize> = raw
        .iter()
        .enumerate()
        .map(|(i, c)| (c.hash.as_str(), i))
        .collect();

    let on_remote = commits_reachable_from_remotes(&repo_path, &raw, &index_by_hash)?;

    let mut edges = Vec::new();
    for (i, commit) in raw.iter().enumerate() {
        let (from_lane, from_row) = positions[i];
        for parent in &commit.parents {
            if let Some(&pi) = index_by_hash.get(parent.as_str()) {
                let (to_lane, to_row) = positions[pi];
                edges.push(GraphEdge {
                    from: commit.hash.clone(),
                    to: parent.clone(),
                    from_lane,
                    from_row,
                    to_lane,
                    to_row,
                });
            }
        }
    }

    let commits = raw
        .into_iter()
        .zip(positions)
        .map(|(c, (lane, row))| {
            let pushed = on_remote.contains(c.hash.as_str());
            GraphCommit {
                hash: c.hash,
                parents: c.parents,
                author: c.author,
                date: c.date,
                message: c.message,
                refs: c.refs,
                lane,
                row,
                on_remote: pushed,
            }
        })
        .collect();

    Ok(CommitGraphData {
        commits,
        edges,
        lane_count,
        has_more,
    })
}

#[cfg(test)]
#[path = "tests/log_tests.rs"]
mod tests;
