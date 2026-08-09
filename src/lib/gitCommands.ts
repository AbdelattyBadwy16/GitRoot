import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";

// types mirroring the Rust side (src-tauri/src/git/*.rs) - wording happens in explain.ts using dictionary.json

// opens the OS's native folder picker; null if the user cancelled
export async function pickFolder(): Promise<string | null> {
  const result = await openDialog({ directory: true, multiple: false, title: "Open a git repository" });
  return typeof result === "string" ? result : null;
}

export interface RepoInfo {
  name: string;
  path: string;
  currentBranch: string;
}

export interface CommandResult {
  success: boolean;
  authError: boolean;
  networkError: boolean;
  rawStderr: string | null;
  data: Record<string, unknown>;
  // the literal `git ...` command that ran
  command: string;
}

export interface FileStatus {
  path: string;
  staged: boolean;
  statusLabel: string;
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
  // commits not yet on the other side; both 0 if there's no upstream
  ahead: number;
  behind: number;
}

export interface GraphCommit {
  hash: string;
  parents: string[];
  author: string;
  date: string;
  message: string;
  refs: string[];
  lane: number;
  row: number;
  // reachable from some origin/* ref - actually pushed, not just committed locally
  onRemote: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  fromLane: number;
  fromRow: number;
  toLane: number;
  toRow: number;
}

export interface CommitGraphData {
  commits: GraphCommit[];
  edges: GraphEdge[];
  laneCount: number;
  // true if there's more history past `commits` - read a page at a time
  hasMore: boolean;
}

// Rust structs serialize as snake_case; normalize field names to camelCase here
function normalizeCommandResult(raw: any): CommandResult {
  return {
    success: raw.success,
    authError: raw.auth_error,
    networkError: raw.network_error,
    rawStderr: raw.raw_stderr,
    data: raw.data ?? {},
    command: raw.command,
  };
}

function normalizeFileStatus(raw: any): FileStatus {
  return {
    path: raw.path,
    staged: raw.staged,
    statusLabel: raw.status_label,
  };
}

function normalizeGraph(raw: any): CommitGraphData {
  return {
    laneCount: raw.lane_count,
    hasMore: raw.has_more,
    commits: raw.commits.map((c: any) => ({
      hash: c.hash,
      parents: c.parents,
      author: c.author,
      date: c.date,
      message: c.message,
      refs: c.refs,
      lane: c.lane,
      row: c.row,
      onRemote: c.on_remote,
    })),
    edges: raw.edges.map((e: any) => ({
      from: e.from,
      to: e.to,
      fromLane: e.from_lane,
      fromRow: e.from_row,
      toLane: e.to_lane,
      toRow: e.to_row,
    })),
  };
}

export async function openRepo(path: string): Promise<RepoInfo> {
  const raw: any = await invoke("open_repo", { path });
  return { name: raw.name, path: raw.path, currentBranch: raw.current_branch };
}

export async function initRepo(path: string, remoteUrl: string | null): Promise<RepoInfo> {
  const raw: any = await invoke("init_repo", { path, remoteUrl });
  return { name: raw.name, path: raw.path, currentBranch: raw.current_branch };
}

// clones url into a new folder (named after the repo) inside destinationDir, then opens it
export async function cloneRepo(url: string, destinationDir: string): Promise<RepoInfo> {
  const raw: any = await invoke("clone_repo", { url, destinationDir });
  return { name: raw.name, path: raw.path, currentBranch: raw.current_branch };
}

export async function pull(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("pull", { repoPath }));
}

export async function push(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("push", { repoPath }));
}

export async function stash(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("stash", { repoPath }));
}

export async function commit(repoPath: string, message: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("commit", { repoPath, message }));
}

export async function getStatus(repoPath: string): Promise<FileStatus[]> {
  const raw: any[] = await invoke("status", { repoPath });
  return raw.map(normalizeFileStatus);
}

export async function stageFile(repoPath: string, path: string): Promise<void> {
  await invoke("stage_file", { repoPath, path });
}

