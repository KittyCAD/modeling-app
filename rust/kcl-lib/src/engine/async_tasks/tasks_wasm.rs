//! This module contains the wasm-specific `AsyncTasks` struct, which is used to manage a set of asynchronous
//! tasks.

use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use tokio::sync::RwLock;

use crate::errors::KclError;

#[derive(Debug, Clone)]
pub struct AsyncTasks {
    sender: Arc<RwLock<tokio::sync::mpsc::Sender<Result<(), KclError>>>>,
    receiver: Arc<RwLock<tokio::sync::mpsc::Receiver<Result<(), KclError>>>>,
    sent: Arc<AtomicUsize>,
}

// Safety: single-threaded wasm ⇒ these are sound.
unsafe impl Send for AsyncTasks {}
unsafe impl Sync for AsyncTasks {}

impl AsyncTasks {
    pub fn new() -> Self {
        let (results_tx, results_rx) = tokio::sync::mpsc::channel(10);
        Self {
            sender: Arc::new(RwLock::new(results_tx)),
            receiver: Arc::new(RwLock::new(results_rx)),
            sent: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub async fn spawn<F>(&mut self, task: F)
    where
        F: std::future::Future<Output = anyhow::Result<(), KclError>>,
        F: Send + 'static,
    {
        // Add one to the sent counter.
        self.sent.fetch_add(1, Ordering::Relaxed);

        let counter = self.sent.load(Ordering::Acquire);

        // Spawn the task and send the result to the channel.
        let sender_clone = self.sender.clone();
        wasm_bindgen_futures::spawn_local(async move {
            web_sys::console::log_1(&format!("Task {} started", counter).into());
            let result = task.await;
            let sender = sender_clone.read().await;
            if let Err(_) = sender.send(result).await {
                web_sys::console::error_1(&"Failed to send result".into());
            }
            web_sys::console::log_1(&format!("Task {} finished", counter).into());
        });
    }

    // Wait for all tasks to finish.
    // Return an error if any of them failed.
    pub async fn join_all(&mut self) -> anyhow::Result<(), KclError> {
        if self.sent.load(Ordering::Acquire) == 0 {
            return Ok(());
        }

        let mut results = Vec::new();
        let mut receiver = self.receiver.write().await;

        web_sys::console::log_1(&format!("Waiting for {} tasks to finish", self.sent.load(Ordering::Acquire)).into());

        // Wait for all tasks to finish.
        loop {
            let result = receiver.recv().await;
            match result {
                Some(result) => {
                    results.push(result);

                    if results.len() == self.sent.load(Ordering::Acquire) {
                        // All tasks have finished.
                        break;
                    }
                }
                None => {
                    // The channel is closed, which means all tasks have finished.
                    break;
                }
            }
        }

        // Reset the sent counter.
        self.sent.store(0, Ordering::Release);

        web_sys::console::log_1(&format!("Received {} results", results.len()).into());

        // Check if any of the tasks failed.
        for result in results {
            result?;
        }

        Ok(())
    }

    pub async fn clear(&mut self) {
        web_sys::console::log_1(&"Clearing tasks".into());

        // Clear the sent counter.
        self.sent.store(0, Ordering::Release);

        // Clear the channel.
        let (results_tx, results_rx) = tokio::sync::mpsc::channel(1);
        *self.sender.write().await = results_tx;
        *self.receiver.write().await = results_rx;
    }
}

impl Default for AsyncTasks {
    fn default() -> Self {
        Self::new()
    }
}
