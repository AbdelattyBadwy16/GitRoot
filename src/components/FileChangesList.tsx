import type { FileChange } from "../lib/gitCommands";

interface FileChangesListProps {
  files: FileChange[];
  loading?: boolean;
}

const STATUS_COLOR: Record<FileChange["status"], string> = {
  added: "var(--lane-3)",
  deleted: "var(--lane-8)",
  modified: "var(--lane-2)",
  renamed: "var(--lane-4)",
};

const GROUPS: { status: FileChange["status"]; heading: string }[] = [
  { status: "added", heading: "will be added" },
  { status: "deleted", heading: "will be removed" },
  { status: "modified", heading: "will be modified" },
  { status: "renamed", heading: "will be renamed" },
];

export default function FileChangesList({ files, loading }: FileChangesListProps) {
  if (loading) {
    return (
      <div style={{ padding: "16px 0", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
        loading file changes…
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{ padding: "16px 0", fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
        no file changes
      </div>
    );
  }

  const groups = GROUPS.map((g) => ({ ...g, files: files.filter((f) => f.status === g.status) })).filter(
    (g) => g.files.length > 0
  );

  return (
    <div style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-0)", maxHeight: 200, overflow: "auto" }}>
      {groups.map((group, gi) => (
        <div key={group.status} style={{ borderTop: gi === 0 ? "none" : "1px solid var(--border)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px 2px",
              fontSize: 10,
              fontWeight: 600,
              color: "var(--text-muted)",
            }}
          >
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[group.status], flexShrink: 0 }} />
            {group.heading} ({group.files.length})
          </div>
          {group.files.map((f) => (
            <div
              key={f.path}
              style={{
                padding: "4px 10px 4px 22px",
                fontSize: 11.5,
                fontFamily: "ui-monospace, monospace",
                color: "var(--text-secondary)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={f.path}
            >
              {f.path}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
