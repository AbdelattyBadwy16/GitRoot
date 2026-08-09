import { motion } from "framer-motion";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel, busy }: ConfirmDialogProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onCancel}
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
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{title}</h2>
        </div>
        <p style={{ margin: "0 0 20px", fontSize: 13.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{message}</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            onClick={onCancel}
            disabled={busy}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-secondary)",
              fontSize: 13,
              cursor: busy ? "default" : "pointer",
            }}
          >
            cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-4), var(--lane-2))",
              color: "#fff",
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? "default" : "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            {busy ? "working…" : confirmLabel}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
