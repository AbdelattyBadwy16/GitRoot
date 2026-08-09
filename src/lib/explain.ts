import dictionary from "./dictionary.json";
import type { CommandResult } from "./gitCommands";

type DictEntry = {
  meaning: string;
  result: string;
  resultZero?: string;
  steps?: string[];
  stepsZero?: string[];
  authError?: string;
  networkError?: string;
  confirmText?: string;
};

const dict = dictionary as unknown as Record<string, DictEntry>;

// the four command-bar buttons; CommandBar's dispatch table is keyed on exactly these
export type CommandName = "pull" | "push" | "stash" | "commit";

// every action that goes through this dictionary
export type ActionKind = CommandName | "switchBranch" | "createBranch" | "revert" | "undo";

// the numeric field each action's `{n}` template counts, when it has one
const COUNT_FIELD: Partial<Record<ActionKind, string>> = {
  pull: "commits",
  push: "commits",
  stash: "files",
  commit: "files",
  revert: "commits",
};

function fillTemplate(template: string, n: number, data: Record<string, unknown>): string {
  return template
    .replaceAll("{n}", String(n))
    .replaceAll("{s}", n === 1 ? "" : "s")
    .replaceAll("{remote}", String(data.remote ?? "the remote"))
    .replaceAll("{branch}", String(data.branch ?? "the current branch"))
    .replaceAll("{from}", String(data.from ?? "its starting point"))
    .replaceAll("{target}", String(data.target ?? "the chosen commit"));
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
  if (!result.success) {
    // not auth/network - surface git's own message instead of a made-up one
    return result.rawStderr?.trim() || "that command didn't succeed.";
  }
  const n = countFor(kind, result);
  const template = n === 0 && entry.resultZero ? entry.resultZero : entry.result;
  return fillTemplate(template, n, result.data);
}

// the step-by-step breakdown; empty on failure since git commands here don't partially apply
function stepsFor(kind: ActionKind, result: CommandResult): string[] {
  if (!result.success) return [];
  const entry = dict[kind];
  const n = countFor(kind, result);
  const template = n === 0 && entry.stepsZero ? entry.stepsZero : entry.steps;
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
    meaning: dict[kind].meaning,
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
