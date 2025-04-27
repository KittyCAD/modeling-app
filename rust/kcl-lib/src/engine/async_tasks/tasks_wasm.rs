//! This module contains the `AsyncTasks` struct, which is used to manage a set of asynchronous
//! tasks.

use std::{ops::AddAssign, sync::Arc};

use tokio::sync::RwLock;

use crate::errors::KclError;

#[derive(Debug, Clone)]
pub struct AsyncTasks {
    pub sender: Arc<RwLock<tokio::sync::mpsc::Sender<Result<(), KclError>>>>,
    pub receiver: Arc<RwLock<tokio::sync::mpsc::Receiver<Result<(), KclError>>>>,
    pub sent: Arc<RwLock<usize>>,
}

impl AsyncTasks {
    pub fn new() -> Self {
        let (results_tx, results_rx) = tokio::sync::mpsc::channel(1);
        Self {
            sender: Arc::new(RwLock::new(results_tx)),
            receiver: Arc::new(RwLock::new(results_rx)),
            sent: Arc::new(RwLock::new(0)),
        }
    }

    pub async fn spawn<F>(&mut self, task: F)
    where
        F: std::future::Future<Output = anyhow::Result<(), KclError>>,
        F: Send + 'static,
    {
        // Add one to the sent counter.
        self.sent.write().await.add_assign(1);

        // Spawn the task and send the result to the channel.
        let sender_clone = self.sender.clone();
        wasm_bindgen_futures::spawn_local(async move {
            let result = task.await;
            let sender = sender_clone.read().await;
            if let Err(_) = sender.send(result).await {
                web_sys::console::error_1(&"Failed to send result".into());
            }
        });
    }

    // Wait for all tasks to finish.
    // Return an error if any of them failed.
    pub async fn join_all(&mut self) -> anyhow::Result<(), KclError> {
        if *self.sent.read().await == 0 {
            return Ok(());
        }

        let mut results = Vec::new();
        let mut receiver = self.receiver.write().await;

        // Wait for all tasks to finish.
        while let Some(result) = receiver.recv().await {
            results.push(result);

            // Check if all tasks have finished.
            if results.len() == *self.sent.read().await {
                break;
            }
        }

        // Check if any of the tasks failed.
        for result in results {
            result?;
        }

        Ok(())
    }

    pub async fn clear(&mut self) {
        // Clear the sent counter.
        *self.sent.write().await = 0;

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
