import type { ActionKind } from "./explain";
import type { CommandResult, UndoHistoryEntry } from "./gitCommands";

export type UndoAction =
  | { kind: "pull"; targetHash: string }
  | { kind: "push"; targetHash: string }
  | { kind: "stash" }
  | { kind: "commit"; targetHash: string }
  | { kind: "switchBranch"; targetBranch: string }
  | { kind: "createBranch"; name: string; startPoint: string }
  | { kind: "revert"; targetHash: string }
  | { kind: "reset"; targetHash: string };

export const UNDO_LABEL: Record<UndoAction["kind"], string> = {
  pull: "undo pull",
  push: "undo push",
  stash: "undo stash",
  commit: "undo commit",
  switchBranch: "undo switch",
  createBranch: "undo new branch",
  revert: "undo revert",
  reset: "undo reset",
};

export function undoConfirmText(action: UndoAction): string {
  switch (action.kind) {
    case "pull":
      return "moves your branch back to before the pull. only works if your working directory is clean right now.";
    case "push":
      return "reverts the commits you just pushed and pushes that revert — nothing is deleted from history, and this is safe even though it already reached the remote.";
    case "stash":
      return "brings back the changes you just stashed.";
    case "commit":
      return "undoes the commit but keeps every change staged, ready to commit again.";
    case "switchBranch":
      return `switches back to ${action.targetBranch}.`;
    case "createBranch":
      return `deletes ${action.name} and switches back to ${action.startPoint}. only works if you haven't committed anything on it yet.`;
    case "revert":
      return "undoes the revert and keeps the changes staged, ready to commit again.";
    case "reset":
      return "moves your branch back to before the reset. changes a hard reset threw away can't be brought back.";
  }
}

export function computeUndo(kind: ActionKind, result: CommandResult): UndoAction | null {
  const data = result.data;
  switch (kind) {
    case "pull":
      return Number(data.commits ?? 0) > 0 && typeof data.before === "string" ? { kind: "pull", targetHash: data.before } : null;
    case "push":
      return data.hadUpstream === true && Number(data.commits ?? 0) > 0 && typeof data.before === "string"
        ? { kind: "push", targetHash: data.before }
        : null;
    case "stash":
      return Number(data.files ?? 0) > 0 ? { kind: "stash" } : null;
    case "commit":
      return typeof data.beforeHead === "string" ? { kind: "commit", targetHash: data.beforeHead } : null;
    case "switchBranch":
      return typeof data.before === "string" && data.before !== data.after ? { kind: "switchBranch", targetBranch: data.before } : null;
    case "createBranch":
      return typeof data.branch === "string" && typeof data.from === "string" ? { kind: "createBranch", name: data.branch, startPoint: data.from } : null;
    case "revert":
      return typeof data.before === "string" ? { kind: "revert", targetHash: data.before } : null;
    case "reset":
      return typeof data.before === "string" ? { kind: "reset", targetHash: data.before } : null;
    default:
      return null;
  }
}

// how many past actions the undo history keeps around, most-recent-first - old enough to be
// genuinely useful, capped so the persisted file and the dropdown both stay reasonable
export const MAX_UNDO_HISTORY = 20;

export interface UndoHistoryItem {
  id: string;
  action: UndoAction;
  timestampMs: number;
}

export function genId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function toPersistedEntry(item: UndoHistoryItem): UndoHistoryEntry {
  return { id: item.id, kind: item.action.kind, action: item.action, label: UNDO_LABEL[item.action.kind], timestampMs: item.timestampMs };
}

export function fromPersistedEntry(entry: UndoHistoryEntry): UndoHistoryItem {
  return { id: entry.id, action: entry.action as UndoAction, timestampMs: entry.timestampMs };
}

export function relativeTime(ms: number): string {
  const diffSec = Math.round((Date.now() - ms) / 1000);
  if (diffSec < 60) return "just now";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}d ago`;
}
