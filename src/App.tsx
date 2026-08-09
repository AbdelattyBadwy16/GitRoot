import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CommitGraph from "./components/CommitGraph";
import StagingList from "./components/StagingList";
import CommandBar from "./components/CommandBar";
import DetailsPanel from "./components/DetailsPanel";
import BranchesTab from "./components/BranchesTab";
import HunkEditor from "./components/HunkEditor";
import ConfirmDialog from "./components/ConfirmDialog";
import GitIdentityPrompt from "./components/GitIdentityPrompt";
import TourOverlay from "./components/TourOverlay";
import WelcomeTourPrompt from "./components/WelcomeTourPrompt";
import Logo from "./components/Logo";
import RootArt from "./components/RootArt";
import { TOUR_STEPS } from "./lib/tour";
import {
  openRepo,
  initRepo,
  cloneRepo,
  pull,
  push,
  stash,
  stashPop,
  commit as commitFn,
  uncommitTo,
  hardResetTo,
  getStatus,
  stageFile,
  unstageFile,
  getCommitGraph,
  getRepoFingerprint,
  listBranches,
  switchBranch,
  createBranch,
  undoCreateBranch,
  revertToCommit,
  pickFolder,
  checkGitAvailable,
  checkGitIdentity,
  openExternal,
  type RepoInfo,
  type FileStatus,
  type CommitGraphData,
  type BranchInfo,
  type CommandResult,
  type GitIdentity,
} from "./lib/gitCommands";
import { explainDetails, revertConfirmText, type ActionDetails, type ActionKind, type CommandName } from "./lib/explain";
import { isHead } from "./lib/graph";

const EMPTY_GRAPH: CommitGraphData = { commits: [], edges: [], laneCount: 0, hasMore: false };
// how many commits the graph loads at a time, so a huge repo doesn't freeze the window on open
const GRAPH_PAGE_SIZE = 30;

type Tab = "graph" | "commit" | "branches";

// everything needed to reverse whatever the last successful action did
type UndoAction =
  | { kind: "pull"; targetHash: string }
  | { kind: "push"; targetHash: string }
  | { kind: "stash" }
  | { kind: "commit"; targetHash: string }
  | { kind: "switchBranch"; targetBranch: string }
  | { kind: "createBranch"; name: string; startPoint: string }
  | { kind: "revert"; targetHash: string };

const UNDO_LABEL: Record<UndoAction["kind"], string> = {
  pull: "undo pull",
  push: "undo push",
  stash: "undo stash",
  commit: "undo commit",
  switchBranch: "undo switch",
  createBranch: "undo new branch",
  revert: "undo revert",
};

function undoConfirmText(action: UndoAction): string {
  switch (action.kind) {
    case "pull":
      return "moves your branch back to before the pull. only works if your working directory is clean right now.";
    case "push":
      return "reverts the commits you just pushed and pushes that revert — nothing is deleted from history, and this is safe even though it already reached the remote.";
    case "stash":
      return "brings back the changes you just stashed.";
    case "commit":
      return "undoes the commit but keeps every change staged, ready to commit again.";
    case "switchBranch":
      return `switches back to ${action.targetBranch}.`;
    case "createBranch":
      return `deletes ${action.name} and switches back to ${action.startPoint}. only works if you haven't committed anything on it yet.`;
    case "revert":
      return "undoes the revert and keeps the changes staged, ready to commit again.";
  }
}

// figures out how to undo whatever action just succeeded, or null when there's nothing safe to offer
function computeUndo(kind: ActionKind, result: CommandResult): UndoAction | null {
  const data = result.data;
  switch (kind) {
    case "pull":
      return Number(data.commits ?? 0) > 0 && typeof data.before === "string" ? { kind: "pull", targetHash: data.before } : null;
    case "push":
      return data.hadUpstream === true && Number(data.commits ?? 0) > 0 && typeof data.before === "string"
        ? { kind: "push", targetHash: data.before }
        : null;
    case "stash":
      return Number(data.files ?? 0) > 0 ? { kind: "stash" } : null;
    case "commit":
      return typeof data.beforeHead === "string" ? { kind: "commit", targetHash: data.beforeHead } : null;
    case "switchBranch":
      return typeof data.before === "string" && data.before !== data.after ? { kind: "switchBranch", targetBranch: data.before } : null;
    case "createBranch":
      return typeof data.branch === "string" && typeof data.from === "string" ? { kind: "createBranch", name: data.branch, startPoint: data.from } : null;
    case "revert":
      return typeof data.before === "string" ? { kind: "revert", targetHash: data.before } : null;
    default:
      return null;
  }
}

const LEARNING_MODE_KEY = "gitroot:learningMode";
// set the first time a repo is ever opened, so the welcome tour prompt only ever appears once
const TOUR_OFFERED_KEY = "gitroot:tourOffered";