export async function unstageFile(repoPath: string, path: string): Promise<void> {
  await invoke("unstage_file", { repoPath, path });
}

// discards a file's unstaged changes entirely - restores a tracked file, removes an untracked one
export async function discardFile(repoPath: string, path: string): Promise<void> {
  await invoke("discard_file", { repoPath, path });
}

export async function getFileDiff(repoPath: string, path: string, staged: boolean): Promise<string> {
  return invoke("file_diff", { repoPath, path, staged });
}

// cheap "has anything changed" signature, polled - not meant to be shown
export async function getRepoFingerprint(repoPath: string): Promise<string> {
  return invoke("repo_fingerprint", { repoPath });
}

export async function listBranches(repoPath: string): Promise<BranchInfo[]> {
  const raw: any[] = await invoke("list_branches", { repoPath });
  return raw.map((b) => ({ name: b.name, isCurrent: b.is_current, upstream: b.upstream, ahead: b.ahead, behind: b.behind }));
}

export async function switchBranch(repoPath: string, branch: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("switch_branch", { repoPath, branch }));
}

export async function createBranch(repoPath: string, name: string, startPoint: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("create_branch", { repoPath, name, startPoint }));
}

export async function revertToCommit(repoPath: string, target: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("revert_to_commit", { repoPath, target }));
}

export interface FileHunksResult {
  // one entry per hunk (raw unified-diff text); index is the hunkIndex stage/discard below take
  hunks: string[];
  // true when the file changed but didn't split into hunks (binary/mode-only change) - fall back to whole-file stage/discard
  wholeFileOnly: boolean;
}

// unstaged hunks for one file, for the hunk editor's stage/discard-per-part view
export async function getFileHunks(repoPath: string, path: string): Promise<FileHunksResult> {
  const raw: any = await invoke("file_hunks", { repoPath, path });
  return { hunks: raw.hunks, wholeFileOnly: raw.whole_file_only };
}

// stages only the given lines within one hunk; lines indexes parseDiff's output array (the "@@ ..." header is index 0)
export async function stageHunkLines(repoPath: string, path: string, hunkIndex: number, lines: number[]): Promise<void> {
  await invoke("stage_hunk_lines", { repoPath, path, hunkIndex, lines });
}

export async function discardHunkLines(repoPath: string, path: string, hunkIndex: number, lines: number[]): Promise<void> {
  await invoke("discard_hunk_lines", { repoPath, path, hunkIndex, lines });
}

export async function getCommitGraph(repoPath: string, limit: number): Promise<CommitGraphData> {
  return normalizeGraph(await invoke("commit_graph", { repoPath, limit }));
}

// undoes a stash - the other half of `stash`
export async function stashPop(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("stash_pop", { repoPath }));
}

// moves HEAD back to targetHash but keeps every change staged - undoes a commit or a revert
export async function uncommitTo(repoPath: string, targetHash: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("uncommit_to", { repoPath, targetHash }));
}

// moves the branch back to targetHash and discards everything after it - undoes a pull, refuses on a dirty tree
export async function hardResetTo(repoPath: string, targetHash: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("hard_reset_to", { repoPath, targetHash }));
}

// deletes the branch just created and switches back - undoes createBranch, refuses if it already has commits
export async function undoCreateBranch(repoPath: string, name: string, startPoint: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("undo_create_branch", { repoPath, name, startPoint }));
}

export interface GitAvailability {
  available: boolean;
  version: string | null;
}

// checked once at startup - nothing else works until this is true
export async function checkGitAvailable(): Promise<GitAvailability> {
  return invoke("check_git_available");
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

// the name/email commits in this repo get attributed to
export async function checkGitIdentity(repoPath: string): Promise<GitIdentity> {
  return invoke("check_git_identity", { repoPath });
}

export async function setGitIdentity(repoPath: string, name: string, email: string): Promise<void> {
  await invoke("set_git_identity", { repoPath, name, email });
}

// opens a URL in the system browser, not inside the app's own window
export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}