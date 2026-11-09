#![allow(dead_code)]

use std::sync::Arc;

use indexmap::IndexMap;
use tokio::sync::RwLock;

use crate::front::Error;
use crate::front::FileId;
use crate::front::LifecycleApi;
use crate::front::ProjectId;
use crate::front::Result;
use crate::front::SceneGraph;
use crate::front::Version;

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

/// Project state belongs to one frontend context; its clones share that owner.
#[derive(Debug, Default, Clone)]
pub struct ProjectManager {
    project: Arc<RwLock<Option<Project>>>,
}

impl ProjectManager {
    async fn with_project<T>(&self, f: impl FnOnce(&Option<Project>) -> T) -> T {
        f(&*self.project.read().await)
    }

    async fn with_project_mut<T>(&self, f: impl FnOnce(&mut Option<Project>) -> T) -> T {
        f(&mut *self.project.write().await)
    }

    /// Registered projects execute only their active file. Unregistered contexts
    /// retain standalone execution, without treating a missing path as a wildcard.
    pub async fn execution_file(&self, requested_path: Option<&str>) -> Result<Option<crate::TypedPath>> {
        self.with_project(|project| {
            let Some(project) = project else {
                return Ok(requested_path.map(crate::TypedPath::from));
            };
            let file = project
                .files
                .get(&project.open_file)
                .ok_or_else(|| Error::file_id_not_found(project.id, project.open_file))?;
            if let Some(requested_path) = requested_path
                && requested_path != file.path
            {
                return Err(Error {
                    msg: format!(
                        "Execution file `{requested_path}` does not match registered active file `{}`",
                        file.path
                    ),
                });
            }
            Ok(Some(crate::TypedPath::from(file.path.as_str())))
        })
        .await
    }
}

impl LifecycleApi for ProjectManager {
    async fn open_project(&self, id: ProjectId, files: Vec<crate::front::File>, open_file: FileId) -> Result<()> {
        self.with_project_mut(move |project| {
            if !files.iter().any(|file| file.id == open_file) {
                return Err(Error::file_id_not_found(id, open_file));
            }
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

    async fn get_project(&self, id: ProjectId) -> Result<Vec<crate::front::File>> {
        self.with_project(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(id, None));
            };
            if project.id != id {
                return Err(Error::bad_project(id, Some(project.id)));
            }
            Ok(project
                .files
                .iter()
                .map(|(file_id, file)| to_front_file(*file_id, file))
                .collect())
        })
        .await
    }

