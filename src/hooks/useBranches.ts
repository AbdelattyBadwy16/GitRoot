import { switchBranch, createBranch } from "../lib/gitCommands";
import { computeUndo } from "../lib/undo";
import type { CoreActions } from "./types";

export function useBranches({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo }: CoreActions) {
  async function handleSwitchBranch(name: string) {
    if (!repo) return;
    setBusy("switchBranch");
    try {
      const result = await switchBranch(repo.path, name);
      const details = applyResult("switchBranch", result);
      if (!details.isError) recordUndo(computeUndo("switchBranch", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateBranch(name: string, startPoint: string) {
    if (!repo) return;
    setBusy("createBranch");
    try {
      const result = await createBranch(repo.path, name, startPoint);
      const details = applyResult("createBranch", result);
      if (!details.isError) recordUndo(computeUndo("createBranch", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  return { handleSwitchBranch, handleCreateBranch };
}
