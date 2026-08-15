import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getFileHunks, stageHunkLines, discardHunkLines, unstageHunkLines, stageFile, discardFile, unstageFile, type FileHunksResult } from "../lib/gitCommands";
import { parseDiff, DIFF_ROW_STYLES, DIFF_PREFIX } from "../lib/diff";
import ConfirmDialog from "./ConfirmDialog";

type DiscardTarget = { kind: "whole" } | { kind: "hunk"; index: number };

interface HunkEditorProps {
  repoPath: string;
  filePath: string;
  onBack: () => void;
  onChanged: () => void;
}

type Selections = Map<number, Set<number>>;

function defaultSelection(hunk: string): Set<number> {
  const sel = new Set<number>();
  parseDiff(hunk).forEach((l, li) => {
    if (l.kind === "add" || l.kind === "remove") sel.add(li);
  });
  return sel;
}

export default function HunkEditor({ repoPath, filePath, onBack, onChanged }: HunkEditorProps) {
  const [result, setResult] = useState<FileHunksResult | null>(null);
  const [selections, setSelections] = useState<Selections>(new Map());
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const [wholeFileBusy, setWholeFileBusy] = useState<"stage" | "discard" | "unstage" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState<DiscardTarget | null>(null);

  async function load() {
    try {
      const r = await getFileHunks(repoPath, filePath);
      setResult(r);
      setSelections(new Map(r.hunks.map((hunk, i) => [i, defaultSelection(hunk)])));
    } catch (err) {
      setError(String(err));
    }
  }

  useEffect(() => {
    setResult(null);
    setSelections(new Map());
    setError(null);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoPath, filePath]);

  function toggleLine(hunkIndex: number, lineIndex: number) {
    setSelections((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(hunkIndex) ?? []);
      if (set.has(lineIndex)) set.delete(lineIndex);
      else set.add(lineIndex);
      next.set(hunkIndex, set);
      return next;
    });
  }

  async function act(index: number, action: "stage" | "discard" | "unstage") {
    const lines = Array.from(selections.get(index) ?? []);
    if (lines.length === 0) return;
    setBusyIndex(index);
    setError(null);
    try {
      if (action === "stage") await stageHunkLines(repoPath, filePath, index, lines);
      else if (action === "unstage") await unstageHunkLines(repoPath, filePath, index, lines);
      else await discardHunkLines(repoPath, filePath, index, lines);
      await load();
      onChanged();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyIndex(null);
    }
  }

  async function actWholeFile(action: "stage" | "discard" | "unstage") {
    setWholeFileBusy(action);
    setError(null);
    try {
      if (action === "stage") await stageFile(repoPath, filePath);
      else if (action === "unstage") await unstageFile(repoPath, filePath);
      else await discardFile(repoPath, filePath);
      onChanged();
      onBack();
    } catch (err) {
      setError(String(err));
    } finally {
      setWholeFileBusy(null);
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <button
        onClick={onBack}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          background: "none",
          border: "none",
          color: "var(--text-muted)",
          fontSize: 12.5,
          cursor: "pointer",
          padding: 0,
          marginBottom: 14,
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        back to changed files
      </button>

      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 4, fontWeight: 600 }}>
        editing changes in
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, fontWeight: 600, marginBottom: 4 }}>{filePath}</div>
      <p style={{ margin: "0 0 16px", fontSize: 12, color: "var(--text-muted)" }}>
        {result?.staged
          ? "nothing unstaged here, these lines are already staged (probably from undoing a commit). uncheck what you don't want, then unstage just what's checked."
          : "every added/removed line has its own checkbox. uncheck what you don't want, then stage or discard just what's checked."}
      </p>

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: "10px 12px",
            borderRadius: 8,
            background: "color-mix(in srgb, var(--danger) 12%, transparent)",
            border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
            color: "var(--danger)",
            fontSize: 12.5,
          }}
        >
          {error}
        </div>
      )}

      {result === null ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13 }}>loading…</div>
      ) : result.wholeFileOnly ? (
        <div style={{ padding: "20px", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
          <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.5, margin: "0 0 14px" }}>
            this file changed, but it can't be split into parts. it's likely binary (an image, a compiled file,
            .DS_Store...), which git only tracks as "changed" or not, never line by line.{" "}
            {result.staged ? "unstage the whole file instead:" : "stage or discard the whole file instead:"}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            {result.staged ? (
              <button
                onClick={() => actWholeFile("unstage")}
                disabled={wholeFileBusy !== null}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                  color: "#fff",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: wholeFileBusy !== null ? "default" : "pointer",
                  opacity: wholeFileBusy !== null && wholeFileBusy !== "unstage" ? 0.4 : 1,
                }}
              >
                {wholeFileBusy === "unstage" ? "…" : "unstage whole file"}
              </button>
            ) : (
              <>
                <button
                  onClick={() => setConfirmDiscard({ kind: "whole" })}
                  disabled={wholeFileBusy !== null}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "1px solid var(--border)",
                    background: "none",
                    color: "var(--danger)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: wholeFileBusy !== null ? "default" : "pointer",
                    opacity: wholeFileBusy !== null && wholeFileBusy !== "discard" ? 0.4 : 1,
                  }}
                >
                  {wholeFileBusy === "discard" ? "…" : "discard whole file"}
                </button>
                <button
                  onClick={() => actWholeFile("stage")}
                  disabled={wholeFileBusy !== null}
                  style={{
                    padding: "8px 16px",
                    borderRadius: 8,
                    border: "none",
                    background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                    color: "#fff",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: wholeFileBusy !== null ? "default" : "pointer",
                    opacity: wholeFileBusy !== null && wholeFileBusy !== "stage" ? 0.4 : 1,
                  }}
                >
                  {wholeFileBusy === "stage" ? "…" : "stage whole file"}
                </button>
              </>
            )}
          </div>
        </div>
      ) : result.hunks.length === 0 ? (
        <div style={{ color: "var(--text-muted)", fontSize: 13, padding: "24px 0", textAlign: "center", border: "1px dashed var(--border)", borderRadius: 10 }}>
          {result.staged ? "nothing staged left to split up in this file." : "nothing unstaged left to split up in this file."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <AnimatePresence initial={false}>
            {result.hunks.map((hunk, i) => {
              const selected = selections.get(i) ?? new Set<number>();
              const parsed = parseDiff(hunk);
              const changedCount = parsed.filter((l) => l.kind === "add" || l.kind === "remove").length;
              const selectedCount = selected.size;
              const allSelected = selectedCount === changedCount;

              return (
                <motion.div
                  key={hunk}
                  layout
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  style={{ overflow: "hidden" }}
                >
                  <div style={{ borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "var(--surface-1)",
                        borderBottom: "1px solid var(--border)",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>part {i + 1} of {result.hunks.length}</span>
                        <button
                          onClick={() =>
                            setSelections((prev) => {
                              const next = new Map(prev);
                              next.set(i, allSelected ? new Set() : defaultSelection(hunk));
                              return next;
                            })
                          }
                          style={{ background: "none", border: "none", color: "var(--lane-1)", fontSize: 11, cursor: "pointer", padding: 0, textDecoration: "underline" }}
                        >
                          {allSelected ? "deselect all" : "select all"}
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 6 }}>
                        {result.staged ? (
                          <button
                            onClick={() => act(i, "unstage")}
                            disabled={busyIndex !== null || selectedCount === 0}
                            title="unstage just the checked lines, the working tree is untouched"
                            style={{
                              padding: "5px 10px",
                              borderRadius: 6,
                              border: "none",
                              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: busyIndex !== null || selectedCount === 0 ? "default" : "pointer",
                              opacity: (busyIndex !== null && busyIndex !== i) || selectedCount === 0 ? 0.4 : 1,
                            }}
                          >
                            {busyIndex === i
                              ? "…"
                              : `unstage ${selectedCount}/${changedCount} line${changedCount === 1 ? "" : "s"}`}
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => setConfirmDiscard({ kind: "hunk", index: i })}
                              disabled={busyIndex !== null || selectedCount === 0}
                              title="throw away just the checked lines"
                              style={{
                                padding: "5px 10px",
                                borderRadius: 6,
                                border: "1px solid var(--border)",
                                background: "none",
                                color: "var(--danger)",
                                fontSize: 12,
                                fontWeight: 500,
                                cursor: busyIndex !== null || selectedCount === 0 ? "default" : "pointer",
                                opacity: (busyIndex !== null && busyIndex !== i) || selectedCount === 0 ? 0.4 : 1,
                              }}
                            >
                              {busyIndex === i ? "…" : `discard ${selectedCount}/${changedCount} line${changedCount === 1 ? "" : "s"}`}
                            </button>
                            <button
                              onClick={() => act(i, "stage")}
                              disabled={busyIndex !== null || selectedCount === 0}
                              title="stage just the checked lines"
                              style={{
                                padding: "5px 10px",
                                borderRadius: 6,
                                border: "none",
                                background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                                color: "#fff",
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: busyIndex !== null || selectedCount === 0 ? "default" : "pointer",
                                opacity: (busyIndex !== null && busyIndex !== i) || selectedCount === 0 ? 0.4 : 1,
                              }}
                            >
                              {busyIndex === i
                                ? "…"
                                : `stage ${selectedCount}/${changedCount} line${changedCount === 1 ? "" : "s"}`}
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.6 }}>
                      {parsed.map((l, li) => {
                        const checkable = l.kind === "add" || l.kind === "remove";
                        return (
                          <div
                            key={li}
                            style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 10px 0 6px", whiteSpace: "pre", ...DIFF_ROW_STYLES[l.kind] }}
                          >
                            <span style={{ width: 15, flexShrink: 0, display: "flex", justifyContent: "center" }}>
                              {checkable && (
                                <input
                                  type="checkbox"
                                  checked={selected.has(li)}
                                  onChange={() => toggleLine(i, li)}
                                  title={l.kind === "add" ? "include this added line" : "include this removed line"}
                                  style={{ margin: 0, cursor: "pointer", accentColor: "var(--lane-1)" }}
                                />
                              )}
                            </span>
                            <span style={{ opacity: 0.55, userSelect: "none", flexShrink: 0 }}>{DIFF_PREFIX[l.kind]}</span>
                            <span style={{ opacity: checkable && !selected.has(li) ? 0.45 : 1 }}>{l.text}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      <AnimatePresence>
        {confirmDiscard && result && (
          <ConfirmDialog
            title="discard for good?"
            message={
              confirmDiscard.kind === "whole"
                ? `this throws away every unstaged change in "${filePath}". it can't be brought back.`
                : (() => {
                    const hunk = result.hunks[confirmDiscard.index];
                    const selected = selections.get(confirmDiscard.index) ?? new Set<number>();
                    const changedCount = parseDiff(hunk).filter((l) => l.kind === "add" || l.kind === "remove").length;
                    return `this throws away ${selected.size}/${changedCount} line${changedCount === 1 ? "" : "s"} in "${filePath}". it can't be brought back.`;
                  })()
            }
            confirmLabel="discard"
            busy={confirmDiscard.kind === "whole" ? wholeFileBusy === "discard" : busyIndex === confirmDiscard.index}
            onCancel={() => setConfirmDiscard(null)}
            onConfirm={async () => {
              const target = confirmDiscard;
              setConfirmDiscard(null);
              if (target.kind === "whole") await actWholeFile("discard");
              else await act(target.index, "discard");
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
