//! No IPC accepts a Command. Only fixed collectors / registered tool actions construct one.
use std::{
    io::{Read, Write},
    process::{Command, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};

#[derive(Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::SeqCst);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::SeqCst)
    }
}
#[derive(Debug)]
pub struct ProcessOutput {
    pub status: String,
    pub exit_code: Option<i32>,
    pub stdout: Vec<u8>,
    pub stderr: Vec<u8>,
}

pub(crate) fn execute(
    mut command: Command,
    input: Vec<u8>,
    timeout: Duration,
    limit: usize,
    cancel: &Cancellation,
) -> crate::Result<ProcessOutput> {
    if cancel.is_cancelled() {
        return Ok(ProcessOutput {
            status: "cancelled".into(),
            exit_code: None,
            stdout: vec![],
            stderr: vec![],
        });
    }
    if timeout.is_zero() || timeout > Duration::from_secs(120) || limit > 20 * 1024 * 1024 {
        return Err("运行预算无效。".into());
    }
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000 | 0x00000004); // hidden + suspended, attach job before any code executes
    }
    #[cfg(not(windows))]
    {
        let _ = command;
        let _ = input;
        return Err("受控进程执行仅支持 Windows。".into());
    }
    #[cfg(windows)]
    {
        let mut child = command.spawn().map_err(|_| "无法启动受控进程。")?;
        let job = match windows_job::Job::attach(&child) {
            Ok(j) => j,
            Err(e) => {
                let _ = child.kill();
                let _ = child.wait();
                return Err(e);
            }
        };
        let mut stdin = child.stdin.take().ok_or("无法创建输入管道。")?;
        let writer = std::thread::spawn(move || {
            let _ = stdin.write_all(&input);
        });
        let used = Arc::new(AtomicUsize::new(0));
        let exceeded = Arc::new(AtomicBool::new(false));
        fn read_pipe(
            mut pipe: impl Read,
            used: Arc<AtomicUsize>,
            exceeded: Arc<AtomicBool>,
            limit: usize,
        ) -> Vec<u8> {
            let mut bytes = Vec::new();
            let mut buffer = [0; 8192];
            loop {
                match pipe.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let before = used.fetch_add(n, Ordering::SeqCst);
                        let keep = n.min(limit.saturating_sub(before));
                        bytes.extend_from_slice(&buffer[..keep]);
                        if keep < n {
                            exceeded.store(true, Ordering::SeqCst);
                        }
                    }
                }
            }
            bytes
        }
        let stdout = child.stdout.take().ok_or("无法创建输出管道。")?;
        let stderr = child.stderr.take().ok_or("无法创建错误管道。")?;
        let (u, e) = (used.clone(), exceeded.clone());
        let out = std::thread::spawn(move || read_pipe(stdout, u, e, limit));
        let (u, e) = (used.clone(), exceeded.clone());
        let err = std::thread::spawn(move || read_pipe(stderr, u, e, limit));
        let start = Instant::now();
        let (mut status, exit_code) = loop {
            let why = if cancel.is_cancelled() {
                Some("cancelled")
            } else if exceeded.load(Ordering::SeqCst) {
                Some("truncated")
            } else if start.elapsed() >= timeout {
                Some("timed_out")
            } else {
                None
            };
            if let Some(why) = why {
                job.terminate();
                let _ = child.wait();
                break (why.to_string(), None);
            }
            match child.try_wait() {
                Ok(Some(code)) => {
                    break (
                        (if code.success() {
                            "completed"
                        } else {
                            "failed"
                        })
                        .into(),
                        code.code(),
                    );
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(15)),
                Err(_) => {
                    job.terminate();
                    let _ = child.wait();
                    break ("failed".into(), None);
                }
            }
        };
        // Also kill descendants retaining pipe handles after their parent exits.
        job.terminate();
        let stdout = out.join().map_err(|_| "输出读取失败。")?;
        let stderr = err.join().map_err(|_| "错误输出读取失败。")?;
        let _ = writer.join();
        if exceeded.load(Ordering::SeqCst) && status != "cancelled" {
            status = "truncated".into();
        }
        Ok(ProcessOutput {
            status,
            exit_code,
            stdout,
            stderr,
        })
    }
}

