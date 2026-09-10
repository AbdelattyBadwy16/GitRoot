import { useEffect, useRef, useState } from "react";
import { runRawCommand, type RawCommandOutput } from "../lib/gitCommands";

interface CommandInputProps {
  repoPath: string;
  // called after every command, success or failure - a raw command can change basically
  // anything, so the parent just re-fetches everything rather than trying to guess what moved
  onRan: () => void;
}

interface HistoryEntry extends RawCommandOutput {
  id: string;
}

const MAX_HISTORY = 50;

// the power-user escape hatch: a fixed line at the bottom of the window, present no matter which
// tab is open. anything typed here runs as `git <input>` directly, with no confirmation and no
// "what this does" explanation - the opposite of the rest of the app on purpose.
export default function CommandInput({ repoPath, onRan }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  // index into history while recalling past commands with the arrow keys, like a real shell
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // a different repo means this scrollback belongs to somewhere else entirely
  useEffect(() => {
    setHistory([]);
    setValue("");
    setExpanded(false);
    setNavIndex(null);
  }, [repoPath]);

  useEffect(() => {
    if (expanded && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, expanded]);

  async function run() {
    const input = value.trim();
    if (!input || running) return;
    setRunning(true);
    setExpanded(true);
    try {
      const result = await runRawCommand(repoPath, input);
      setHistory((prev) => [...prev, { ...result, id: `${Date.now()}-${Math.random()}` }].slice(-MAX_HISTORY));
      setValue("");
      setNavIndex(null);
      onRan();
    } finally {
      setRunning(false);
    }
  }

  function recall(index: number) {
    setNavIndex(index);
    setValue(history[index].command.replace(/^git /, ""));
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      run();
    } else if (e.key === "ArrowUp") {
      if (history.length === 0) return;
      e.preventDefault();
      recall(navIndex === null ? history.length - 1 : Math.max(0, navIndex - 1));
    } else if (e.key === "ArrowDown") {
      if (navIndex === null) return;
      e.preventDefault();
      const next = navIndex + 1;
      if (next >= history.length) {
        setNavIndex(null);
        setValue("");
      } else {
        recall(next);
      }
    } else if (e.key === "Escape") {
      setExpanded(false);
    }
  }

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface-1)", flexShrink: 0 }}>
      {expanded && history.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 220,
            overflowY: "auto",
            padding: "10px 14px",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12,
            borderBottom: "1px solid var(--border)",
            background: "var(--surface-0)",
          }}
        >
          {history.map((h) => (
            <div key={h.id} style={{ marginBottom: 10 }}>
              <div style={{ color: "var(--text-muted)" }}>$ {h.command}</div>
              {h.stdout && <div style={{ whiteSpace: "pre-wrap", color: "var(--text-primary)" }}>{h.stdout}</div>}
              {h.stderr && <div style={{ whiteSpace: "pre-wrap", color: h.success ? "var(--text-muted)" : "var(--danger)" }}>{h.stderr}</div>}
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px" }}>
        <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: "var(--text-muted)", flexShrink: 0 }}>git</span>
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setNavIndex(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => history.length > 0 && setExpanded(true)}
          disabled={running}
          placeholder="type a git command and press enter…"
          style={{
            flex: 1,
            minWidth: 0,
            border: "none",
            outline: "none",
            background: "none",
            fontFamily: "ui-monospace, monospace",
            fontSize: 12.5,
            color: "var(--text-primary)",
            padding: "5px 0",
          }}
        />
        {history.length > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}
          >
            {expanded ? "hide output" : "show output"}
          </button>
        )}
      </div>
    </div>
  );
}
