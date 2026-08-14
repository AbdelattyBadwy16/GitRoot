import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { setGitIdentity, type GitIdentity } from "../lib/gitCommands";
import { avatarUrl, loadProfiles, saveProfiles, newProfileId, type GitProfile } from "../lib/profiles";
import { useProfileSwitch } from "../hooks/useProfileSwitch";

interface AccountSwitcherProps {
  repoPath: string;
  identity: GitIdentity;
  onIdentityChanged: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type FormState = { label: string; name: string; email: string; githubUsername: string };
const EMPTY_FORM: FormState = { label: "", name: "", email: "", githubUsername: "" };

export default function AccountSwitcher({ repoPath, identity, onIdentityChanged, open, onOpenChange }: AccountSwitcherProps) {
  const [profiles, setProfiles] = useState<GitProfile[]>(loadProfiles);
  const [mode, setMode] = useState<"list" | "add" | "edit">("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const { switchingId, error, setError, switchTo } = useProfileSwitch(repoPath, onIdentityChanged);
  const containerRef = useRef<HTMLDivElement>(null);

  const activeProfile = profiles.find((p) => p.name === identity.name && p.email === identity.email) ?? null;
  const hasUnsavedIdentity = !!(identity.name && identity.email && !activeProfile);

  function persist(next: GitProfile[]) {
    setProfiles(next);
    saveProfiles(next);
  }

  function closeAndReset() {
    onOpenChange(false);
    setMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setError(null);
  }

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) closeAndReset();
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function startAdd(prefill?: Partial<FormState>) {
    setForm({ ...EMPTY_FORM, name: identity.name ?? "", email: identity.email ?? "", ...prefill });
    setEditingId(null);
    setMode("add");
    setError(null);
  }

  function startEdit(profile: GitProfile) {
    setForm({ label: profile.label, name: profile.name, email: profile.email, githubUsername: profile.githubUsername ?? "" });
    setEditingId(profile.id);
    setMode("edit");
    setError(null);
  }

  function removeProfile(id: string) {
    persist(profiles.filter((p) => p.id !== id));
  }

  async function submitForm() {
    const name = form.name.trim();
    const email = form.email.trim();
    if (!name || !email) return;
    const label = form.label.trim() || name;
    const githubUsername = form.githubUsername.trim() || null;

    if (mode === "edit" && editingId) {
      const wasActive = activeProfile?.id === editingId;
      persist(profiles.map((p) => (p.id === editingId ? { ...p, label, name, email, githubUsername } : p)));
      if (wasActive) {
        try {
          await setGitIdentity(repoPath, name, email);
          onIdentityChanged();
        } catch (err) {
          setError(String(err));
          return;
        }
      }
    } else {
      persist([...profiles, { id: newProfileId(), label, name, email, githubUsername }]);
    }
    setMode("list");
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  const buttonTitle = identity.name ? `${identity.name}${identity.email ? ` <${identity.email}>` : ""}` : "set up your git identity";

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        onClick={() => onOpenChange(!open)}
        title={buttonTitle}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "1px solid var(--border)",
          padding: 0,
          background: "var(--surface-2)",
          cursor: "pointer",
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        <Avatar profile={activeProfile} fallbackLabel={identity.name} size={26} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              right: 0,
              width: 280,
              borderRadius: 12,
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              boxShadow: "var(--shadow-lg)",
              padding: 10,
              zIndex: 50,
            }}
          >
            {mode === "list" ? (
              <>
                <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, padding: "2px 6px 8px" }}>
                  git identity
                </div>

