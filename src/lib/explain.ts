import dictionary from "./dictionary.json";
import type { CommandResult } from "./gitCommands";

type DictEntry = {
  meaning: string;
  result?: string;
  resultZero?: string;
  resultFastForward?: string;
  steps?: string[];
  stepsZero?: string[];
  stepsFastForward?: string[];
  authError?: string;
  networkError?: string;
  confirmText?: string;
  conflictPaused?: string;
  risky?: boolean;
  fastForward?: string;
  clean?: string;
  wouldConflict?: string;
  alreadyPushedWarning?: string;
  plan?: string;
  progress?: string;
  soft?: string;
  mixed?: string;
  hard?: string;
  modeSoft?: string;
  modeMixed?: string;
  modeHard?: string;
  confirmDiscard?: string;
};

const dict = dictionary as unknown as Record<string, DictEntry>;

export type CommandName = "pull" | "push" | "stash" | "commit";

export type ActionKind = CommandName | "switchBranch" | "createBranch" | "revert" | "undo" | "merge" | "rebase" | "reset";

export type ResetMode = "soft" | "mixed" | "hard";

const COUNT_FIELD: Partial<Record<ActionKind, string>> = {
  pull: "commits",
  push: "commits",
  stash: "files",
  commit: "files",
  revert: "commits",
  merge: "commits",
  rebase: "commits",
  reset: "commits",
};

function fill(template: string, vars: Record<string, string | number>): string {
  return Object.entries(vars).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), template);
}

function fillTemplate(template: string, n: number, data: Record<string, unknown>): string {
  return template
    .replaceAll("{n}", String(n))
    .replaceAll("{s}", n === 1 ? "" : "s")
    .replaceAll("{remote}", String(data.remote ?? "the remote"))
    .replaceAll("{branch}", String(data.branch ?? "the current branch"))
    .replaceAll("{from}", String(data.from ?? "its starting point"))
    .replaceAll("{target}", String(data.target ?? "the chosen commit"));
}

function filesList(data: Record<string, unknown>): string {
  const files = data.files;
  return Array.isArray(files) ? files.join(", ") : "some files";
}

function countFor(kind: ActionKind, result: CommandResult): number {
  const field = COUNT_FIELD[kind];
  return field ? Number(result.data[field] ?? 0) : 0;
}

function resultText(kind: ActionKind, result: CommandResult): string {
  const entry = dict[kind];
  if (result.authError) return fillTemplate(entry.authError ?? "you're not logged in to reach this remote.", 0, result.data);
  if (result.networkError) {
    return fillTemplate(entry.networkError ?? "couldn't reach {remote} — check your network or VPN connection.", 0, result.data);
  }
  if (result.conflict) {
    const template = entry.conflictPaused ?? "git paused here — resolve the conflicting files, then continue.";
    return fillTemplate(template, 0, result.data).replaceAll("{files}", filesList(result.data));
  }
  if (!result.success) {
    return result.rawStderr?.trim() || "that command didn't succeed.";
  }
  const n = countFor(kind, result);
  if (kind === "reset" && typeof result.data.mode === "string") {
    const modeText = entry[result.data.mode as ResetMode];
    if (modeText) return fillTemplate(modeText, n, result.data);
  }
  if (result.data.fastForward === true && entry.resultFastForward) {
    return fillTemplate(entry.resultFastForward, n, result.data);
  }
  const template = (n === 0 && entry.resultZero ? entry.resultZero : entry.result) ?? "done.";
  return fillTemplate(template, n, result.data);
}

function stepsFor(kind: ActionKind, result: CommandResult): string[] {
  if (!result.success) return [];
  const entry = dict[kind];
  const n = countFor(kind, result);
  const template = n === 0 && entry.stepsZero ? entry.stepsZero : result.data.fastForward === true && entry.stepsFastForward ? entry.stepsFastForward : entry.steps;
  return (template ?? []).map((s) => fillTemplate(s, n, result.data));
}

export interface ActionDetails {
  kind: ActionKind;
  command: string;
  meaning: string;
  result: string;
  steps: string[];
  count: number;
  before: string | null;
  after: string | null;
  isError: boolean;
  labels: { remote: string; branch: string; from: string; target: string };
}

function labelsFor(data: Record<string, unknown>): ActionDetails["labels"] {
  return {
    remote: String(data.remote ?? "the remote"),
    branch: String(data.branch ?? "the current branch"),
    from: String(data.from ?? "its starting point"),
    target: String(data.target ?? "the chosen commit"),
  };
}

export function explainDetails(kind: ActionKind, result: CommandResult): ActionDetails {
  return {
    kind,
    command: result.command,
    // important: must fill the template here too, or text like {branch} show up as it is
    meaning: fillTemplate(dict[kind].meaning, countFor(kind, result), result.data),
    result: resultText(kind, result),
    steps: stepsFor(kind, result),
    count: countFor(kind, result),
    before: typeof result.data.before === "string" ? result.data.before : null,
    after: typeof result.data.after === "string" ? result.data.after : null,
    isError: !result.success,
    labels: labelsFor(result.data),
  };
}

export function revertConfirmText(n: number, target: string): string {
  const entry = dict.revert;
  const template = entry.confirmText ?? "this can't be undone through the app. continue?";
  return fillTemplate(template, n, { target });
}

export function mergePreviewText(outcome: "fastForward" | "clean" | "conflict", commits: number, branch: string, target: string, files: string[]): string {
  const entry = dict.merge;
  const s = commits === 1 ? "" : "s";
  if (outcome === "fastForward") return fill(entry.fastForward ?? "", { branch, target, n: commits, s });
  if (outcome === "clean") return fill(entry.clean ?? "", { branch, target, n: commits, s });
  return fill(entry.wouldConflict ?? "", { branch, target, files: files.join(", ") });
}

export function rebaseAlreadyPushedWarning(): string {
  return dict.rebase.alreadyPushedWarning ?? "some of these commits are already on your remote. continue?";
}

export function rebasePlanText(commits: number, branch: string, target: string): string {
  const s = commits === 1 ? "" : "s";
  return fill(dict.rebase.plan ?? "", { n: commits, s, branch, target });
}

export function rebaseProgressText(current: number, total: number): string {
  return fill(dict.rebase.progress ?? "", { current, total });
}

export function resetModeInlineText(mode: ResetMode): string {
  const entry = dict.reset;
  return (mode === "soft" ? entry.modeSoft : mode === "mixed" ? entry.modeMixed : entry.modeHard) ?? "";
}

export function resetAlreadyPushedWarning(): string {
  return dict.reset.alreadyPushedWarning ?? "some of these commits are already on your remote. continue?";
}

export function resetDiscardConfirmText(n: number, hasUncommittedChanges: boolean): string {
  const s = n === 1 ? "" : "s";
  const base = fill(dict.reset.confirmDiscard ?? "", { n, s });
  return hasUncommittedChanges ? `${base} this also throws away the uncommitted changes you have right now.` : base;
}