function loadLearningMode(): boolean {
  const stored = localStorage.getItem(LEARNING_MODE_KEY);
  // defaults on - explaining commands is the whole point of this app
  return stored === null ? true : stored === "true";
}

export default function App() {
  const [repo, setRepo] = useState<RepoInfo | null>(null);
  const [graph, setGraph] = useState<CommitGraphData>(EMPTY_GRAPH);
  const [graphLimit, setGraphLimit] = useState(GRAPH_PAGE_SIZE);
  const [loadingMoreGraph, setLoadingMoreGraph] = useState(false);
  const [files, setFiles] = useState<FileStatus[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("graph");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [pulseHash, setPulseHash] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<ActionDetails | null>(null);
  const [learningMode, setLearningMode] = useState(loadLearningMode);
  const [branches, setBranches] = useState<BranchInfo[]>([]);
  const [revertTarget, setRevertTarget] = useState<{ hash: string; commitsAfter: number } | null>(null);
  const [hunkEditorFile, setHunkEditorFile] = useState<string | null>(null);
  const [lastUndo, setLastUndo] = useState<UndoAction | null>(null);
  const [undoConfirming, setUndoConfirming] = useState(false);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [gitIdentity, setGitIdentity] = useState<GitIdentity | null>(null);
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);

  // checked once at startup - nothing else works until this is true
  useEffect(() => {
    checkGitAvailable()
      .then((info) => setGitAvailable(info.available))
      .catch(() => setGitAvailable(false));
  }, []);

  useEffect(() => {
    localStorage.setItem(LEARNING_MODE_KEY, String(learningMode));
  }, [learningMode]);

  // leaving the commit tab shouldn't leave the hunk editor silently open underneath
  useEffect(() => {
    if (activeTab !== "commit") setHunkEditorFile(null);
  }, [activeTab]);

  // landing page state
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [pathInput, setPathInput] = useState("");
  // set when the chosen folder is valid but not a git repo yet - offers to init it right there
  const [notGitFolderPath, setNotGitFolderPath] = useState<string | null>(null);
  const [initRemoteUrl, setInitRemoteUrl] = useState("");
  const [showCloneInput, setShowCloneInput] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);

  // limit defaults to the current page - pull/push/commit just want to refresh what's showing, not reset to page 1
  async function refresh(path: string, limit: number = graphLimit): Promise<CommitGraphData> {
    const [g, s, b] = await Promise.all([getCommitGraph(path, limit), getStatus(path), listBranches(path)]);
    setGraph(g);
    setFiles(s);
    setBranches(b);
    // keeps the header's branch pill honest even if the branch changed outside this app
    const current = b.find((x) => x.isCurrent)?.name;
    if (current) {
      setRepo((r) => (r && r.path === path && r.currentBranch !== current ? { ...r, currentBranch: current } : r));
    }
    return g;
  }

  async function loadMoreGraph() {
    if (!repo || loadingMoreGraph || !graph.hasMore) return;
    setLoadingMoreGraph(true);
    const newLimit = graphLimit + GRAPH_PAGE_SIZE;
    try {
      const g = await getCommitGraph(repo.path, newLimit);
      setGraph(g);
      setGraphLimit(newLimit);
    } finally {
      setLoadingMoreGraph(false);
    }
  }

  // kept in refs so the polling interval below always sees the latest busy/refresh without restarting its timer
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  // auto-refresh: polls a cheap fingerprint (see repo_fingerprint_sync) to catch changes made outside the app
  useEffect(() => {
    if (!repo) return;
    let lastFingerprint: string | null = null;
    const path = repo.path;

    const tick = async () => {
      let fp: string;
      try {
        fp = await getRepoFingerprint(path);
      } catch {
        return; // repo momentarily unreadable (e.g. mid-git-operation); next tick retries
      }
      if (lastFingerprint === null) {
        lastFingerprint = fp;
        return;
      }
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        // skip while a command is actively running - its own completion already refreshes
        if (busyRef.current === null) await refreshRef.current(path);
      }
    };

    const interval = window.setInterval(tick, 1500);
    return () => window.clearInterval(interval);
  }, [repo]);

  // briefly spotlights the current HEAD after an action that could have moved it
  function pulseHead(g: CommitGraphData) {
    const head = g.commits.find(isHead);
    if (!head) return;
    setPulseHash(head.hash);
    window.setTimeout(() => setPulseHash((cur) => (cur === head.hash ? null : cur)), 2600);
  }

  // feeds the details column - see explain.ts for the full breakdown it computes
  function applyResult(kind: ActionKind, result: CommandResult) {
    const details = explainDetails(kind, result);
    setLastAction(details);
    return details;
  }

  // shared tail for every way a repo can become "the open one": picked, init'd, or cloned
  async function finishOpening(info: RepoInfo) {
    setRepo(info);
    setGraphLimit(GRAPH_PAGE_SIZE);
    setActiveTab("graph");
    setHunkEditorFile(null);
    setLastUndo(null);
    await refresh(info.path, GRAPH_PAGE_SIZE);
    checkGitIdentity(info.path)
      .then(setGitIdentity)
      .catch(() => setGitIdentity(null));
    if (localStorage.getItem(TOUR_OFFERED_KEY) === null) {
      localStorage.setItem(TOUR_OFFERED_KEY, "true");
      setShowTourPrompt(true);
    }
  }

  // moves the tour to a given step, switching tabs first if that step lives on a different one
  function tourGoTo(index: number) {
    if (index < 0) return;
    if (index < TOUR_STEPS.length && TOUR_STEPS[index].tab) setActiveTab(TOUR_STEPS[index].tab!);
    setTourStep(index);
  }

  async function openAt(path: string) {
    setOpenError(null);
    setNotGitFolderPath(null);
    setOpening(true);
    try {
      const info = await openRepo(path);
      await finishOpening(info);
    } catch (err) {
      const message = String(err);
      // matches Rust's exact wording for "valid folder, just not a git repo yet" (see open_repo_sync)
      if (message === "that folder isn't a git repository.") {
        setNotGitFolderPath(path);
      } else {
        setOpenError(message);
      }
    } finally {
      setOpening(false);
    }
  }

  async function handleBrowse() {
    const path = await pickFolder();
    if (path) await openAt(path);
  }

  async function handleInit() {
    if (!notGitFolderPath) return;
    setOpening(true);
    setOpenError(null);
    try {
      const info = await initRepo(notGitFolderPath, initRemoteUrl.trim() || null);
      setNotGitFolderPath(null);
      setInitRemoteUrl("");
      await finishOpening(info);
    } catch (err) {
      setOpenError(String(err));
    } finally {
      setOpening(false);
    }
  }

  // cloning needs a destination folder too, so this reuses the same native picker handleBrowse uses
  async function handleClone() {
    const url = cloneUrl.trim();
    if (!url) return;
    const destination = await pickFolder();
    if (!destination) return;
    setOpenError(null);
    setCloning(true);
    try {
      const info = await cloneRepo(url, destination);
      setShowCloneInput(false);
      setCloneUrl("");
      await finishOpening(info);
    } catch (err) {
      setOpenError(String(err));
    } finally {
      setCloning(false);
    }
  }

  async function runCommand(name: Exclude<CommandName, "commit">) {
    if (!repo) return;
    setBusy(name);
    try {
      const fn = { pull, push, stash }[name];
      const result = await fn(repo.path);
      const details = applyResult(name, result);
      if (!details.isError) setLastUndo(computeUndo(name, result));
      const g = await refresh(repo.path);
      if (!details.isError && name !== "stash") pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function toggleFile(file: FileStatus) {
    if (!repo) return;
    if (file.staged) {
      await unstageFile(repo.path, file.path);
    } else {
      await stageFile(repo.path, file.path);
    }
    const s = await getStatus(repo.path);
    setFiles(s);
  }

  async function handleCommit() {
    if (!repo) return;
    setBusy("commit");
    try {
      const result = await commitFn(repo.path, message);
      const details = applyResult("commit", result);
      if (!details.isError) {
        setMessage("");
        setActiveTab("graph");
        setLastUndo(computeUndo("commit", result));
      }
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleSwitchBranch(name: string) {
    if (!repo) return;
    setBusy("switchBranch");
    try {
      const result = await switchBranch(repo.path, name);
      const details = applyResult("switchBranch", result);
      if (!details.isError) setLastUndo(computeUndo("switchBranch", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleCreateBranch(name: string, startPoint: string) {
    if (!repo) return;
    setBusy("createBranch");
    try {
      const result = await createBranch(repo.path, name, startPoint);
      const details = applyResult("createBranch", result);
      if (!details.isError) setLastUndo(computeUndo("createBranch", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRevert() {
    if (!repo || !revertTarget) return;
    const target = revertTarget.hash;
    setBusy("revert");
    try {
      const result = await revertToCommit(repo.path, target);
      const details = applyResult("revert", result);
      if (!details.isError) setLastUndo(computeUndo("revert", result));
      setRevertTarget(null);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  // reverses whatever lastUndo describes; push is the one case that's two real git operations in sequence
  async function handleUndo() {
    if (!repo || !lastUndo) return;
    const action = lastUndo;
    setBusy("undo");
    try {
      let result: CommandResult;
      switch (action.kind) {
        case "pull":
          result = await hardResetTo(repo.path, action.targetHash);
          break;
        case "commit":
        case "revert":
          result = await uncommitTo(repo.path, action.targetHash);
          break;
        case "stash":
          result = await stashPop(repo.path);
          break;
        case "switchBranch":
          result = await switchBranch(repo.path, action.targetBranch);
          break;
        case "createBranch":
          result = await undoCreateBranch(repo.path, action.name, action.startPoint);
          break;
        case "push": {
          setLastUndo(null); // a partial failure here (revert ok, push not) isn't safe to blindly retry
          const revertResult = await revertToCommit(repo.path, action.targetHash);
          if (!revertResult.success) {
            result = revertResult;
            break;
          }
          const pushResult = await push(repo.path);
          result = { ...pushResult, command: `${revertResult.command} && ${pushResult.command}` };
          break;
        }
      }
      const details = applyResult("undo", result);
      if (!details.isError) setLastUndo(null);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  if (gitAvailable === null) return null;
  if (gitAvailable === false) {
    return (
      <GitMissingScreen
        onRetry={() => {
          setGitAvailable(null);
          checkGitAvailable()
            .then((info) => setGitAvailable(info.available))
            .catch(() => setGitAvailable(false));
        }}
      />
    );
  }

  if (!repo) {
    return <LandingPage
      opening={opening}
      openError={openError}
      showManualInput={showManualInput}
      pathInput={pathInput}
      onBrowse={handleBrowse}
      onToggleManualInput={() => setShowManualInput((v) => !v)}
      onPathInputChange={setPathInput}
      onManualOpen={() => openAt(pathInput.trim())}
      notGitFolderPath={notGitFolderPath}
      initRemoteUrl={initRemoteUrl}
      onInitRemoteUrlChange={setInitRemoteUrl}
      onInit={handleInit}
      onCancelInit={() => {
        setNotGitFolderPath(null);
        setInitRemoteUrl("");
      }}
      showCloneInput={showCloneInput}
      onToggleCloneInput={() => setShowCloneInput((v) => !v)}
      cloneUrl={cloneUrl}
      onCloneUrlChange={setCloneUrl}
      onClone={handleClone}
      cloning={cloning}
    />;
  }

  const currentBranchInfo = branches.find((b) => b.isCurrent) ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--surface-1)",
          boxShadow: "var(--shadow-sm)",
          position: "relative",
          zIndex: 1,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Logo size={26} glow />
          <div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <strong style={{ fontSize: 14 }}>{repo.name}</strong>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--lane-1)",
                  background: "color-mix(in srgb, var(--lane-1) 14%, var(--surface-1))",
                  border: "1px solid color-mix(in srgb, var(--lane-1) 40%, transparent)",
                  borderRadius: 999,
                  padding: "1px 8px",
                }}
              >
                {repo.currentBranch}
              </span>
              <BranchStatusBadge branch={currentBranchInfo} changedFiles={files.length} />
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <AnimatePresence>
            {lastUndo && (
              <motion.button
                key="undo"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => setUndoConfirming(true)}
                disabled={!!busy}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  background: "color-mix(in srgb, var(--lane-4) 12%, var(--surface-1))",
                  border: "1px solid color-mix(in srgb, var(--lane-4) 40%, transparent)",
                  borderRadius: 7,
                  padding: "5px 10px",
                  color: "var(--lane-4)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: busy ? "default" : "pointer",
                }}
              >
                <UndoIcon />
                {UNDO_LABEL[lastUndo.kind]}
              </motion.button>
            )}
          </AnimatePresence>
          <LearningModeToggle value={learningMode} onChange={setLearningMode} />
          <button
            onClick={() => tourGoTo(0)}
            title="take the tour"
            style={{
              width: 26,
              height: 26,
              borderRadius: "50%",
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-muted)",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            ?
          </button>
          <button
            onClick={() => setRepo(null)}
            style={{
              background: "none",
              border: "1px solid var(--border)",
              borderRadius: 7,
              padding: "5px 10px",
              color: "var(--text-muted)",
              fontSize: 12.5,
              cursor: "pointer",
            }}
          >
            switch repo
          </button>
        </div>
      </header>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <CommandBar
          onRun={runCommand}
          onOpenCommit={() => setActiveTab("commit")}
          commitOpen={activeTab === "commit"}
          busy={busy}
          learningMode={learningMode}
        />

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
          <TabBar active={activeTab} onChange={setActiveTab} />
          <div style={{ flex: 1, overflow: "auto" }}>
            {activeTab === "commit" && hunkEditorFile ? (
              <HunkEditor
                repoPath={repo.path}
                filePath={hunkEditorFile}
                onBack={() => setHunkEditorFile(null)}
                onChanged={() => getStatus(repo.path).then(setFiles)}
              />
            ) : activeTab === "commit" ? (
              <div data-tour="staging">
                {gitIdentity && (!gitIdentity.name || !gitIdentity.email) && (
                  <div style={{ padding: "20px 20px 0" }}>
                    <GitIdentityPrompt repoPath={repo.path} onSaved={() => checkGitIdentity(repo.path).then(setGitIdentity)} />
                  </div>
                )}
                <StagingList
                  files={files}
                  onToggle={toggleFile}
                  onOpenFile={(f) => setHunkEditorFile(f.path)}
                  message={message}
                  onMessageChange={setMessage}
                  onCommit={handleCommit}
                  busy={busy === "commit"}
                />
              </div>
            ) : activeTab === "branches" ? (
              <BranchesTab
                branches={branches}
                onSwitch={handleSwitchBranch}
                onCreate={handleCreateBranch}
                busy={busy === "switchBranch" || busy === "createBranch"}
              />
            ) : (
              <div data-tour="graph" style={{ padding: 20 }}>
                <CommitGraph
                  graph={graph}
                  pulseHash={pulseHash}
                  hasMore={graph.hasMore}
                  loadingMore={loadingMoreGraph}
                  onLoadMore={loadMoreGraph}
                  onRevertClick={(hash, commitsAfter) => setRevertTarget({ hash, commitsAfter })}
                />
              </div>
            )}
          </div>
        </div>

        {learningMode && <DetailsPanel details={lastAction} running={busy} />}
      </div>

      <AnimatePresence>
        {revertTarget && (
          <ConfirmDialog
            title="revert to this commit?"
            message={revertConfirmText(revertTarget.commitsAfter, revertTarget.hash.slice(0, 7))}
            confirmLabel={`revert ${revertTarget.commitsAfter} commit${revertTarget.commitsAfter === 1 ? "" : "s"}`}
            onConfirm={confirmRevert}
            onCancel={() => setRevertTarget(null)}
            busy={busy === "revert"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {undoConfirming && lastUndo && (
          <ConfirmDialog
            title="undo this?"
            message={undoConfirmText(lastUndo)}
            confirmLabel={UNDO_LABEL[lastUndo.kind]}
            onConfirm={() => {
              setUndoConfirming(false);
              handleUndo();
            }}
            onCancel={() => setUndoConfirming(false)}
            busy={busy === "undo"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showTourPrompt && (
          <WelcomeTourPrompt
            onStart={() => {
              setShowTourPrompt(false);
              tourGoTo(0);
            }}
            onSkip={() => setShowTourPrompt(false)}
          />
        )}
      </AnimatePresence>

      {tourStep !== null && (
        <TourOverlay
          stepIndex={tourStep}
          onNext={() => tourGoTo(tourStep + 1)}
          onBack={() => tourGoTo(tourStep - 1)}
          onSkip={() => setTourStep(null)}
          onFinish={() => setTourStep(null)}
        />
      )}
    </div>
  );
}

const TAB_LABELS: { key: Tab; label: string }[] = [
  { key: "graph", label: "graph" },
  { key: "commit", label: "commit" },
  { key: "branches", label: "branches" },
];

// segmented control where the active pill glides between tabs instead of popping to its new spot
function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  return (
    <div data-tour="tab-bar" style={{ padding: "14px 20px 10px" }}>
      <div style={{ display: "inline-flex", gap: 2, padding: 3, borderRadius: 11, background: "var(--surface-2)" }}>
        {TAB_LABELS.map((t) => {
          const isActive = active === t.key;
          return (
            <button
              key={t.key}
              onClick={() => onChange(t.key)}
              style={{
                position: "relative",
                padding: "6px 16px",
                border: "none",
                background: "none",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
                fontSize: 13,
                fontWeight: isActive ? 600 : 500,
                cursor: "pointer",
                borderRadius: 8,
                transition: "color 0.15s",
              }}
            >
              {isActive && (
                <motion.div
                  layoutId="tab-pill"
                  transition={{ type: "spring", stiffness: 500, damping: 34 }}
                  style={{
                    position: "absolute",
                    inset: 0,
                    borderRadius: 8,
                    // lightening the capsule's own color reads as "raised" in both themes; comparing surface tokens directly doesn't, since their order flips between light/dark
                    background: "color-mix(in srgb, white 14%, var(--surface-2))",
                    border: "1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)",
                    boxShadow: "var(--shadow-sm)",
                    zIndex: 0,
                  }}
                />
              )}
              <span style={{ position: "relative", zIndex: 1 }}>{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h10a5 5 0 0 1 0 10H8" />
      <path d="M7 5L3 10l4 5" />
    </svg>
  );
}

// always-visible summary of the branch's ahead/behind and clean/dirty state, lives in the header so it's visible on every tab
function BranchStatusBadge({ branch, changedFiles }: { branch: BranchInfo | null; changedFiles: number }) {
  if (!branch) return null;
  const clean = changedFiles === 0;

  return (
    <div data-tour="branch-status" style={{ display: "flex", alignItems: "center", gap: 6 }}>
      {branch.upstream ? (
        branch.ahead === 0 && branch.behind === 0 ? (
          <Chip label="up to date" title={`in sync with ${branch.upstream}`} />
        ) : (
          <>
            {branch.ahead > 0 && (
              <Chip
                label={`↑${branch.ahead}`}
                title={`${branch.ahead} commit${branch.ahead === 1 ? "" : "s"} not pushed to ${branch.upstream} yet`}
              />
            )}
            {branch.behind > 0 && (
              <Chip
                label={`↓${branch.behind}`}
                title={`${branch.behind} commit${branch.behind === 1 ? "" : "s"} on ${branch.upstream} you don't have yet — pull to catch up`}
              />
            )}
          </>
        )
      ) : (
        <Chip label="no upstream" title="this branch hasn't been pushed anywhere yet" muted />
      )}
      <Chip
        label={clean ? "clean" : `${changedFiles} uncommitted`}
        title={
          clean
            ? "working directory matches the last commit — nothing to commit"
            : `${changedFiles} file${changedFiles === 1 ? "" : "s"} changed since the last commit`
        }
        dotColor={clean ? "var(--lane-3)" : "var(--lane-2)"}
      />
    </div>
  );
}

function Chip({ label, title, muted, dotColor }: { label: string; title?: string; muted?: boolean; dotColor?: string }) {
  return (
    <span
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 10.5,
        fontWeight: 600,
        color: muted ? "var(--text-muted)" : "var(--text-secondary)",
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: 999,
        padding: "2px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {dotColor && <span style={{ width: 6, height: 6, borderRadius: "50%", background: dotColor, flexShrink: 0 }} />}
      {label}
    </span>
  );
}

// one switch that gates every "explain as you go" surface: the details column and the command hover hints
function LearningModeToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      data-tour="learning-mode"
      onClick={() => onChange(!value)}
      title={value ? "learning mode is on — click to turn off" : "learning mode is off — click to turn on"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "none",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      <span style={{ fontSize: 12.5, color: value ? "var(--text-primary)" : "var(--text-muted)", fontWeight: 500 }}>
        learning mode
      </span>
      <span
        style={{
          position: "relative",
          width: 34,
          height: 19,
          borderRadius: 999,
          background: value ? "var(--lane-1)" : "var(--surface-2)",
          border: "1px solid " + (value ? "color-mix(in srgb, var(--lane-1) 60%, transparent)" : "var(--border)"),
          transition: "background 0.15s",
          flexShrink: 0,
        }}
      >
        <motion.span
          animate={{ left: value ? 16 : 2 }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
          style={{
            position: "absolute",
            top: 1.5,
            width: 14,
            height: 14,
            borderRadius: "50%",
            background: "#fff",
            boxShadow: "0 1px 3px rgba(0,0,0,0.3)",
          }}
        />
      </span>
    </button>
  );
}

interface LandingPageProps {
  opening: boolean;
  openError: string | null;
  showManualInput: boolean;
  pathInput: string;
  onBrowse: () => void;
  onToggleManualInput: () => void;
  onPathInputChange: (v: string) => void;
  onManualOpen: () => void;
  notGitFolderPath: string | null;
  initRemoteUrl: string;
  onInitRemoteUrlChange: (v: string) => void;
  onInit: () => void;
  onCancelInit: () => void;
  showCloneInput: boolean;
  onToggleCloneInput: () => void;
  cloneUrl: string;
  onCloneUrlChange: (v: string) => void;
  onClone: () => void;
  cloning: boolean;
}

const BLOBS = [
  { color: "var(--lane-3)", size: 420, top: "-10%", left: "-8%", dur: 22 },
  { color: "var(--lane-1)", size: 460, top: "40%", left: "70%", dur: 26 },
  { color: "var(--lane-7)", size: 320, top: "70%", left: "5%", dur: 19 },
];

// scannable reasons to use this over a terminal
const FEATURES: { color: string; text: string }[] = [
  { color: "var(--lane-1)", text: "every command explained in plain language" },
  { color: "var(--lane-3)", text: "undo safely — history is never force-deleted" },
  { color: "var(--lane-2)", text: "stage changes file-by-file, even piece-by-piece" },
  { color: "var(--lane-7)", text: "every branch visible, one click to switch" },
];

// shown instead of everything else on startup when git itself isn't on this machine - nothing works without it
function GitMissingScreen({ onRetry }: { onRetry: () => void }) {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--surface-0)", padding: 40 }}>
      <div style={{ maxWidth: 380, textAlign: "center" }}>
        <Logo size={40} />
        <h1 style={{ fontSize: 19, margin: "16px 0 8px" }}>git isn't installed</h1>
        <p style={{ color: "var(--text-secondary)", fontSize: 13.5, lineHeight: 1.6, margin: "0 0 22px" }}>
          GitRoot runs the real git on your machine, so it needs git installed first. install it, then come back here.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button
            onClick={() => openExternal("https://git-scm.com/downloads")}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "none",
              background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
              color: "#fff",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            get git
          </button>
          <button
            onClick={onRetry}
            style={{
              padding: "10px 18px",
              borderRadius: 10,
              border: "1px solid var(--border)",
              background: "none",
              color: "var(--text-primary)",
              fontSize: 13.5,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            i installed it — check again
          </button>
        </div>
      </div>
    </div>
  );
}

function LandingPage({
  opening,
  openError,
  showManualInput,
  pathInput,
  onBrowse,
  onToggleManualInput,
  onPathInputChange,
  onManualOpen,
  notGitFolderPath,
  initRemoteUrl,
  onInitRemoteUrlChange,
  onInit,
  onCancelInit,
  showCloneInput,
  onToggleCloneInput,
  cloneUrl,
  onCloneUrlChange,
  onClone,
  cloning,
}: LandingPageProps) {
  const busy = opening || cloning;

  return (
    <div style={{ position: "relative", height: "100%", overflow: "hidden", background: "var(--surface-0)" }}>
      {BLOBS.map((b, i) => (
        <motion.div
          key={i}
          animate={{ x: [0, 30, -20, 0], y: [0, -20, 15, 0] }}
          transition={{ duration: b.dur, repeat: Infinity, ease: "easeInOut" }}
          style={{
            position: "absolute",
            top: b.top,
            left: b.left,
            width: b.size,
            height: b.size,
            borderRadius: "50%",
            background: b.color,
            opacity: 0.14,
            filter: "blur(90px)",
            pointerEvents: "none",
          }}
        />
      ))}

      {/* content scrolls independently of the blobs so a small window doesn't clip the expanded forms */}
      <div style={{ position: "relative", height: "100%", overflow: "auto" }}>
        <div style={{ minHeight: "100%", display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 40px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 56, maxWidth: 960, width: "100%", flexWrap: "wrap", justifyContent: "center" }}>
            {/* LEFT: identity, actions, what you actually get */}
            <div style={{ flex: "1 1 420px", maxWidth: 460 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                <Logo size={44} />
                <h1
                  style={{
                    fontSize: 28,
                    fontWeight: 700,
                    margin: 0,
                    backgroundImage: "linear-gradient(135deg, var(--text-primary), var(--text-secondary))",
                    backgroundClip: "text",
                    WebkitBackgroundClip: "text",
                    color: "transparent",
                    letterSpacing: -0.5,
                  }}
                >
                  GitRoot
                </h1>
              </div>
              <p style={{ color: "var(--text-secondary)", margin: "0 0 26px", fontSize: 15, lineHeight: 1.55, maxWidth: 400 }}>
                A git client that explains what it's doing, every time — open a folder, clone a repository, or
                start a brand new one.
              </p>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <motion.button
                  onClick={onBrowse}
                  disabled={busy}
                  whileHover={busy ? undefined : { scale: 1.02 }}
                  whileTap={busy ? undefined : { scale: 0.98 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "13px 22px",
                    borderRadius: 12,
                    border: "none",
                    background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                    color: "#fff",
                    fontSize: 14.5,
                    fontWeight: 600,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.7 : 1,
                    boxShadow: "0 8px 24px color-mix(in srgb, var(--lane-1) 40%, transparent)",
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                  {opening ? "opening…" : "choose a folder"}
                </motion.button>

                <motion.button
                  onClick={onToggleCloneInput}
                  disabled={busy}
                  whileHover={busy ? undefined : { scale: 1.02 }}
                  whileTap={busy ? undefined : { scale: 0.98 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 9,
                    padding: "13px 20px",
                    borderRadius: 12,
                    border: "1px solid var(--border-strong)",
                    background: showCloneInput ? "var(--surface-2)" : "var(--surface-1)",
                    color: "var(--text-primary)",
                    fontSize: 14.5,
                    fontWeight: 600,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.7 : 1,
                  }}
                >
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="6" cy="6" r="2.5" />
                    <circle cx="6" cy="18" r="2.5" />
                    <circle cx="18" cy="12" r="2.5" />
                    <path d="M6 8.5V15.5" />
                    <path d="M8 7l7.5 4" />
                  </svg>
                  clone from a URL
                </motion.button>
              </div>

              <AnimatePresence>
                {showCloneInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <input
                        value={cloneUrl}
                        onChange={(e) => onCloneUrlChange(e.target.value)}
                        placeholder="git@github.com:you/repo.git"
                        onKeyDown={(e) => e.key === "Enter" && onClone()}
                        autoFocus
                        style={{
                          flex: 1,
                          padding: "9px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                          fontFamily: "ui-monospace, monospace",
                        }}
                      />
                      <button
                        onClick={onClone}
                        disabled={busy || cloneUrl.trim().length === 0}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 8,
                          border: "none",
                          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                          color: "#fff",
                          fontWeight: 600,
                          fontSize: 13,
                          cursor: busy || cloneUrl.trim().length === 0 ? "default" : "pointer",
                          opacity: busy || cloneUrl.trim().length === 0 ? 0.6 : 1,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {cloning ? "cloning…" : "clone"}
                      </button>
                    </div>
                    <p style={{ margin: "8px 0 0", fontSize: 11.5, color: "var(--text-muted)" }}>
                      you'll be asked where to put it — GitRoot creates a new folder there for the repo.
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              <div style={{ marginTop: 12 }}>
                <button
                  onClick={onToggleManualInput}
                  style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 12.5, cursor: "pointer", textDecoration: "underline", padding: 0 }}
                >
                  {showManualInput ? "hide" : "or paste a path instead"}
                </button>
              </div>

              <AnimatePresence>
                {showManualInput && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    style={{ overflow: "hidden" }}
                  >
                    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                      <input
                        value={pathInput}
                        onChange={(e) => onPathInputChange(e.target.value)}
                        placeholder="/path/to/repo"
                        onKeyDown={(e) => e.key === "Enter" && onManualOpen()}
                        style={{
                          flex: 1,
                          padding: "9px 10px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                        }}
                      />
                      <button
                        onClick={onManualOpen}
                        disabled={busy}
                        style={{
                          padding: "9px 16px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "var(--surface-1)",
                          color: "var(--text-primary)",
                          fontSize: 13,
                          cursor: busy ? "default" : "pointer",
                        }}
                      >
                        open
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {notGitFolderPath && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: 16,
                      padding: "14px 16px",
                      borderRadius: 10,
                      background: "var(--surface-1)",
                      border: "1px solid var(--border)",
                    }}
                  >
                    <p style={{ margin: "0 0 3px", fontSize: 13, fontWeight: 600 }}>that folder isn't a git repository yet</p>
                    <p
                      style={{
                        margin: "0 0 10px",
                        fontSize: 11.5,
                        fontFamily: "ui-monospace, monospace",
                        color: "var(--text-muted)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {notGitFolderPath}
                    </p>
                    <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      set one up here — optionally link a remote now (or skip this and add one later):
                    </p>
                    <input
                      value={initRemoteUrl}
                      onChange={(e) => onInitRemoteUrlChange(e.target.value)}
                      placeholder="remote URL (optional) — e.g. git@github.com:you/repo.git"
                      onKeyDown={(e) => e.key === "Enter" && onInit()}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--surface-0)",
                        color: "var(--text-primary)",
                        fontSize: 12.5,
                        marginBottom: 10,
                      }}
                    />
                    <div style={{ display: "flex", gap: 8 }}>
                      <button
                        onClick={onInit}
                        disabled={busy}
                        style={{
                          flex: 1,
                          padding: "9px 14px",
                          borderRadius: 8,
                          border: "none",
                          background: "linear-gradient(135deg, var(--lane-3), var(--lane-1))",
                          color: "#fff",
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: busy ? "default" : "pointer",
                          opacity: busy ? 0.7 : 1,
                        }}
                      >
                        {opening ? "setting up…" : "initialize repository"}
                      </button>
                      <button
                        onClick={onCancelInit}
                        disabled={busy}
                        style={{
                          padding: "9px 14px",
                          borderRadius: 8,
                          border: "1px solid var(--border)",
                          background: "none",
                          color: "var(--text-muted)",
                          fontSize: 13,
                          cursor: busy ? "default" : "pointer",
                        }}
                      >
                        cancel
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <AnimatePresence>
                {openError && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    style={{
                      marginTop: 16,
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "color-mix(in srgb, var(--danger) 12%, transparent)",
                      border: "1px solid color-mix(in srgb, var(--danger) 35%, transparent)",
                      color: "var(--danger)",
                      fontSize: 13,
                    }}
                  >
                    {openError}
                  </motion.p>
                )}
              </AnimatePresence>

              <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 30 }}>
                {FEATURES.map((f) => (
                  <div key={f.text} style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text-secondary)" }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: f.color,
                        boxShadow: `0 0 5px 1px color-mix(in srgb, ${f.color} 55%, transparent)`,
                        flexShrink: 0,
                      }}
                    />
                    {f.text}
                  </div>
                ))}
              </div>

              <p style={{ marginTop: 24, color: "var(--text-muted)", fontSize: 11.5 }}>
                everything runs locally — nothing about your code leaves your machine.
              </p>
            </div>

            {/* right: decorative preview of the same "root system" the real commit graph draws */}
            <motion.div
              animate={{ y: [0, -10, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
              style={{ flex: "0 0 auto", width: 260, height: 380 }}
            >
              <RootArt />
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
