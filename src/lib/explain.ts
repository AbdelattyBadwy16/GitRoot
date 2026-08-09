import dictionary from "./dictionary.json";
import type { CommandResult } from "./gitCommands";

type DictEntry = {
  meaning: string;
  result: string;
  resultZero?: string;
  resultFastForward?: string;
  steps?: string[];
  stepsZero?: string[];
  stepsFastForward?: string[];
  authError?: string;
  networkError?: string;
  confirmText?: string;
  conflictPaused?: string;
  // merge/rebase-only: pre-flight preview and progress wording (see mergePreviewText, rebase*Text below)
  risky?: boolean;
  fastForward?: string;
  clean?: string;
  wouldConflict?: string;
  alreadyPushedWarning?: string;
  plan?: string;
  progress?: string;
};

const dict = dictionary as unknown as Record<string, DictEntry>;

// the four command-bar buttons; CommandBar's dispatch table is keyed on exactly these
export type CommandName = "pull" | "push" | "stash" | "commit";

// every action that goes through this dictionary
export type ActionKind = CommandName | "switchBranch" | "createBranch" | "revert" | "undo" | "merge" | "rebase";

// the numeric field each action's `{n}` template counts, when it has one
const COUNT_FIELD: Partial<Record<ActionKind, string>> = {
  pull: "commits",
  push: "commits",
  stash: "files",
  commit: "files",
  revert: "commits",
  merge: "commits",
  rebase: "commits",
};

// small standalone template filler for the merge/rebase preview helpers below, which don't have
// a CommandResult.data to pull from yet - fillTemplate (below) stays the one used post-execution
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

// how many commits/files this action's `{n}` refers to - also what ActionDiagram animates
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
    // paused, not failed - merge/rebase stopped with unmerged paths; see ConflictDialog
    const template = entry.conflictPaused ?? "git paused here — resolve the conflicting files, then continue.";
    return fillTemplate(template, 0, result.data).replaceAll("{files}", filesList(result.data));
  }
  if (!result.success) {
    // not auth/network - surface git's own message instead of a made-up one
    return result.rawStderr?.trim() || "that command didn't succeed.";
  }
  const n = countFor(kind, result);
  if (result.data.fastForward === true && entry.resultFastForward) {
    return fillTemplate(entry.resultFastForward, n, result.data);
  }
  const template = n === 0 && entry.resultZero ? entry.resultZero : entry.result;
  return fillTemplate(template, n, result.data);
}

// the step-by-step breakdown; empty on failure since git commands here don't partially apply
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
  // the numbered "what actually happened" breakdown; see stepsFor
  steps: string[];
  // the `{n}` this action's steps/result refer to; what ActionDiagram animates
  count: number;
  before: string | null;
  after: string | null;
  isError: boolean;
  // same names {remote}/{branch}/{from}/{target} resolve to in the text above
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

// the full breakdown the details column shows - the single source of truth for all of it
export function explainDetails(kind: ActionKind, result: CommandResult): ActionDetails {
  return {
    kind,
    command: result.command,
    // meaning can carry the same {branch}/{target}/{from} placeholders result/steps do (e.g.
    // merge's "combines {target}'s history into {branch}.") - fill it the same way, or it shows
    // the literal placeholder text instead of the real branch names
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

// confirm-before-running text for reverting to an earlier commit
export function revertConfirmText(n: number, target: string): string {
  const entry = dict.revert;
  const template = entry.confirmText ?? "this can't be undone through the app. continue?";
  return fillTemplate(template, n, { target });
}

// merge's three possible outcomes, straight from `git merge-tree` - shown in the confirm step
// before the real merge runs (see DESIGN.md 2.6)
export function mergePreviewText(outcome: "fastForward" | "clean" | "conflict", commits: number, branch: string, target: string, files: string[]): string {
  const entry = dict.merge;
  const s = commits === 1 ? "" : "s";
  if (outcome === "fastForward") return fill(entry.fastForward ?? "", { branch, target, n: commits, s });
  if (outcome === "clean") return fill(entry.clean ?? "", { branch, target, n: commits, s });
  return fill(entry.wouldConflict ?? "", { branch, target, files: files.join(", ") });
}

// the strong warning shown when any commit about to be rebased already exists on the remote -
// has to be confirmed before the plan preview even shows (see DESIGN.md 2.6)
export function rebaseAlreadyPushedWarning(): string {
  return dict.rebase.alreadyPushedWarning ?? "some of these commits are already on your remote. continue?";
}

// "this will replay N commits from X onto Y..." - shown after the already-pushed check clears
export function rebasePlanText(commits: number, branch: string, target: string): string {
  const s = commits === 1 ? "" : "s";
  return fill(dict.rebase.plan ?? "", { n: commits, s, branch, target });
}

// "resolving commit 2 of 4..." - polled live while a rebase runs or sits paused on a conflict
export function rebaseProgressText(current: number, total: number): string {
  return fill(dict.rebase.progress ?? "", { current, total });
}
