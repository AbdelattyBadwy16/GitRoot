import { useState } from "react";
import { continueMerge, continueRebase, continueRevert, abortMerge, abortRebase, abortRevert, withTarget } from "../lib/gitCommands";
import { explainDetails } from "../lib/explain";
import { computeUndo } from "../lib/undo";
import type { CoreActions } from "./types";

// a paused git operation waiting on conflict resolution - merge, rebase, and revert all feed
// into this one, since they share the exact same continue/abort UI (ConflictDialog)
export function usePausedOp({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo, setLastAction }: CoreActions) {
  const [pausedOp, setPausedOp] = useState<{ kind: "merge" | "rebase" | "revert"; target: string } | null>(null);

  async function handleContinuePausedOp() {
    if (!repo || !pausedOp) return;
    setBusy("conflictContinue");
    try {
      const raw =
        pausedOp.kind === "merge"
          ? await continueMerge(repo.path)
          : pausedOp.kind === "rebase"
          ? await continueRebase(repo.path)
          : await continueRevert(repo.path);
      const result = withTarget(raw, pausedOp.target);
      if (result.conflict) {
        setLastAction(explainDetails(pausedOp.kind, result));
        return;
      }
      setPausedOp(null);
      const details = applyResult(pausedOp.kind, result);
      if (!details.isError && pausedOp.kind === "revert") recordUndo(computeUndo("revert", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleAbortPausedOp() {
    if (!repo || !pausedOp) return;
    setBusy("conflictAbort");
    try {
      if (pausedOp.kind === "merge") await abortMerge(repo.path);
      else if (pausedOp.kind === "rebase") await abortRebase(repo.path);
      else await abortRevert(repo.path);
      setPausedOp(null);
      setLastAction(null);
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  return { pausedOp, setPausedOp, handleContinuePausedOp, handleAbortPausedOp };
}
