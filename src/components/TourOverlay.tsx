import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion, useDragControls } from "framer-motion";
import { TOUR_STEPS } from "../lib/tour";

interface TourOverlayProps {
  stepIndex: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onFinish: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

function useTargetRect(selector: string | null): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);

  useEffect(() => {
    if (!selector) {
      setRect(null);
      return;
    }
    const measure = () => {
      const el = document.querySelector(`[data-tour="${selector}"]`);
      setRect(el ? el.getBoundingClientRect() : null);
    };
    const raf = requestAnimationFrame(measure);
    const settle = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(settle);
      window.removeEventListener("resize", measure);
    };
  }, [selector]);

  return rect;
}

const PRIMARY_BTN: CSSProperties = {
  padding: "9px 18px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
  color: "#fff",
  fontSize: 13.5,
  fontWeight: 600,
  cursor: "pointer",
};

const SECONDARY_BTN: CSSProperties = {
  padding: "9px 16px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-secondary)",
  fontSize: 13.5,
  cursor: "pointer",
};

const SKIP_BTN: CSSProperties = {
  padding: "9px 4px",
  border: "none",
  background: "none",
  color: "var(--text-muted)",
  fontSize: 12.5,
  cursor: "pointer",
  textDecoration: "underline",
};

// a "•" prefix renders as an unnumbered sub-point, everything else gets its own number
function ExampleList({ lines }: { lines: string[] }) {
  let n = 0;
  return (
    <div
      style={{
        marginTop: 12,
        padding: "10px 12px",
        borderRadius: 10,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, marginBottom: 7 }}>
        example
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {lines.map((line, i) => {
          const isSub = line.startsWith("•");
          if (!isSub) n += 1;
          return (
            <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.45 }}>
              {isSub ? (
                <span style={{ flexShrink: 0, width: 16, textAlign: "center", color: "var(--text-muted)" }}>·</span>
              ) : (
                <span
                  style={{
                    flexShrink: 0,
                    marginTop: 1,
                    width: 16,
                    height: 16,
                    borderRadius: "50%",
                    background: "var(--surface-1)",
                    border: "1px solid var(--border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9.5,
                    fontWeight: 700,
                    color: "var(--text-muted)",
                  }}
                >
                  {n}
                </span>
              )}
              <span>{isSub ? line.slice(1).trim() : line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// purely decorative preview of the shared conflict dialog - not the real component, no click
// does anything real, just so the "if something conflicts" step has something to look at
function ConflictMockup() {
  return (
    <div
      style={{
        marginTop: 12,
        padding: 12,
        borderRadius: 10,
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
      }}
    >
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 0.7, color: "var(--text-muted)", fontWeight: 600, marginBottom: 8 }}>
        what it looks like
      </div>
      <div style={{ borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface-0)", overflow: "hidden", marginBottom: 10 }}>
        {["auth.js", "config.json"].map((f, i) => (
          <div
            key={f}
            style={{
              padding: "6px 10px",
              fontSize: 11.5,
              fontFamily: "ui-monospace, monospace",
              color: "var(--danger)",
              borderTop: i === 0 ? "none" : "1px solid var(--border)",
            }}
          >
            {f}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <span style={{ padding: "5px 12px", borderRadius: 7, border: "1px solid color-mix(in srgb, var(--danger) 45%, var(--border))", color: "var(--danger)", fontSize: 11.5, fontWeight: 600 }}>
          abort
        </span>
        <span style={{ padding: "5px 12px", borderRadius: 7, background: "var(--border)", color: "var(--text-muted)", fontSize: 11.5, fontWeight: 600 }}>
          continue
        </span>
      </div>
    </div>
  );
}

function GripIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
      <circle cx="8" cy="5" r="1.6" />
      <circle cx="16" cy="5" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <circle cx="16" cy="12" r="1.6" />
      <circle cx="8" cy="19" r="1.6" />
      <circle cx="16" cy="19" r="1.6" />
    </svg>
  );
}

const GAP = 16;
const MARGIN = 14;
const CARD_WIDTH = 380;

export default function TourOverlay({ stepIndex, onNext, onBack, onSkip, onFinish }: TourOverlayProps) {
  const done = stepIndex >= TOUR_STEPS.length;
  const step = done ? null : TOUR_STEPS[stepIndex];
  const rect = useTargetRect(step?.id ?? null);
  const dragControls = useDragControls();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const PAD = 8;
  const highlighted = rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };
  const cardMaxHeight = Math.min(520, window.innerHeight - MARGIN * 2);

  let cardTop: number;
  let cardLeft: number;
  // "below" or "above" the target, or "center" when there's nothing real to point at
  let arrowSide: "below" | "above" | "center" = "center";
  let arrowLeft = 0;

  if (highlighted) {
    const spaceBelow = window.innerHeight - (highlighted.top + highlighted.height) - GAP - MARGIN;
    const spaceAbove = highlighted.top - GAP - MARGIN;
    const estimatedHeight = Math.max(1, Math.min(cardMaxHeight, Math.max(spaceBelow, spaceAbove)));

    arrowSide = spaceBelow >= estimatedHeight || spaceBelow >= spaceAbove ? "below" : "above";
    cardTop = arrowSide === "below" ? highlighted.top + highlighted.height + GAP : highlighted.top - GAP - estimatedHeight;
    // hard clamp - the card can never end up off the top or bottom of the window
    cardTop = Math.max(MARGIN, Math.min(cardTop, window.innerHeight - MARGIN - estimatedHeight));

    const targetCenterX = highlighted.left + highlighted.width / 2;
    cardLeft = Math.min(Math.max(MARGIN, targetCenterX - CARD_WIDTH / 2), window.innerWidth - CARD_WIDTH - MARGIN);
    arrowLeft = Math.min(Math.max(20, targetCenterX - cardLeft), CARD_WIDTH - 20);
  } else {
    cardLeft = Math.max(MARGIN, (window.innerWidth - CARD_WIDTH) / 2);
    cardTop = Math.max(MARGIN, window.innerHeight * 0.16);
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }}>
      <div style={{ position: "fixed", inset: 0 }} onClick={(e) => e.stopPropagation()} />

      {highlighted ? (
        <motion.div
          layout
          transition={{ type: "spring", stiffness: 350, damping: 30 }}
          style={{
            position: "fixed",
            top: highlighted.top,
            left: highlighted.left,
            width: highlighted.width,
            height: highlighted.height,
            borderRadius: 12,
            pointerEvents: "none",
            boxShadow: "0 0 0 9999px rgba(6, 8, 12, 0.66), 0 0 0 2px var(--lane-1), 0 0 26px 6px color-mix(in srgb, var(--lane-1) 55%, transparent)",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(6, 8, 12, 0.66)" }} />
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={done ? "done" : step!.id}
          drag
          dragListener={false}
          dragControls={dragControls}
          dragMomentum={false}
          dragConstraints={{ left: -window.innerWidth, right: window.innerWidth, top: -window.innerHeight, bottom: window.innerHeight }}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          style={{ position: "fixed", top: cardTop, left: cardLeft, width: CARD_WIDTH }}
        >
          {arrowSide !== "center" && (
            <div
              style={{
                position: "absolute",
                left: arrowLeft - 8,
                ...(arrowSide === "below" ? { top: -7 } : { bottom: -7 }),
                width: 0,
                height: 0,
                borderLeft: "8px solid transparent",
                borderRight: "8px solid transparent",
                ...(arrowSide === "below"
                  ? { borderBottom: "8px solid var(--surface-1)" }
                  : { borderTop: "8px solid var(--surface-1)" }),
              }}
            />
          )}
          <div
            style={{
              maxHeight: cardMaxHeight,
              overflowY: "auto",
              borderRadius: 14,
              border: "1px solid var(--border)",
              background: "var(--surface-1)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
              padding: 20,
              position: "relative",
            }}
          >
            <div
              onPointerDown={(e) => dragControls.start(e)}
              title="drag to move"
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                padding: 4,
                borderRadius: 6,
                color: "var(--text-muted)",
                cursor: "grab",
                touchAction: "none",
              }}
            >
              <GripIcon />
            </div>

            {done ? (
              <>
                <div style={{ fontSize: 26, marginBottom: 8 }}>🌱</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>you're all set</div>
                <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                  everything you run gets explained live, and history-changing actions can always be undone. go build something.
                </p>
                <button onClick={onFinish} style={PRIMARY_BTN}>
                  let's go
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap", paddingRight: 20 }}>
                  {TOUR_STEPS.map((_, i) => (
                    <span
                      key={i}
                      style={{
                        width: i === stepIndex ? 16 : 6,
                        height: 6,
                        borderRadius: 999,
                        background: i === stepIndex ? "var(--lane-1)" : "var(--border-strong)",
                        transition: "width 0.2s",
                      }}
                    />
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, marginBottom: 4 }}>
                  step {stepIndex + 1} of {TOUR_STEPS.length}
                </div>
                <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 7, paddingRight: 20 }}>{step!.title}</div>
                <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{step!.body}</p>
                {step!.example && <ExampleList lines={step!.example} />}
                {step!.id === "concept-conflict" && <ConflictMockup />}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 18 }}>
                  <button onClick={onSkip} style={SKIP_BTN}>
                    skip tour
                  </button>
                  <div style={{ display: "flex", gap: 8 }}>
                    {stepIndex > 0 && (
                      <button onClick={onBack} style={SECONDARY_BTN}>
                        back
                      </button>
                    )}
                    <button onClick={onNext} style={PRIMARY_BTN}>
                      {stepIndex === TOUR_STEPS.length - 1 ? "finish" : "next"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
