// this stop extra console window on windows
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod git;
mod settings;
mod undo_history;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            settings::check_tour_offered,
            settings::mark_tour_offered,
            undo_history::load_undo_history,
            undo_history::save_undo_history,
            git::commands::pull,
            git::commands::push,
            git::commands::force_push,
            git::commands::stash,
            git::commands::stash_pop,
            git::commands::list_stashes,
            git::commands::apply_stash,
            git::commands::pop_stash,
            git::commands::drop_stash,
            git::commands::commit,
            git::commands::uncommit_to,
            git::commands::hard_reset_to,
            git::commands::status,
            git::commands::stage_file,
            git::commands::unstage_file,
            git::commands::discard_file,
            git::commands::file_diff,
            git::commands::repo_fingerprint,
            git::commands::list_branches,
            git::commands::switch_branch,
            git::commands::create_branch,
            git::commands::undo_create_branch,
            git::commands::revert_to_commit,
            git::commands::continue_revert,
            git::commands::abort_revert,
            git::commands::reset_preflight,
            git::commands::reset_to_commit,
            git::commands::conflicted_files,
            git::commands::has_conflict_markers,
            git::commands::merge_preview,
            git::commands::diff_name_status,
            git::commands::merge_branch,
            git::commands::continue_merge,
            git::commands::abort_merge,
            git::commands::rebase_preflight,
            git::commands::rebase_branch,
            git::commands::rebase_status,
            git::commands::continue_rebase,
            git::commands::abort_rebase,
            git::commands::file_hunks,
            git::commands::stage_hunk,
            git::commands::discard_hunk,
            git::commands::stage_hunk_lines,
            git::commands::discard_hunk_lines,
            git::commands::unstage_hunk_lines,
            git::log::commit_graph,
            git::open_repo,
            git::init_repo,
            git::clone_repo,
            git::check_git_available,
            git::check_git_identity,
            git::set_git_identity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running GitRoot");
}
