use sentinel_core::{Store, authorize_window, domain::*};
use std::sync::Mutex;
use tauri::{Manager, State, WebviewWindow};

type AppStore = Mutex<Store>;
type Result<T> = std::result::Result<T, String>;
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppStatus {
    version: &'static str,
    mode: &'static str,
    model_enabled: bool,
    real_collection_enabled: bool,
}

fn access(window: &WebviewWindow) -> Result<()> {
    authorize_window(window.label())
}

#[tauri::command]
fn get_app_status(window: WebviewWindow) -> Result<AppStatus> {
    access(&window)?;
    Ok(AppStatus {
        version: "0.1.0",
        mode: "native-synthetic",
        model_enabled: false,
        real_collection_enabled: false,
    })
}
#[tauri::command]
fn create_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CreateCase,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .create(request)
}
#[tauri::command]
fn get_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .get(&request.case_id)
}
#[tauri::command]
fn list_cases(window: WebviewWindow, state: State<AppStore>) -> Result<Vec<CaseRecord>> {
    access(&window)?;
    state.lock().map_err(|_| "案例服务暂不可用。")?.list()
}
#[tauri::command]
fn build_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: CaseRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .build_plan(&request.case_id)
}
#[tauri::command]
fn approve_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: ApproveRequest,
) -> Result<Consent> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .approve(request)
}
#[tauri::command]
fn start_plan(
    window: WebviewWindow,
    state: State<AppStore>,
    request: StartRequest,
) -> Result<CaseRecord> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .start(request)
}
#[tauri::command]
fn export_case(
    window: WebviewWindow,
    state: State<AppStore>,
    request: ExportRequest,
) -> Result<ExportResult> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .export(request)
}
#[tauri::command]
fn delete_case(window: WebviewWindow, state: State<AppStore>, request: CaseRequest) -> Result<()> {
    access(&window)?;
    state
        .lock()
        .map_err(|_| "案例服务暂不可用。")?
        .delete(&request.case_id)
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let path = app.path().app_local_data_dir()?;
            std::fs::create_dir_all(&path)?;
            let store =
                Store::open(&path.join("metadata.sqlite")).map_err(std::io::Error::other)?;
            app.manage(Mutex::new(store));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_app_status,
            create_case,
            get_case,
            list_cases,
            build_plan,
            approve_plan,
            start_plan,
            export_case,
            delete_case
        ])
        .run(tauri::generate_context!())
        .expect("Sentinel PC could not initialize");
}
