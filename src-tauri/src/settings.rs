use tauri::Manager;

fn tour_marker_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("tour_offered_v2"))
}

#[tauri::command]
pub fn check_tour_offered(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(tour_marker_path(&app)?.exists())
}

#[tauri::command]
pub fn mark_tour_offered(app: tauri::AppHandle) -> Result<(), String> {
    std::fs::write(tour_marker_path(&app)?, "").map_err(|e| e.to_string())
}
