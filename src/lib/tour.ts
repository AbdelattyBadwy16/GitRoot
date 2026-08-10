export interface TourStep {
  id: string;
  tab?: "graph" | "commit" | "branches";
  title: string;
  body: string;
  example?: string[];
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "graph",
    tab: "graph",
    title: "your history",
    body: "every commit becomes a node here, connected to its parents. hover one to trace its whole thread of ancestors and descendants. click an earlier commit to safely undo back to it — GitRoot only offers moves it can explain.",
    example: [
      "say your branch has 5 commits, newest at the top.",
      "you click the 2nd-oldest one.",
      "GitRoot shows exactly what would be undone before it touches anything.",
      "confirm, and only then does it run.",
    ],
  },
  {
    id: "tab-bar",
    tab: "graph",
    title: "getting around",
    body: "three tabs: history (this graph), commit (staging your changes), and branches (switching, creating, merging, rebasing).",
  },
  {
    id: "command-pull",
    tab: "graph",
    title: "pull — get their changes",
    body: "downloads new commits from the remote and merges them into your branch.",
    example: [
      "your teammate pushed 3 commits to origin/main that you don't have yet.",
      "you click pull.",
      "GitRoot fetches them and merges them in.",
      "the panel says \"pulled 3 commits from origin/main.\"",
    ],
  },
  {
    id: "command-push",
    tab: "graph",
    title: "push — send yours",
    body: "uploads your commits so the remote matches your branch.",
    example: [
      "you made 2 commits locally that origin doesn't have yet.",
      "you click push.",
      "GitRoot uploads them.",
      "the panel says \"pushed 2 commits to origin/main.\"",
    ],
  },
  {
    id: "command-stash",
    tab: "graph",
    title: "stash — set changes aside",
    body: "sets your uncommitted changes aside so your working directory is clean, without committing anything half-finished.",
    example: [
      "you're mid-edit on a file but need to switch branches right now.",
      "click stash — the changes are tucked away, working directory is clean.",
      "switch branches freely, do whatever you need.",
      "come back and click \"stash pop\" to bring them back exactly as they were.",
    ],
  },
  {
    id: "undo-button",
    title: "you can always undo",
    body: "after most actions, an undo button appears in the header for a while. it reverses exactly what just happened — nothing more.",
    example: [
      "pulled by mistake? undo moves your branch back to before the pull.",
      "pushed something you shouldn't have? undo reverts it with a new commit, safe even though it already reached the remote.",
      "every undo explains what it's about to do before it runs.",
    ],
  },
  {
    id: "commit-button",
    tab: "graph",
    title: "committing",
    body: "opens the staging view, where you choose exactly what goes into your next commit.",
  },
  {
    id: "staging",
    tab: "commit",
    title: "staging changes",
    body: "check a box to stage a whole file, or click it open to stage just a few lines — down to the line, not just the file.",
    example: [
      "you edited login.tsx and styles.css, but only login.tsx is ready.",
      "check just login.tsx's box.",
      "type a message describing the change, click commit.",
      "a new commit appears on the graph — styles.css stays unstaged for later.",
    ],
  },
  {
    id: "branches-tab",
    tab: "branches",
    title: "branches",
    body: "every local branch, one click to switch, or create a new one from any starting point.",
    example: [
      "you want to try something risky without touching main.",
      "type a name, pick main as the starting point, click create & switch.",
      "you're now on the new branch — commit freely, main stays untouched.",
    ],
  },
  {
    id: "merge-picker",
    tab: "branches",
    title: "merge — combine a branch in",
    body: "pick a branch to combine into the one you're on. GitRoot checks in advance what will happen, before anything runs.",
    example: [
      "you're on main, feature-login has 3 commits main doesn't have.",
      "pick feature-login, click merge — GitRoot previews the outcome first:",
      "• fast-forward — main has no commits of its own, so it just moves forward, no new merge commit.",
      "• clean — both sides changed, but nothing overlaps, so it combines automatically.",
      "• would conflict — it names the exact files, so you know before you commit to it.",
      "confirm what you see, and it runs for real.",
    ],
  },
  {
    id: "rebase-picker",
    tab: "branches",
    title: "rebase — replay onto a new base",
    body: "replays your branch's own commits on top of another branch, one at a time, each getting a new commit hash.",
    example: [
      "your branch has 2 commits, main moved on since you started.",
      "pick main, click rebase.",
      "if any of your commits are already pushed, GitRoot warns you first — rewriting pushed history can cause real problems for anyone who already pulled it.",
      "confirm the warning only if you understand the risk, then see the plan: \"replay 2 commits from your-branch onto main.\"",
      "it replays them one at a time, showing \"resolving commit 1 of 2.\"",
    ],
  },
  {
    id: "concept-conflict",
    tab: "branches",
    title: "if something conflicts",
    body: "merge and rebase both pause the exact same way when git can't combine something automatically.",
    example: [
      "GitRoot shows exactly which files conflict.",
      "open them in your editor, resolve the conflict markers, save.",
      "continue lights up once every file is resolved.",
      "changed your mind? abort is always one click away — it puts everything back exactly like before you started.",
    ],
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
  {
    id: "account-switcher",
    title: "switching identities",
    body: "save a few name/email profiles (with a GitHub avatar if you like) and switch between them here — handy if you use one machine for work and personal projects.",
    example: [
      "add a profile for each identity you use.",
      "click one to switch — every commit from now on uses that name and email.",
      "this only changes what your commits say, it never touches your push or pull credentials.",
    ],
  },
];
