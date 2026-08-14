import type { RepoInfo, CommandResult, CommitGraphData } from "../lib/gitCommands";
import type { ActionDetails, ActionKind } from "../lib/explain";
import type { UndoAction } from "../lib/undo";

// the primitives almost every feature hook needs: the open repo, how to mark a command
// in-flight, how to translate+record a result, and how to refresh the whole repo view
// afterward. Built once in App.tsx and passed into each hook - not every hook uses every
// field, but passing one shared bag keeps every hook's signature the same shape.
export interface CoreActions {
  repo: RepoInfo | null;
  setBusy: (name: string | null) => void;
  applyResult: (kind: ActionKind, result: CommandResult) => ActionDetails;
  refresh: (path: string) => Promise<CommitGraphData>;
  pulseHead: (g: CommitGraphData) => void;
  recordUndo: (action: UndoAction | null) => void;
  setLastAction: (details: ActionDetails | null) => void;
}
