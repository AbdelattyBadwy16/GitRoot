import type { CSSProperties } from "react";
import type { StashInfo } from "../lib/gitCommands";

// each stash row is a bit taller than a branch row since it carries a message + metadata line
const STASH_ROW_HEIGHT = 56;
const MAX_VISIBLE_STASHES = 5;

interface StashTabProps {
  stashes: StashInfo[];
  busy: boolean;
  onApply: (stash: StashInfo) => void;
  onPop: (stash: StashInfo) => void;
  onRequestDrop: (stash: StashInfo) => void;
}

export default function StashTab({ stashes, busy, onApply, onPop, onRequestDrop }: StashTabProps) {
  return (
    <div data-tour="stash-tab" style={{ padding: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
        stash
      </div>
      <p style={{ color: "var(--text-secondary)", margin: "0 0 16px", fontSize: 13, lineHeight: 1.5 }}>
        every stash sets your working directory's changes aside without losing them. apply brings a copy
        back and keeps the entry, pop brings it back and removes the entry, drop deletes it for good.
      </p>

      {stashes.length === 0 ? (
        <div
          style={{
            borderRadius: 10,
            border: "1px solid var(--border)",
            padding: "22px 14px",
            textAlign: "center",
            color: "var(--text-muted)",
            fontSize: 13,
          }}
        >
          nothing stashed right now
        </div>
      ) : (
        <div style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
          <div style={{ maxHeight: STASH_ROW_HEIGHT * MAX_VISIBLE_STASHES, overflowY: "auto" }}>
            {stashes.map((s, i) => (
              <div
                key={s.stashRef}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 14px",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                  background: "var(--surface-0)",
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={s.message}
                  >
                    {s.message}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                    {s.stashRef}
                    {s.branch && <> · {s.branch}</>} · {s.date}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button onClick={() => onApply(s)} disabled={busy} style={rowButtonStyle(busy)} title="bring this back, keep the stash entry">
                    apply
                  </button>
                  <button onClick={() => onPop(s)} disabled={busy} style={rowButtonStyle(busy)} title="bring this back, remove the stash entry">
                    pop
                  </button>
                  <button onClick={() => onRequestDrop(s)} disabled={busy} style={dangerRowButtonStyle(busy)} title="delete this stash entry for good">
                    drop
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function rowButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--surface-1)",
    color: "var(--text-secondary)",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.5 : 1,
  };
}

function dangerRowButtonStyle(busy: boolean): CSSProperties {
  return {
    padding: "5px 10px",
    borderRadius: 6,
    border: "1px solid color-mix(in srgb, var(--danger) 45%, transparent)",
    background: "color-mix(in srgb, var(--danger) 10%, var(--surface-1))",
    color: "var(--danger)",
    fontSize: 11.5,
    fontWeight: 600,
    cursor: busy ? "default" : "pointer",
    opacity: busy ? 0.5 : 1,
  };
}
