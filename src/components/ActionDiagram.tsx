import type { ReactNode } from "react";
import { motion } from "framer-motion";
import type { ActionKind } from "../lib/explain";

interface ActionDiagramProps {
  kind: ActionKind;
  count: number;
  branch: string;
  remote: string;
  from: string;
  target: string;
  before: string | null;
  after: string | null;
}

const W = 232;
const H = 104;
const ZONE_W = 82;
const ZONE_H = 54;
const ZONE_Y = (H - ZONE_H) / 2;
const LEFT_X = 0;
const RIGHT_X = W - ZONE_W;

function truncate(label: string, max = 13): string {
  return label.length > max ? label.slice(0, max - 1) + "…" : label;
}

function CloudIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.4-2A5 5 0 0 0 6 18h11.5z" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6" cy="6" r="2.5" />
      <circle cx="6" cy="18" r="2.5" />
      <circle cx="18" cy="12" r="2.5" />
      <path d="M6 8.5V15.5" />
      <path d="M8.2 7.2C11 9 13 9.7 15.8 11" />
    </svg>
  );
}

function FilesIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </svg>
  );
}

function StashBoxIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="6" rx="1.5" />
      <path d="M6 11v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" />
      <path d="M10 15h4" />
    </svg>
  );
}

function Zone({ x, icon, title, sublabel, color, highlight }: { x: number; icon: ReactNode; title: string; sublabel: string; color: string; highlight: boolean }) {
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: ZONE_Y,
        width: ZONE_W,
        height: ZONE_H,
        borderRadius: 12,
        border: `1px solid color-mix(in srgb, ${color} ${highlight ? 45 : 22}%, var(--border))`,
        background: `color-mix(in srgb, ${color} ${highlight ? 10 : 4}%, var(--surface-1))`,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        textAlign: "center",
        padding: "0 5px",
      }}
    >
      <span style={{ color, display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 9, fontWeight: 700, color: "var(--text-primary)", textTransform: "uppercase", letterSpacing: 0.3 }}>{title}</span>
      <span
        style={{
          fontSize: 9,
          color: "var(--text-muted)",
          fontFamily: "ui-monospace, monospace",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          maxWidth: "100%",
        }}
      >
        {sublabel}
      </span>
    </div>
  );
}

function FlowDiagram({
  left,
  right,
  direction,
  count,
}: {
  left: { icon: ReactNode; title: string; sublabel: string; color: string };
  right: { icon: ReactNode; title: string; sublabel: string; color: string };
  direction: "leftToRight" | "rightToLeft";
  count: number;
}) {
  const midY = H / 2;
  const x1 = LEFT_X + ZONE_W;
  const x2 = RIGHT_X;
  const path = direction === "leftToRight" ? `M ${x1} ${midY} L ${x2} ${midY}` : `M ${x2} ${midY} L ${x1} ${midY}`;
  const dotColor = direction === "leftToRight" ? left.color : right.color;
  const shown = Math.min(count, 5);

  return (
    <div style={{ position: "relative", width: W, height: H }}>
      <svg width={W} height={H} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <defs>
          <filter id="diagram-glow" x="-200%" y="-200%" width="500%" height="500%">
            <feGaussianBlur stdDeviation="2.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line x1={x1} y1={midY} x2={x2} y2={midY} stroke="var(--border)" strokeWidth={1.5} strokeDasharray="1 5" />
        {count > 0 &&
          Array.from({ length: shown }).map((_, i) => (
            <circle key={i} r={3.2} fill={dotColor} filter="url(#diagram-glow)">
              <animateMotion dur="1.5s" repeatCount="indefinite" begin={`${(i * 1.5) / shown}s`} path={path} />
            </circle>
          ))}
      </svg>
      <Zone x={LEFT_X} {...left} highlight={direction === "rightToLeft"} />
      <Zone x={RIGHT_X} {...right} highlight={direction === "leftToRight"} />
      {count === 0 && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 2, textAlign: "center", fontSize: 9.5, color: "var(--text-muted)" }}>already in sync</div>
      )}
    </div>
  );
}

function BranchPill({ label, color, muted }: { label: string; color: string; muted?: boolean }) {
  return (
    <div
      style={{
        padding: "6px 10px",
        borderRadius: 999,
        border: `1px solid color-mix(in srgb, ${color} ${muted ? 30 : 50}%, transparent)`,
        background: muted ? "var(--surface-2)" : `color-mix(in srgb, ${color} 14%, var(--surface-1))`,
        color: muted ? "var(--text-muted)" : color,
        fontSize: 11,
        fontWeight: 700,
        textAlign: "center",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {truncate(label)}
    </div>
  );
}

function PointerDiagram({ fromLabel, toLabel, isNew }: { fromLabel: string; toLabel: string; isNew: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: W, height: H, padding: "0 2px" }}>
      <div style={{ width: 92 }}>
        <BranchPill label={fromLabel} color="var(--text-muted)" muted />
      </div>
      <svg width="32" height="16" viewBox="0 0 32 16" style={{ flexShrink: 0 }}>
        <path d="M1 8H23" stroke="var(--lane-1)" strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" />
        <path d="M18 2L26 8L18 14" fill="none" stroke="var(--lane-1)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <motion.div
        style={{ width: 92 }}
        initial={isNew ? { scale: 0.3, opacity: 0 } : { scale: 1, opacity: 1 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: "spring", stiffness: 380, damping: 20 }}
      >
        <BranchPill label={toLabel} color="var(--lane-1)" />
      </motion.div>
    </div>
  );
}

