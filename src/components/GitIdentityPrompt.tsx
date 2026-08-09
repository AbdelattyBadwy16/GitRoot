import { useState, type CSSProperties } from "react";
import { setGitIdentity } from "../lib/gitCommands";

interface GitIdentityPromptProps {
  repoPath: string;
  onSaved: () => void;
}

const inputStyle: CSSProperties = {
  flex: 1,
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--surface-0)",
  color: "var(--text-primary)",
  fontSize: 13,
};

// blocks nothing, just asks for a name + email before your first commit here - git refuses to commit without them
export default function GitIdentityPrompt({ repoPath, onSaved }: GitIdentityPromptProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!name.trim() || !email.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await setGitIdentity(repoPath, name.trim(), email.trim());
      onSaved();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 16, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface-1)", marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 4 }}>git needs to know who you are</div>
      <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
        every commit is attributed to a name and email — set them once, for every repo on this machine.
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="your name" onKeyDown={(e) => e.key === "Enter" && save()} style={inputStyle} />
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" onKeyDown={(e) => e.key === "Enter" && save()} style={inputStyle} />
      </div>
      {error && <div style={{ color: "var(--danger)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button
        onClick={save}
        disabled={saving || !name.trim() || !email.trim()}
        style={{
          padding: "8px 16px",
          borderRadius: 8,
          border: "none",
          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
          color: "#fff",
          fontSize: 13,
          fontWeight: 600,
          cursor: saving || !name.trim() || !email.trim() ? "default" : "pointer",
          opacity: saving || !name.trim() || !email.trim() ? 0.6 : 1,
        }}
      >
        {saving ? "saving…" : "save & continue"}
      </button>
    </div>
  );
}
