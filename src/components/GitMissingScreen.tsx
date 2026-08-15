import Logo from "./Logo";
import { openExternal } from "../lib/gitCommands";

export default function GitMissingScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-0)", padding: 40 }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <Logo size={40} />
        <h1 style={{ fontSize: 19, margin: "16px 0 8px" }}>git isn't installed</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6, margin: "0 0 22px" }}>
          GitRoot runs the real git on your machine, so it needs git installed first. install it, then come back here.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={() => openExternal("https://git-scm.com/downloads")}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            get git
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-primary)",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            i installed it, check again
          </button>
        </div>
      </div>
    </div>
  );
}