                {hasUnsavedIdentity && (
                  <div style={{ margin: "0 0 8px", padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{identity.name}</div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>{identity.email}</div>
                    <button
                      onClick={() => startAdd({ label: identity.name ?? "" })}
                      style={{ fontSize: 11.5, fontWeight: 600, color: "var(--lane-1)", background: "none", border: "none", padding: 0, cursor: "pointer" }}
                    >
                      save as a profile
                    </button>
                  </div>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 2, maxHeight: 260, overflow: "auto" }}>
                  {profiles.map((p) => {
                    const isActive = activeProfile?.id === p.id;
                    return (
                      <div
                        key={p.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "6px 6px",
                          borderRadius: 8,
                          background: isActive ? "color-mix(in srgb, var(--lane-1) 12%, transparent)" : "transparent",
                        }}
                      >
                        <button
                          onClick={() => !isActive && switchTo(p, closeAndReset)}
                          disabled={!!switchingId}
                          style={{
                            flex: 1,
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            minWidth: 0,
                            background: "none",
                            border: "none",
                            padding: 0,
                            textAlign: "left",
                            cursor: isActive || switchingId ? "default" : "pointer",
                          }}
                        >
                          <Avatar profile={p} fallbackLabel={p.label} size={26} />
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {p.label}
                            </div>
                            <div style={{ fontSize: 10.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.email}</div>
                          </div>
                          {switchingId === p.id ? <SmallSpinner /> : isActive ? <ActiveDot /> : null}
                        </button>
                        <IconButton title="edit" onClick={() => startEdit(p)}>
                          <EditIcon />
                        </IconButton>
                        <IconButton title="remove" onClick={() => removeProfile(p.id)}>
                          <TrashIcon />
                        </IconButton>
                      </div>
                    );
                  })}
                  {profiles.length === 0 && !hasUnsavedIdentity && (
                    <div style={{ padding: "8px 6px", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>no saved profiles yet — add one below.</div>
                  )}
                </div>

                {error && <div style={{ color: "var(--danger)", fontSize: 11.5, padding: "6px 6px 0" }}>{error}</div>}

                <button
                  onClick={() => startAdd()}
                  style={{
                    marginTop: 8,
                    width: "100%",
                    padding: "7px 10px",
                    borderRadius: 8,
                    border: "1px dashed var(--border-strong)",
                    background: "none",
                    color: "var(--text-secondary)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  + add profile
                </button>
              </>
            ) : (
              <ProfileForm
                form={form}
                onChange={setForm}
                onCancel={() => {
                  setMode("list");
                  setEditingId(null);
                  setForm(EMPTY_FORM);
                  setError(null);
                }}
                onSubmit={submitForm}
                error={error}
                isEdit={mode === "edit"}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Avatar({ profile, fallbackLabel, size }: { profile: GitProfile | null; fallbackLabel: string | null | undefined; size: number }) {
  const url = avatarUrl(profile?.githubUsername);
  const [errored, setErrored] = useState(false);
  const initial = (profile?.label ?? fallbackLabel ?? "?").trim().charAt(0).toUpperCase() || "?";

  if (url && !errored) {
    return <img src={url} alt="" width={size} height={size} style={{ borderRadius: "50%", display: "block", objectFit: "cover", flexShrink: 0 }} onError={() => setErrored(true)} />;
  }
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
        color: "#fff",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size * 0.42,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initial}
    </div>
  );
}

interface ProfileFormProps {
  form: FormState;
  onChange: (f: FormState) => void;
  onCancel: () => void;
  onSubmit: () => void;
  error: string | null;
  isEdit: boolean;
}

function ProfileForm({ form, onChange, onCancel, onSubmit, error, isEdit }: ProfileFormProps) {
  const valid = !!(form.name.trim() && form.email.trim());
  const fieldStyle: CSSProperties = {
    width: "100%",
    padding: "7px 9px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--surface-0)",
    color: "var(--text-primary)",
    fontSize: 12.5,
    marginBottom: 7,
    boxSizing: "border-box",
  };
  return (
    <div>
      <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8, padding: "0 2px" }}>{isEdit ? "edit profile" : "add a profile"}</div>
      <input placeholder="label (e.g. work, personal)" value={form.label} onChange={(e) => onChange({ ...form, label: e.target.value })} style={fieldStyle} />
      <input placeholder="name" value={form.name} onChange={(e) => onChange({ ...form, name: e.target.value })} style={fieldStyle} />
      <input placeholder="email" value={form.email} onChange={(e) => onChange({ ...form, email: e.target.value })} style={fieldStyle} />
      <input
        placeholder="GitHub username (optional, for the avatar)"
        value={form.githubUsername}
        onChange={(e) => onChange({ ...form, githubUsername: e.target.value })}
        onKeyDown={(e) => e.key === "Enter" && valid && onSubmit()}
        style={{ ...fieldStyle, marginBottom: 4 }}
      />
      <p style={{ margin: "0 0 8px", fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.4, padding: "0 2px" }}>
        switching a profile only changes the name/email your commits use — it doesn't sign you into GitHub or change push/pull credentials.
      </p>
      {error && <div style={{ color: "var(--danger)", fontSize: 11.5, marginBottom: 6, padding: "0 2px" }}>{error}</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={onCancel}
          style={{ flex: 1, padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", background: "none", color: "var(--text-secondary)", fontSize: 12, cursor: "pointer" }}
        >
          cancel
        </button>
        <button
          onClick={onSubmit}
          disabled={!valid}
          style={{
            flex: 1,
            padding: "7px 10px",
            borderRadius: 7,
            border: "none",
            background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
            color: "#fff",
            fontSize: 12,
            fontWeight: 600,
            cursor: valid ? "pointer" : "default",
            opacity: valid ? 1 : 0.5,
          }}
        >
          {isEdit ? "save" : "add"}
        </button>
      </div>
    </div>
  );
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      style={{
        width: 22,
        height: 22,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        border: "none",
        background: "none",
        color: "var(--text-muted)",
        cursor: "pointer",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

function EditIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
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

function ActiveDot() {
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: "var(--lane-3)",
        boxShadow: "0 0 6px 1px color-mix(in srgb, var(--lane-3) 55%, transparent)",
        flexShrink: 0,
      }}
    />
  );
}
