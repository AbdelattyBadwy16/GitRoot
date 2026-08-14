import { AnimatePresence, motion } from "framer-motion";
import Logo from "./Logo";
import RootArt from "./RootArt";

interface LandingPageProps {
  opening: boolean;
  openError: string | null;
  showManualInput: boolean;
  pathInput: string;
  onBrowse: () => void;
  onToggleManualInput: () => void;
  onPathInputChange: (v: string) => void;
  onManualOpen: () => void;
  notGitFolderPath: string | null;
  initRemoteUrl: string;
  onInitRemoteUrlChange: (v: string) => void;
  onInit: () => void;
  onCancelInit: () => void;
  showCloneInput: boolean;
  onToggleCloneInput: () => void;
  cloneUrl: string;
  onCloneUrlChange: (v: string) => void;
  onClone: () => void;
  cloning: boolean;
}

const BLOBS = [
  { color: "var(--lane-3)", size: 420, top: "-10%", left: "-8%", dur: 22 },
  { color: "var(--lane-1)", size: 460, top: "40%", left: "70%", dur: 26 },
  { color: "var(--lane-7)", size: 320, top: "70%", left: "5%", dur: 19 },
];

const FEATURES: { color: string; text: string }[] = [
  { color: "var(--lane-1)", text: "every command explained in plain language" },
  { color: "var(--lane-3)", text: "undo safely — history is never force-deleted" },
  { color: "var(--lane-2)", text: "stage changes file-by-file, even piece-by-piece" },
  { color: "var(--lane-7)", text: "every branch visible, one click to switch" },
];

