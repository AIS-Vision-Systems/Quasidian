use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, State};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    name: String,
    path: String,
    is_dir: bool,
}

/// Holds the single active folder watcher; replacing it drops (stops)
/// the previous one, so exactly one folder is ever watched.
#[derive(Default)]
struct WatcherState(Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderChange {
    kind: String,
    paths: Vec<String>,
}

/// Watches a single folder (non-recursive) and forwards raw change events
/// to the frontend as "folder-changed"; no business logic here.
#[tauri::command]
fn watch_folder(
    app: AppHandle,
    state: State<WatcherState>,
    path: String,
) -> Result<(), String> {
    let mut watcher = notify::recommended_watcher(
        move |result: Result<notify::Event, notify::Error>| {
            if let Ok(event) = result {
                let change = FolderChange {
                    kind: format!("{:?}", event.kind),
                    paths: event
                        .paths
                        .iter()
                        .map(|p| p.to_string_lossy().into_owned())
                        .collect(),
                };
                let _ = app.emit("folder-changed", change);
            }
        },
    )
    .map_err(|e| e.to_string())?;
    watcher
        .watch(std::path::Path::new(&path), RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;
    *state.0.lock().map_err(|e| e.to_string())? = Some(watcher);
    Ok(())
}

#[tauri::command]
fn read_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| e.to_string())
}

/// Write-then-rename so readers never observe a partially written file.
#[tauri::command]
fn write_file_atomic(path: String, contents: String) -> Result<(), String> {
    let tmp = format!("{path}.tmp");
    std::fs::write(&tmp, contents).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

#[tauri::command]
fn ensure_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

/// Non-recursive listing; filtering and sorting happen on the TS side.
#[tauri::command]
fn list_folder(path: String) -> Result<Vec<FileEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        entries.push(FileEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            is_dir: file_type.is_dir(),
        });
    }
    Ok(entries)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(WatcherState::default())
        .invoke_handler(tauri::generate_handler![
            read_file,
            write_file,
            write_file_atomic,
            ensure_dir,
            list_folder,
            watch_folder
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
