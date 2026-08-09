import { motion } from "framer-motion";

interface ArtNode {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
}

interface ArtEdge {
  from: string;
  to: string;
  d: string;
  color: string;
}

const NODES: ArtNode[] = [
  { id: "root", x: 150, y: 415, r: 10, color: "var(--lane-1)" },
  { id: "fork", x: 150, y: 275, r: 8, color: "var(--lane-1)" },
  { id: "midL", x: 82, y: 195, r: 7, color: "var(--lane-3)" },
  { id: "tipL", x: 52, y: 78, r: 8, color: "var(--lane-3)" },
  { id: "midR", x: 216, y: 200, r: 7, color: "var(--lane-2)" },
  { id: "tipR", x: 246, y: 84, r: 8, color: "var(--lane-2)" },
  { id: "twigL", x: 24, y: 148, r: 5.5, color: "var(--lane-7)" },
  { id: "twigR", x: 279, y: 158, r: 5.5, color: "var(--lane-5)" },
];

const EDGES: ArtEdge[] = [
  { from: "root", to: "fork", d: "M 150 415 C 148 360 152 330 150 275", color: "var(--lane-1)" },
  { from: "fork", to: "midL", d: "M 150 275 C 120 250 95 230 82 195", color: "var(--lane-3)" },
  { from: "midL", to: "tipL", d: "M 82 195 C 65 150 48 118 52 78", color: "var(--lane-3)" },
  { from: "fork", to: "midR", d: "M 150 275 C 182 250 205 230 216 200", color: "var(--lane-2)" },
  { from: "midR", to: "tipR", d: "M 216 200 C 232 155 242 118 246 84", color: "var(--lane-2)" },
  { from: "midL", to: "twigL", d: "M 82 195 C 60 178 36 163 24 148", color: "var(--lane-7)" },
  { from: "midR", to: "twigR", d: "M 216 200 C 240 185 267 170 279 158", color: "var(--lane-5)" },
];

const GROW_DURATION = 0.65;
const EDGE_STAGGER = 0.16;

function edgeDelay(index: number): number {
  return 0.15 + index * EDGE_STAGGER;
}

function nodeDelay(id: string): number {
  const i = EDGES.findIndex((e) => e.to === id);
  return i === -1 ? 0.1 : edgeDelay(i) + GROW_DURATION * 0.7;
}

export default function RootArt() {
  return (
    <svg viewBox="0 0 300 440" width="100%" height="100%" style={{ overflow: "visible" }} aria-hidden="true">
      <defs>
        <filter id="gitroot-art-glow" x="-200%" y="-200%" width="500%" height="500%">
          <feGaussianBlur stdDeviation="4.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {EDGES.map((edge, i) => {
        const delay = edgeDelay(i);
        return (
          <g key={`${edge.from}-${edge.to}`}>
            <motion.path
              d={edge.d}
              fill="none"
              stroke={edge.color}
              strokeWidth={9}
              strokeLinecap="round"
              filter="url(#gitroot-art-glow)"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.16, 0.1, 0.16] }}
              transition={{ opacity: { delay, duration: 5, repeat: Infinity, repeatType: "mirror", ease: "easeInOut" } }}
            />
            <motion.path
              d={edge.d}
              fill="none"
              stroke={edge.color}
              strokeWidth={4.5}
              strokeLinecap="round"
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 0.9 }}
              transition={{ delay, duration: GROW_DURATION, ease: "easeOut" }}
            />
            <motion.circle
              r={1.8}
              fill="#fff"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0] }}
              transition={{ delay: delay + GROW_DURATION + 0.3, duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            >
              <animateMotion dur="3.2s" repeatCount="indefinite" path={edge.d} begin={`${delay + GROW_DURATION + 0.3}s`} />
            </motion.circle>
          </g>
        );
      })}

      {NODES.map((node) => {
        const delay = nodeDelay(node.id);
        return (
          <motion.circle
            key={node.id}
            cx={node.x}
            cy={node.y}
            r={node.r}
            fill={node.color}
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: [0, 1.25, 1, 1.06, 1] }}
            transition={{
              opacity: { delay, duration: 0.4 },
              scale: { delay, duration: 2.6, times: [0, 0.28, 0.4, 0.7, 1], repeat: Infinity, repeatDelay: 2.2, ease: "easeInOut" },
            }}
            style={{
              transformOrigin: `${node.x}px ${node.y}px`,
              filter: `drop-shadow(0 0 6px color-mix(in srgb, ${node.color} 65%, transparent))`,
            }}
          />
        );
      })}
    </svg>
  );
}