#[cfg(windows)]
mod windows_job {
    use std::{ffi::c_void, os::windows::io::AsRawHandle, process::Child};
    type Handle = *mut c_void;
    #[repr(C)]
    #[derive(Default)]
    struct Basic {
        process_time: i64,
        job_time: i64,
        flags: u32,
        min_ws: usize,
        max_ws: usize,
        active: u32,
        affinity: usize,
        priority: u32,
        scheduling: u32,
    }
    #[repr(C)]
    #[derive(Default)]
    struct Limits {
        basic: Basic,
        io: [u64; 6],
        process_memory: usize,
        job_memory: usize,
        peak_process: usize,
        peak_job: usize,
    }
    #[repr(C)]
    struct ThreadEntry {
        size: u32,
        usage: u32,
        id: u32,
        owner: u32,
        priority: i32,
        base: i32,
        flags: u32,
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CreateJobObjectW(attributes: Handle, name: *const u16) -> Handle;
        fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
        fn AssignProcessToJobObject(job: Handle, process: Handle) -> i32;
        fn TerminateJobObject(job: Handle, code: u32) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn CreateToolhelp32Snapshot(flags: u32, pid: u32) -> Handle;
        fn Thread32First(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn Thread32Next(snapshot: Handle, entry: *mut ThreadEntry) -> i32;
        fn OpenThread(access: u32, inherit: i32, id: u32) -> Handle;
        fn ResumeThread(thread: Handle) -> u32;
    }
    pub struct Job(Handle);
    impl Job {
        pub fn attach(child: &Child) -> crate::Result<Self> {
            // https://learn.microsoft.com/windows/win32/procthread/job-objects
            unsafe {
                let handle = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
                if handle.is_null() {
                    return Err("无法创建进程作业，已阻止执行。".into());
                }
                let job = Self(handle);
                let mut limits = Limits::default();
                limits.basic.flags = 0x2000;
                if SetInformationJobObject(
                    handle,
                    9,
                    &limits as *const _ as *const c_void,
                    std::mem::size_of::<Limits>() as u32,
                ) == 0
                    || AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                {
                    return Err("无法约束进程树，已阻止执行。".into());
                }
                let snapshot = CreateToolhelp32Snapshot(4, 0);
                if snapshot as isize == -1 {
                    return Err("无法恢复受控进程。".into());
                }
                let mut entry = ThreadEntry {
                    size: std::mem::size_of::<ThreadEntry>() as u32,
                    usage: 0,
                    id: 0,
                    owner: 0,
                    priority: 0,
                    base: 0,
                    flags: 0,
                };
                let mut ok = Thread32First(snapshot, &mut entry);
                let mut resumed = false;
                while ok != 0 {
                    if entry.owner == child.id() {
                        let thread = OpenThread(2, 0, entry.id);
                        if !thread.is_null() {
                            resumed = ResumeThread(thread) != u32::MAX;
                            CloseHandle(thread);
                            break;
                        }
                    }
                    ok = Thread32Next(snapshot, &mut entry);
                }
                CloseHandle(snapshot);
                if !resumed {
                    return Err("无法恢复受控进程。".into());
                }
                Ok(job)
            }
        }
        pub fn terminate(&self) {
            unsafe {
                TerminateJobObject(self.0, 1);
            }
        }
    }
    impl Drop for Job {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    fn cmd(script: &str) -> Command {
        let mut c = Command::new(r"C:\Windows\System32\cmd.exe");
        c.args(["/D", "/C", script]);
        c
    }
    #[test]
    fn output_and_nonzero_exit_are_preserved() {
        let r = execute(
            cmd("echo test& exit /b 8"),
            vec![],
            Duration::from_secs(3),
            1024,
            &Cancellation::default(),
        )
        .unwrap();
        assert_eq!(r.exit_code, Some(8));
        assert_eq!(r.status, "failed");
        assert!(r.stdout.starts_with(b"test"));
    }
    #[test]
    fn timeout_and_cancellation_kill_owned_tree() {
        let helper = || {
            let mut c = Command::new(std::env::current_exe().unwrap());
            c.args([
                "--exact",
                "runner::tests::owned_child_helper",
                "--nocapture",
            ])
            .env("SENTINEL_RUNNER_TEST_CHILD", "1");
            c
        };
        let r = execute(
            helper(),
            vec![],
            Duration::from_millis(100),
            1024,
            &Cancellation::default(),
        )
        .unwrap();
        assert_eq!(r.status, "timed_out");
        let c = Cancellation::default();
        let trigger = c.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(100));
            trigger.cancel();
        });
        let r = execute(helper(), vec![], Duration::from_secs(3), 1024, &c).unwrap();
        assert_eq!(r.status, "cancelled");
    }
    #[test]
    fn owned_child_helper() {
        if std::env::var_os("SENTINEL_RUNNER_TEST_CHILD").is_some() {
            std::thread::sleep(Duration::from_secs(30));
        }
    }
    #[test]
    fn output_budget_is_combined_and_bounded() {
        let r = execute(
            cmd("for /L %i in (1,1,9000) do @echo abcdefghijklmnopqrstuvwxyz"),
            vec![],
            Duration::from_secs(3),
            500,
            &Cancellation::default(),
        )
        .unwrap();
        assert_eq!(r.status, "truncated");
        assert!(r.stdout.len() + r.stderr.len() <= 500);
    }
}
