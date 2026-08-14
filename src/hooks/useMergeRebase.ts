import { useState } from "react";
import { mergePreview, mergeBranch, rebasePreflight, rebaseBranch, getRebaseStatus, type MergePreview, type RebasePreflight, type FileChange } from "../lib/gitCommands";
import { explainDetails } from "../lib/explain";
import type { CoreActions } from "./types";

interface UseMergeRebaseArgs extends CoreActions {
  setPausedOp: (op: { kind: "merge" | "rebase" | "revert"; target: string } | null) => void;
  loadPreviewFiles: (repoPath: string, range: string) => Promise<void>;
  setPreviewFiles: (files: FileChange[] | null) => void;
}

export function useMergeRebase({ repo, setBusy, applyResult, refresh, pulseHead, setLastAction, setPausedOp, loadPreviewFiles, setPreviewFiles }: UseMergeRebaseArgs) {
  const [mergeConfirm, setMergeConfirm] = useState<{ target: string; preview: MergePreview } | null>(null);
  const [rebaseFlow, setRebaseFlow] = useState<{ step: "warning" | "plan"; target: string; preflight: RebasePreflight } | null>(null);
  const [rebaseProgress, setRebaseProgress] = useState<{ current: number; total: number } | null>(null);

  async function handlePickMergeTarget(target: string) {
    if (!repo) return;
    const preview = await mergePreview(repo.path, target);
    setMergeConfirm({ target, preview });
    loadPreviewFiles(repo.path, `HEAD...${target}`);
  }

  async function confirmMerge() {
    if (!repo || !mergeConfirm) return;
    const target = mergeConfirm.target;
    setMergeConfirm(null);
    setPreviewFiles(null);
    setBusy("merge");
    try {
      const result = await mergeBranch(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "merge", target });
        setLastAction(explainDetails("merge", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("merge", result);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handlePickRebaseTarget(target: string) {
    if (!repo) return;
    const preflight = await rebasePreflight(repo.path, target);
    setRebaseFlow({ step: preflight.alreadyPushedCount > 0 ? "warning" : "plan", target, preflight });
    loadPreviewFiles(repo.path, `${target}...HEAD`);
  }

  function confirmRebaseWarning() {
    if (!rebaseFlow) return;
    setRebaseFlow({ ...rebaseFlow, step: "plan" });
  }

  async function confirmRebasePlan() {
    if (!repo || !rebaseFlow) return;
    const target = rebaseFlow.target;
    setRebaseFlow(null);
    setPreviewFiles(null);
    setBusy("rebase");
    const poll = window.setInterval(async () => {
      try {
        const status = await getRebaseStatus(repo.path);
        setRebaseProgress(status.inProgress ? { current: status.current, total: status.total } : null);
      } catch {
      }
    }, 300);
    try {
      const result = await rebaseBranch(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "rebase", target });
        setLastAction(explainDetails("rebase", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("rebase", result);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      window.clearInterval(poll);
      setRebaseProgress(null);
      setBusy(null);
    }
  }

  return {
    mergeConfirm,
    setMergeConfirm,
    rebaseFlow,
    setRebaseFlow,
    rebaseProgress,
    setRebaseProgress,
    handlePickMergeTarget,
    confirmMerge,
    handlePickRebaseTarget,
    confirmRebaseWarning,
    confirmRebasePlan,
  };
}
