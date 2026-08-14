import { useState } from "react";
import { setGitIdentity } from "../lib/gitCommands";
import type { GitProfile } from "../lib/profiles";

// shared by AccountSwitcher (the header dropdown) and AccountPrompt (the startup prompt) -
// both just need "switch to this saved profile" with the same busy/error handling, they
// differ only in what they do once it's done (close a form vs. dismiss a prompt)
export function useProfileSwitch(repoPath: string, onIdentityChanged: () => void) {
  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(profile: GitProfile, onDone?: () => void) {
    if (switchingId) return;
    setSwitchingId(profile.id);
    setError(null);
    try {
      await setGitIdentity(repoPath, profile.name, profile.email);
      onIdentityChanged();
      onDone?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setSwitchingId(null);
    }
  }

  return { switchingId, error, setError, switchTo };
}
