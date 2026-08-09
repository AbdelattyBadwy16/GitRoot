import { useEffect, useState, type CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";
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

export default function TourOverlay({ stepIndex, onNext, onBack, onSkip, onFinish }: TourOverlayProps) {
  const done = stepIndex >= TOUR_STEPS.length;
  const step = done ? null : TOUR_STEPS[stepIndex];
  const rect = useTargetRect(step?.id ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSkip]);

  const PAD = 8;
  const highlighted = rect && { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 };

  const cardWidth = 380;
  const cardMaxHeight = Math.min(520, window.innerHeight - 28);
  let cardStyle: CSSProperties = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (highlighted) {
    const spaceBelow = window.innerHeight - (highlighted.top + highlighted.height);
    const spaceAbove = highlighted.top;
    const openDown = spaceBelow >= spaceAbove;
    const top = openDown
      ? Math.min(highlighted.top + highlighted.height + 14, window.innerHeight - 14 - Math.min(cardMaxHeight, spaceBelow - 14))
      : Math.max(14, highlighted.top - 14 - Math.min(cardMaxHeight, spaceAbove - 14));
    const left = Math.min(Math.max(14, highlighted.left), window.innerWidth - cardWidth - 14);
    cardStyle = { position: "fixed", top: Math.max(14, top), left };
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
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          style={{
            ...cardStyle,
            width: cardWidth,
            maxHeight: cardMaxHeight,
            overflowY: "auto",
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "var(--surface-1)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            padding: 20,
          }}
        >
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
              <div style={{ display: "flex", gap: 4, marginBottom: 12, flexWrap: "wrap" }}>
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
              <div style={{ fontSize: 15.5, fontWeight: 700, marginBottom: 7 }}>{step!.title}</div>
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55 }}>{step!.body}</p>
              {step!.example && <ExampleList lines={step!.example} />}
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
