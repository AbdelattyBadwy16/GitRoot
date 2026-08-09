import type { FileStatus } from "../lib/gitCommands";

interface StagingListProps {
  files: FileStatus[];
  onToggle: (file: FileStatus) => void;
  onOpenFile: (file: FileStatus) => void;
  message: string;
  onMessageChange: (message: string) => void;
  onCommit: () => void;
  busy: boolean;
}

const STATUS_COLOR: Record<string, string> = {
  untracked: "var(--lane-4)",
  staged: "var(--lane-3)",
  modified: "var(--lane-2)",
  deleted: "var(--lane-8)",
};

function statusColor(label: string): string {
  return STATUS_COLOR[label] ?? "var(--lane-2)";
}

export default function StagingList({ files, onToggle, onOpenFile, message, onMessageChange, onCommit, busy }: StagingListProps) {
  const stagedCount = files.filter((f) => f.staged).length;

  return (
    <div style={{ padding: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
        staging area
      </div>
      <p style={{ color: "var(--text-secondary)", margin: "0 0 16px", lineHeight: 1.5, fontSize: 13 }}>
        checking a file stages all of it — git only commits what's staged, not everything that
        changed. click a row to see exactly what changed, and stage or discard it piece by piece.
      </p>

      {files.length === 0 ? (
        <div
          style={{
            color: "var(--text-muted)",
            marginBottom: 16,
            padding: "24px 0",
            textAlign: "center",
            border: "1px dashed var(--border)",
            borderRadius: 10,
          }}
        >
          no changed files — your working directory is clean.
        </div>
      ) : (
        <div style={{ marginBottom: 16, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
          {files.map((f, i) => {
            const color = statusColor(f.statusLabel);
            return (
              <div
                key={f.path}
                onClick={() => onOpenFile(f)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  cursor: "pointer",
                  borderTop: i === 0 ? "none" : "1px solid var(--border)",
                }}
              >
                <input
                  type="checkbox"
                  checked={f.staged}
                  onChange={() => onToggle(f)}
                  onClick={(e) => e.stopPropagation()}
                  disabled={busy}
                />
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: "50%",
                    background: color,
                    boxShadow: `0 0 6px 1px color-mix(in srgb, ${color} 55%, transparent)`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {f.path}
                </span>
                <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{f.statusLabel}</span>
                <span style={{ color: "var(--text-muted)", fontSize: 11 }}>▸</span>
              </div>
            );
          })}
        </div>
      )}

      <textarea
        value={message}
        onChange={(e) => onMessageChange(e.target.value)}
        placeholder="commit message"
        disabled={busy}
        rows={3}
        style={{
          width: "100%",
          resize: "vertical",
          padding: 10,
          borderRadius: 8,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          color: "var(--text-primary)",
          fontFamily: "inherit",
          fontSize: 13.5,
          marginBottom: 10,
        }}
      />
      <button
        onClick={onCommit}
        disabled={busy || stagedCount === 0 || message.trim().length === 0}
        style={{
          padding: "9px 18px",
          borderRadius: 8,
          border: "none",
          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
          color: "#fff",
          fontWeight: 600,
          fontSize: 13.5,
          cursor: busy || stagedCount === 0 || message.trim().length === 0 ? "default" : "pointer",
          opacity: busy || stagedCount === 0 || message.trim().length === 0 ? 0.4 : 1,
          boxShadow: "0 2px 10px color-mix(in srgb, var(--lane-1) 35%, transparent)",
        }}
      >
        commit {stagedCount > 0 ? `${stagedCount} file${stagedCount === 1 ? "" : "s"}` : ""}
      </button>
    </div>
  );
}
