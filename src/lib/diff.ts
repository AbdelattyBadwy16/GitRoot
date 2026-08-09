export interface DiffLine {
  kind: "add" | "remove" | "hunk" | "context";
  text: string;
}

export function parseDiff(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const line of raw.split("\n")) {
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("new file mode") ||
      line.startsWith("deleted file mode") ||
      line.startsWith("+++") ||
      line.startsWith("---")
    ) {
      continue;
    }
    if (line.startsWith("@@")) {
      lines.push({ kind: "hunk", text: line });
    } else if (line.startsWith("+")) {
      lines.push({ kind: "add", text: line.slice(1) });
    } else if (line.startsWith("-")) {
      lines.push({ kind: "remove", text: line.slice(1) });
    } else if (line.length > 0) {
      lines.push({ kind: "context", text: line.startsWith(" ") ? line.slice(1) : line });
    }
  }
  return lines;
}

export const DIFF_ROW_STYLES: Record<DiffLine["kind"], { background?: string; color: string }> = {
  add: { background: "color-mix(in srgb, var(--lane-3) 14%, transparent)", color: "var(--text-primary)" },
  remove: { background: "color-mix(in srgb, var(--lane-8) 14%, transparent)", color: "var(--text-primary)" },
  hunk: { color: "var(--text-muted)", background: "var(--surface-2)" },
  context: { color: "var(--text-secondary)" },
};

export const DIFF_PREFIX: Record<DiffLine["kind"], string> = {
  add: "+",
  remove: "−",
  hunk: "⋯",
  context: " ",
};
