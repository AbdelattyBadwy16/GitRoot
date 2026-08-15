import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { ActionDetails } from "../lib/explain";
import ActionDiagram from "./ActionDiagram";

interface DetailsPanelProps {
  details: ActionDetails | null;
  running: string | null;
  runningLabel?: string | null;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, marginBottom: 5 }}>
        {label}
      </div>
      {children}
    </div>
  );
}

export default function DetailsPanel({ details, running, runningLabel }: DetailsPanelProps) {
  return (
    <div
      style={{
        width: 296,
        flexShrink: 0,
        borderLeft: "1px solid var(--border)",
        background: "var(--surface-1)",
        padding: 20,
        overflow: "auto",
      }}
    >
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.8, color: "var(--text-muted)", marginBottom: 16, fontWeight: 600 }}>
        what happened
      </div>

      <AnimatePresence mode="wait">
        {running ? (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ color: "var(--text-secondary)", fontSize: 13 }}>
            {runningLabel ?? `running ${running}…`}
          </motion.div>
        ) : !details ? (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.5 }}>
            run a command to see exactly what it did: a picture of what moved, the command itself, and what changed.
          </motion.div>
        ) : (
          <motion.div key={details.command + details.result} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
            {!details.isError && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  marginBottom: 18,
                  padding: "14px 6px",
                  background: "var(--surface-0)",
                  borderRadius: 12,
                  border: "1px solid var(--border)",
                }}
              >
                <ActionDiagram
                  kind={details.kind}
                  count={details.count}
                  branch={details.labels.branch}
                  remote={details.labels.remote}
                  from={details.labels.from}
                  target={details.labels.target}
                  before={details.before}
                  after={details.after}
                />
              </div>
            )}

            <Row label="command">
              <div
                style={{
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 12.5,
                  padding: "8px 10px",
                  borderRadius: 7,
                  background: "var(--surface-2)",
                  border: "1px solid var(--border)",
                  wordBreak: "break-word",
                }}
              >
                {details.command}
              </div>
            </Row>

            <Row label="what this does">
              <div style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>{details.meaning}</div>
            </Row>

            {details.steps.length > 0 && (
              <Row label="what happened, step by step">
                <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
                  {details.steps.map((s, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.09, duration: 0.25 }}
                      style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.4 }}
                    >
                      <span
                        style={{
                          flexShrink: 0,
                          marginTop: 1,
                          width: 16,
                          height: 16,
                          borderRadius: "50%",
                          background: "var(--surface-2)",
                          border: "1px solid var(--border)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: "var(--text-muted)",
                        }}
                      >
                        {i + 1}
                      </span>
                      <span>{s}</span>
                    </motion.div>
                  ))}
                </div>
              </Row>
            )}

            {(details.before !== null || details.after !== null) && (
              <Row label="changed">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 9px",
                      borderRadius: 6,
                      background: "var(--surface-2)",
                      border: "1px solid var(--border)",
                      fontSize: 11.5,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--text-muted)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={details.before ?? undefined}
                  >
                    {details.before ?? "-"}
                  </div>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                    <path d="M5 12h14" />
                    <path d="M13 6l6 6-6 6" />
                  </svg>
                  <div
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: "6px 9px",
                      borderRadius: 6,
                      background: `color-mix(in srgb, ${details.isError ? "var(--danger)" : "var(--lane-3)"} 12%, var(--surface-2))`,
                      border: `1px solid color-mix(in srgb, ${details.isError ? "var(--danger)" : "var(--lane-3)"} 35%, transparent)`,
                      fontSize: 11.5,
                      fontFamily: "ui-monospace, monospace",
                      color: "var(--text-primary)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                    title={details.after ?? undefined}
                  >
                    {details.after ?? "-"}
                  </div>
                </div>
              </Row>
            )}

            <Row label={details.isError ? "error" : "result"}>
              <div style={{ fontSize: 13.5, fontWeight: 500, color: details.isError ? "var(--danger)" : "var(--text-primary)", lineHeight: 1.5 }}>
                {details.result}
              </div>
            </Row>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
