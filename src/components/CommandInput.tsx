import { useEffect, useRef, useState } from "react";
import { runRawCommand, type RawCommandOutput } from "../lib/gitCommands";

interface CommandInputProps {
  repoPath: string;
  onRan: () => void;
}

interface HistoryEntry extends RawCommandOutput {
  id: string;
}

const MAX_HISTORY = 50;
const MIN_OUTPUT_HEIGHT = 60;
const MAX_OUTPUT_HEIGHT = 600;
const DEFAULT_OUTPUT_HEIGHT = 220;

export default function CommandInput({ repoPath, onRan }: CommandInputProps) {
  const [value, setValue] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [running, setRunning] = useState(false);
  const [navIndex, setNavIndex] = useState<number | null>(null);
  const [outputHeight, setOutputHeight] = useState(DEFAULT_OUTPUT_HEIGHT);
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef({ y: 0, height: DEFAULT_OUTPUT_HEIGHT });
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHistory([]);
    setValue("");
    setExpanded(false);
    setNavIndex(null);
  }, [repoPath]);

  useEffect(() => {
    if (expanded && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [history, expanded]);

  useEffect(() => {
    if (!dragging) return;
    function onMove(e: MouseEvent) {
      const movedUp = dragStartRef.current.y - e.clientY;
      setOutputHeight(Math.min(MAX_OUTPUT_HEIGHT, Math.max(MIN_OUTPUT_HEIGHT, dragStartRef.current.height + movedUp)));
    }
    function onUp() {
      setDragging(false);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging]);

  function startDrag(e: React.MouseEvent) {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, height: outputHeight };
    if (!expanded && history.length > 0) setExpanded(true);
    setDragging(true);
  }

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
    <div style={{ background: "var(--surface-1)", flexShrink: 0 }}>
      {history.length > 0 && (
        <div
          onMouseDown={startDrag}
          title="drag to resize"
          style={{
            height: 6,
            marginTop: -3,
            cursor: "ns-resize",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div style={{ width: 36, height: 3, borderRadius: 999, background: dragging ? "var(--accent)" : "var(--border-strong)" }} />
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--border)" }}>
        {expanded && history.length > 0 && (
          <div
            ref={scrollRef}
            style={{
              height: outputHeight,
              overflowY: "auto",
              padding: "10px 14px",
              fontFamily: "ui-monospace, monospace",
              fontSize: 12,
              borderBottom: "1px solid var(--border)",
              background: "var(--surface-0)",
              transition: dragging ? "none" : "height 0.1s",
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
    </div>
  );
}
