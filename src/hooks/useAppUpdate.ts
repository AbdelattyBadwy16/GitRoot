import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

// single source of truth for "is there an update" - both the header button (which lights up
// while `update` is set, even after the dialog itself is dismissed) and the dialog (which reads
// the same `update`) stay in sync off one check, instead of each running its own.
export function useAppUpdate() {
  const [update, setUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // brief "you're up to date" confirmation for a manual check that found nothing - the silent
  // once-per-launch check on mount has no button to flash, so it just stays quiet on failure
  const [upToDateFlash, setUpToDateFlash] = useState(false);

  useEffect(() => {
    check()
      .then((result) => {
        if (result) setUpdate(result);
      })
      .catch(() => {});
  }, []);

  async function checkNow() {
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      const result = await check();
      if (result) {
        setUpdate(result);
        setDismissed(false);
      } else {
        flashUpToDate();
      }
    } catch (err) {
      // the updater throws this same message whether the endpoint has no release at all (a 404,
      // say) or it answered but with nothing usable - either way there is simply nothing to
      // install right now, which reads the same to a user as "you're up to date", not an error
      if (String(err).includes("Could not fetch a valid release JSON")) {
        flashUpToDate();
      } else {
        setError(String(err));
      }
    } finally {
      setChecking(false);
    }
  }

  function flashUpToDate() {
    setUpToDateFlash(true);
    window.setTimeout(() => setUpToDateFlash(false), 2000);
  }

  async function install() {
    if (!update || installing) return;
    setInstalling(true);
    setError(null);
    try {
      await update.downloadAndInstall();
      await relaunch();
    } catch (err) {
      setError(String(err));
      setInstalling(false);
    }
  }

  return {
    update,
    dismissed,
    checking,
    installing,
    error,
    upToDateFlash,
    checkNow,
    install,
    dismiss: () => setDismissed(true),
    // re-shows the dialog for the update already found (e.g. after "later") without re-hitting
    // the network - distinct from checkNow, which always checks again
    reopen: () => setDismissed(false),
  };
}
