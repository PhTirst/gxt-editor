#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]
mod gxt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
      gxt::gxt_load,
      gxt::gxt_save,
      gxt::gxt_startup_path,
    ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
