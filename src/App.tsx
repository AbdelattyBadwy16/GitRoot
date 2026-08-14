import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import CommitGraph, { type CommitActionContext } from "./components/CommitGraph";
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
import AccountSwitcher from "./components/AccountSwitcher";
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
  continueRevert,
  abortRevert,
  resetPreflight,
  resetToCommit,
  pickFolder,
  checkGitAvailable,
  checkGitIdentity,
  checkTourOffered,
  markTourOffered,
  mergePreview,
  mergeBranch,
  continueMerge,
  abortMerge,
  rebasePreflight,
  rebaseBranch,
  getRebaseStatus,
  continueRebase,
  abortRebase,
  diffNameStatus,
  listStashes,
  applyStash,
  popStash,
  dropStash,
  loadUndoHistory,
  saveUndoHistory,
  withTarget,
  type RepoInfo,
  type FileStatus,
  type CommitGraphData,
  type BranchInfo,
  type CommandResult,
  type GitIdentity,
  type MergePreview,
  type RebasePreflight,
  type ResetPreflight,
  type ResetMode,
  type FileChange,
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
import {
  UNDO_LABEL,
  MAX_UNDO_HISTORY,
  undoConfirmText,
  computeUndo,
  genId,
  toPersistedEntry,
  fromPersistedEntry,
  relativeTime,
  type UndoAction,
  type UndoHistoryItem,
} from "./lib/undo";

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
  const [dropStashTarget, setDropStashTarget] = useState<StashInfo | null>(null);
  const [revertTarget, setRevertTarget] = useState<CommitActionContext | null>(null);
  const [hunkEditorFile, setHunkEditorFile] = useState<string | null>(null);
  const [undoHistory, setUndoHistory] = useState<UndoHistoryItem[]>([]);
  const [undoConfirmingId, setUndoConfirmingId] = useState<string | null>(null);
  const [undoHistoryOpen, setUndoHistoryOpen] = useState(false);
  const undoHistoryRef = useRef<HTMLDivElement>(null);
  const lastUndo = undoHistory[0] ?? null;
  const undoConfirming = undoHistory.find((h) => h.id === undoConfirmingId) ?? null;

  // close the history dropdown on an outside click, same pattern AccountSwitcher already uses
  useEffect(() => {
    if (!undoHistoryOpen) return;
    function onDocClick(e: MouseEvent) {
      if (undoHistoryRef.current && !undoHistoryRef.current.contains(e.target as Node)) setUndoHistoryOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [undoHistoryOpen]);

  function pushUndoHistory(action: UndoAction) {
    if (!repo) return;
    const next = [{ id: genId(), action, timestampMs: Date.now() }, ...undoHistory].slice(0, MAX_UNDO_HISTORY);
    setUndoHistory(next);
    saveUndoHistory(repo.path, next.map(toPersistedEntry)).catch(() => {});
  }

  // most call sites just have a raw UndoAction | null from computeUndo - this is the
  // "record it if there's anything to record" shortcut for those
  function recordUndo(action: UndoAction | null) {
    if (action) pushUndoHistory(action);
  }

  function removeUndoHistoryEntry(id: string) {
    setUndoHistory((prev) => {
      const next = prev.filter((h) => h.id !== id);
      if (repo) saveUndoHistory(repo.path, next.map(toPersistedEntry)).catch(() => {});
      return next;
    });
  }
  const [gitAvailable, setGitAvailable] = useState<boolean | null>(null);
  const [gitIdentity, setGitIdentity] = useState<GitIdentity | null>(null);
  const [showTourPrompt, setShowTourPrompt] = useState(false);
  const [tourStep, setTourStep] = useState<number | null>(null);
  // while true, elements that are normally hidden until something makes them relevant (undo,
  // merge/rebase pickers with only one branch) force-show a preview instead, so the tour always
  // has something real to point at
  const touring = tourStep !== null;

  // file-level "what will change" preview shared by reset/revert/merge/rebase dialogs -
  // only one of those dialogs is ever open at once, so a single slot is enough
  const [previewFiles, setPreviewFiles] = useState<FileChange[] | null>(null);
  const [previewFilesLoading, setPreviewFilesLoading] = useState(false);
  // guards against a slow, stale fetch (e.g. from a dialog the user already cancelled)
  // resolving after a newer one and clobbering it with out-of-date files
  const previewFilesRequestId = useRef(0);

  async function loadPreviewFiles(repoPath: string, range: string) {
    const requestId = ++previewFilesRequestId.current;
    setPreviewFiles(null);
    setPreviewFilesLoading(true);
    try {
      const files = await diffNameStatus(repoPath, range);
      if (requestId === previewFilesRequestId.current) setPreviewFiles(files);
    } catch {
      if (requestId === previewFilesRequestId.current) setPreviewFiles([]);
    } finally {
      if (requestId === previewFilesRequestId.current) setPreviewFilesLoading(false);
    }
  }

  const [mergeConfirm, setMergeConfirm] = useState<{ target: string; preview: MergePreview } | null>(null);
  const [rebaseFlow, setRebaseFlow] = useState<{ step: "warning" | "plan"; target: string; preflight: RebasePreflight } | null>(null);
  const [rebaseProgress, setRebaseProgress] = useState<{ current: number; total: number } | null>(null);
  const [pausedOp, setPausedOp] = useState<{ kind: "merge" | "rebase" | "revert"; target: string } | null>(null);
  const [resetFlow, setResetFlow] = useState<{
    context: CommitActionContext;
    preflight: ResetPreflight;
    step: "warning" | "picker" | "confirmDiscard";
    mode: ResetMode;
  } | null>(null);

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
    // undo history is scoped per-repo and persisted in that repo's own .git dir, so switching
    // repos means loading whatever history that repo already has, not clearing to empty
    setUndoHistory([]);
    loadUndoHistory(info.path)
      .then((entries) => setUndoHistory(entries.map(fromPersistedEntry)))
      .catch(() => setUndoHistory([]));
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

  async function handleSwitchBranch(name: string) {
    if (!repo) return;
    setBusy("switchBranch");
    try {
      const result = await switchBranch(repo.path, name);
      const details = applyResult("switchBranch", result);
      if (!details.isError) recordUndo(computeUndo("switchBranch", result));
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
      if (!details.isError) recordUndo(computeUndo("createBranch", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleApplyStash(stash: StashInfo) {
    if (!repo) return;
    setBusy("applyStash");
    try {
      const result = await applyStash(repo.path, stash.stashRef);
      // withTarget so the result text can name which stash this was ({target}), not just
      // say "applied the stash" - the backend only knows the ref, the frontend already has
      // the human message right here
      applyResult("applyStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function handlePopStash(stash: StashInfo) {
    if (!repo) return;
    setBusy("popStash");
    try {
      const result = await popStash(repo.path, stash.stashRef);
      applyResult("popStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function confirmDropStash() {
    if (!repo || !dropStashTarget) return;
    const stash = dropStashTarget;
    setDropStashTarget(null);
    setBusy("dropStash");
    try {
      const result = await dropStash(repo.path, stash.stashRef);
      applyResult("dropStash", withTarget(result, stash.message));
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function handlePickMergeTarget(target: string) {
    if (!repo) return;
    const preview = await mergePreview(repo.path, target);
    setMergeConfirm({ target, preview });
    loadPreviewFiles(repo.path, `HEAD...${target}`);
  }

  async function confirmMerge() {
    if (!repo || !mergeConfirm) return;
    const target = mergeConfirm.target;
    setMergeConfirm(null);
    setPreviewFiles(null);
    setBusy("merge");
    try {
      const result = await mergeBranch(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "merge", target });
        setLastAction(explainDetails("merge", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("merge", result);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handlePickRebaseTarget(target: string) {
    if (!repo) return;
    const preflight = await rebasePreflight(repo.path, target);
    setRebaseFlow({ step: preflight.alreadyPushedCount > 0 ? "warning" : "plan", target, preflight });
    loadPreviewFiles(repo.path, `${target}...HEAD`);
  }

  function confirmRebaseWarning() {
    if (!rebaseFlow) return;
    setRebaseFlow({ ...rebaseFlow, step: "plan" });
  }

  async function confirmRebasePlan() {
    if (!repo || !rebaseFlow) return;
    const target = rebaseFlow.target;
    setRebaseFlow(null);
    setPreviewFiles(null);
    setBusy("rebase");
    const poll = window.setInterval(async () => {
      try {
        const status = await getRebaseStatus(repo.path);
        setRebaseProgress(status.inProgress ? { current: status.current, total: status.total } : null);
      } catch {
      }
    }, 300);
    try {
      const result = await rebaseBranch(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "rebase", target });
        setLastAction(explainDetails("rebase", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("rebase", result);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      window.clearInterval(poll);
      setRebaseProgress(null);
      setBusy(null);
    }
  }

  async function handleContinuePausedOp() {
    if (!repo || !pausedOp) return;
    setBusy("conflictContinue");
    try {
      const raw =
        pausedOp.kind === "merge"
          ? await continueMerge(repo.path)
          : pausedOp.kind === "rebase"
          ? await continueRebase(repo.path)
          : await continueRevert(repo.path);
      const result = withTarget(raw, pausedOp.target);
      if (result.conflict) {
        setLastAction(explainDetails(pausedOp.kind, result));
        return;
      }
      setPausedOp(null);
      const details = applyResult(pausedOp.kind, result);
      if (!details.isError && pausedOp.kind === "revert") recordUndo(computeUndo("revert", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handleAbortPausedOp() {
    if (!repo || !pausedOp) return;
    setBusy("conflictAbort");
    try {
      if (pausedOp.kind === "merge") await abortMerge(repo.path);
      else if (pausedOp.kind === "rebase") await abortRebase(repo.path);
      else await abortRevert(repo.path);
      setPausedOp(null);
      setLastAction(null);
      await refresh(repo.path);
    } finally {
      setBusy(null);
    }
  }

  async function confirmRevert() {
    if (!repo || !revertTarget) return;
    const target = revertTarget.target.hash;
    setRevertTarget(null);
    setPreviewFiles(null);
    setBusy("revert");
    try {
      const result = await revertToCommit(repo.path, target);
      if (result.conflict) {
        setPausedOp({ kind: "revert", target });
        setLastAction(explainDetails("revert", result));
        await refresh(repo.path);
        return;
      }
      const details = applyResult("revert", result);
      if (!details.isError) recordUndo(computeUndo("revert", result));
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  async function handlePickCommitAction(kind: "reset" | "revert", context: CommitActionContext) {
    if (!repo) return;
    const range = `${context.target.hash}..${context.head.hash}`;
    if (kind === "revert") {
      setRevertTarget(context);
      loadPreviewFiles(repo.path, range);
      return;
    }
    const preflight = await resetPreflight(repo.path, context.target.hash);
    setResetFlow({
      context,
      preflight,
      step: preflight.alreadyPushedCount > 0 ? "warning" : "picker",
      mode: "mixed",
    });
    loadPreviewFiles(repo.path, range);
  }

  function confirmResetWarning() {
    setResetFlow((rf) => (rf ? { ...rf, step: "picker" } : rf));
  }

  function confirmResetPicker() {
    if (!resetFlow) return;
    if (resetFlow.mode === "hard") {
      setResetFlow({ ...resetFlow, step: "confirmDiscard" });
      return;
    }
    executeReset(resetFlow.mode);
  }

  function confirmResetDiscard() {
    executeReset("hard");
  }

  async function executeReset(mode: ResetMode) {
    if (!repo || !resetFlow) return;
    const target = resetFlow.context.target.hash;
    setBusy("reset");
    try {
      const result = await resetToCommit(repo.path, target, mode);
      const details = applyResult("reset", result);
      if (!details.isError) recordUndo(computeUndo("reset", result));
      setResetFlow(null);
      setPreviewFiles(null);
      const g = await refresh(repo.path);
      if (!details.isError) pulseHead(g);
    } finally {
      setBusy(null);
    }
  }

  // undoes one specific entry from the history, not necessarily the most recent - each entry
  // just replays its own reverse command against the repo's current state, independent of
  // whatever else has happened since (git has no real transactional undo; this is the same
  // limitation that already existed for "undo last action", just no longer hidden behind it
  // always being the most recent thing)
  async function handleUndo(entryId: string) {
    const entry = undoHistory.find((h) => h.id === entryId);
    if (!repo || !entry) return;
    const action = entry.action;
    setBusy("undo");
    try {
      let result: CommandResult;
      switch (action.kind) {
        case "pull":
        case "reset":
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
          removeUndoHistoryEntry(entryId); // not safe to just retry this if it fail halfway
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
      if (!details.isError) removeUndoHistoryEntry(entryId);
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
          <div data-tour="account-switcher">
            <AccountSwitcher repoPath={repo.path} identity={gitIdentity ?? { name: null, email: null }} onIdentityChanged={refreshGitIdentity} />
          </div>
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

