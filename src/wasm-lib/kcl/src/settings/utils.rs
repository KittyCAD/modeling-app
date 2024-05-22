//! Utility functions for settings.

use std::path::Path;

use anyhow::Result;
use clap::ValueEnum;

use crate::settings::types::file::FileEntry;

lazy_static::lazy_static! {

    pub static ref IMPORT_FILE_EXTENSIONS: Vec<String> = {
        let mut import_file_extensions = vec!["stp".to_string(), "glb".to_string(), "fbxb".to_string()];
        let named_extensions = kittycad::types::FileImportFormat::value_variants()
            .iter()
            .map(|x| format!("{}", x))
            .collect::<Vec<String>>();
        // Add all the default import formats.
        import_file_extensions.extend_from_slice(&named_extensions);
        import_file_extensions
    };

    pub static ref RELEVANT_EXTENSIONS: Vec<String> = {
        let mut relevant_extensions = IMPORT_FILE_EXTENSIONS.clone();
        relevant_extensions.push("kcl".to_string());
        relevant_extensions
    };
}

/// Walk a directory recursively and return a list of all files.
#[async_recursion::async_recursion]
pub async fn walk_dir<P>(dir: P) -> Result<FileEntry>
where
    P: AsRef<Path> + Send,
{
    // Make sure the path is a directory.
    if !dir.as_ref().is_dir() {
        return Err(anyhow::anyhow!("Path `{}` is not a directory", dir.as_ref().display()));
    }

    // Make sure the directory exists.
    if !dir.as_ref().exists() {
        return Err(anyhow::anyhow!("Directory `{}` does not exist", dir.as_ref().display()));
    }

    let mut entry = FileEntry {
        name: dir
            .as_ref()
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("No file name"))?
            .to_string_lossy()
            .to_string(),
        path: dir.as_ref().display().to_string(),
        children: None,
    };

    let mut children = vec![];

    let mut entries = tokio::fs::read_dir(&dir.as_ref()).await?;
    while let Some(e) = entries.next_entry().await? {
        // ignore hidden files and directories (starting with a dot)
        if e.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        if e.file_type().await?.is_dir() {
            children.push(walk_dir(&e.path()).await?);
        } else {
            if !is_relevant_file(&e.path())? {
                continue;
            }
            children.push(FileEntry {
                name: e.file_name().to_string_lossy().to_string(),
                path: e.path().display().to_string(),
                children: None,
            });
        }
    }

    // We don't set this to none if there are no children, because it's a directory.
    entry.children = Some(children);

    Ok(entry)
}

/// Check if a file is relevant for the application.
fn is_relevant_file<P: AsRef<Path>>(path: P) -> Result<bool> {
    if let Some(ext) = path.as_ref().extension() {
        Ok(RELEVANT_EXTENSIONS.contains(&ext.to_string_lossy().to_string()))
    } else {
        Ok(false)
    }
}
