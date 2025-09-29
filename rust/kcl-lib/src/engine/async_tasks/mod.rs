#[cfg(not(target_arch = "wasm32"))]
pub mod tasks;
#[cfg(target_arch = "wasm32")]
pub mod tasks_wasm;

#[cfg(not(target_arch = "wasm32"))]
pub use tasks::AsyncTasks;
#[cfg(target_arch = "wasm32")]
pub use tasks_wasm::AsyncTasks;
