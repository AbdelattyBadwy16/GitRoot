import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";


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
  conflict: boolean;
  rawStderr: string | null;
  data: Record<string, unknown>;
  command: string;
}

export interface FileStatus {
  path: string;
  staged: boolean;
  statusLabel: string;
}

// injects a human-readable {target} (a stash message, a commit hash, ...) into a result's data
// so explainDetails/dictionary templates can name what an action was about - used wherever the
// backend only knows a ref/hash but the frontend already has the friendlier label in hand
export function withTarget(result: CommandResult, target: string): CommandResult {
  return { ...result, data: { ...result.data, target } };
}

export interface BranchInfo {
  name: string;
  isCurrent: boolean;
  upstream: string | null;
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
  hasMore: boolean;
}

function normalizeCommandResult(raw: any): CommandResult {
  return {
    success: raw.success,
    authError: raw.auth_error,
    networkError: raw.network_error,
    conflict: raw.conflict,
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

export async function discardFile(repoPath: string, path: string): Promise<void> {
  await invoke("discard_file", { repoPath, path });
}

export async function getFileDiff(repoPath: string, path: string, staged: boolean): Promise<string> {
  return invoke("file_diff", { repoPath, path, staged });
}

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
  hunks: string[];
  wholeFileOnly: boolean;
}

export async function getFileHunks(repoPath: string, path: string): Promise<FileHunksResult> {
  const raw: any = await invoke("file_hunks", { repoPath, path });
  return { hunks: raw.hunks, wholeFileOnly: raw.whole_file_only };
}

export async function stageHunkLines(repoPath: string, path: string, hunkIndex: number, lines: number[]): Promise<void> {
  await invoke("stage_hunk_lines", { repoPath, path, hunkIndex, lines });
}

export async function discardHunkLines(repoPath: string, path: string, hunkIndex: number, lines: number[]): Promise<void> {
  await invoke("discard_hunk_lines", { repoPath, path, hunkIndex, lines });
}

export async function getCommitGraph(repoPath: string, limit: number): Promise<CommitGraphData> {
  return normalizeGraph(await invoke("commit_graph", { repoPath, limit }));
}

export async function stashPop(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("stash_pop", { repoPath }));
}

// ===== stash list / selective restore =====

export interface StashInfo {
  stashRef: string;
  message: string;
  branch: string | null;
  date: string;
}

export async function listStashes(repoPath: string): Promise<StashInfo[]> {
  const raw: any[] = await invoke("list_stashes", { repoPath });
  return raw.map((s) => ({ stashRef: s.stash_ref, message: s.message, branch: s.branch ?? null, date: s.date }));
}

export async function applyStash(repoPath: string, stashRef: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("apply_stash", { repoPath, stashRef }));
}

export async function popStash(repoPath: string, stashRef: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("pop_stash", { repoPath, stashRef }));
}

export async function dropStash(repoPath: string, stashRef: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("drop_stash", { repoPath, stashRef }));
}

// ===== undo history (persisted per-repo, in .git/) =====

export interface UndoHistoryEntry {
  id: string;
  kind: string;
  // opaque on purpose - whatever shape UndoAction (in App.tsx) serializes to
  action: unknown;
  label: string;
  timestampMs: number;
}

export async function loadUndoHistory(repoPath: string): Promise<UndoHistoryEntry[]> {
  const raw: any[] = await invoke("load_undo_history", { repoPath });
  return raw.map((e) => ({ id: e.id, kind: e.kind, action: e.action, label: e.label, timestampMs: e.timestamp_ms }));
}

export async function saveUndoHistory(repoPath: string, entries: UndoHistoryEntry[]): Promise<void> {
  await invoke("save_undo_history", {
    repoPath,
    entries: entries.map((e) => ({ id: e.id, kind: e.kind, action: e.action, label: e.label, timestamp_ms: e.timestampMs })),
  });
}

export async function uncommitTo(repoPath: string, targetHash: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("uncommit_to", { repoPath, targetHash }));
}

export async function hardResetTo(repoPath: string, targetHash: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("hard_reset_to", { repoPath, targetHash }));
}

export async function undoCreateBranch(repoPath: string, name: string, startPoint: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("undo_create_branch", { repoPath, name, startPoint }));
}

export interface GitAvailability {
  available: boolean;
  version: string | null;
}

export async function checkGitAvailable(): Promise<GitAvailability> {
  return invoke("check_git_available");
}

export interface GitIdentity {
  name: string | null;
  email: string | null;
}

