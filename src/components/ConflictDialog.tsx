import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { getConflictedFiles, getRebaseStatus } from "../lib/gitCommands";
import { rebaseProgressText } from "../lib/explain";

interface ConflictDialogProps {
  repoPath: string;
  // which operation paused - only rebase shows "resolving commit N of M" progress
  kind: "merge" | "rebase";
  target: string;
  onContinue: () => void;
  onAbort: () => void;
  // true while a continue/abort request is in flight
  busy: boolean;
}

// the one conflict-pause UI shared by merge and rebase (see DESIGN.md 2.6) - polls the repo
// itself for the live conflicted-file list (and, for rebase, replay progress) so continue only
// enables once every unmerged path is actually resolved
export default function ConflictDialog({ repoPath, kind, target, onContinue, onAbort, busy }: ConflictDialogProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const conflicted = await getConflictedFiles(repoPath);
        if (!cancelled) setFiles(conflicted);
      } catch {
        // repo momentarily unreadable mid-operation - next tick retries
      }
      if (kind === "rebase") {
        try {
          const status = await getRebaseStatus(repoPath);
          if (!cancelled) setProgress(status.inProgress ? { current: status.current, total: status.total } : null);
        } catch {
          // ignore - stale progress is harmless, the file list is what gates continue
        }
      }
    }

    poll();
    const interval = window.setInterval(poll, 800);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [repoPath, kind]);

  const resolved = files.length === 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        style={{
          width: 440,
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--lane-4)",
              boxShadow: "0 0 6px 1px color-mix(in srgb, var(--lane-4) 55%, transparent)",
            }}
          />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
            {kind === "merge" ? "merge conflict" : "rebase conflict"}
          </h2>
        </div>

        <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          {kind === "merge"
            ? `git paused while merging ${target} — it couldn't combine these files automatically.`
            : `git paused while replaying your commits onto ${target} — it couldn't apply one automatically.`}{" "}
          resolve them in your editor or terminal (edit the file, remove the conflict markers, then stage it), and this
          dialog will update on its own.
        </p>

        {kind === "rebase" && progress && (
          <div
            style={{
              marginBottom: 12,
              padding: "6px 10px",
              borderRadius: 7,
              background: "var(--surface-2)",
              border: "1px solid var(--border)",
              fontSize: 12.5,
              color: "var(--text-secondary)",
              display: "inline-block",
            }}
          >
            {rebaseProgressText(progress.current, progress.total)}
          </div>
        )}

        <div
          style={{
            marginBottom: 18,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-0)",
            maxHeight: 140,
            overflow: "auto",
          }}
        >
          {files.length === 0 ? (
            <div style={{ padding: "10px 12px", fontSize: 12.5, color: "var(--lane-3)", display: "flex", alignItems: "center", gap: 7 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              every conflict is resolved — ready to continue.
            </div>
          ) : (
            files.map((f) => (
              <div
                key={f}
                style={{
                  padding: "7px 12px",
                  fontSize: 12.5,
                  fontFamily: "ui-monospace, monospace",
                  color: "var(--danger)",
                  borderTop: "1px solid var(--border)",
                }}
              >
                {f}
              </div>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onAbort}
            disabled={busy}
            title={`git ${kind} --abort`}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid color-mix(in srgb, var(--danger) 45%, var(--border))",
              background: "none",
              color: "var(--danger)",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            abort
          </button>
          <button
            onClick={onContinue}
            disabled={busy || !resolved}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || !resolved ? "default" : "pointer",
              opacity: busy || !resolved ? 0.5 : 1,
            }}
          >
            {busy ? "working…" : "continue"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
