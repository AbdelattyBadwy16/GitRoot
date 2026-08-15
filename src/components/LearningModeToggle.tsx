import { motion } from "framer-motion";

export default function LearningModeToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      data-tour="learning-mode"
      onClick={() => onChange(!value)}
      title={value ? "learning mode is on, click to turn off" : "learning mode is off, click to turn on"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span style={{ fontSize: 12.5, color: value ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 500 }}>
        learning mode
      </span>
      <span
        style={{
          position: "relative",
          width: 34,
          height: 19,
          borderRadius: 999,
          background: value ? "var(--lane-1)" : "var(--surface-2)",
          border: "1px solid " + (value ? "color-mix(in srgb, var(--lane-1) 60%, transparent)" : "var(--border)"),
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <motion.span
          animate={{ left: value ? 16 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            position: "absolute",
            top: 1.5,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </span>
    </button>
  );
}
