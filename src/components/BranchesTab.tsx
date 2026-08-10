import { useState } from "react";
import { motion } from "framer-motion";
import type { BranchInfo } from "../lib/gitCommands";

// each branch row is 10px top/bottom padding plus its content, this is the real rendered height
const BRANCH_ROW_HEIGHT = 41;
const MAX_VISIBLE_BRANCHES = 5;

interface BranchesTabProps {
  branches: BranchInfo[];
  onSwitch: (name: string) => void;
  onCreate: (name: string, startPoint: string) => void;
  busy: boolean;
  onPickMergeTarget: (branch: string) => void;
  onPickRebaseTarget: (branch: string) => void;
  mergeBusy: boolean;
  rebaseBusy: boolean;
  // while true, show the merge/rebase pickers even with only one branch, disabled, so the tour
  // always has something real to point at
  touring?: boolean;
}

export default function BranchesTab({ branches, onSwitch, onCreate, busy, onPickMergeTarget, onPickRebaseTarget, mergeBusy, rebaseBusy, touring }: BranchesTabProps) {
  const current = branches.find((b) => b.isCurrent)?.name ?? branches[0]?.name ?? "";
  const [newName, setNewName] = useState("");
  const [startPoint, setStartPoint] = useState(current);
  const otherBranches = branches.filter((b) => !b.isCurrent);
  const [mergeTarget, setMergeTarget] = useState(otherBranches[0]?.name ?? "");
  const [rebaseTarget, setRebaseTarget] = useState(otherBranches[0]?.name ?? "");
  const effectiveMergeTarget = otherBranches.some((b) => b.name === mergeTarget) ? mergeTarget : otherBranches[0]?.name ?? "";
  const effectiveRebaseTarget = otherBranches.some((b) => b.name === rebaseTarget) ? rebaseTarget : otherBranches[0]?.name ?? "";

  const [startPointTouched, setStartPointTouched] = useState(false);
  const effectiveStartPoint = startPointTouched ? startPoint : current;

  function submitCreate() {
    const name = newName.trim();
    if (!name || busy) return;
    onCreate(name, effectiveStartPoint);
    setNewName("");
    setStartPointTouched(false);
  }

  return (
    <div data-tour="branches-tab" style={{ padding: 20 }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 6, fontWeight: 600 }}>
        branches
      </div>
      <p style={{ color: "var(--text-secondary)", margin: "0 0 16px", fontSize: 13, lineHeight: 1.5 }}>
        click a branch to switch to it. git blocks the switch (nothing is lost) if you have uncommitted
        changes that would conflict with it.
      </p>

      <div style={{ marginBottom: 20, borderRadius: 10, border: "1px solid var(--border)", overflow: "hidden" }}>
        <div style={{ maxHeight: BRANCH_ROW_HEIGHT * MAX_VISIBLE_BRANCHES, overflowY: "auto" }}>
          {branches.map((b, i) => (
            <button
              key={b.name}
              onClick={() => !b.isCurrent && onSwitch(b.name)}
              disabled={busy || b.isCurrent}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                width: "100%",
                textAlign: "left",
                padding: "10px 14px",
                border: "none",
                borderTop: i === 0 ? "none" : "1px solid var(--border)",
                background: b.isCurrent ? "color-mix(in srgb, var(--lane-1) 10%, var(--surface-1))" : "var(--surface-0)",
                cursor: busy || b.isCurrent ? "default" : "pointer",
                opacity: busy && !b.isCurrent ? 0.5 : 1,
              }}
            >
              <span
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: b.isCurrent ? "var(--lane-1)" : "var(--text-muted)",
                  boxShadow: b.isCurrent ? "0 0 6px 1px color-mix(in srgb, var(--lane-1) 55%, transparent)" : "none",
                  flexShrink: 0,
                }}
              />
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13.5, fontWeight: b.isCurrent ? 600 : 500, color: "var(--text-primary)" }}>
                {b.name}
              </span>
              {b.isCurrent && (
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: "var(--lane-1)",
                    background: "color-mix(in srgb, var(--lane-1) 16%, var(--surface-1))",
                    border: "1px solid color-mix(in srgb, var(--lane-1) 40%, transparent)",
                    borderRadius: 999,
                    padding: "1px 7px",
                  }}
                >
                  current
                </span>
              )}
              {b.upstream && (
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>tracks {b.upstream}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      <div style={{ borderRadius: 10, border: "1px solid var(--border)", padding: 14, background: "var(--surface-1)" }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>create a new branch</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="new-branch-name"
            onKeyDown={(e) => e.key === "Enter" && submitCreate()}
            disabled={busy}
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--surface-0)",
              color: "var(--text-primary)",
              fontSize: 13,
              fontFamily: "ui-monospace, monospace",
            }}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 12.5, color: "var(--text-secondary)" }}>
          <span>starting from</span>
          <select
            value={effectiveStartPoint}
            onChange={(e) => {
              setStartPoint(e.target.value);
              setStartPointTouched(true);
            }}
            disabled={busy}
            style={{
              padding: "6px 8px",
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--surface-0)",
              color: "var(--text-primary)",
              fontSize: 12.5,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {branches.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
                {b.isCurrent ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
        <motion.button
          onClick={submitCreate}
          disabled={busy || !newName.trim()}
          whileHover={busy || !newName.trim() ? undefined : { scale: 1.02 }}
          whileTap={busy || !newName.trim() ? undefined : { scale: 0.98 }}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy || !newName.trim() ? "default" : "pointer",
            opacity: busy || !newName.trim() ? 0.5 : 1,
          }}
        >
          create &amp; switch
        </motion.button>
      </div>

      {(otherBranches.length > 0 || touring) && (
        <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
          <div data-tour="merge-picker" style={{ flex: "1 1 220px", borderRadius: 10, border: "1px solid var(--border)", padding: 14, background: "var(--surface-1)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>merge into {current}</div>
            <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>
              combines another branch's history into {current}.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={effectiveMergeTarget}
                onChange={(e) => setMergeTarget(e.target.value)}
                disabled={mergeBusy || otherBranches.length === 0}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-0)",
                  color: "var(--text-primary)",
                  fontSize: 12.5,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {otherBranches.length === 0 ? (
                  <option>no other branches yet</option>
                ) : (
                  otherBranches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))
                )}
              </select>
              <button
                onClick={() => effectiveMergeTarget && onPickMergeTarget(effectiveMergeTarget)}
                disabled={mergeBusy || !effectiveMergeTarget}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                  color: "#fff",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: mergeBusy || !effectiveMergeTarget ? "default" : "pointer",
                  opacity: mergeBusy || !effectiveMergeTarget ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                merge
              </button>
            </div>
          </div>

          <div data-tour="rebase-picker" style={{ flex: "1 1 220px", borderRadius: 10, border: "1px solid var(--border)", padding: 14, background: "var(--surface-1)" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>rebase {current} onto</div>
            <p style={{ margin: "0 0 10px", fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4 }}>
              replays {current}'s own commits on top of another branch, one at a time.
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={effectiveRebaseTarget}
                onChange={(e) => setRebaseTarget(e.target.value)}
                disabled={rebaseBusy || otherBranches.length === 0}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--surface-0)",
                  color: "var(--text-primary)",
                  fontSize: 12.5,
                  fontFamily: "ui-monospace, monospace",
                }}
              >
                {otherBranches.length === 0 ? (
                  <option>no other branches yet</option>
                ) : (
                  otherBranches.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))
                )}
              </select>
              <button
                onClick={() => effectiveRebaseTarget && onPickRebaseTarget(effectiveRebaseTarget)}
                disabled={rebaseBusy || !effectiveRebaseTarget}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "1px solid color-mix(in srgb, var(--lane-4) 55%, transparent)",
                  background: "color-mix(in srgb, var(--lane-4) 12%, var(--surface-1))",
                  color: "var(--lane-4)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: rebaseBusy || !effectiveRebaseTarget ? "default" : "pointer",
                  opacity: rebaseBusy || !effectiveRebaseTarget ? 0.5 : 1,
                  whiteSpace: "nowrap",
                }}
              >
                rebase
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