function UndoDiagram({ target, count }: { target: string; count: number }) {
  const shown = Math.min(count, 4);
  return (
    <div style={{ width: W }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 7 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--text-muted)", flexShrink: 0 }} />
        <span style={{ fontSize: 10.5, fontFamily: "ui-monospace, monospace", color: "var(--text-muted)" }}>{truncate(target, 24)}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginLeft: 3, paddingLeft: 11, borderLeft: "2px dashed var(--border-strong)", marginBottom: 8 }}>
        {Array.from({ length: shown }).map((_, i) => (
          <div key={i} style={{ fontSize: 10, color: "var(--text-muted)", textDecoration: "line-through", opacity: 0.55 }}>
            commit {i + 1}
          </div>
        ))}
        {count > shown && <div style={{ fontSize: 10, color: "var(--text-muted)" }}>+{count - shown} more</div>}
      </div>
      <motion.div
        initial={{ opacity: 0, x: -6 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.35, duration: 0.3 }}
        style={{ display: "flex", alignItems: "center", gap: 7 }}
      >
        <span
          style={{
            width: 11,
            height: 11,
            borderRadius: "50%",
            background: "var(--lane-3)",
            boxShadow: "0 0 8px 2px color-mix(in srgb, var(--lane-3) 55%, transparent)",
            flexShrink: 0,
          }}
        />
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--lane-3)" }}>new commit — undoes all of the above</span>
      </motion.div>
      <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 5, fontSize: 9.5, color: "var(--text-muted)" }}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--lane-3)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
        nothing above was deleted
      </div>
    </div>
  );
}

function RewindDiagram({ beforeLabel, afterLabel }: { beforeLabel: string; afterLabel: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: W, height: H, padding: "0 2px" }}>
      <div style={{ width: 92, opacity: 0.5 }}>
        <BranchPill label={beforeLabel} color="var(--text-muted)" muted />
      </div>
      <svg width="32" height="16" viewBox="0 0 32 16" style={{ flexShrink: 0 }}>
        <path d="M31 8H9" stroke="var(--lane-3)" strokeWidth={2} strokeDasharray="3 3" strokeLinecap="round" />
        <path d="M14 2L6 8L14 14" fill="none" stroke="var(--lane-3)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <motion.div style={{ width: 92 }} initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 20 }}>
        <BranchPill label={afterLabel} color="var(--lane-3)" />
      </motion.div>
    </div>
  );
}

export default function ActionDiagram({ kind, count, branch, remote, from, target, before, after }: ActionDiagramProps) {
  switch (kind) {
    case "pull":
      return (
        <FlowDiagram
          direction="rightToLeft"
          count={count}
          left={{ icon: <BranchIcon />, title: "your branch", sublabel: truncate(branch), color: "var(--lane-1)" }}
          right={{ icon: <CloudIcon />, title: "remote", sublabel: truncate(remote), color: "var(--lane-3)" }}
        />
      );
    case "push":
      return (
        <FlowDiagram
          direction="leftToRight"
          count={count}
          left={{ icon: <BranchIcon />, title: "your branch", sublabel: truncate(branch), color: "var(--lane-1)" }}
          right={{ icon: <CloudIcon />, title: "remote", sublabel: truncate(remote), color: "var(--lane-3)" }}
        />
      );
    case "stash":
      return (
        <FlowDiagram
          direction="leftToRight"
          count={count}
          left={{ icon: <FilesIcon />, title: "working dir", sublabel: `${count} file${count === 1 ? "" : "s"}`, color: "var(--lane-2)" }}
          right={{ icon: <StashBoxIcon />, title: "stash", sublabel: "tucked away", color: "var(--lane-4)" }}
        />
      );
    case "commit":
      return (
        <FlowDiagram
          direction="leftToRight"
          count={count}
          left={{ icon: <FilesIcon />, title: "staged", sublabel: `${count} file${count === 1 ? "" : "s"}`, color: "var(--lane-2)" }}
          right={{ icon: <BranchIcon />, title: "history", sublabel: truncate(branch), color: "var(--lane-3)" }}
        />
      );
    case "switchBranch":
      return <PointerDiagram fromLabel={before ?? "previous branch"} toLabel={after ?? branch} isNew={false} />;
    case "createBranch":
      return <PointerDiagram fromLabel={from} toLabel={branch} isNew />;
    case "revert":
      return <UndoDiagram target={target} count={count} />;
    case "undo":
      return <RewindDiagram beforeLabel={before ?? "before"} afterLabel={after ?? "now"} />;
    case "merge":
      return (
        <FlowDiagram
          direction="leftToRight"
          count={count}
          left={{ icon: <BranchIcon />, title: "merging in", sublabel: truncate(target), color: "var(--lane-2)" }}
          right={{ icon: <BranchIcon />, title: "your branch", sublabel: truncate(branch), color: "var(--lane-1)" }}
        />
      );
    case "rebase":
      return (
        <FlowDiagram
          direction="leftToRight"
          count={count}
          left={{ icon: <BranchIcon />, title: "replaying", sublabel: truncate(branch), color: "var(--lane-1)" }}
          right={{ icon: <BranchIcon />, title: "onto", sublabel: truncate(target), color: "var(--lane-4)" }}
        />
      );
    default:
      return null;
  }
}
