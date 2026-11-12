fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_app_status",
            "create_case",
            "get_case",
            "list_cases",
            "build_plan",
            "approve_plan",
            "start_plan",
            "export_case",
            "delete_case",
        ]),
    ))
    .expect("Tauri build metadata");
}
