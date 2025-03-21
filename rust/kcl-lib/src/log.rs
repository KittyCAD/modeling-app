#![allow(dead_code)]
use std::env;

#[cfg(feature = "dhat-heap")]
use dhat::{HeapStats, Profiler};
use web_time::Instant;

const LOG_ENV_VAR: &str = "ZOO_LOG";
const FORCE_LOGGING: bool = false;

lazy_static::lazy_static! {
    static ref ENABLED: bool = {
        if FORCE_LOGGING {
            return true;
        }
        let env_var = env::var(LOG_ENV_VAR);
        let Ok(env_var) = env_var else {
            return false;
        };
        !env_var.is_empty()
    };
}

#[cfg(feature = "dhat-heap")]
lazy_static::lazy_static! {
    static ref PROFILER: Profiler = Profiler::builder().testing().build();
}

/// Log a message
pub(crate) fn log(msg: impl Into<String>) {
    if *ENABLED {
        log_inner(msg.into());
    }
}

#[allow(unused_macros)]
macro_rules! logln {
    ($($rest:tt)*) => {
        crate::log::log(format!($($rest)*))
    }
}
pub(crate) use logln;

#[cfg(any(test, all(not(feature = "disable-println"), not(target_arch = "wasm32"))))]
#[inline]
fn log_inner(msg: String) {
    eprintln!("{msg}");
}

#[cfg(all(not(feature = "disable-println"), target_arch = "wasm32"))]
#[inline]
fn log_inner(msg: String) {
    web_sys::console::log_1(&msg.into());
}

#[cfg(all(feature = "disable-println", not(test)))]
#[inline]
fn log_inner(_msg: String) {}

/// A helper struct for recording and logging basic performance metrics.
///
/// It will log the metrics when dropped or if `log_now` is called.
pub(crate) struct LogPerfStats<'a> {
    msg: &'a str,
    start_time: Instant,
    #[cfg(feature = "dhat-heap")]
    start_stats: HeapStats,
    cancelled: bool,
}

impl<'a> LogPerfStats<'a> {
    #[cfg(not(feature = "dhat-heap"))]
    pub fn new(msg: &'a str) -> Self {
        LogPerfStats {
            msg,
            start_time: Instant::now(),
            cancelled: false,
        }
    }

    #[cfg(feature = "dhat-heap")]
    pub fn new(msg: &'a str) -> Self {
        lazy_static::initialize(&PROFILER);
        LogPerfStats {
            msg,
            start_time: Instant::now(),
            start_stats: HeapStats::get(),
            cancelled: false,
        }
    }

    pub fn log_now(&self) {
        let time = Instant::now().duration_since(self.start_time).as_secs_f64() * 1000.0;
        logln!("{}\n  time: {time:.3}ms", self.msg);
        #[cfg(feature = "dhat-heap")]
        {
            let stats = HeapStats::get();
            let blocks = stats.total_blocks - self.start_stats.total_blocks;
            let bytes = (stats.total_bytes - self.start_stats.total_bytes) as f64 / 1_000_000.0;
            let cur = stats.curr_bytes as f64 / 1000.0;
            let max = stats.curr_bytes as f64 / 1000.0;

            logln!("  memory:");
            logln!("    allocations:          {bytes:.5} MB ({blocks} blocks)");
            logln!("    currently allocated:  {cur:.3} KB");
            logln!("    max allocated:        {max:.3} KB");
        }
    }

    /// After `cancel`ing, this object will not log its stats on drop (you can still `log_now`).
    pub fn cancel(&mut self) {
        self.cancelled = true;
    }
}

impl Drop for LogPerfStats<'_> {
    fn drop(&mut self) {
        if !self.cancelled {
            self.log_now();
        }
    }
}