export async function checkGitIdentity(repoPath: string): Promise<GitIdentity> {
  return invoke("check_git_identity", { repoPath });
}

export async function setGitIdentity(repoPath: string, name: string, email: string): Promise<void> {
  await invoke("set_git_identity", { repoPath, name, email });
}

export async function openExternal(url: string): Promise<void> {
  await openUrl(url);
}

// ===== merge =====

export interface MergePreview {
  outcome: "fastForward" | "clean" | "conflict";
  commits: number;
  files: string[];
  currentBranch: string;
}

function normalizeMergePreview(raw: any): MergePreview {
  return { outcome: raw.outcome, commits: raw.commits, files: raw.files, currentBranch: raw.current_branch };
}

export async function mergePreview(repoPath: string, target: string): Promise<MergePreview> {
  return normalizeMergePreview(await invoke("merge_preview", { repoPath, target }));
}

export async function mergeBranch(repoPath: string, target: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("merge_branch", { repoPath, target }));
}

export async function continueMerge(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("continue_merge", { repoPath }));
}

export async function abortMerge(repoPath: string): Promise<void> {
  await invoke("abort_merge", { repoPath });
}

// ===== rebase =====

export interface RebasePreflight {
  currentBranch: string;
  target: string;
  totalCommits: number;
  alreadyPushedCount: number;
  hasUpstream: boolean;
  upstream: string | null;
}

function normalizeRebasePreflight(raw: any): RebasePreflight {
  return {
    currentBranch: raw.current_branch,
    target: raw.target,
    totalCommits: raw.total_commits,
    alreadyPushedCount: raw.already_pushed_count,
    hasUpstream: raw.has_upstream,
    upstream: raw.upstream ?? null,
  };
}

export async function rebasePreflight(repoPath: string, target: string): Promise<RebasePreflight> {
  return normalizeRebasePreflight(await invoke("rebase_preflight", { repoPath, target }));
}

export async function rebaseBranch(repoPath: string, target: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("rebase_branch", { repoPath, target }));
}

export interface RebaseStatus {
  inProgress: boolean;
  current: number;
  total: number;
}

export async function getRebaseStatus(repoPath: string): Promise<RebaseStatus> {
  const raw: any = await invoke("rebase_status", { repoPath });
  return { inProgress: raw.in_progress, current: raw.current, total: raw.total };
}

export async function continueRebase(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("continue_rebase", { repoPath }));
}

export async function abortRebase(repoPath: string): Promise<void> {
  await invoke("abort_rebase", { repoPath });
}

export async function getConflictedFiles(repoPath: string): Promise<string[]> {
  return invoke("conflicted_files", { repoPath });
}

export async function continueRevert(repoPath: string): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("continue_revert", { repoPath }));
}

export async function abortRevert(repoPath: string): Promise<void> {
  await invoke("abort_revert", { repoPath });
}

// ===== file change preview (reset / revert / merge / rebase) =====

export interface FileChange {
  path: string;
  status: "added" | "deleted" | "modified" | "renamed";
}

export async function diffNameStatus(repoPath: string, range: string): Promise<FileChange[]> {
  return invoke("diff_name_status", { repoPath, range });
}

// ===== reset =====

export type ResetMode = "soft" | "mixed" | "hard";

export interface ResetPreflight {
  currentBranch: string;
  target: string;
  commits: number;
  alreadyPushedCount: number;
  hasUncommittedChanges: boolean;
}

function normalizeResetPreflight(raw: any): ResetPreflight {
  return {
    currentBranch: raw.current_branch,
    target: raw.target,
    commits: raw.commits,
    alreadyPushedCount: raw.already_pushed_count,
    hasUncommittedChanges: raw.has_uncommitted_changes,
  };
}

export async function resetPreflight(repoPath: string, targetHash: string): Promise<ResetPreflight> {
  return normalizeResetPreflight(await invoke("reset_preflight", { repoPath, targetHash }));
}

export async function resetToCommit(repoPath: string, targetHash: string, mode: ResetMode): Promise<CommandResult> {
  return normalizeCommandResult(await invoke("reset_to_commit", { repoPath, targetHash, mode }));
}

// backed by a marker file in the app's own data dir, not localStorage - stays correct across
// app restarts regardless of how the webview handles its storage
export async function checkTourOffered(): Promise<boolean> {
  return invoke("check_tour_offered");
}

export async function markTourOffered(): Promise<void> {
  await invoke("mark_tour_offered");
}