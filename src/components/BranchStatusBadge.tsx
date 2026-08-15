import type { BranchInfo } from "../lib/gitCommands";

// only used by BranchStatusBadge itself, kept local rather than its own file
function Chip({ label, title, muted, dotColor }: { label: string; title?: string; muted?: boolean; dotColor?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        fontWeight: 600,
        color: muted ? "var(--text-muted)" : "var(--text-secondary)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {dotColor && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
      {label}
    </span>
  );
}

export default function BranchStatusBadge({ branch, changedFiles }: { branch: BranchInfo | null; changedFiles: number }) {
  if (!branch) return null;
  const clean = changedFiles === 0;

  return (
    <div data-tour="branch-status" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {branch.upstream ? (
        branch.ahead === 0 && branch.behind === 0 ? (
          <Chip label="up to date" title={`in sync with ${branch.upstream}`} />
        ) : (
          <>
            {branch.ahead > 0 && (
              <Chip
                label={`↑${branch.ahead}`}
                title={`${branch.ahead} commit${branch.ahead === 1 ? "" : "s"} not pushed to ${branch.upstream} yet`}
              />
            )}
            {branch.behind > 0 && (
              <Chip
                label={`↓${branch.behind}`}
                title={`${branch.behind} commit${branch.behind === 1 ? "" : "s"} on ${branch.upstream} you don't have yet, pull to catch up`}
              />
            )}
          </>
        )
      ) : (
        <Chip label="no upstream" title="this branch hasn't been pushed anywhere yet" muted />
      )}
      <Chip
        label={clean ? "clean" : `${changedFiles} uncommitted`}
        title={
          clean
            ? "working directory matches the last commit, nothing to commit"
            : `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed since the last commit`
        }
        dotColor={clean ? "var(--lane-3)" : "var(--lane-2)"}
      />
    </div>
  );
}
