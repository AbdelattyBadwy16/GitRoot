import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { openPath } from "@tauri-apps/plugin-opener";
import { join } from "@tauri-apps/api/path";
import { getConflictedFiles, getRebaseStatus, hasConflictMarkers, stageFile } from "../lib/gitCommands";
import { rebaseProgressText } from "../lib/explain";
import { usePrefersReducedMotion } from "../hooks/usePrefersReducedMotion";

interface ConflictDialogProps {
  repoPath: string;
  kind: "merge" | "rebase" | "revert";
  target: string;
  onContinue: () => void;
  onAbort: () => void;
  busy: boolean;
}

type ExamplePhase = "raw" | "local" | "remote" | "both";

interface ExampleLine {
  key: string;
  text: string;
  // "content" lines are plain text either way - only the marker lines themselves get color, so
  // the "resolved" states read as ordinary text, not as a still-conflicted file
  tone: "marker" | "content";
  side: "local" | "remote" | null;
  color?: string;
}

const EXAMPLE_PHASES: ExamplePhase[] = ["raw", "local", "remote", "both"];
const EXAMPLE_HOLD_MS: Record<ExamplePhase, number> = { raw: 5000, local: 5000, remote: 5000, both: 5000 };

const EXAMPLE_CAPTION: Record<ExamplePhase, string> = {
  raw: "this is what git leaves in the file — it won't build or run like this, you have to clean it up first.",
  local: "keeping only the local version: delete the remote block, and all three marker lines.",
  remote: "keeping only the remote version: delete the local block, and all three marker lines.",
  both: "keeping both: just delete the three marker lines — keep both lines of code.",
};

function SideBadge({ side }: { side: "local" | "remote" }) {
  const color = side === "local" ? "var(--lane-1)" : "var(--lane-3)";
  return (
    <span
      style={{
        flexShrink: 0,
        fontFamily: "-apple-system, sans-serif",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: 0.4,
        textTransform: "uppercase",
        padding: "1px 6px",
        borderRadius: 999,
        color,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
      }}
    >
      {side === "local" ? "local — your side" : "remote — their side"}
    </span>
  );
}

