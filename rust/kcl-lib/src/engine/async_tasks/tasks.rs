//! This module contains the `AsyncTasks` struct, which is used to manage a set of asynchronous
//! tasks.

use std::sync::Arc;

use tokio::sync::RwLock;

use crate::errors::KclError;

#[derive(Debug, Clone)]
pub struct AsyncTasks {
    pub tasks: Arc<RwLock<tokio::task::JoinSet<anyhow::Result<(), KclError>>>>,
}

impl AsyncTasks {
    pub fn new() -> Self {
        Self {
            tasks: Arc::new(RwLock::new(tokio::task::JoinSet::new())),
        }
    }

    pub async fn spawn<F>(&mut self, task: F)
    where
        F: std::future::Future<Output = anyhow::Result<(), KclError>>,
        F: Send + 'static,
    {
        self.tasks.write().await.spawn(task);
    }

    // Wait for all tasks to finish.
    // Return an error if any of them failed.
    pub async fn join_all(&mut self) -> anyhow::Result<(), KclError> {
        let tasks = std::mem::take(&mut *self.tasks.write().await);
        let results = tasks.join_all().await;
        for result in results {
            result?;
        }

        Ok(())
    }

    pub async fn clear(&mut self) {
        *self.tasks.write().await = tokio::task::JoinSet::new();
    }
}

impl Default for AsyncTasks {
    fn default() -> Self {
        Self::new()
    }
}
