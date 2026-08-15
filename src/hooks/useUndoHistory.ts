import { useEffect, useRef, useState } from "react";
import {
  hardResetTo,
  uncommitTo,
  stashPop,
  switchBranch,
  undoCreateBranch,
  revertToCommit,
  push,
  loadUndoHistory,
  saveUndoHistory,
  type RepoInfo,
  type CommandResult,
  type CommitGraphData,
} from "../lib/gitCommands";
import type { ActionDetails, ActionKind } from "../lib/explain";
import {
  MAX_UNDO_HISTORY,
  genId,
  toPersistedEntry,
  fromPersistedEntry,
  type UndoAction,
  type UndoHistoryItem,
} from "../lib/undo";

interface UseUndoHistoryArgs {
  repo: RepoInfo | null;
  setBusy: (name: string | null) => void;
  applyResult: (kind: ActionKind, result: CommandResult) => ActionDetails;
  refresh: (path: string) => Promise<CommitGraphData>;
  pulseHead: (g: CommitGraphData) => void;
}

export function useUndoHistory({ repo, setBusy, applyResult, refresh, pulseHead }: UseUndoHistoryArgs) {
  const [undoHistory, setUndoHistory] = useState<UndoHistoryItem[]>([]);
  const [undoConfirmingId, setUndoConfirmingId] = useState<string | null>(null);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const undoHistoryRef = useRef<HTMLDivElement>(null);
  const lastUndo = undoHistory[0] ?? null;
  const undoConfirming = undoHistory.find((h) => h.id === undoConfirmingId) ?? null;

  // close the history dropdown on an outside click
  useEffect(() => {
    if (!undoHistoryOpen) return;
    function onDocClick(e: MouseEvent) {
      if (undoHistoryRef.current && !undoHistoryRef.current.contains(e.target as Node)) setUndoHistoryOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [undoHistoryOpen]);

  // undo history is scoped per-repo and persisted in that repo's own .git dir, so opening a
  // (possibly different) repo means loading whatever history that repo already has, not
  // carrying over whatever was in memory before
  useEffect(() => {
    if (!repo) return;
    setUndoHistory([]);
    loadUndoHistory(repo.path)
      .then((entries) => setUndoHistory(entries.map(fromPersistedEntry)))
      .catch(() => setUndoHistory([]));
  }, [repo?.path]);

  function pushUndoHistory(action: UndoAction) {
    if (!repo) return;
    const next = [{ id: genId(), action, timestampMs: Date.now() }, ...undoHistory].slice(0, MAX_UNDO_HISTORY);
    setUndoHistory(next);
    saveUndoHistory(repo.path, next.map(toPersistedEntry)).catch(() => {});
  }

  // most call sites just have a raw UndoAction | null from computeUndo - this is the
  // "record it if there's anything to record" shortcut for those
  function recordUndo(action: UndoAction | null) {
    if (action) pushUndoHistory(action);
  }

  function removeUndoHistoryEntry(id: string) {
    setUndoHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      if (repo) saveUndoHistory(repo.path, next.map(toPersistedEntry)).catch(() => {});
      return next;
    });
  }

  // undoes one specific entry from the history, not necessarily the most recent - each entry
  // just replays its own reverse command against the repo's current state, independent of
  // whatever else has happened since (git has no real transactional undo; this is the same
  // limitation that already existed for "undo last action", just no longer hidden behind it
  // always being the most recent thing)
  async function handleUndo(entryId: string) {
    const entry = undoHistory.find((h) => h.id === entryId);
    if (!repo || !entry) return;
    const action = entry.action;
    setBusy("undo");
    try {
      let result: CommandResult;
      switch (action.kind) {
        case "pull":
        case "reset":
          result = await hardResetTo(repo.path, action.targetHash);
          break;
        case "commit":
        case "revert":
          result = await uncommitTo(repo.path, action.targetHash);
          break;
        case "stash":
          result = await stashPop(repo.path);
          break;
        case "switchBranch":
          result = await switchBranch(repo.path, action.targetBranch);
          break;
        case "createBranch":
          result = await undoCreateBranch(repo.path, action.name, action.startPoint);
          break;
        case "push": {
          removeUndoHistoryEntry(entryId); // not safe to just retry this if it fail halfway
          const revertResult = await revertToCommit(repo.path, action.targetHash);
          if (!revertResult.success) {
            result = revertResult;
            break;
          }
          const pushResult = await push(repo.path);
          result = { ...pushResult, command: `${revertResult.command} && ${pushResult.command}` };
          break;
        }
      }
      const details = applyResult("undo", result);
      if (!details.isError) removeUndoHistoryEntry(entryId);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  return {
    undoHistory,
    undoConfirmingId,
    setUndoConfirmingId,
    undoHistoryOpen,
    setUndoHistoryOpen,
    undoHistoryRef,
    lastUndo,
    undoConfirming,
    recordUndo,
    handleUndo,
  };
}
