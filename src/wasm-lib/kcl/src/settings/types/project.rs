//! Types specific for modeling-app projects.

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::settings::types::{
    AppSettings, AppTheme, CommandBarSettings, ModelingSettings, TextEditorSettings, DEFAULT_THEME_COLOR,
};

/// High level project configuration.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectConfiguration {
    /// The settings for the project.
    #[serde(default)]
    pub settings: ProjectSettings,
}

impl ProjectConfiguration {
    // TODO: remove this when we remove backwards compatibility with the old settings file.
    pub fn backwards_compatible_toml_parse(toml_str: &str) -> Result<Self> {
        let mut settings = toml::from_str::<Self>(toml_str)?;
        settings.settings.app.project_directory = None;

        if let Some(theme) = &settings.settings.app.theme {
            if settings.settings.app.appearance.theme == AppTheme::default() {
                settings.settings.app.appearance.theme = *theme;
                settings.settings.app.theme = None;
            }
        }

        if let Some(theme_color) = &settings.settings.app.theme_color {
            if settings.settings.app.appearance.color == DEFAULT_THEME_COLOR {
                settings.settings.app.appearance.color = theme_color.clone().into();
                settings.settings.app.theme_color = None;
            }
        }

        if let Some(enable_ssao) = settings.settings.app.enable_ssao {
            if settings.settings.modeling.enable_ssao {
                settings.settings.modeling.enable_ssao = enable_ssao;
                settings.settings.app.enable_ssao = None;
            }
        }

        Ok(settings)
    }
}

/// High level project settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectSettings {
    /// The settings for the modeling app.
    #[serde(default)]
    pub app: AppSettings,
    /// Settings that affect the behavior while modeling.
    #[serde(default)]
    pub modeling: ModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    #[serde(default, alias = "textEditor")]
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "commandBar")]
    pub command_bar: CommandBarSettings,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::{
        AppSettings, AppTheme, CommandBarSettings, ModelingSettings, ProjectConfiguration, ProjectSettings,
        TextEditorSettings,
    };
    use crate::settings::types::{AppearanceSettings, UnitLength};

    #[test]
    // Test that we can deserialize a project file from the old format.
    // TODO: We can remove this functionality after a few versions.
    fn test_backwards_compatible_project_settings_file() {
        let old_project_file = r#"[settings.app]
theme = "dark"
themeColor = "138"

[settings.modeling]
defaultUnit = "yd"
showDebugPanel = true

[settings.textEditor]
textWrapping = false
blinkingCursor = false

[settings.commandBar]
includeSettings = false
#"#;

        //let parsed = toml::from_str::<ProjectConfiguration(old_project_file).unwrap();
        let parsed = ProjectConfiguration::backwards_compatible_toml_parse(old_project_file).unwrap();
        assert_eq!(
            parsed,
            ProjectConfiguration {
                settings: ProjectSettings {
                    app: AppSettings {
                        appearance: AppearanceSettings {
                            theme: AppTheme::Dark,
                            color: 138.0,
                        },
                        onboarding_status: Default::default(),
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::Yd,
                        mouse_controls: Default::default(),
                        highlight_edges: Default::default(),
                        show_debug_panel: true,
                        enable_ssao: false,
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: false,
                        blinking_cursor: false,
                    },
                    command_bar: CommandBarSettings {
                        include_settings: false,
                    },
                }
            }
        );
    }

    #[test]
    fn test_project_settings_empty_file_parses() {
        let empty_settings_file = r#""#;

        let parsed = toml::from_str::<ProjectConfiguration>(empty_settings_file).unwrap();
        assert_eq!(parsed, ProjectConfiguration::default());

        // Write the file back out.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(
            serialized,
            r#"[settings.app]
onboarding_status = "incomplete"
dismiss_web_banner = false

[settings.app.appearance]
theme = "system"
color = 264.5

[settings.modeling]
base_unit = "mm"
mouse_controls = "kittycad"
highlight_edges = true
show_debug_panel = false
enable_ssao = true

[settings.text_editor]
text_wrapping = true
blinking_cursor = true

[settings.command_bar]
include_settings = true
"#
        );

        let parsed = ProjectConfiguration::backwards_compatible_toml_parse(empty_settings_file).unwrap();
        assert_eq!(parsed, ProjectConfiguration::default());
    }
}
