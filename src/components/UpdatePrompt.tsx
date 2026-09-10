import { motion } from "framer-motion";
import type { Update } from "@tauri-apps/plugin-updater";

interface UpdatePromptProps {
  update: Update | null;
  dismissed: boolean;
  installing: boolean;
  error: string | null;
  onDismiss: () => void;
  onInstall: () => void;
}

export default function UpdatePrompt({ update, dismissed, installing, error, onDismiss, onInstall }: UpdatePromptProps) {
  if (!update || dismissed) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => !installing && onDismiss()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 420,
          borderRadius: 14,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
          padding: 22,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "var(--lane-4)",
              boxShadow: "0 0 6px 1px color-mix(in srgb, var(--lane-4) 55%, transparent)",
            }}
          />
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>update available</h2>
        </div>
        <div style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>
          gitroot {update.version} is out (you're on {update.currentVersion}).
        </div>
        {update.body && (
          <div
            style={{
              margin: "0 0 20px",
              padding: 12,
              borderRadius: 8,
              background: "var(--surface-0)",
              border: "1px solid var(--border)",
              fontSize: 12.5,
              color: "var(--text-secondary)",
              lineHeight: 1.5,
              maxHeight: 160,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {update.body}
          </div>
        )}
        {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 12 }}>{error}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onDismiss}
            disabled={installing}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: installing ? "default" : "pointer",
            }}
          >
            later
          </button>
          <button
            onClick={onInstall}
            disabled={installing}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-4), var(--lane-2))",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: installing ? "default" : "pointer",
              opacity: installing ? 0.6 : 1,
            }}
          >
            {installing ? "installing…" : "download & restart"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
