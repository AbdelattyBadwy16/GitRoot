import { motion } from "framer-motion";
import { loadProfiles } from "../lib/profiles";
import { useProfileSwitch } from "../hooks/useProfileSwitch";
import type { GitIdentity } from "../lib/gitCommands";

interface AccountPromptProps {
  repoPath: string;
  identity: GitIdentity;
  onIdentityChanged: () => void;
  onDismiss: () => void;
  onManageAccounts: () => void;
}

export default function AccountPrompt({ repoPath, identity, onIdentityChanged, onDismiss, onManageAccounts }: AccountPromptProps) {
  const profiles = loadProfiles();
  const others = profiles.filter((p) => p.name !== identity.name || p.email !== identity.email);
  const { switchingId, error, switchTo } = useProfileSwitch(repoPath, onIdentityChanged);

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
        initial={{ opacity: 0, scale: 0.94, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 400, damping: 32 }}
        style={{
          width: 340,
          borderRadius: 16,
          border: "1px solid var(--border)",
          background: "var(--surface-1)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
          padding: 22,
        }}
      >
        <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, marginBottom: 12 }}>
          git identity
        </div>

        <button
          onClick={() => onDismiss()}
          disabled={!!switchingId}
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "10px 12px",
            marginBottom: 10,
            borderRadius: 10,
            border: "1px solid color-mix(in srgb, var(--lane-1) 45%, transparent)",
            background: "color-mix(in srgb, var(--lane-1) 12%, var(--surface-1))",
            cursor: switchingId ? "default" : "pointer",
            textAlign: "left",
          }}
        >
          <InitialAvatar label={identity.name} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              continue as {identity.name}
            </div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{identity.email}</div>
          </div>
        </button>

        {others.length > 0 && (
          <>
            <div style={{ fontSize: 10.5, color: "var(--text-muted)", margin: "4px 2px 6px" }}>or switch to</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 180, overflow: "auto", marginBottom: 8 }}>
              {others.map((p) => (
                <button
                  key={p.id}
                  onClick={() => switchTo(p, onDismiss)}
                  disabled={!!switchingId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "8px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--surface-0)",
                    cursor: switchingId ? "default" : "pointer",
                    textAlign: "left",
                  }}
                >
                  <InitialAvatar label={p.label} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {p.label}
                    </div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.email}</div>
                  </div>
                  {switchingId === p.id && <SmallSpinner />}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div style={{ color: "var(--danger)", fontSize: 11.5, marginBottom: 8 }}>{error}</div>}

        <button
          onClick={onManageAccounts}
          style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11.5, cursor: "pointer", textDecoration: "underline", padding: "2px" }}
        >
          manage accounts
        </button>
      </motion.div>
    </motion.div>
  );
}

function InitialAvatar({ label }: { label: string | null | undefined }) {
  const initial = (label ?? "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      style={{
        width: 30,
        height: 30,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

function SmallSpinner() {
  return (
    <motion.span
      animate={{ rotate: 360 }}
      transition={{ duration: 0.8, repeat: Infinity, ease: "linear" }}
      style={{
        width: 12,
        height: 12,
        borderRadius: "50%",
        border: "2px solid color-mix(in srgb, var(--lane-1) 25%, transparent)",
        borderTopColor: "var(--lane-1)",
        display: "inline-block",
        flexShrink: 0,
      }}
    />
  );
}
