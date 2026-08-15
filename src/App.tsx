import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CommitGraph from "./components/CommitGraph";
import CommitRangeSummary from "./components/CommitRangeSummary";
import FileChangesList from "./components/FileChangesList";
import PreviewTabs from "./components/PreviewTabs";
import StagingList from "./components/StagingList";
import CommandBar from "./components/CommandBar";
import DetailsPanel from "./components/DetailsPanel";
import BranchesTab from "./components/BranchesTab";
import StashTab from "./components/StashTab";
import HunkEditor from "./components/HunkEditor";
import ConfirmDialog from "./components/ConfirmDialog";
import ConflictDialog from "./components/ConflictDialog";
import ResetDialog from "./components/ResetDialog";
import GitIdentityPrompt from "./components/GitIdentityPrompt";
import TourOverlay from "./components/TourOverlay";
import WelcomeTourPrompt from "./components/WelcomeTourPrompt";
import TabBar, { type Tab } from "./components/TabBar";
import BranchStatusBadge from "./components/BranchStatusBadge";
import LearningModeToggle from "./components/LearningModeToggle";
import GitMissingScreen from "./components/GitMissingScreen";
import LandingPage from "./components/LandingPage";
import Logo from "./components/Logo";
import { TOUR_STEPS } from "./lib/tour";
import {
  openRepo,
  initRepo,
  cloneRepo,
  pull,
  push,
  stash,
  commit as commitFn,
  getStatus,
  stageFile,
  unstageFile,
  getCommitGraph,
  getRepoFingerprint,
  listBranches,
  listStashes,
  pickFolder,
  checkGitAvailable,
  checkGitIdentity,
  checkTourOffered,
  markTourOffered,
  type RepoInfo,
  type FileStatus,
  type CommitGraphData,
  type BranchInfo,
  type CommandResult,
  type GitIdentity,
  type StashInfo,
} from "./lib/gitCommands";
import {
  explainDetails,
  revertConfirmText,
  mergePreviewText,
  rebaseAlreadyPushedWarning,
  rebasePlanText,
  rebaseProgressText,
  type ActionDetails,
  type ActionKind,
  type CommandName,
} from "./lib/explain";
import { isHead } from "./lib/graph";
import { loadLearningMode, saveLearningMode } from "./lib/learningMode";
import { UNDO_LABEL, computeUndo, undoConfirmText, relativeTime } from "./lib/undo";
import { usePreviewFiles } from "./hooks/usePreviewFiles";
import { useUndoHistory } from "./hooks/useUndoHistory";
import { useBranches } from "./hooks/useBranches";
import { usePausedOp } from "./hooks/usePausedOp";
import { useStashActions } from "./hooks/useStashActions";
import { useMergeRebase } from "./hooks/useMergeRebase";
import { useResetRevert } from "./hooks/useResetRevert";

