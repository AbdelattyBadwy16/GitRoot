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

// finds the real element for the current step and tracks its position - re-measured after tab switches settle
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
  padding: "8px 16px",
  borderRadius: 8,
  border: "none",
  background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
  color: "#fff",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

const SECONDARY_BTN: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "none",
  color: "var(--text-secondary)",
  fontSize: 13,
  cursor: "pointer",
};

const SKIP_BTN: CSSProperties = {
  padding: "8px 4px",
  border: "none",
  background: "none",
  color: "var(--text-muted)",
  fontSize: 12,
  cursor: "pointer",
  textDecoration: "underline",
};

// spotlight + card walkthrough shown on first launch, or replayed anytime from the header - each step points at a real element via its data-tour attribute
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

  const cardWidth = 300;
  let cardStyle: CSSProperties = { position: "fixed", left: "50%", top: "50%", transform: "translate(-50%, -50%)" };
  if (highlighted) {
    const spaceBelow = window.innerHeight - (highlighted.top + highlighted.height);
    const top = spaceBelow > 190 ? highlighted.top + highlighted.height + 14 : Math.max(14, highlighted.top - 14 - 170);
    const left = Math.min(Math.max(14, highlighted.left), window.innerWidth - cardWidth - 14);
    cardStyle = { position: "fixed", top, left };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999 }}>
      {/* blocks every real click while touring - only the card's own buttons are reachable */}
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
            borderRadius: 14,
            border: "1px solid var(--border)",
            background: "var(--surface-1)",
            boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
            padding: 18,
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
              <div style={{ display: "flex", gap: 4, marginBottom: 10 }}>
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
              <div style={{ fontSize: 14.5, fontWeight: 700, marginBottom: 6 }}>{step!.title}</div>
              <p style={{ margin: "0 0 16px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>{step!.body}</p>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
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
