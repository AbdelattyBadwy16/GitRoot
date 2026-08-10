import type { CommitActionContext } from "./CommitGraph";

interface CommitRangeSummaryProps {
  context: CommitActionContext;
  afterCaption: string;
  listCaption: string;
}

function short(hash: string): string {
  return hash.slice(0, 7);
}

function truncate(message: string, max = 48): string {
  return message.length > max ? `${message.slice(0, max - 1)}…` : message;
}

export default function CommitRangeSummary({ context, afterCaption, listCaption }: CommitRangeSummaryProps) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "stretch", gap: 8, marginBottom: 12 }}>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "7px 10px",
            borderRadius: 8,
            background: "var(--surface-2)",
            border: "1px solid var(--border)",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginBottom: 3 }}>now</div>
          <div style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)" }}>{short(context.head.hash)}</div>
          <div style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={context.head.message}>
            {truncate(context.head.message)}
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            padding: "7px 10px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--lane-4) 10%, var(--surface-2))",
            border: "1px solid color-mix(in srgb, var(--lane-4) 35%, transparent)",
          }}
        >
          <div style={{ fontSize: 10, color: "var(--text-muted)", fontWeight: 600, marginBottom: 3 }}>{afterCaption}</div>
          <div style={{ fontSize: 11.5, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)" }}>{short(context.target.hash)}</div>
          <div style={{ fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={context.target.message}>
            {truncate(context.target.message)}
          </div>
        </div>
      </div>

      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{listCaption}</div>
      <div style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-0)", maxHeight: 130, overflow: "auto" }}>
        {context.affected.map((c, i) => (
          <div
            key={c.hash}
            style={{
              display: "flex",
              gap: 8,
              padding: "6px 10px",
              fontSize: 11.5,
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            <span style={{ fontFamily: "ui-monospace, monospace", color: "var(--text-muted)", flexShrink: 0 }}>{short(c.hash)}</span>
            <span style={{ color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.message}</span>
          </div>
        ))}
        {context.affectedMore > 0 && (
          <div style={{ padding: "6px 10px", fontSize: 11, color: "var(--text-muted)", borderTop: "1px solid var(--border)" }}>
            +{context.affectedMore} more commit{context.affectedMore === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
