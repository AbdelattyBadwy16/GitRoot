import type { CSSProperties } from "react";
import { motion } from "framer-motion";
import { resetAlreadyPushedWarning, resetDiscardConfirmText, resetModeInlineText, type ResetMode } from "../lib/explain";
import type { CommitActionContext } from "./CommitGraph";
import type { FileChange } from "../lib/gitCommands";
import CommitRangeSummary from "./CommitRangeSummary";
import PreviewTabs from "./PreviewTabs";
import FileChangesList from "./FileChangesList";

interface ResetDialogProps {
  context: CommitActionContext;
  hasUncommittedChanges: boolean;
  step: "warning" | "picker" | "confirmDiscard";
  mode: ResetMode;
  previewFiles: FileChange[] | null;
  previewFilesLoading: boolean;
  onModeChange: (mode: ResetMode) => void;
  onConfirmWarning: () => void;
  onConfirmPicker: () => void;
  onConfirmDiscard: () => void;
  onCancel: () => void;
  busy: boolean;
}

const MODES: { mode: ResetMode; label: string }[] = [
  { mode: "soft", label: "soft" },
  { mode: "mixed", label: "mixed" },
  { mode: "hard", label: "hard" },
];

export default function ResetDialog({
  context,
  hasUncommittedChanges,
  step,
  mode,
  previewFiles,
  previewFilesLoading,
  onModeChange,
  onConfirmWarning,
  onConfirmPicker,
  onConfirmDiscard,
  onCancel,
  busy,
}: ResetDialogProps) {
  const commits = context.commits;
  const s = commits === 1 ? "" : "s";
  const filesTab = <FileChangesList files={previewFiles ?? []} loading={previewFilesLoading} />;
  const filesCount = previewFiles?.length ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={busy ? undefined : onCancel}
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
        onClick={(e) => e.stopPropagation()}
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
            {step === "warning" ? "these commits are already on your remote" : step === "confirmDiscard" ? "this can't be recovered" : "reset to this commit?"}
          </h2>
        </div>

        {step === "warning" && (
          <>
            <PreviewTabs
              commitsContent={
                <CommitRangeSummary
                  context={context}
                  afterCaption="after"
                  listCaption="commits that would move off your branch's tip:"
                />
              }
              filesContent={filesTab}
              filesCount={filesCount}
            />
            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {resetAlreadyPushedWarning()}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onCancel} disabled={busy} style={cancelButtonStyle(busy)}>
                cancel
              </button>
              <button onClick={onConfirmWarning} disabled={busy} style={primaryButtonStyle(busy)}>
                continue anyway
              </button>
            </div>
          </>
        )}

        {step === "picker" && (
          <>
            <PreviewTabs
              commitsContent={
                <CommitRangeSummary
                  context={context}
                  afterCaption="after"
                  listCaption="commits that will move off your branch's tip:"
                />
              }
              filesContent={filesTab}
              filesCount={filesCount}
            />
            <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {commits} commit{s} away. pick what happens to their changes.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>
              {MODES.map(({ mode: m, label }) => (
                <label
                  key={m}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    padding: "9px 11px",
                    borderRadius: 9,
                    border: `1px solid ${mode === m ? "var(--lane-4)" : "var(--border)"}`,
                    background: mode === m ? "color-mix(in srgb, var(--lane-4) 10%, var(--surface-0))" : "var(--surface-0)",
                    cursor: "pointer",
                  }}
                >
                  <input type="radio" name="reset-mode" checked={mode === m} onChange={() => onModeChange(m)} style={{ marginTop: 3 }} />
                  <span>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{label}{m === "hard" && <span style={{ color: "var(--danger)", fontWeight: 600, fontSize: 11 }}> · discards changes</span>}</div>
                    <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2, lineHeight: 1.4 }}>{resetModeInlineText(m)}</div>
                  </span>
                </label>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onCancel} disabled={busy} style={cancelButtonStyle(busy)}>
                cancel
              </button>
              <button onClick={onConfirmPicker} disabled={busy} style={primaryButtonStyle(busy)}>
                {busy ? "working…" : `reset (${mode})`}
              </button>
            </div>
          </>
        )}

        {step === "confirmDiscard" && (
          <>
            <PreviewTabs
              commitsContent={
                <CommitRangeSummary
                  context={context}
                  afterCaption="after"
                  listCaption="commits that will be discarded, along with their changes:"
                />
              }
              filesContent={filesTab}
              filesCount={filesCount}
            />
            <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              {resetDiscardConfirmText(commits, hasUncommittedChanges)}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button onClick={onCancel} disabled={busy} style={cancelButtonStyle(busy)}>
                cancel
              </button>
              <button onClick={onConfirmDiscard} disabled={busy} style={dangerButtonStyle(busy)}>
                {busy ? "working…" : "yes, discard and reset"}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function cancelButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "none",
    color: "var(--text-secondary)",
    fontSize: 13,
    cursor: busy ? "default" : "pointer",
  };
}

function primaryButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "linear-gradient(135deg, var(--lane-4), var(--lane-2))",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}

function dangerButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: "8px 16px",
    borderRadius: 8,
    border: "none",
    background: "var(--danger)",
    color: "#fff",
    fontSize: 13,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.6 : 1,
  };
}
