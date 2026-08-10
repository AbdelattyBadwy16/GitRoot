import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CommitGraphData, GraphCommit, GraphEdge } from "../lib/gitCommands";
import { isHead } from "../lib/graph";

interface CommitGraphProps {
  graph: CommitGraphData;
  pulseHash?: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  onRevertClick?: (targetHash: string, commitsAfter: number) => void;
}

const ROW_HEIGHT = 60;
const LANE_WIDTH = 32;
const LANE_X0 = 24;
const NODE_RADIUS = 7.5;
const MERGE_SIZE = 15;
const TOP_PADDING = 30;
const MAX_VISIBLE_TIPS = 6;

const LANE_COLORS = [
  "var(--lane-1)",
  "var(--lane-2)",
  "var(--lane-3)",
  "var(--lane-4)",
  "var(--lane-5)",
  "var(--lane-6)",
  "var(--lane-7)",
  "var(--lane-8)",
];

function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length];
}

function laneX(lane: number): number {
  return LANE_X0 + lane * LANE_WIDTH;
}

function rowY(row: number): number {
  return TOP_PADDING + row * ROW_HEIGHT;
}

function seededUnit(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

function edgePath(edge: GraphEdge): string {
  const x1 = laneX(edge.fromLane);
  const y1 = rowY(edge.fromRow);
  const x2 = laneX(edge.toLane);
  const y2 = rowY(edge.toRow);
  const midY = (y1 + y2) / 2;
  const wobble = (seededUnit(`${edge.from}->${edge.to}`) - 0.5) * 9;
  if (x1 === x2) {
    return `M ${x1} ${y1} Q ${x1 + wobble} ${midY} ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${x1 + wobble * 0.5} ${midY}, ${x2 - wobble * 0.5} ${midY}, ${x2} ${y2}`;
}

function parseRef(r: string): { label: string; head: boolean } {
  if (r === "HEAD") return { label: "HEAD (detached)", head: true };
  if (r.startsWith("HEAD -> ")) return { label: r.slice(8), head: true };
  return { label: r, head: false };
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

export default function CommitGraph({
  graph,
  pulseHash = null,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  onRevertClick,
}: CommitGraphProps) {
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const activeHash = hoveredHash ?? pulseHash;

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: "400px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, onLoadMore]);

  const { byHash, childrenOf } = useMemo(() => {
    const byHash = new Map<string, GraphCommit>();
    const childrenOf = new Map<string, string[]>();
    for (const c of graph.commits) byHash.set(c.hash, c);
    for (const e of graph.edges) {
      const list = childrenOf.get(e.to) ?? [];
      list.push(e.from);
      childrenOf.set(e.to, list);
    }
    return { byHash, childrenOf };
  }, [graph]);

  const headHash = useMemo(() => graph.commits.find(isHead)?.hash ?? null, [graph]);

  const branchTips = useMemo(() => {
    const seen = new Map<string, { color: string; head: boolean }>();
    for (const c of graph.commits) {
      for (const raw of c.refs) {
        const { label, head } = parseRef(raw);
        if (!seen.has(label)) seen.set(label, { color: laneColor(c.lane), head });
      }
    }
    return Array.from(seen.entries());
  }, [graph]);

  const headAncestors = useMemo(() => {
    const seen = new Set<string>();
    if (!headHash) return seen;
    seen.add(headHash);
    const stack = [headHash];
    while (stack.length) {
      const h = stack.pop()!;
      for (const p of byHash.get(h)?.parents ?? []) {
        if (!seen.has(p)) {
          seen.add(p);
          stack.push(p);
        }
      }
    }
    return seen;
  }, [headHash, byHash]);

  function ancestorsInclusive(start: string): Set<string> {
    const seen = new Set<string>([start]);
    const stack = [start];
    while (stack.length) {
      const h = stack.pop()!;
      for (const p of byHash.get(h)?.parents ?? []) {
        if (!seen.has(p)) {
          seen.add(p);
          stack.push(p);
        }
      }
    }
    return seen;
  }

  const spotlight = useMemo(() => {
    if (!activeHash) return null;
    const seen = new Set<string>([activeHash]);
    const up = [activeHash];
    while (up.length) {
      const h = up.pop()!;
      for (const p of byHash.get(h)?.parents ?? []) {
        if (!seen.has(p)) {
          seen.add(p);
          up.push(p);
        }
      }
    }
    const down = [activeHash];
    while (down.length) {
      const h = down.pop()!;
      for (const c of childrenOf.get(h) ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          down.push(c);
        }
      }
    }
    return seen;
  }, [activeHash, byHash, childrenOf]);

  const width = LANE_X0 + graph.laneCount * LANE_WIDTH + 420;
  const height = TOP_PADDING * 2 + graph.commits.length * ROW_HEIGHT;
  const hasLocalOnly = graph.commits.some((c) => !c.onRemote);

  if (graph.commits.length === 0) {
    return (
      <div style={{ padding: "40px 16px", color: "var(--text-muted)", textAlign: "center" }}>
        no commits yet.
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 14, display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          hover a commit to trace its story through the graph — click any earlier one to safely undo back to it
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
          {hasLocalOnly && (
            <span style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 11.5, color: "var(--text-muted)" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "var(--lane-1)",
                    boxShadow: "0 0 4px 1px color-mix(in srgb, var(--lane-1) 55%, transparent)",
                    display: "inline-block",
                  }}
                />
                on the remote
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    border: "1.5px dashed var(--lane-1)",
                    display: "inline-block",
                  }}
                />
                not pushed yet
              </span>
            </span>
          )}
          {branchTips.length > 0 && (
            <span style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              {branchTips.slice(0, MAX_VISIBLE_TIPS).map(([label, { color, head }]) => (
                <span
                  key={label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: head ? "#fff" : color,
                    background: head ? color : `color-mix(in srgb, ${color} 12%, var(--surface-1))`,
                    border: `1px solid color-mix(in srgb, ${color} ${head ? 70 : 40}%, transparent)`,
                  }}
                >
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: head ? "#fff" : color, flexShrink: 0 }} />
                  {label}
                </span>
              ))}
              {branchTips.length > MAX_VISIBLE_TIPS && (
                <span
                  title={branchTips
                    .slice(MAX_VISIBLE_TIPS)
                    .map(([label]) => label)
                    .join(", ")}
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: "2px 8px",
                    borderRadius: 999,
                    color: "var(--text-muted)",
                    background: "var(--surface-2)",
                    border: "1px solid var(--border)",
                  }}
                >
                  +{branchTips.length - MAX_VISIBLE_TIPS} more
                </span>
              )}
            </span>
          )}
        </div>
      </div>
      <div style={{ position: "relative", width, height, minHeight: 120 }}>
        <svg
          width={width}
          height={height}
          style={{ position: "absolute", top: 0, left: 0, pointerEvents: "none", overflow: "visible" }}
        >
          <defs>
            <filter id="gitroot-node-glow" x="-200%" y="-200%" width="500%" height="500%">
              <feGaussianBlur stdDeviation="3.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
            {Array.from({ length: graph.laneCount }, (_, lane) => (
              <linearGradient key={`wash-${lane}`} id={`gitroot-wash-${lane}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={laneColor(lane)} stopOpacity={0} />
                <stop offset="12%" stopColor={laneColor(lane)} stopOpacity={0.05} />
                <stop offset="88%" stopColor={laneColor(lane)} stopOpacity={0.05} />
                <stop offset="100%" stopColor={laneColor(lane)} stopOpacity={0} />
              </linearGradient>
            ))}
          </defs>

          {Array.from({ length: graph.laneCount }, (_, lane) => (
            <rect
              key={`wash-rect-${lane}`}
              x={laneX(lane) - LANE_WIDTH / 2}
              y={0}
              width={LANE_WIDTH}
              height={height}
              fill={`url(#gitroot-wash-${lane})`}
            />
          ))}

          <AnimatePresence>
            {graph.edges.map((edge) => {
              const d = edgePath(edge);
              const lit = !spotlight || (spotlight.has(edge.from) && spotlight.has(edge.to));
              const color = laneColor(edge.fromLane);
              const key = `${edge.from}->${edge.to}`;
              const seed = seededUnit(key);
              const pushed = byHash.get(edge.from)?.onRemote ?? true;
              return (
                <g key={key}>
                  <motion.path
                    d={d}
                    fill="none"
                    stroke={color}
                    strokeLinecap="round"
                    filter="url(#gitroot-node-glow)"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: lit ? 0.16 : 0.04, strokeWidth: lit ? 10 : 7 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.4 }}
                  />
                  {pushed ? (
                    <motion.path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeLinecap="round"
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: lit ? 1 : 0.15, strokeWidth: lit ? 4.5 : 3 }}
                      exit={{ opacity: 0 }}
                      transition={{ pathLength: { duration: 0.7, ease: "easeOut" }, default: { duration: 0.35 } }}
                    />
                  ) : (
                    <motion.path
                      d={d}
                      fill="none"
                      stroke={color}
                      strokeLinecap="round"
                      strokeDasharray="1.5 7"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: lit ? 0.75 : 0.15, strokeWidth: lit ? 4 : 3 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.35 }}
                    />
                  )}
                  {!reducedMotion && spotlight && lit && pushed && (
                    <>
                      <circle r={1.6 + seed * 1.3} fill="#fff" opacity={0.85}>
                        <animateMotion dur={`${2.3 + seed}s`} repeatCount="indefinite" path={d} />
                      </circle>
                      <circle r={1.6} fill={color} opacity={0.9}>
                        <animateMotion dur={`${2.3 + seed}s`} repeatCount="indefinite" path={d} begin={`${(2.3 + seed) / 2}s`} />
                      </circle>
                    </>
                  )}
                </g>
              );
            })}
          </AnimatePresence>
        </svg>

        <AnimatePresence>
          {graph.commits.map((commit) => {
            const x = laneX(commit.lane);
            const y = rowY(commit.row);
            const color = laneColor(commit.lane);
            const merge = commit.parents.length > 1;
            const head = isHead(commit);
            const nodeSize = merge ? MERGE_SIZE : NODE_RADIUS * 2;
            const labelX = LANE_X0 + graph.laneCount * LANE_WIDTH + 20;
            const lit = !spotlight || spotlight.has(commit.hash);
            const revertEligible = !!onRevertClick && !!headHash && commit.hash !== headHash && headAncestors.has(commit.hash);

            return (
              <motion.div
                key={commit.hash}
                layout
                layoutId={commit.hash}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.4 }}
                transition={{ layout: { type: "spring", stiffness: 400, damping: 32 }, default: { duration: 0.2 } }}
                onMouseEnter={() => setHoveredHash(commit.hash)}
                onMouseLeave={() => setHoveredHash((cur) => (cur === commit.hash ? null : cur))}
                onClick={() => {
                  if (!revertEligible || !onRevertClick) return;
                  const commitsAfter = headAncestors.size - ancestorsInclusive(commit.hash).size;
                  onRevertClick(commit.hash, commitsAfter);
                }}
                style={{
                  position: "absolute",
                  left: 0,
                  top: y - ROW_HEIGHT / 2,
                  width,
                  height: ROW_HEIGHT,
                  cursor: revertEligible ? "pointer" : "default",
                }}
              >
                <motion.div
                  animate={{
                    opacity: activeHash === commit.hash ? 1 : 0,
                    backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
                  }}
                  transition={{ duration: 0.15 }}
                  style={{ position: "absolute", inset: 0, borderRadius: 8, pointerEvents: "none" }}
                />

                {head && (
                  <motion.div
                    animate={reducedMotion ? { opacity: 0.6 } : { scale: [1, 1.6, 1], opacity: [0.55, 0, 0.55] }}
                    transition={{ duration: 2.2, repeat: reducedMotion ? 0 : Infinity, ease: "easeInOut" }}
                    style={{
                      position: "absolute",
                      left: x - NODE_RADIUS - 5,
                      top: ROW_HEIGHT / 2 - NODE_RADIUS - 5,
                      width: (NODE_RADIUS + 5) * 2,
                      height: (NODE_RADIUS + 5) * 2,
                      borderRadius: "50%",
                      border: `2px solid ${color}`,
                      pointerEvents: "none",
                    }}
                  />
                )}

                <motion.div
                  animate={{ opacity: lit ? 1 : 0.28, scale: lit ? 1 : 0.88, rotate: merge ? 45 : 0 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: "absolute",
                    left: x - nodeSize / 2,
                    top: ROW_HEIGHT / 2 - nodeSize / 2,
                    width: nodeSize,
                    height: nodeSize,
                    borderRadius: merge ? 4 : "50%",
                    backgroundColor: commit.onRemote ? color : "var(--surface-0)",
                    backgroundImage: commit.onRemote
                      ? `radial-gradient(circle at 32% 30%, color-mix(in srgb, ${color} 45%, white 55%), ${color})`
                      : "none",
                    border: commit.onRemote ? "2px solid var(--surface-0)" : `2px dashed ${color}`,
                    boxShadow: commit.onRemote
                      ? merge
                        ? `0 0 0 2px ${color}, 0 0 14px 3px color-mix(in srgb, ${color} 65%, transparent)`
                        : `0 0 10px 2px color-mix(in srgb, ${color} 55%, transparent)`
                      : "none",
                  }}
                  title={commit.onRemote ? commit.hash : `${commit.hash} — not pushed yet`}
                />

                <motion.div
                  animate={{ opacity: lit ? 1 : 0.35 }}
                  transition={{ duration: 0.15 }}
                  style={{
                    position: "absolute",
                    left: labelX,
                    top: 6,
                    right: 8,
                    lineHeight: 1.35,
                    overflow: "hidden",
                  }}
                >
                  <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                    {commit.refs.length > 0 && (
                      <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {commit.refs.map((raw) => {
                          const { label, head: isHeadRef } = parseRef(raw);
                          return (
                            <motion.span
                              key={raw}
                              layout
                              layoutId={`ref-${raw}`}
                              transition={{ type: "spring", stiffness: 340, damping: 22 }}
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "1px 7px",
                                borderRadius: 999,
                                backgroundColor: isHeadRef ? color : `color-mix(in srgb, ${color} 16%, var(--surface-1))`,
                                border: `1px solid color-mix(in srgb, ${color} 45%, transparent)`,
                                boxShadow: `0 0 6px color-mix(in srgb, ${color} 35%, transparent)`,
                                color: isHeadRef ? "#fff" : color,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {label}
                            </motion.span>
                          );
                        })}
                      </span>
                    )}
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        fontWeight: 500,
                      }}
                    >
                      {commit.message}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        fontSize: 9,
                        fontWeight: 700,
                        color: "#fff",
                        backgroundColor: `color-mix(in srgb, ${color} 75%, var(--text-muted))`,
                        flexShrink: 0,
                      }}
                    >
                      {commit.author.trim().charAt(0).toUpperCase() || "?"}
                    </span>
                    <span style={{ fontFamily: "ui-monospace, monospace" }}>{commit.hash.slice(0, 7)}</span>
                    <span>·</span>
                    <span>{commit.author}</span>
                    <span>·</span>
                    <span>{commit.date}</span>
                    {revertEligible && hoveredHash === commit.hash && (
                      <motion.span
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        style={{
                          marginLeft: 4,
                          color,
                          fontWeight: 600,
                        }}
                      >
                        · click to revert to here
                      </motion.span>
                    )}
                  </div>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      <div ref={sentinelRef} style={{ textAlign: "center", padding: "14px 0", fontSize: 12, color: "var(--text-muted)" }}>
        {loadingMore ? "loading more history…" : !hasMore ? "— beginning of history —" : null}
      </div>
    </div>
  );
}
