//! State management for the application.

use kcl_lib::settings::types::file::ProjectState;
use tokio::sync::Mutex;

#[derive(Debug, Default)]
pub struct Store(Mutex<Option<ProjectState>>);

impl Store {
    pub fn new(p: ProjectState) -> Self {
        Self(Mutex::new(Some(p)))
    }

    pub async fn get(&self) -> Option<ProjectState> {
        self.0.lock().await.clone()
    }

    #[allow(dead_code)]
    pub async fn set(&self, p: ProjectState) {
        *self.0.lock().await = Some(p);
    }
}
