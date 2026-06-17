use tauri::{
    tray::TrayIconBuilder,
    Manager,
};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Holds the spawned Next.js standalone server process so we can kill it on app exit.
struct SidecarHandle(Mutex<Option<Child>>);

/// Holds the system-tray icon handle so commands can mutate its title.
struct TrayHandle(Mutex<Option<tauri::tray::TrayIcon>>);

#[tauri::command]
fn vow_tray_set(text: String, state: tauri::State<TrayHandle>) {
    let title = format!("⛓ {}", text.chars().take(40).collect::<String>());
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.set_title(Some(&title));
    }
}

#[tauri::command]
fn vow_tray_clear(state: tauri::State<TrayHandle>) {
    if let Some(tray) = state.0.lock().unwrap().as_ref() {
        let _ = tray.set_title(None::<&str>);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_notification::init())
        .manage(SidecarHandle(Mutex::new(None)))
        .manage(TrayHandle(Mutex::new(None)))
        .setup(|app| {
            let handle = app.handle();
            let resource_dir = handle.path().resource_dir()?;
            let app_data_dir = handle.path().app_data_dir()?;

            // Ensure the user-data directory exists
            std::fs::create_dir_all(&app_data_dir)?;

            // Copy the DB template on first launch
            let db_path = app_data_dir.join("data.db");
            if !db_path.exists() {
                let template = resource_dir.join("data.db.template");
                if template.exists() {
                    std::fs::copy(&template, &db_path)?;
                }
            }

            let db_url = format!("file:{}", db_path.to_string_lossy());

            // Locate the bundled standalone server
            let standalone_dir = resource_dir.join("standalone");
            let server_js = standalone_dir.join("server.js");

            // Find node on PATH (or fall back to common macOS Homebrew path)
            let node_path = which::which("node")
                .unwrap_or_else(|_| std::path::PathBuf::from("/opt/homebrew/bin/node"));

            // Spawn the Next.js standalone server
            let child = Command::new(&node_path)
                .arg(&server_js)
                .env("PORT", "3737")
                .env("HOSTNAME", "127.0.0.1")
                .env("DATABASE_URL", &db_url)
                // Pass the standalone dir so Next.js can find .next/static
                .current_dir(&standalone_dir)
                .stdout(Stdio::inherit())
                .stderr(Stdio::inherit())
                .spawn()?;

            // Stash the child so we can kill it on exit
            let sidecar_state: tauri::State<SidecarHandle> = app.state();
            *sidecar_state.0.lock().unwrap() = Some(child);

            // Build the system tray icon programmatically.
            // Use the app's bundled window icon — tauri-build embeds it and
            // AppHandle::default_window_icon() returns it as a ready Image.
            let mut tray_builder = TrayIconBuilder::new()
                .icon_as_template(true)
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let tray = tray_builder.build(app)?;

            // Store handle in managed state
            let tray_state: tauri::State<TrayHandle> = app.state();
            *tray_state.0.lock().unwrap() = Some(tray);

            // Give the Node server a moment to bind before the window loads
            std::thread::sleep(std::time::Duration::from_millis(1200));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![vow_tray_set, vow_tray_clear])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Destroyed = event {
                // Kill the sidecar when the last window is destroyed
                let app = window.app_handle();
                if let Some(state) = app.try_state::<SidecarHandle>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Life OS");
}
