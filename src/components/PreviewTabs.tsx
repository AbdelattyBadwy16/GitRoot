import { useState } from "react";

interface PreviewTabsProps {
  commitsContent: React.ReactNode;
  filesContent: React.ReactNode;
  filesCount: number;
}

type PreviewTab = "commits" | "files";

export default function PreviewTabs({ commitsContent, filesContent, filesCount }: PreviewTabsProps) {
  const [active, setActive] = useState<PreviewTab>("commits");

  const tabs: { key: PreviewTab; label: string }[] = [
    { key: "commits", label: "commits" },
    { key: "files", label: `files${filesCount > 0 ? ` (${filesCount})` : ""}` },
  ];

  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "inline-flex", gap: 2, padding: 2, borderRadius: 8, background: "var(--surface-2)", marginBottom: 10 }}>
        {tabs.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              style={{
                padding: "4px 12px",
                // no layoutId/shared-element animation here on purpose - this pill gets
                // mounted and unmounted fresh across ResetDialog's warning/picker/confirmDiscard
                // steps (they're separate conditional branches, not the same instance), and a
                // layoutId shared across two elements outside a LayoutGroup/AnimatePresence
                // boundary can get stuck mid-projection, leaving the dialog's fixed-position
                // overlay in the DOM eating clicks after the dialog is "closed" - looks exactly
                // like the whole app freezing
                background: isActive ? "color-mix(in srgb, white 14%, var(--surface-2))" : "none",
                border: isActive ? "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)" : "1px solid transparent",
                boxShadow: isActive ? "var(--shadow-sm)" : "none",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: 11.5,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                borderRadius: 6,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {active === "commits" ? commitsContent : filesContent}
    </div>
  );
}