export default function LandingPage({
  opening,
  openError,
  showManualInput,
  pathInput,
  onBrowse,
  onToggleManualInput,
  onPathInputChange,
  onManualOpen,
  notGitFolderPath,
  initRemoteUrl,
  onInitRemoteUrlChange,
  onInit,
  onCancelInit,
  showCloneInput,
  onToggleCloneInput,
  cloneUrl,
  onCloneUrlChange,
  onClone,
  cloning,
}: LandingPageProps) {
  const busy = opening || cloning;

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden", background: "var(--surface-0)" }}>
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            background: b.color,
            opacity: 0.14,
            filter: "blur(90px)",
            pointerEvents: "none",
          }}
        />
      ))}

      <div style={{ position: "relative", height: "100%", overflow: "auto" }}>
        <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 56, maxWidth: 960, width: "100%", flexWrap: "wrap", justifyContent: "center" }}>
            <div style={{ flex: "1 1 420px", maxWidth: 460 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <Logo size={44} />
                <h1
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    margin: 0,
                    backgroundImage: "linear-gradient(135deg, var(--text-primary), var(--text-secondary))",
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                    letterSpacing: -0.5,
                  }}
                >
                  GitRoot
                </h1>
              </div>
              <p style={{ color: "var(--text-secondary)", margin: "0 0 26px", fontSize: 15, lineHeight: 1.55, maxWidth: 400 }}>
                A git client that explains what it's doing, every time — open a folder, clone a repository, or
                start a brand new one.
              </p>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <motion.button
                  onClick={onBrowse}
                  disabled={busy}
                  whileHover={busy ? undefined : { scale: 1.02 }}
                  whileTap={busy ? undefined : { scale: 0.98 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "13px 22px",
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                    color: "#fff",
                    fontSize: 14.5,
                    fontWeight: 600,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.7 : 1,
                    boxShadow: "0 8px 24px color-mix(in srgb, var(--lane-1) 40%, transparent)",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                  {opening ? "opening…" : "choose a folder"}
                </motion.button>

                <motion.button
                  onClick={onToggleCloneInput}
                  disabled={busy}
                  whileHover={busy ? undefined : { scale: 1.02 }}
                  whileTap={busy ? undefined : { scale: 0.98 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "13px 20px",
                    borderRadius: 12,
                    border: "1px solid var(--border-strong)",
                    background: showCloneInput ? "var(--surface-2)" : "var(--surface-1)",
                    color: "var(--text-primary)",
                    fontSize: 14.5,
                    fontWeight: 600,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="2.5" />
                    <circle cx="6" cy="18" r="2.5" />
                    <circle cx="18" cy="12" r="2.5" />
                    <path d="M6 8.5V15.5" />
                    <path d="M8 7l7.5 4" />
                  </svg>
                  clone from a URL
                </motion.button>
              </div>

              <AnimatePresence>
                {showCloneInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <input
                        value={cloneUrl}
                        onChange={(e) => onCloneUrlChange(e.target.value)}
                        placeholder="git@github.com:you/repo.git"
                        onKeyDown={(e) => e.key === "Enter" && onClone()}
                        autoFocus
                        style={{
                          flex: 1,
                          padding: "9px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                          fontFamily: "ui-monospace, monospace",
                        }}
                      />
                      <button
                        onClick={onClone}
                        disabled={busy || cloneUrl.trim().length === 0}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 8,
                          border: "none",
                          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                          color: "#fff",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: busy || cloneUrl.trim().length === 0 ? "default" : "pointer",
                          opacity: busy || cloneUrl.trim().length === 0 ? 0.6 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cloning ? "cloning…" : "clone"}
                      </button>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-muted)" }}>
                      you'll be asked where to put it — GitRoot creates a new folder there for the repo.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div style={{ marginTop: 12 }}>
                <button
                  onClick={onToggleManualInput}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  {showManualInput ? "hide" : "or paste a path instead"}
                </button>
              </div>

              <AnimatePresence>
                {showManualInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <input
                        value={pathInput}
                        onChange={(e) => onPathInputChange(e.target.value)}
                        placeholder="/path/to/repo"
                        onKeyDown={(e) => e.key === "Enter" && onManualOpen()}
                        style={{
                          flex: 1,
                          padding: "9px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                        }}
                      />
                      <button
                        onClick={onManualOpen}
                        disabled={busy}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                          cursor: busy ? "default" : "pointer",
                        }}
                      >
                        open
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {notGitFolderPath && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: 16,
                      padding: "14px 16px",
                      borderRadius: 10,
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 600 }}>that folder isn't a git repository yet</p>
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 11.5,
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {notGitFolderPath}
                    </p>
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      set one up here — optionally link a remote now (or skip this and add one later):
                    </p>
                    <input
                      value={initRemoteUrl}
                      onChange={(e) => onInitRemoteUrlChange(e.target.value)}
                      placeholder="remote URL (optional) — e.g. git@github.com:you/repo.git"
                      onKeyDown={(e) => e.key === "Enter" && onInit()}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface-0)",
                        color: "var(--text-primary)",
                        fontSize: 12.5,
                        marginBottom: 10,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={onInit}
                        disabled={busy}
                        style={{
                          flex: 1,
                          padding: "9px 14px",
                          borderRadius: 8,
                          border: "none",
                          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: busy ? "default" : "pointer",
                          opacity: busy ? 0.7 : 1,
                        }}
                      >
                        {opening ? "setting up…" : "initialize repository"}
                      </button>
                      <button
                        onClick={onCancelInit}
                        disabled={busy}
                        style={{
                          padding: "9px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "none",
                          color: "var(--text-muted)",
                          fontSize: 13,
                          cursor: busy ? "default" : "pointer",
                        }}
                      >
                        cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {openError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: 16,
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
                      color: "var(--danger)",
                      fontSize: 13,
                    }}
                  >
                    {openError}
                  </motion.p>
                )}
              </AnimatePresence>

              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 30 }}>
                {FEATURES.map((f) => (
                  <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text-secondary)" }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: f.color,
                        boxShadow: `0 0 5px 1px color-mix(in srgb, ${f.color} 55%, transparent)`,
                        flexShrink: 0,
                      }}
                    />
                    {f.text}
                  </div>
                ))}
              </div>

              <p style={{ marginTop: 24, color: "var(--text-muted)", fontSize: 11.5 }}>
                everything runs locally — nothing about your code leaves your machine.
              </p>
            </div>

            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              style={{ flex: "0 0 auto", width: 260, height: 380 }}
            >
              <RootArt />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
