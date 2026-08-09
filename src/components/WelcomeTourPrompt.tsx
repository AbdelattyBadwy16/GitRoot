import { motion } from "framer-motion";
import Logo from "./Logo";

interface WelcomeTourPromptProps {
  onStart: () => void;
  onSkip: () => void;
}

export default function WelcomeTourPrompt({ onStart, onSkip }: WelcomeTourPromptProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(6, 8, 12, 0.66)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 998,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 380, damping: 28 }}
        style={{
          width: 340,
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          padding: 26,
          textAlign: "center",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 14 }}>
          <Logo size={42} glow />
        </div>
        <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>welcome to GitRoot 👋</div>
        <p style={{ margin: "0 0 22px", fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          new to git, or just want the 60-second tour? it points out what everything does. you can always take it later from the header.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <button
            onClick={onStart}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            show me around
          </button>
          <button
            onClick={onSkip}
            style={{
              padding: "10px 16px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-secondary)",
              fontSize: 13.5,
              fontWeight: 500,
              cursor: "pointer",
            }}
          >
            I know git, skip it
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
