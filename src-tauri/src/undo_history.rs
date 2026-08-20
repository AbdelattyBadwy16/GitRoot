use serde::{Deserialize, Serialize};


const HISTORY_FILE_NAME: &str = "gitroot-undo-history.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UndoHistoryEntry {
    pub id: String,
    pub kind: String,
    pub action: serde_json::Value,
    pub label: String,
    pub timestamp_ms: i64,
}

fn history_path(repo_path: &str) -> std::path::PathBuf {
    std::path::Path::new(repo_path)
        .join(".git")
        .join(HISTORY_FILE_NAME)
}

#[tauri::command]
pub async fn load_undo_history(repo_path: String) -> Result<Vec<UndoHistoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || load_undo_history_sync(repo_path))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn load_undo_history_sync(repo_path: String) -> Result<Vec<UndoHistoryEntry>, String> {
    let path = history_path(&repo_path);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Ok(Vec::new());
    }
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_undo_history(
    repo_path: String,
    entries: Vec<UndoHistoryEntry>,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || save_undo_history_sync(repo_path, entries))
        .await
        .map_err(|e| format!("internal error: {e}"))?
}

fn save_undo_history_sync(repo_path: String, entries: Vec<UndoHistoryEntry>) -> Result<(), String> {
    let path = history_path(&repo_path);
    let json = serde_json::to_string_pretty(&entries).map_err(|e| e.to_string())?;
    std::fs::write(&path, json).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_repo_dir() -> std::path::PathBuf {
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "gitroot-undo-history-test-{}-{}",
            std::process::id(),
            n
        ));
        std::fs::create_dir_all(dir.join(".git")).unwrap();
        dir
    }

    fn sample_entry(id: &str) -> UndoHistoryEntry {
        UndoHistoryEntry {
            id: id.to_string(),
            kind: "reset".to_string(),
            action: serde_json::json!({ "kind": "reset", "targetHash": "abc1234" }),
            label: "undo reset".to_string(),
            timestamp_ms: 1_700_000_000_000,
        }
    }

    #[test]
    fn load_returns_empty_when_no_history_file_exists_yet() {
        let dir = temp_repo_dir();
        let history = load_undo_history_sync(dir.to_string_lossy().to_string()).unwrap();
        assert!(history.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_then_load_round_trips_entries_in_order() {
        let dir = temp_repo_dir();
        let repo_path = dir.to_string_lossy().to_string();
        let entries = vec![sample_entry("a"), sample_entry("b")];

        save_undo_history_sync(repo_path.clone(), entries.clone()).unwrap();
        let loaded = load_undo_history_sync(repo_path).unwrap();

        assert_eq!(loaded.len(), 2);
        assert_eq!(loaded[0].id, "a");
        assert_eq!(loaded[1].id, "b");
        assert_eq!(loaded[0].action["targetHash"], "abc1234");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_overwrites_rather_than_appends() {
        let dir = temp_repo_dir();
        let repo_path = dir.to_string_lossy().to_string();

        save_undo_history_sync(
            repo_path.clone(),
            vec![sample_entry("a"), sample_entry("b")],
        )
        .unwrap();
        save_undo_history_sync(repo_path.clone(), vec![sample_entry("c")]).unwrap();

        let loaded = load_undo_history_sync(repo_path).unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, "c");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn save_with_an_empty_list_clears_a_previously_saved_history() {
        let dir = temp_repo_dir();
        let repo_path = dir.to_string_lossy().to_string();

        save_undo_history_sync(repo_path.clone(), vec![sample_entry("a")]).unwrap();
        save_undo_history_sync(repo_path.clone(), vec![]).unwrap();

        let loaded = load_undo_history_sync(repo_path).unwrap();
        assert!(loaded.is_empty());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_returns_empty_for_a_path_that_does_not_exist_at_all_instead_of_erroring() {
        let bogus = std::env::temp_dir().join("gitroot-undo-history-does-not-exist-at-all");
        let history = load_undo_history_sync(bogus.to_string_lossy().to_string()).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn save_fails_gracefully_instead_of_panicking_when_the_git_dir_does_not_exist() {
        // a plain directory with no .git subfolder at all - not a real repo
        static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("gitroot-undo-history-no-git-{n}"));
        std::fs::create_dir_all(&dir).unwrap();

        let result =
            save_undo_history_sync(dir.to_string_lossy().to_string(), vec![sample_entry("a")]);
        assert!(
            result.is_err(),
            "writing into a missing .git dir should error, not panic"
        );
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn load_returns_an_error_instead_of_panicking_on_corrupted_json() {
        let dir = temp_repo_dir();
        std::fs::write(
            dir.join(".git").join(HISTORY_FILE_NAME),
            "{ not valid json ][",
        )
        .unwrap();

        let result = load_undo_history_sync(dir.to_string_lossy().to_string());
        assert!(result.is_err());
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn round_trips_unicode_and_quote_heavy_labels() {
        let dir = temp_repo_dir();
        let repo_path = dir.to_string_lossy().to_string();
        let mut entry = sample_entry("a");
        entry.label = "undo revert \"fix: عربي 你好\" 🎉".to_string();

        save_undo_history_sync(repo_path.clone(), vec![entry]).unwrap();
        let loaded = load_undo_history_sync(repo_path).unwrap();

        assert_eq!(loaded[0].label, "undo revert \"fix: عربي 你好\" 🎉");
        std::fs::remove_dir_all(&dir).ok();
    }
}
