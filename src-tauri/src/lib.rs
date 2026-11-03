#[cfg(target_os = "windows")]
use tauri::Manager;

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        RegisterWindowMessageW, RegisterClassW,
        CreateWindowExW, DefWindowProcW, GetMessageW, TranslateMessage,
        DispatchMessageW, MSG, WNDCLASSW, SetWindowPos, GetWindowLongPtrW,
        SetWindowLongPtrW,
        GWL_EXSTYLE, WS_EX_TOOLWINDOW, WS_EX_NOACTIVATE,
        SWP_NOMOVE, SWP_NOSIZE, SWP_NOACTIVATE,
        CS_HREDRAW, CS_VREDRAW,
    },
};

#[cfg(target_os = "windows")]
fn to_wstr(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

// 简单的全局存储，以便消息回调可访问目标窗口
#[cfg(target_os = "windows")]
static mut DESKNOTE_TARGET: HWND = std::ptr::null_mut();
#[cfg(target_os = "windows")]
static mut TASKBAR_MSG_ID: u32 = 0;

// 将窗口设置到桌面底层：高于壁纸，低于所有普通窗口
#[cfg(target_os = "windows")]
unsafe fn set_window_to_bottom(hwnd: HWND) {
    if hwnd == std::ptr::null_mut() { return; }

    // 设置窗口扩展样式：ToolWindow + NoActivate
    let mut ex_style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
    ex_style |= WS_EX_TOOLWINDOW as isize;
    ex_style |= WS_EX_NOACTIVATE as isize;
    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex_style);

    // 将窗口放到最底层（高于壁纸，低于其他窗口）
    // 位置由前端统一设置；Explorer 重启时仅恢复层级，不重置位置。
    // HWND_BOTTOM 表示放在所有非顶层窗口的下方
    SetWindowPos(
        hwnd,
        1isize as *mut _, // HWND_BOTTOM = 1
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
    );
}

// 监听 TaskbarCreated 消息的隐藏窗口线程
#[cfg(target_os = "windows")]
fn start_taskbar_monitor(target_hwnd: HWND) {
    unsafe {
        DESKNOTE_TARGET = target_hwnd;
    }

    std::thread::spawn(move || unsafe {
        // 注册 TaskbarCreated 消息 ID
        let msg_id = RegisterWindowMessageW(to_wstr("TaskbarCreated").as_ptr());
        TASKBAR_MSG_ID = msg_id;

        // 准备窗口类名
        let class_name = to_wstr("DeskNoteMonitorClass");

        let wnd_class = WNDCLASSW {
            lpfnWndProc: Some(monitor_wndproc),
            hInstance: std::ptr::null_mut(),
            lpszClassName: class_name.as_ptr(),
            style: CS_HREDRAW | CS_VREDRAW,
            ..std::mem::zeroed()
        };

        RegisterClassW(&wnd_class);

        // 创建一个隐藏窗口来接收广播消息
        let _hwnd = CreateWindowExW(
            0,
            class_name.as_ptr(),
            to_wstr("DeskNoteMonitor").as_ptr(),
            0,
            0,
            0,
            0,
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        );

        // 消息循环
        let mut msg: MSG = std::mem::zeroed();
        loop {
            let ret = GetMessageW(&mut msg as *mut MSG, std::ptr::null_mut(), 0, 0);
            if ret <= 0 {
                break;
            }

            TranslateMessage(&msg as *const MSG);
            DispatchMessageW(&msg as *const MSG);
        }
    });
}

// 隐藏窗口的 wndproc
#[cfg(target_os = "windows")]
extern "system" fn monitor_wndproc(hwnd: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
    unsafe {
        if msg == TASKBAR_MSG_ID as u32 {
            let target = DESKNOTE_TARGET;
            if target != std::ptr::null_mut() {
                set_window_to_bottom(target);
            }
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .setup(|app| {
            #[cfg(target_os = "windows")]
            {
                let window = app.get_webview_window("main").expect("找不到 main 窗口");
                let hwnd = window.hwnd().unwrap().0 as HWND;

                unsafe {
                    // 设置窗口到桌面底层
                    set_window_to_bottom(hwnd);
                    // 前端完成工作区 / DPI 定位后再显示，避免先露出屏幕外的窗口。
                }

                // 启动 TaskbarCreated 监听器
                start_taskbar_monitor(hwnd);
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
