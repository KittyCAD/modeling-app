//! Types for interacting with files in projects.

use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// Information about project.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Project {
    #[serde(flatten)]
    pub file: FileEntry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<FileMetadata>,
}

/// Information about a file or directory.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<FileEntry>,
}

/// Metadata about a file or directory.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct FileMetadata {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accessed: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub r#type: Option<FileType>,
    #[serde(default)]
    #[ts(type = "number")]
    pub size: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub permission: Option<FilePermission>,
}

/// The type of a file.
#[derive(Debug, Copy, Clone, Deserialize, Serialize, JsonSchema, Display, FromStr, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum FileType {
    /// A file.
    File,
    /// A directory.
    Directory,
    /// A symbolic link.
    Symlink,
}

/// The permissions of a file.
#[derive(Debug, Copy, Clone, Deserialize, Serialize, JsonSchema, Display, FromStr, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum FilePermission {
    /// Read permission.
    Read,
    /// Write permission.
    Write,
    /// Execute permission.
    Execute,
}

impl From<std::fs::FileType> for FileType {
    fn from(file_type: std::fs::FileType) -> Self {
        if file_type.is_file() {
            FileType::File
        } else if file_type.is_dir() {
            FileType::Directory
        } else if file_type.is_symlink() {
            FileType::Symlink
        } else {
            unreachable!()
        }
    }
}

impl From<std::fs::Permissions> for FilePermission {
    fn from(permissions: std::fs::Permissions) -> Self {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = permissions.mode();
            if mode & 0o400 != 0 {
                FilePermission::Read
            } else if mode & 0o200 != 0 {
                FilePermission::Write
            } else if mode & 0o100 != 0 {
                FilePermission::Execute
            } else {
                unreachable!()
            }
        }
        #[cfg(not(unix))]
        {
            if permissions.readonly() {
                FilePermission::Read
            } else {
                FilePermission::Write
            }
        }
    }
}

impl From<std::fs::Metadata> for FileMetadata {
    fn from(metadata: std::fs::Metadata) -> Self {
        Self {
            accessed: metadata.accessed().ok().map(|t| t.into()),
            created: metadata.created().ok().map(|t| t.into()),
            r#type: Some(metadata.file_type().into()),
            size: metadata.len(),
            modified: metadata.modified().ok().map(|t| t.into()),
            permission: Some(metadata.permissions().into()),
        }
    }
}
