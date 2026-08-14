import { useRef, useState } from "react";
import { diffNameStatus, type FileChange } from "../lib/gitCommands";

// file-level "what will change" preview shared by reset/revert/merge/rebase dialogs - only
// one of those dialogs is ever open at once, so a single slot is enough
export function usePreviewFiles() {
  const [previewFiles, setPreviewFiles] = useState<FileChange[] | null>(null);
  const [previewFilesLoading, setPreviewFilesLoading] = useState(false);
  // guards against a slow, stale fetch (e.g. from a dialog the user already cancelled)
  // resolving after a newer one and clobbering it with out-of-date files
  const requestId = useRef(0);

  async function loadPreviewFiles(repoPath: string, range: string) {
    const id = ++requestId.current;
    setPreviewFiles(null);
    setPreviewFilesLoading(true);
    try {
      const files = await diffNameStatus(repoPath, range);
      if (id === requestId.current) setPreviewFiles(files);
    } catch {
      if (id === requestId.current) setPreviewFiles([]);
    } finally {
      if (id === requestId.current) setPreviewFilesLoading(false);
    }
  }

  return { previewFiles, previewFilesLoading, loadPreviewFiles, setPreviewFiles };
}