    async fn add_file(&self, project_id: ProjectId, file: crate::front::File) -> Result<()> {
        self.with_project_mut(move |project| {
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

    async fn get_file(&self, project_id: ProjectId, file_id: FileId) -> Result<crate::front::File> {
        self.with_project(move |project| {
            let Some(project) = project else {
                return Err(Error::bad_project(project_id, None));
            };
            if project.id != project_id {
                return Err(Error::bad_project(project_id, Some(project.id)));
            }
            project
                .files
                .get(&file_id)
                .map(|file| to_front_file(file_id, file))
                .ok_or_else(|| Error::file_id_not_found(project_id, file_id))
        })
        .await
    }

    async fn remove_file(&self, project_id: ProjectId, file_id: FileId) -> Result<()> {
        self.with_project_mut(move |project| {
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
        self.with_project_mut(move |project| {
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
        self.with_project_mut(move |project| {
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
        self.with_project_mut(move |project| {
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

fn to_front_file(file_id: FileId, file: &File) -> crate::front::File {
    crate::front::File {
        id: file_id,
        path: file.path.clone(),
        text: file.text.clone(),
    }
}

// Dummy struct to ensure we export the types from the API crate :-(
#[derive(ts_rs::TS, serde::Serialize)]
#[ts(export, export_to = "FrontendApi.ts")]
pub struct IgnoreMe {
    pub a: crate::front::File,
}

#[cfg(test)]
mod tests {
    use crate::TypedPath;
    use crate::front::File;
    use crate::front::FileId;
    use crate::front::LifecycleApi;
    use crate::front::ProjectId;
    use crate::project::ProjectManager;

    fn file(id: usize, path: &str, text: &str) -> File {
        File {
            id: FileId(id),
            path: path.to_owned(),
            text: text.to_owned(),
        }
    }

    #[tokio::test]
    async fn independent_managers_isolate_identical_project_and_file_ids() {
        let first = ProjectManager::default();
        let second = ProjectManager::default();
        first
            .open_project(ProjectId(0), vec![file(0, "/first/main.kcl", "first")], FileId(0))
            .await
            .unwrap();
        assert_eq!(second.execution_file(None).await.unwrap(), None);
        second
            .open_project(ProjectId(0), vec![file(0, "/second/main.kcl", "second")], FileId(0))
            .await
            .unwrap();
        first
            .update_file(ProjectId(0), FileId(0), "first edit".to_owned())
            .await
            .unwrap();

        assert_eq!(
            first.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/first/main.kcl"))
        );
        assert_eq!(
            second.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/second/main.kcl"))
        );
        assert_eq!(
            first.get_file(ProjectId(0), FileId(0)).await.unwrap().text,
            "first edit"
        );
        assert_eq!(second.get_file(ProjectId(0), FileId(0)).await.unwrap().text, "second");
    }

    #[tokio::test]
    async fn clones_share_only_their_own_project_lifecycle() {
        let manager = ProjectManager::default();
        let clone = manager.clone();
        let other = ProjectManager::default();
        manager
            .open_project(ProjectId(0), vec![file(0, "/project/main.kcl", "main")], FileId(0))
            .await
            .unwrap();
        other
            .open_project(ProjectId(0), vec![file(0, "/other/main.kcl", "other")], FileId(0))
            .await
            .unwrap();
        clone
            .add_file(ProjectId(0), file(1, "/project/nested/part.kcl", "part"))
            .await
            .unwrap();
        clone.switch_file(ProjectId(0), FileId(1)).await.unwrap();
        clone
            .update_file(ProjectId(0), FileId(1), "edited part".to_owned())
            .await
            .unwrap();

        assert_eq!(
            manager.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/project/nested/part.kcl"))
        );
        assert_eq!(
            manager.get_file(ProjectId(0), FileId(1)).await.unwrap().text,
            "edited part"
        );
        assert_eq!(other.get_project(ProjectId(0)).await.unwrap().len(), 1);
        assert_eq!(
            other.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/other/main.kcl"))
        );
    }

    #[tokio::test]
    async fn invalid_open_preserves_the_existing_project_atomically() {
        let manager = ProjectManager::default();
        manager.open_project(ProjectId(9), vec![], FileId(0)).await.unwrap_err();
        assert_eq!(manager.execution_file(None).await.unwrap(), None);
        manager
            .open_project(ProjectId(0), vec![file(0, "/project/main.kcl", "original")], FileId(0))
            .await
            .unwrap();

        manager
            .open_project(
                ProjectId(9),
                vec![file(1, "/replacement/main.kcl", "replacement")],
                FileId(2),
            )
            .await
            .unwrap_err();
        assert_eq!(
            manager.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/project/main.kcl"))
        );
        assert_eq!(
            manager.get_file(ProjectId(0), FileId(0)).await.unwrap().text,
            "original"
        );
        manager.get_project(ProjectId(9)).await.unwrap_err();
    }

    #[tokio::test]
    async fn explicit_execution_paths_must_exactly_match_the_active_file() {
        let manager = ProjectManager::default();
        manager
            .open_project(
                ProjectId(0),
                vec![
                    file(0, "/project/main.kcl", "main"),
                    file(1, "/project/part.kcl", "part"),
                ],
                FileId(0),
            )
            .await
            .unwrap();

        for path in ["/project/part.kcl", "/arbitrary/main.kcl", "/project/./main.kcl", ""] {
            let error = manager.execution_file(Some(path)).await.unwrap_err();
            assert!(error.msg.contains("does not match registered active file"));
        }
        assert_eq!(
            manager.execution_file(Some("/project/main.kcl")).await.unwrap(),
            Some(TypedPath::from("/project/main.kcl"))
        );
        assert_eq!(
            manager.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/project/main.kcl"))
        );
        assert_eq!(manager.get_file(ProjectId(0), FileId(0)).await.unwrap().text, "main");
    }

    #[tokio::test]
    async fn switching_and_removing_files_never_falls_back_from_a_missing_active_file() {
        let manager = ProjectManager::default();
        manager
            .open_project(
                ProjectId(0),
                vec![
                    file(0, "/project/main.kcl", "main"),
                    file(1, "/project/part.kcl", "part"),
                ],
                FileId(0),
            )
            .await
            .unwrap();

        manager.switch_file(ProjectId(0), FileId(9)).await.unwrap_err();
        assert_eq!(
            manager.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/project/main.kcl"))
        );
        manager.switch_file(ProjectId(0), FileId(1)).await.unwrap();
        assert_eq!(
            manager.execution_file(Some("/project/part.kcl")).await.unwrap(),
            Some(TypedPath::from("/project/part.kcl"))
        );
        manager.execution_file(Some("/project/main.kcl")).await.unwrap_err();

        manager.remove_file(ProjectId(0), FileId(1)).await.unwrap();
        manager.execution_file(None).await.unwrap_err();
        manager.execution_file(Some("/project/part.kcl")).await.unwrap_err();
        manager.execution_file(Some("/project/main.kcl")).await.unwrap_err();
        manager.switch_file(ProjectId(0), FileId(0)).await.unwrap();
        assert_eq!(
            manager.execution_file(None).await.unwrap(),
            Some(TypedPath::from("/project/main.kcl"))
        );
    }

    #[tokio::test]
    async fn standalone_resolution_does_not_register_or_remember_a_caller_path() {
        let manager = ProjectManager::default();
        assert_eq!(manager.execution_file(None).await.unwrap(), None);
        for path in ["/standalone/main.kcl", "/another/main.kcl"] {
            assert_eq!(
                manager.execution_file(Some(path)).await.unwrap(),
                Some(TypedPath::from(path))
            );
            assert_eq!(manager.execution_file(None).await.unwrap(), None);
        }
        manager.get_project(ProjectId(0)).await.unwrap_err();
    }
}
