import { motion } from "framer-motion";

export type Tab = "graph" | "commit" | "branches" | "stash";

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: "graph", label: "graph" },
  { key: "commit", label: "commit" },
  { key: "branches", label: "branches" },
  { key: "stash", label: "stash" },
];

export default function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div data-tour="tab-bar" style={{ padding: "14px 20px 10px" }}>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 11, background: "var(--surface-2)" }}>
        {TAB_LABELS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              style={{
                position: "relative",
                padding: "6px 16px",
                border: "none",
                background: "none",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                borderRadius: 8,
                transition: "color 0.15s",
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="tab-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 8,
                    // this work in both light and dark theme, comparing surface colors direct does not
                    background: "color-mix(in srgb, white 14%, var(--surface-2))",
                    border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
                    boxShadow: "var(--shadow-sm)",
                    zIndex: 0,
                  }}
                />
              )}
              <span style={{ position: "relative", zIndex: 1 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
