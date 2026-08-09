export interface TourStep {
  id: string;
  tab?: "graph" | "commit" | "branches";
  title: string;
  body: string;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "graph",
    tab: "graph",
    title: "your history",
    body: "every commit, drawn as a growing root. hover one to trace its whole story, and click an earlier one to safely undo back to it.",
  },
  {
    id: "command-bar",
    tab: "graph",
    title: "the everyday commands",
    body: "pull, push, and stash — one click each. GitRoot runs the real git command and shows you exactly what happened.",
  },
  {
    id: "commit-button",
    tab: "graph",
    title: "committing",
    body: "review what changed and save the parts you want as a new point in history.",
  },
  {
    id: "tab-bar",
    tab: "graph",
    title: "getting around",
    body: "switch between your history, staging changes, and branches.",
  },
  {
    id: "staging",
    tab: "commit",
    title: "staging changes",
    body: "check a box to stage a whole file, or click it open to stage just a few lines — down to the line, not just the file.",
  },
  {
    id: "branches-tab",
    tab: "branches",
    title: "branches",
    body: "every branch you have, one click to switch, or create a new one from any starting point.",
  },
  {
    id: "learning-mode",
    tab: "graph",
    title: "learning mode",
    body: "flip this on and every command explains itself as it runs — what it means, what happened step by step, before and after.",
  },
  {
    id: "branch-status",
    tab: "graph",
    title: "always know where you stand",
    body: "ahead or behind your remote, clean or not — visible from any tab, no need to go looking for it.",
  },
];
