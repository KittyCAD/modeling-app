use std::sync::Arc;
use std::sync::RwLock;

use kcl_lib::Configuration;
use kcl_lib::ExecutorSettings;
use kcl_lib::TypedPath;

#[derive(Clone, Default)]
pub(crate) struct ExecutionPath(Arc<RwLock<Option<String>>>);

impl ExecutionPath {
    pub(crate) fn for_execution(
        &self,
        config: Configuration,
        path: Option<String>,
        is_mock: bool,
    ) -> Result<ExecutorSettings, String> {
        if !is_mock {
            *self.0.write().map_err(|e| e.to_string())? = path.clone();
        }
        Ok(Self::settings(config, path))
    }

    pub(crate) fn for_current_scene(&self, config: Configuration) -> Result<ExecutorSettings, String> {
        let path = self.0.read().map_err(|e| e.to_string())?.clone();
        Ok(Self::settings(config, path))
    }

    fn settings(config: Configuration, path: Option<String>) -> ExecutorSettings {
        let mut settings: ExecutorSettings = config.into();
        if let Some(path) = path {
            settings.with_current_file(TypedPath::from(&path));
        }
        settings
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scene_edits_keep_real_execution_identity_across_callbacks_and_mock_execution() {
        let path = ExecutionPath::default();
        let callback_clone = path.clone();
        let real = path
            .for_execution(
                Configuration::default(),
                Some("/project/assembly.kcl".to_owned()),
                false,
            )
            .unwrap();
        let edit = callback_clone.for_current_scene(Configuration::default()).unwrap();
        assert_eq!(edit.current_file, real.current_file);
        assert_eq!(edit.project_directory, real.project_directory);
        assert_eq!(edit.current_file, Some(TypedPath::from("/project/assembly.kcl")));
        assert_eq!(edit.project_directory, Some(TypedPath::from("/project")));

        let mock = path
            .for_execution(Configuration::default(), Some("/preview/other.kcl".to_owned()), true)
            .unwrap();
        assert_eq!(mock.current_file, Some(TypedPath::from("/preview/other.kcl")));
        let edit = callback_clone.for_current_scene(Configuration::default()).unwrap();
        assert_eq!(edit.current_file, real.current_file);
        assert_eq!(edit.project_directory, real.project_directory);

        // Resetting the scene uses the same explicit path selection as execution.
        callback_clone
            .for_execution(Configuration::default(), Some("/other/new.kcl".to_owned()), false)
            .unwrap();
        let edit = path.for_current_scene(Configuration::default()).unwrap();
        assert_eq!(edit.current_file, Some(TypedPath::from("/other/new.kcl")));
        assert_eq!(edit.project_directory, Some(TypedPath::from("/other")));

        path.for_execution(Configuration::default(), None, false).unwrap();
        let edit = callback_clone.for_current_scene(Configuration::default()).unwrap();
        assert_eq!(edit.current_file, None);
        assert_eq!(edit.project_directory, None);
    }
}