const EMPTY_GRAPH: CommitGraphData = { commits: [], edges: [], laneCount: 0, hasMore: false };
const GRAPH_PAGE_SIZE = 30;

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
  const [stashes, setStashes] = useState<StashInfo[]>([]);
  const [hunkEditorFile, setHunkEditorFile] = useState<string | null>(null);
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [gitIdentity, setGitIdentity] = useState<GitIdentity | null>(null);
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  // while true, elements that are normally hidden until something makes them relevant (undo,
  // merge/rebase pickers with only one branch) force-show a preview instead, so the tour always
  // has something real to point at
  const touring = tourStep !== null;

  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);
  const [showManualInput, setShowManualInput] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [notGitFolderPath, setNotGitFolderPath] = useState<string | null>(null);
  const [initRemoteUrl, setInitRemoteUrl] = useState("");
  const [showCloneInput, setShowCloneInput] = useState(false);
  const [cloneUrl, setCloneUrl] = useState("");
  const [cloning, setCloning] = useState(false);

  async function refresh(path: string, limit: number = graphLimit): Promise<CommitGraphData> {
    const [g, s, b, st] = await Promise.all([getCommitGraph(path, limit), getStatus(path), listBranches(path), listStashes(path)]);
    setGraph(g);
    setFiles(s);
    setBranches(b);
    setStashes(st);
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

  function pulseHead(g: CommitGraphData) {
    const head = g.commits.find(isHead);
    if (!head) return;
    setPulseHash(head.hash);
    window.setTimeout(() => setPulseHash((cur) => (cur === head.hash ? null : cur)), 2600);
  }

  function applyResult(kind: ActionKind, result: CommandResult) {
    const details = explainDetails(kind, result);
    setLastAction(details);
    return details;
  }

  const { previewFiles, previewFilesLoading, loadPreviewFiles, setPreviewFiles } = usePreviewFiles();

  const {
    undoHistory,
    setUndoConfirmingId,
    undoHistoryOpen,
    setUndoHistoryOpen,
    undoHistoryRef,
    lastUndo,
    undoConfirming,
    recordUndo,
    handleUndo,
  } = useUndoHistory({ repo, setBusy, applyResult, refresh, pulseHead });

  const { handleSwitchBranch, handleCreateBranch } = useBranches({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo, setLastAction });

  const { pausedOp, setPausedOp, handleContinuePausedOp, handleAbortPausedOp } = usePausedOp({
    repo,
    setBusy,
    applyResult,
    refresh,
    pulseHead,
    recordUndo,
    setLastAction,
  });

  const { dropStashTarget, setDropStashTarget, handleApplyStash, handlePopStash, confirmDropStash } = useStashActions({
    repo,
    setBusy,
    applyResult,
    refresh,
    pulseHead,
    recordUndo,
    setLastAction,
  });

  const {
    mergeConfirm,
    setMergeConfirm,
    rebaseFlow,
    setRebaseFlow,
    rebaseProgress,
    setRebaseProgress,
    handlePickMergeTarget,
    confirmMerge,
    handlePickRebaseTarget,
    confirmRebaseWarning,
    confirmRebasePlan,
  } = useMergeRebase({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo, setLastAction, setPausedOp, loadPreviewFiles, setPreviewFiles });

  const {
    revertTarget,
    setRevertTarget,
    resetFlow,
    setResetFlow,
    confirmRevert,
    handlePickCommitAction,
    confirmResetWarning,
    confirmResetPicker,
    confirmResetDiscard,
  } = useResetRevert({ repo, setBusy, applyResult, refresh, pulseHead, recordUndo, setLastAction, setPausedOp, loadPreviewFiles, setPreviewFiles });

  function refreshGitIdentity() {
    if (!repo) return;
    checkGitIdentity(repo.path)
      .then(setGitIdentity)
      .catch(() => setGitIdentity(null));
  }

  async function finishOpening(info: RepoInfo) {
    setRepo(info);
    setGraphLimit(GRAPH_PAGE_SIZE);
    setActiveTab("graph");
    setHunkEditorFile(null);
    // clear this so it does not poll or act on the wrong repo after switching
    setMergeConfirm(null);
    setRebaseFlow(null);
    setRebaseProgress(null);
    setPausedOp(null);
    setResetFlow(null);
    setPreviewFiles(null);
    await refresh(info.path, GRAPH_PAGE_SIZE);
    checkGitIdentity(info.path)
      .then(setGitIdentity)
      .catch(() => setGitIdentity(null));
    if (!(await checkTourOffered())) {
      await markTourOffered();
      setShowTourPrompt(true);
    }
  }

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
      // important: this text must match the rust error text exactly
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
      if (result.conflict) {
        const target = String(result.data.target ?? "the remote");
        setPausedOp({ kind: "merge", target });
        setLastAction(explainDetails("merge", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult(name, result);
      if (!details.isError) recordUndo(computeUndo(name, result));
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
        recordUndo(computeUndo("commit", result));
      }
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    checkGitAvailable()
      .then((info) => setGitAvailable(info.available))
      .catch(() => setGitAvailable(false));
    // the tour-offered flag moved from localStorage to a file on disk (see checkTourOffered) -
    // clean up both old keys, they're unused now
    localStorage.removeItem("gitroot:tourOffered");
    localStorage.removeItem("gitroot:tourOffered:v2");
  }, []);

  useEffect(() => {
    saveLearningMode(learningMode);
  }, [learningMode]);

  useEffect(() => {
    if (activeTab !== "commit") setHunkEditorFile(null);
  }, [activeTab]);

  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  });

  useEffect(() => {
    if (!repo) return;
    let lastFingerprint: string | null = null;
    const path = repo.path;

    const tick = async () => {
      let fp: string;
      try {
        fp = await getRepoFingerprint(path);
      } catch {
        return;
      }
      if (lastFingerprint === null) {
        lastFingerprint = fp;
        return;
      }
      if (fp !== lastFingerprint) {
        lastFingerprint = fp;
        if (busyRef.current === null) await refreshRef.current(path);
      }
    };

    const interval = window.setInterval(tick, 1500);
    return () => window.clearInterval(interval);
  }, [repo]);

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
          <div ref={undoHistoryRef} style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
            <AnimatePresence>
              {(lastUndo || touring) && (
                <motion.button
                  key="undo"
                  data-tour="undo-button"
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  onClick={() => lastUndo && setUndoConfirmingId(lastUndo.id)}
                  disabled={!!busy || !lastUndo}
                  title={lastUndo ? undefined : "appears here after an action that can be safely undone"}
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
                    cursor: busy || !lastUndo ? "default" : "pointer",
                    opacity: lastUndo ? 1 : 0.55,
                  }}
                >
                  <UndoIcon />
                  {lastUndo ? UNDO_LABEL[lastUndo.action.kind] : "undo last action"}
                </motion.button>
              )}
            </AnimatePresence>
            {undoHistory.length > 1 && (
              <button
                onClick={() => setUndoHistoryOpen((o) => !o)}
                disabled={!!busy}
                title="show undo history"
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minWidth: 22,
                  height: 22,
                  padding: "0 6px",
                  borderRadius: 7,
                  border: "1px solid var(--border)",
                  background: undoHistoryOpen ? "var(--surface-2)" : "var(--surface-1)",
                  color: "var(--text-secondary)",
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.55 : 1,
                }}
              >
                {undoHistory.length}
              </button>
            )}
            {undoHistoryOpen && undoHistory.length > 1 && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 6px)",
                  right: 0,
                  zIndex: 50,
                  width: 260,
                  borderRadius: 10,
                  border: "1px solid var(--border)",
                  background: "var(--surface-1)",
                  boxShadow: "0 12px 30px rgba(0,0,0,0.35)",
                  overflow: "hidden",
                }}
              >
                <div style={{ padding: "8px 12px", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.6, color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  undo history
                </div>
                <div style={{ maxHeight: 52 * 5, overflowY: "auto" }}>
                  {undoHistory.map((h, i) => (
                    <div
                      key={h.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        borderTop: i === 0 ? "none" : "1px solid var(--border)",
                      }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{UNDO_LABEL[h.action.kind]}</div>
                        <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{relativeTime(h.timestampMs)}</div>
                      </div>
                      <button
                        onClick={() => {
                          setUndoConfirmingId(h.id);
                          setUndoHistoryOpen(false);
                        }}
                        disabled={!!busy}
                        style={{
                          padding: "4px 10px",
                          borderRadius: 6,
                          border: "1px solid color-mix(in srgb, var(--lane-4) 40%, transparent)",
                          background: "color-mix(in srgb, var(--lane-4) 12%, var(--surface-1))",
                          color: "var(--lane-4)",
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: busy ? "default" : "pointer",
                          flexShrink: 0,
                        }}
                      >
                        undo
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
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

        <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 }}>
          <TabBar active={activeTab} onChange={setActiveTab} />
          {/* minHeight: 0 is load-bearing here - without it this flex item refuses to
              shrink below its content's height (the commit graph's ever-growing canvas),
              so overflow: auto never actually clips/scrolls and the whole window grows instead */}
          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
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
                    <GitIdentityPrompt repoPath={repo.path} onSaved={refreshGitIdentity} />
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
                // important: use the global busy here, not just this tab own busy, or user
                // can start a second git command while one is still running
                busy={!!busy}
                onPickMergeTarget={handlePickMergeTarget}
                onPickRebaseTarget={handlePickRebaseTarget}
                mergeBusy={!!busy}
                rebaseBusy={!!busy}
                touring={touring}
              />
            ) : activeTab === "stash" ? (
              <StashTab
                stashes={stashes}
                busy={!!busy}
                onApply={handleApplyStash}
                onPop={handlePopStash}
                onRequestDrop={setDropStashTarget}
              />
            ) : (
              <div data-tour="graph" style={{ padding: 20 }}>
                <CommitGraph
                  graph={graph}
                  pulseHash={pulseHash}
                  hasMore={graph.hasMore}
                  loadingMore={loadingMoreGraph}
                  onLoadMore={loadMoreGraph}
                  onCommitAction={handlePickCommitAction}
                />
              </div>
            )}
          </div>
        </div>

        {learningMode && (
          <DetailsPanel
            details={lastAction}
            running={busy}
            runningLabel={busy === "rebase" && rebaseProgress ? rebaseProgressText(rebaseProgress.current, rebaseProgress.total) : null}
          />
        )}
      </div>

      <AnimatePresence>
        {revertTarget && (
          <ConfirmDialog
            title="revert to this commit?"
            message={
              <>
                <PreviewTabs
                  commitsContent={
                    <CommitRangeSummary
                      context={revertTarget}
                      afterCaption="content will match"
                      listCaption="commits this will undo with new commits, newest first:"
                    />
                  }
                  filesContent={<FileChangesList files={previewFiles ?? []} loading={previewFilesLoading} />}
                  filesCount={previewFiles?.length ?? 0}
                />
                {revertConfirmText(revertTarget.commits, revertTarget.target.hash.slice(0, 7))}
              </>
            }
            confirmLabel={`revert ${revertTarget.commits} commit${revertTarget.commits === 1 ? "" : "s"}`}
            onConfirm={confirmRevert}
            onCancel={() => {
              setRevertTarget(null);
              setPreviewFiles(null);
            }}
            busy={busy === "revert"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {undoConfirming && (
          <ConfirmDialog
            title="undo this?"
            message={undoConfirmText(undoConfirming.action)}
            confirmLabel={UNDO_LABEL[undoConfirming.action.kind]}
            onConfirm={() => {
              const id = undoConfirming.id;
              setUndoConfirmingId(null);
              handleUndo(id);
            }}
            onCancel={() => setUndoConfirmingId(null)}
            busy={busy === "undo"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mergeConfirm && (
          <ConfirmDialog
            title={mergeConfirm.preview.outcome === "conflict" ? "merge would conflict" : "merge this branch?"}
            message={
              <PreviewTabs
                commitsContent={mergePreviewText(
                  mergeConfirm.preview.outcome,
                  mergeConfirm.preview.commits,
                  mergeConfirm.preview.currentBranch,
                  mergeConfirm.target,
                  mergeConfirm.preview.files
                )}
                filesContent={<FileChangesList files={previewFiles ?? []} loading={previewFilesLoading} />}
                filesCount={previewFiles?.length ?? 0}
              />
            }
            confirmLabel="merge"
            onConfirm={confirmMerge}
            onCancel={() => {
              setMergeConfirm(null);
              setPreviewFiles(null);
            }}
            busy={busy === "merge"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rebaseFlow?.step === "warning" && (
          <ConfirmDialog
            title="these commits are already on your remote"
            message={rebaseAlreadyPushedWarning()}
            confirmLabel="continue anyway"
            onConfirm={confirmRebaseWarning}
            onCancel={() => {
              setRebaseFlow(null);
              setPreviewFiles(null);
            }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {rebaseFlow?.step === "plan" && (
          <ConfirmDialog
            title="rebase this branch?"
            message={
              <PreviewTabs
                commitsContent={rebasePlanText(rebaseFlow.preflight.totalCommits, rebaseFlow.preflight.currentBranch, rebaseFlow.target)}
                filesContent={<FileChangesList files={previewFiles ?? []} loading={previewFilesLoading} />}
                filesCount={previewFiles?.length ?? 0}
              />
            }
            confirmLabel="rebase"
            onConfirm={confirmRebasePlan}
            onCancel={() => {
              setRebaseFlow(null);
              setPreviewFiles(null);
            }}
            busy={busy === "rebase"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {resetFlow && (
          <ResetDialog
            context={resetFlow.context}
            hasUncommittedChanges={resetFlow.preflight.hasUncommittedChanges}
            step={resetFlow.step}
            mode={resetFlow.mode}
            previewFiles={previewFiles}
            previewFilesLoading={previewFilesLoading}
            onModeChange={(mode) => setResetFlow((rf) => (rf ? { ...rf, mode } : rf))}
            onConfirmWarning={confirmResetWarning}
            onConfirmPicker={confirmResetPicker}
            onConfirmDiscard={confirmResetDiscard}
            onCancel={() => {
              setResetFlow(null);
              setPreviewFiles(null);
            }}
            busy={busy === "reset"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {dropStashTarget && (
          <ConfirmDialog
            title="drop this stash?"
            message={`this deletes "${dropStashTarget.message}" for good — the changes it held can't be brought back.`}
            confirmLabel="drop stash"
            onConfirm={confirmDropStash}
            onCancel={() => setDropStashTarget(null)}
            busy={busy === "dropStash"}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {pausedOp && repo && (
          <ConflictDialog
            repoPath={repo.path}
            kind={pausedOp.kind}
            target={pausedOp.target}
            onContinue={handleContinuePausedOp}
            onAbort={handleAbortPausedOp}
            busy={busy === "conflictContinue" || busy === "conflictAbort"}
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

function UndoIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 10h10a5 5 0 0 1 0 10H8" />
      <path d="M7 5L3 10l4 5" />
    </svg>
  );
}