// a real (if tiny) conflicting code change, played on its own on a loop: raw conflict → keep
// local → keep remote → keep both → back to raw. no buttons - just watch it happen, the same
// way a short how-to video would show it, without needing an actual video asset.
function ConflictMarkerExample({ target }: { target: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [phase, setPhase] = useState<ExamplePhase>("raw");

  useEffect(() => {
    if (reducedMotion) return;
    let cancelled = false;
    let idx = 0;
    let timer: number;
    const tick = () => {
      if (cancelled) return;
      idx = (idx + 1) % EXAMPLE_PHASES.length;
      const next = EXAMPLE_PHASES[idx];
      setPhase(next);
      timer = window.setTimeout(tick, EXAMPLE_HOLD_MS[next]);
    };
    timer = window.setTimeout(tick, EXAMPLE_HOLD_MS.raw);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [reducedMotion]);

  const lines = useMemo<ExampleLine[]>(
    () => [
      { key: "m1", text: "<<<<<<< HEAD", tone: "marker", side: "local", color: "var(--lane-1)" },
      { key: "local", text: '  const buttonLabel = "Sign up";', tone: "content", side: "local" },
      { key: "m2", text: "=======", tone: "marker", side: null, color: "var(--lane-4)" },
      { key: "remote", text: '  const buttonLabel = "Get started";', tone: "content", side: "remote" },
      { key: "m3", text: `>>>>>>> ${target}`, tone: "marker", side: "remote", color: "var(--lane-3)" },
    ],
    [target],
  );

  const visible = lines.filter((l) => {
    if (phase === "raw") return true;
    if (l.tone === "marker") return false;
    if (phase === "both") return true;
    return l.side === phase;
  });

  return (
    <div>
      <div
        style={{
          padding: "8px 10px",
          borderRadius: 6,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          fontFamily: "ui-monospace, monospace",
          fontSize: 11.5,
          lineHeight: 1.7,
          overflow: "hidden",
        }}
      >
        <AnimatePresence initial={false}>
          {visible.map((l) => (
            <motion.div
              key={l.key}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 34 }}
              style={{
                overflow: "hidden",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <span style={{ whiteSpace: "pre", color: l.color ?? "var(--text-primary)" }}>{l.text}</span>
              {l.tone === "content" && l.side && <SideBadge side={l.side} />}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence mode="wait">
        <motion.p
          key={phase}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5 }}
        >
          {EXAMPLE_CAPTION[phase]}
        </motion.p>
      </AnimatePresence>
    </div>
  );
}

export default function ConflictDialog({ repoPath, kind, target, onContinue, onAbort, busy }: ConflictDialogProps) {
  const [files, setFiles] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  // files where a "mark as resolved" click found the file still has <<<<<<< markers in it -
  // shown as an inline warning with a way to force it through instead of a modal, since it's a
  // per-row, low-stakes decision (unlike discarding a hunk, staging here is easy to undo)
  const [markerWarning, setMarkerWarning] = useState<Set<string>>(new Set());
  const [stagingFile, setStagingFile] = useState<string | null>(null);

  async function handleOpenFile(relativePath: string) {
    setOpenError(null);
    try {
      const fullPath = await join(repoPath, relativePath);
      await openPath(fullPath);
    } catch (err) {
      setOpenError(`couldn't open ${relativePath} — ${String(err)}`);
    }
  }

  async function handleMarkResolved(relativePath: string, force: boolean) {
    setOpenError(null);
    if (!force) {
      try {
        if (await hasConflictMarkers(repoPath, relativePath)) {
          setMarkerWarning((prev) => new Set(prev).add(relativePath));
          return;
        }
      } catch {
        // couldn't check - fall through and let stageFile itself surface any real problem
      }
    }
    setMarkerWarning((prev) => {
      if (!prev.has(relativePath)) return prev;
      const next = new Set(prev);
      next.delete(relativePath);
      return next;
    });
    setStagingFile(relativePath);
    try {
      await stageFile(repoPath, relativePath);
    } catch (err) {
      setOpenError(`couldn't mark ${relativePath} as resolved — ${String(err)}`);
    } finally {
      setStagingFile(null);
    }
  }

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const conflicted = await getConflictedFiles(repoPath);
        if (!cancelled) setFiles(conflicted);
      } catch {
      }
      if (kind === "rebase") {
        try {
          const status = await getRebaseStatus(repoPath);
          if (!cancelled) setProgress(status.inProgress ? { current: status.current, total: status.total } : null);
        } catch {
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
          width: 520,
          maxHeight: "88vh",
          overflowY: "auto",
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
            {kind === "merge" ? "merge conflict" : kind === "rebase" ? "rebase conflict" : "revert conflict"}
          </h2>
        </div>

        <p style={{ margin: "0 0 6px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          {kind === "merge"
            ? `git paused while merging ${target} — it couldn't combine these files automatically.`
            : kind === "rebase"
            ? `git paused while replaying your commits onto ${target} — it couldn't apply one automatically.`
            : `git paused while reverting a commit that touched the same lines as something after it — it couldn't undo it automatically.`}{" "}
          the file(s) below have two versions of the same lines, and git needs you to pick which ones stay.
        </p>

        <div
          style={{
            marginBottom: 14,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-0)",
            padding: "10px 12px",
          }}
        >
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>
            how to fix each file
          </div>
          <ol style={{ margin: "0 0 10px", padding: "0 0 0 18px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <li>
              click <strong>open</strong> next to a file below — it opens in your editor.
            </li>
            <li>
              inside, look for blocks that look like this — git left them right in the file to show you both
              versions. watch what each choice would leave behind:
            </li>
          </ol>

          <ConflictMarkerExample target={target} />

          <ol start={3} style={{ margin: "10px 0 0", padding: "0 0 0 18px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            <li>
              in the real file, delete whichever version you don't want, <strong>and delete all three marker lines
              too</strong> — only your final, clean text should be left.
            </li>
            <li>save the file, come back here, and click "mark as resolved" next to it.</li>
            <li>once every file below is resolved, "continue" lights up.</li>
          </ol>
        </div>

        {openError && (
          <div
            style={{
              marginBottom: 12,
              padding: "8px 10px",
              borderRadius: 7,
              background: "color-mix(in srgb, var(--danger) 12%, transparent)",
              border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
              color: "var(--danger)",
              fontSize: 12,
            }}
          >
            {openError}
          </div>
        )}

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
            files.map((f) => {
              const warned = markerWarning.has(f);
              const busyHere = stagingFile === f;
              return (
                <div key={f} style={{ padding: "7px 8px 7px 12px", borderTop: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--danger)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={f}
                    >
                      {f}
                    </span>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <button
                        onClick={() => handleOpenFile(f)}
                        title="open in your default editor"
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "3px 8px",
                          borderRadius: 6,
                          border: "1px solid var(--border)",
                          background: "none",
                          color: "var(--text-secondary)",
                          fontSize: 11,
                          fontWeight: 500,
                          cursor: "pointer",
                        }}
                      >
                        open
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 17L17 7M9 7h8v8" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleMarkResolved(f, false)}
                        disabled={busyHere}
                        title="stage this file, so continue can go ahead once every file is marked"
                        style={{
                          padding: "3px 8px",
                          borderRadius: 6,
                          border: "none",
                          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                          color: "#fff",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: busyHere ? "default" : "pointer",
                          opacity: busyHere ? 0.6 : 1,
                        }}
                      >
                        {busyHere ? "…" : "mark as resolved"}
                      </button>
                    </div>
                  </div>
                  {warned && (
                    <div
                      style={{
                        marginTop: 7,
                        padding: "7px 9px",
                        borderRadius: 6,
                        background: "color-mix(in srgb, var(--lane-4) 12%, transparent)",
                        border: "1px solid color-mix(in srgb, var(--lane-4) 35%, transparent)",
                        fontSize: 11.5,
                        color: "var(--text-secondary)",
                        lineHeight: 1.5,
                      }}
                    >
                      this file still has conflict markers ({"<<<<<<< / ======= / >>>>>>>"}) in it — it probably
                      isn't finished yet.
                      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                        <button
                          onClick={() => setMarkerWarning((prev) => { const next = new Set(prev); next.delete(f); return next; })}
                          style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "none", color: "var(--text-secondary)", fontSize: 11, cursor: "pointer" }}
                        >
                          let me check again
                        </button>
                        <button
                          onClick={() => handleMarkResolved(f, true)}
                          disabled={busyHere}
                          style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid color-mix(in srgb, var(--lane-4) 50%, var(--border))", background: "none", color: "var(--lane-4)", fontSize: 11, fontWeight: 600, cursor: busyHere ? "default" : "pointer" }}
                        >
                          stage it anyway
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
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
