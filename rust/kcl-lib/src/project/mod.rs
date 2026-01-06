#![allow(dead_code)]

use std::sync::Arc;

use indexmap::IndexMap;
use tokio::sync::RwLock;

use crate::front::{Error, FileId, LifecycleApi, ProjectId, Result, SceneGraph, Version};

#[derive(Debug, Clone)]
pub struct Project {
    id: ProjectId,
    files: IndexMap<FileId, File>,
    open_file: FileId,
    cur_version: Version,
}

impl Project {
    fn scene_graph(&self) -> SceneGraph {
        SceneGraph::empty(self.id, self.open_file, self.cur_version)
    }
}

#[derive(Debug, Clone)]
struct File {
    version: Version,
    path: String,
    text: String,
}

lazy_static::lazy_static! {
        static ref PROJECT: Arc<RwLock<Option<Project>>> = Default::default();
}

#[derive(Debug, Clone)]
pub struct ProjectManager;

impl ProjectManager {
    async fn with_project<T>(f: impl FnOnce(&Option<Project>) -> T) -> T {
        f(&*PROJECT.read().await)
    }

    async fn with_project_mut<T>(f: impl FnOnce(&mut Option<Project>) -> T) -> T {
        f(&mut *PROJECT.write().await)
    }
}

impl LifecycleApi for ProjectManager {
    async fn open_project(&self, id: ProjectId, files: Vec<crate::front::File>, open_file: FileId) -> Result<()> {
        Self::with_project_mut(move |project| {
            *project = Some(Project {
                id,
                files: files
                    .into_iter()
                    .map(|f| {
                        (
                            f.id,
                            File {
                                version: Version(0),
                                path: f.path,
                                text: f.text,
                            },
                        )
                    })
                    .collect(),
                open_file,
                cur_version: Version(0),
            });
            Ok(())
        })
        .await
    }

    async fn add_file(&self, project_id: ProjectId, file: crate::front::File) -> Result<()> {
        Self::with_project_mut(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            if project.files.contains_key(&file.id) {
                return Err(Error::file_id_in_use(file.id, &project.files[&file.id].path));
            }
            project.files.insert(
                file.id,
                File {
                    version: Version(0),
                    path: file.path,
                    text: file.text,
                },
            );
            Ok(())
        })
        .await
    }

    async fn remove_file(&self, project_id: ProjectId, file_id: FileId) -> Result<()> {
        Self::with_project_mut(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            let old = project.files.swap_remove(&file_id);
            if old.is_none() {
                return Err(Error::bad_file(file_id, None));
            }
            Ok(())
        })
        .await
    }

    async fn update_file(&self, project_id: ProjectId, file_id: FileId, text: String) -> Result<()> {
        Self::with_project_mut(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            let Some(file) = project.files.get_mut(&file_id) else {
                return Err(Error::bad_file(file_id, None));
            };
            file.text = text;
            Ok(())
        })
        .await
    }

    async fn switch_file(&self, project_id: ProjectId, file_id: FileId) -> Result<()> {
        Self::with_project_mut(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            let Some(file) = project.files.get(&file_id) else {
                return Err(Error::bad_file(file_id, None));
            };
            project.open_file = file_id;
            project.cur_version = file.version;
            Ok(())
        })
        .await
    }

    async fn refresh(&self, project_id: ProjectId) -> Result<()> {
        Self::with_project_mut(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            Ok(())
        })
        .await
    }
}

// Dummy struct to ensure we export the types from the API crate :-(
#[derive(ts_rs::TS, serde::Serialize)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct IgnoreMe {
    pub a: crate::front::File,
}
