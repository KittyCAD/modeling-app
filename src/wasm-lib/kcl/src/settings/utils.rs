//! Utility functions for settings.

use std::path::PathBuf;

use anyhow::Result;

use crate::settings::types::file::FileEntry;

/// Walk a directory recursively and return a list of all files.
#[async_recursion::async_recursion]
pub async fn walk_dir(dir: PathBuf) -> Result<FileEntry> {
    let mut entry = FileEntry {
        name: dir
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("No file name"))?
            .to_string_lossy()
            .to_string(),
        path: dir.display().to_string(),
        children: None,
    };

    let mut children = vec![];

    let mut entries = tokio::fs::read_dir(&dir).await?;
    while let Some(e) = entries.next_entry().await? {
        if e.file_type().await?.is_dir() {
            children.push(walk_dir(e.path()).await?);
        } else {
            children.push(FileEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: e.path().display().to_string(),
                children: None,
            });
        }
    }

    if !children.is_empty() {
        entry.children = Some(children);
    }

    Ok(entry)
}
