//! Types for interacting with files in projects.

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::Configuration;

/// State management for the application.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectState {
    pub project: Project,
    pub current_file: Option<String>,
}

/// Project route information.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectRoute {
    pub project_name: String,
    pub project_path: String,
    pub current_file_name: String,
    pub current_file_path: String,
}

impl ProjectRoute {
    /// Get the project state from the url in the route.
    pub fn from_route(configuration: &Configuration, route: &str) -> Result<Self> {
        let path = std::path::Path::new(route);
        // Check if the default project path is in the route.
        let (project_path, project_name) = if path.starts_with(&configuration.settings.project.directory)
            && configuration.settings.project.directory != std::path::PathBuf::default()
        {
            // Get the project name.
            let project_name = path
                .strip_prefix(&configuration.settings.project.directory)
                .unwrap()
                .iter()
                .next()
                .ok_or_else(|| anyhow::anyhow!("Project name not found: {}", path.display()))?
                .to_string_lossy()
                .to_string();
            (
                configuration
                    .settings
                    .project
                    .directory
                    .join(&project_name)
                    .display()
                    .to_string(),
                project_name,
            )
        } else {
            // Assume the project path is the parent directory of the file.
            let project_dir = path
                .parent()
                .ok_or_else(|| anyhow::anyhow!("Parent directory not found: {}", path.display()))?;
            let project_name = project_dir
                .file_name()
                .ok_or_else(|| anyhow::anyhow!("Project name not found: {}", path.display()))?;
            (
                project_dir.display().to_string(),
                project_name.to_string_lossy().to_string(),
            )
        };

        let current_file_name = path
            .file_name()
            .ok_or_else(|| anyhow::anyhow!("File name not found: {}", path.display()))?
            .to_string_lossy()
            .to_string();

        Ok(Self {
            project_name,
            project_path,
            current_file_name,
            current_file_path: path.display().to_string(),
        })
    }
}

/// Information about project.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Project {
    #[serde(flatten)]
    pub file: FileEntry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<FileMetadata>,
    #[serde(default)]
    #[ts(type = "number")]
    pub kcl_file_count: u64,
    #[serde(default)]
    #[ts(type = "number")]
    pub directory_count: u64,
}

impl Project {
    #[cfg(not(target_arch = "wasm32"))]
    /// Populate a project from a path.
    pub async fn from_path<P: AsRef<std::path::Path>>(path: P) -> Result<Self> {
        // Check if they are using '.' as the path.
        let path = if path.as_ref() == std::path::Path::new(".") {
            std::env::current_dir()?
        } else {
            path.as_ref().to_path_buf()
        };

        // Make sure the path exists.
        if !path.exists() {
            return Err(anyhow::anyhow!("Path does not exist"));
        }

        let file = crate::settings::utils::walk_dir(&path).await?;
        let metadata = std::fs::metadata(path).ok().map(|m| m.into());
        let mut project = Self {
            file,
            metadata,
            kcl_file_count: 0,
            directory_count: 0,
        };
        project.populate_kcl_file_count()?;
        project.populate_directory_count()?;
        Ok(project)
    }

    /// Populate the number of KCL files in the project.
    pub fn populate_kcl_file_count(&mut self) -> Result<()> {
        let mut count = 0;
        if let Some(children) = &self.file.children {
            for entry in children.iter() {
                if entry.name.ends_with(".kcl") {
                    count += 1;
                } else {
                    count += entry.kcl_file_count();
                }
            }
        }

        self.kcl_file_count = count;
        Ok(())
    }

    /// Populate the number of directories in the project.
    pub fn populate_directory_count(&mut self) -> Result<()> {
        let mut count = 0;
        if let Some(children) = &self.file.children {
            for entry in children.iter() {
                count += entry.directory_count();
            }
        }

        self.directory_count = count;
        Ok(())
    }
}

/// Information about a file or directory.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileEntry>>,
}

impl FileEntry {
    /// Recursively get the number of kcl files in the file entry.
    pub fn kcl_file_count(&self) -> u64 {
        let mut count = 0;
        if let Some(children) = &self.children {
            for entry in children.iter() {
                if entry.name.ends_with(".kcl") {
                    count += 1;
                } else {
                    count += entry.kcl_file_count();
                }
            }
        }
        count
    }

    /// Recursively get the number of directories in the file entry.
    pub fn directory_count(&self) -> u64 {
        let mut count = 0;
        if let Some(children) = &self.children {
            for entry in children.iter() {
                if entry.children.is_some() {
                    count += 1;
                }
            }
        }
        count
    }
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

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    #[test]
    fn test_project_route_from_route_std_path() {
        let mut configuration = crate::settings::types::Configuration::default();
        configuration.settings.project.directory =
            std::path::PathBuf::from("/Users/macinatormax/Documents/kittycad-modeling-projects");

        let route = "/Users/macinatormax/Documents/kittycad-modeling-projects/assembly/main.kcl";
        let state = super::ProjectRoute::from_route(&configuration, route).unwrap();
        assert_eq!(
            state,
            super::ProjectRoute {
                project_name: "assembly".to_string(),
                project_path: "/Users/macinatormax/Documents/kittycad-modeling-projects/assembly".to_string(),
                current_file_name: "main.kcl".to_string(),
                current_file_path: "/Users/macinatormax/Documents/kittycad-modeling-projects/assembly/main.kcl"
                    .to_string(),
            }
        );
    }

    #[test]
    fn test_project_route_from_route_outside_std_path() {
        let mut configuration = crate::settings::types::Configuration::default();
        configuration.settings.project.directory =
            std::path::PathBuf::from("/Users/macinatormax/Documents/kittycad-modeling-projects");

        let route = "/Users/macinatormax/kittycad/modeling-app/main.kcl";
        let state = super::ProjectRoute::from_route(&configuration, route).unwrap();
        assert_eq!(
            state,
            super::ProjectRoute {
                project_name: "modeling-app".to_string(),
                project_path: "/Users/macinatormax/kittycad/modeling-app".to_string(),
                current_file_name: "main.kcl".to_string(),
                current_file_path: "/Users/macinatormax/kittycad/modeling-app/main.kcl".to_string(),
            }
        );
    }

    #[test]
    fn test_project_route_from_route_browser() {
        let mut configuration = crate::settings::types::Configuration::default();
        configuration.settings.project.directory = std::path::PathBuf::default();

        let route = "/browser/main.kcl";
        let state = super::ProjectRoute::from_route(&configuration, route).unwrap();
        assert_eq!(
            state,
            super::ProjectRoute {
                project_name: "browser".to_string(),
                project_path: "/browser".to_string(),
                current_file_name: "main.kcl".to_string(),
                current_file_path: "/browser/main.kcl".to_string(),
            }
        );
    }
}
