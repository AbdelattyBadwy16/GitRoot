import { useState } from "react";
import { loadProfiles } from "../lib/profiles";
import type { GitIdentity } from "../lib/gitCommands";

// the startup "continue as X, or switch?" prompt, plus the controlled open state for the
// header AccountSwitcher dropdown (so this prompt's "manage accounts" link can open it)
export function useAccountPrompt() {
  const [showAccountPrompt, setShowAccountPrompt] = useState(false);
  const [accountSwitcherOpen, setAccountSwitcherOpen] = useState(false);

  // called once a freshly-opened repo's identity is known - only worth interrupting for if
  // there's an actual choice: at least one saved profile that isn't already the active one.
  // zero saved profiles, or the one saved profile that's already active, means nothing to ask.
  function checkAfterOpen(identity: GitIdentity) {
    if (!identity.name || !identity.email) {
      setShowAccountPrompt(false);
      return;
    }
    const hasAlternative = loadProfiles().some((p) => p.name !== identity.name || p.email !== identity.email);
    setShowAccountPrompt(hasAlternative);
  }

  function dismiss() {
    setShowAccountPrompt(false);
  }

  function openFullSwitcher() {
    setShowAccountPrompt(false);
    setAccountSwitcherOpen(true);
  }

  return { showAccountPrompt, dismiss, checkAfterOpen, accountSwitcherOpen, setAccountSwitcherOpen, openFullSwitcher };
}
