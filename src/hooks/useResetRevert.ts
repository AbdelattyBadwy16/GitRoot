import { useState } from "react";
import { revertToCommit, resetPreflight, resetToCommit, type ResetPreflight, type ResetMode, type FileChange } from "../lib/gitCommands";
import { explainDetails } from "../lib/explain";
import { computeUndo } from "../lib/undo";
import type { CommitActionContext } from "../components/CommitGraph";
import type { CoreActions } from "./types";

interface UseResetRevertArgs extends CoreActions {
  setPausedOp: (op: { kind: "merge" | "rebase" | "revert"; target: string } | null) => void;
  loadPreviewFiles: (repoPath: string, range: string) => Promise<void>;
  setPreviewFiles: (files: FileChange[] | null) => void;
}

export function useResetRevert({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo, setLastAction, setPausedOp, loadPreviewFiles, setPreviewFiles }: UseResetRevertArgs) {
  const [revertTarget, setRevertTarget] = useState<CommitActionContext | null>(null);
  const [resetFlow, setResetFlow] = useState<{
    context: CommitActionContext;
    preflight: ResetPreflight;
    step: "warning" | "picker" | "confirmDiscard";
    mode: ResetMode;
  } | null>(null);

  async function confirmRevert() {
    if (!repo || !revertTarget) return;
    const target = revertTarget.target.hash;
    setRevertTarget(null);
    setPreviewFiles(null);
    setBusy("revert");
    try {
      const result = await revertToCommit(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "revert", target });
        setLastAction(explainDetails("revert", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("revert", result);
      if (!details.isError) recordUndo(computeUndo("revert", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handlePickCommitAction(kind: "reset" | "revert", context: CommitActionContext) {
    if (!repo) return;
    const range = `${context.target.hash}..${context.head.hash}`;
    if (kind === "revert") {
      setRevertTarget(context);
      loadPreviewFiles(repo.path, range);
      return;
    }
    const preflight = await resetPreflight(repo.path, context.target.hash);
    setResetFlow({
      context,
      preflight,
      step: preflight.alreadyPushedCount > 0 ? "warning" : "picker",
      mode: "mixed",
    });
    loadPreviewFiles(repo.path, range);
  }

  function confirmResetWarning() {
    setResetFlow((rf) => (rf ? { ...rf, step: "picker" } : rf));
  }

  function confirmResetPicker() {
    if (!resetFlow) return;
    if (resetFlow.mode === "hard") {
      setResetFlow({ ...resetFlow, step: "confirmDiscard" });
      return;
    }
    executeReset(resetFlow.mode);
  }

  function confirmResetDiscard() {
    executeReset("hard");
  }

  async function executeReset(mode: ResetMode) {
    if (!repo || !resetFlow) return;
    const target = resetFlow.context.target.hash;
    setBusy("reset");
    try {
      const result = await resetToCommit(repo.path, target, mode);
      const details = applyResult("reset", result);
      if (!details.isError) recordUndo(computeUndo("reset", result));
      setResetFlow(null);
      setPreviewFiles(null);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  return {
    revertTarget,
    setRevertTarget,
    resetFlow,
    setResetFlow,
    confirmRevert,
    handlePickCommitAction,
    confirmResetWarning,
    confirmResetPicker,
    confirmResetDiscard,
  };
}
