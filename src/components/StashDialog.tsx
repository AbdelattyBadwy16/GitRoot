import { useState } from "react";
import { motion } from "framer-motion";
import type { FileStatus } from "../lib/gitCommands";

interface StashDialogProps {
  files: FileStatus[];
  busy: boolean;
  onCancel: () => void;
  onConfirm: (message: string, paths: string[] | null) => void;
}

export default function StashDialog({ files, busy, onCancel, onConfirm }: StashDialogProps) {
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(files.map((f) => f.path)));

  const allSelected = files.length > 0 && selected.size === files.length;

  function toggle(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function submit() {
    if (selected.size === 0 || busy) return;
    // only send an explicit pathspec for a real subset - selecting everything should stay the
    // plain "stash the whole working directory" form (which also, unlike a pathspec, is what
    // still leaves untracked files alone by default), not an equivalent-looking substitute for it
    const paths = allSelected ? null : Array.from(selected);
    onConfirm(message, paths);
  }

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
          width: 460,
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>set changes aside</h2>
        </div>

        <p style={{ margin: "0 0 14px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          give it a label so you can tell your stashes apart later, and pick which changed files go in - anything
          left unchecked stays right where it is.
        </p>

        <input
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder='label this stash (optional), e.g. "wip: refactor auth"'
          disabled={busy}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{
            width: "100%",
            marginBottom: 14,
            padding: "9px 11px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-0)",
            color: "var(--text-primary)",
            fontSize: 13,
            boxSizing: "border-box",
          }}
        />

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <span style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600 }}>
            {selected.size}/{files.length} file{files.length === 1 ? "" : "s"} selected
          </span>
          <button
            onClick={() => setSelected(allSelected ? new Set() : new Set(files.map((f) => f.path)))}
            disabled={busy}
            style={{ background: "none", border: "none", color: "var(--lane-1)", fontSize: 11, cursor: busy ? "default" : "pointer", padding: 0, textDecoration: "underline" }}
          >
            {allSelected ? "deselect all" : "select all"}
          </button>
        </div>

        <div
          style={{
            marginBottom: 18,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--surface-0)",
            maxHeight: 200,
            overflow: "auto",
          }}
        >
          {files.length === 0 ? (
            <div style={{ padding: "16px 12px", fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>
              nothing changed right now.
            </div>
          ) : (
            files.map((f, i) => (
              <label
                key={f.path}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 12px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  cursor: busy ? "default" : "pointer",
                }}
              >
                <input type="checkbox" checked={selected.has(f.path)} onChange={() => toggle(f.path)} disabled={busy} style={{ margin: 0, flexShrink: 0 }} />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: "ui-monospace, monospace",
                    fontSize: 12.5,
                    color: "var(--text-primary)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={f.path}
                >
                  {f.path}
                </span>
                <span style={{ flexShrink: 0, fontSize: 10.5, color: "var(--text-muted)" }}>{f.statusLabel}</span>
              </label>
            ))
          )}
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || selected.size === 0}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy || selected.size === 0 ? "default" : "pointer",
              opacity: busy || selected.size === 0 ? 0.5 : 1,
            }}
          >
            {busy ? "working…" : `stash ${selected.size} file${selected.size === 1 ? "" : "s"}`}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
