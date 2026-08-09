import { useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { CommandName } from "../lib/explain";

interface CommandBarProps {
  onRun: (command: Exclude<CommandName, "commit">) => void;
  onOpenCommit: () => void;
  commitOpen: boolean;
  busy: string | null;
  // when on, hovering a command shows what it does (see App.tsx)
  learningMode: boolean;
}

function Spinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      style={{
        width: 15,
        height: 15,
        borderRadius: "50%",
        border: "2px solid color-mix(in srgb, currentColor 25%, transparent)",
        borderTopColor: "currentColor",
        display: "inline-block",
      }}
    />
  );
}

function PullIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 4v11" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function PushIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 19V8" />
      <path d="M7 13l5-5 5 5" />
      <path d="M4 19h16" />
    </svg>
  );
}

function StashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="5" width="16" height="6" rx="1.5" />
      <path d="M6 11v6a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-6" />
      <path d="M10 15h4" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12h5" />
      <path d="M16 12h5" />
      <circle cx="12" cy="12" r="3.5" />
    </svg>
  );
}

// each command gets its own color identity, matching the graph's lane palette
const BUTTONS: { key: Exclude<CommandName, "commit">; label: string; icon: () => JSX.Element; hint: string; color: string }[] = [
  { key: "pull", label: "pull", icon: PullIcon, hint: "downloads new commits from the remote and merges them into your branch.", color: "var(--lane-1)" },
  { key: "push", label: "push", icon: PushIcon, hint: "uploads your commits so the remote matches your branch.", color: "var(--lane-2)" },
  { key: "stash", label: "stash", icon: StashIcon, hint: "sets uncommitted changes aside so your working directory is clean.", color: "var(--lane-4)" },
];
const COMMIT_HINT = "review what changed and save the ones you choose as a new point in history.";
const COMMIT_COLOR = "var(--lane-3)";

// tooltip next to a button on hover, only rendered when Learning Mode is on
function HoverHint({ text }: { text: string }) {
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, x: -4 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.12 }}
        style={{
          position: "absolute",
          left: "100%",
          top: 0,
          marginLeft: 8,
          width: 180,
          padding: "8px 10px",
          borderRadius: 8,
          background: "var(--surface-2)",
          border: "1px solid var(--border)",
          boxShadow: "var(--shadow-lg)",
          color: "var(--text-secondary)",
          fontSize: 12,
          fontWeight: 400,
          lineHeight: 1.4,
          zIndex: 20,
          pointerEvents: "none",
        }}
      >
        {text}
      </motion.div>
    </AnimatePresence>
  );
}

function IconChip({ color, active, busy, children }: { color: string; active: boolean; busy: boolean; children: ReactNode }) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: 28,
        height: 28,
        borderRadius: 8,
        flexShrink: 0,
        color: active ? "#fff" : color,
        background: active
          ? `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 70%, black))`
          : `color-mix(in srgb, ${color} ${busy ? 6 : 12}%, var(--surface-1))`,
        boxShadow: active ? `0 3px 10px color-mix(in srgb, ${color} 45%, transparent)` : "none",
        transition: "background 0.15s, box-shadow 0.15s, color 0.15s",
      }}
    >
      {children}
    </span>
  );
}

// the sidebar's command buttons
export default function CommandBar({ onRun, onOpenCommit, commitOpen, busy, learningMode }: CommandBarProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div
      data-tour="command-bar"
      style={{
        width: 208,
        padding: 16,
        borderRight: "1px solid var(--border)",
        background: "var(--surface-1)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
        commands
      </div>
      {BUTTONS.map((b) => {
        const active = busy === b.key;
        return (
          <div key={b.key} style={{ position: "relative" }} onMouseEnter={() => setHovered(b.key)} onMouseLeave={() => setHovered(null)}>
            <motion.button
              disabled={!!busy}
              onClick={() => onRun(b.key)}
              whileHover={busy ? undefined : { y: -1 }}
              whileTap={busy ? undefined : { scale: 0.98 }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "8px 10px",
                marginBottom: 8,
                borderRadius: 10,
                border: active ? `1px solid color-mix(in srgb, ${b.color} 45%, transparent)` : "1px solid var(--border)",
                background: active ? `color-mix(in srgb, ${b.color} 8%, var(--surface-1))` : "var(--surface-0)",
                boxShadow: active ? "var(--shadow-sm)" : "none",
                color: "var(--text-primary)",
                fontSize: 13.5,
                fontWeight: 500,
                cursor: busy ? "default" : "pointer",
                opacity: busy && !active ? 0.4 : 1,
                transition: "background 0.15s, opacity 0.15s, border-color 0.15s",
              }}
            >
              <IconChip color={b.color} active={active} busy={!!busy}>
                {active ? <Spinner /> : <b.icon />}
              </IconChip>
              {b.label}
            </motion.button>
            {learningMode && hovered === b.key && <HoverHint text={b.hint} />}
          </div>
        );
      })}
      <div data-tour="commit-button" style={{ position: "relative" }} onMouseEnter={() => setHovered("commit")} onMouseLeave={() => setHovered(null)}>
        <motion.button
          disabled={!!busy}
          onClick={onOpenCommit}
          whileHover={busy ? undefined : { y: -1 }}
          whileTap={busy ? undefined : { scale: 0.98 }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            textAlign: "left",
            padding: "8px 10px",
            marginTop: 4,
            borderRadius: 10,
            border: commitOpen || busy === "commit" ? `1px solid color-mix(in srgb, ${COMMIT_COLOR} 45%, transparent)` : "1px solid var(--border)",
            background: commitOpen || busy === "commit" ? `color-mix(in srgb, ${COMMIT_COLOR} 8%, var(--surface-1))` : "var(--surface-0)",
            boxShadow: commitOpen || busy === "commit" ? "var(--shadow-sm)" : "none",
            color: "var(--text-primary)",
            fontSize: 13.5,
            fontWeight: 500,
            cursor: busy ? "default" : "pointer",
            opacity: busy && busy !== "commit" ? 0.4 : 1,
            transition: "background 0.15s, opacity 0.15s, border-color 0.15s",
          }}
        >
          <IconChip color={COMMIT_COLOR} active={commitOpen || busy === "commit"} busy={!!busy}>
            {busy === "commit" ? <Spinner /> : <CommitIcon />}
          </IconChip>
          commit
        </motion.button>
        {learningMode && hovered === "commit" && <HoverHint text={COMMIT_HINT} />}
      </div>
    </div>
  );
}
