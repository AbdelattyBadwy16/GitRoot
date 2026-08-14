import { useState } from "react";
import { applyStash, popStash, dropStash, withTarget, type StashInfo } from "../lib/gitCommands";
import type { CoreActions } from "./types";

export function useStashActions({ repo, setBusy, applyResult, refresh }: CoreActions) {
  const [dropStashTarget, setDropStashTarget] = useState<StashInfo | null>(null);

  async function handleApplyStash(stash: StashInfo) {
    if (!repo) return;
    setBusy("applyStash");
    try {
      const result = await applyStash(repo.path, stash.stashRef);
      // withTarget so the result text can name which stash this was ({target}), not just
      // say "applied the stash" - the backend only knows the ref, the frontend already has
      // the human message right here
      applyResult("applyStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function handlePopStash(stash: StashInfo) {
    if (!repo) return;
    setBusy("popStash");
    try {
      const result = await popStash(repo.path, stash.stashRef);
      applyResult("popStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function confirmDropStash() {
    if (!repo || !dropStashTarget) return;
    const stash = dropStashTarget;
    setDropStashTarget(null);
    setBusy("dropStash");
    try {
      const result = await dropStash(repo.path, stash.stashRef);
      applyResult("dropStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  return { dropStashTarget, setDropStashTarget, handleApplyStash, handlePopStash, confirmDropStash };
}
