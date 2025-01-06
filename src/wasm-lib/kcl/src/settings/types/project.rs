//! Types specific for modeling-app projects.

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::{
    settings::types::{
        is_default, AppColor, CommandBarSettings, DefaultTrue, FloatOrInt, OnboardingStatus, TextEditorSettings,
    },
    UnitLength,
};

/// High level project configuration.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectConfiguration {
    /// The settings for the project.
    #[serde(default)]
    #[validate(nested)]
    pub settings: PerProjectSettings,
}

impl ProjectConfiguration {
    // TODO: remove this when we remove backwards compatibility with the old settings file.
    pub fn backwards_compatible_toml_parse(toml_str: &str) -> Result<Self> {
        let mut settings = toml::from_str::<Self>(toml_str)?;

        if let Some(theme_color) = &settings.settings.app.theme_color {
            if settings.settings.app.appearance.color == AppColor::default() {
                settings.settings.app.appearance.color = theme_color.clone().into();
                settings.settings.app.theme_color = None;
            }
        }

        if let Some(enable_ssao) = settings.settings.app.enable_ssao {
            if settings.settings.modeling.enable_ssao.into() {
                settings.settings.modeling.enable_ssao = enable_ssao.into();
                settings.settings.app.enable_ssao = None;
            }
        }

        if settings.settings.modeling.show_debug_panel && !settings.settings.app.show_debug_panel {
            settings.settings.app.show_debug_panel = settings.settings.modeling.show_debug_panel;
            settings.settings.modeling.show_debug_panel = Default::default();
        }

        settings.validate()?;

        Ok(settings)
    }
}

/// High level project settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct PerProjectSettings {
    /// The settings for the modeling app.
    #[serde(default)]
    #[validate(nested)]
    pub app: ProjectAppSettings,
    /// Settings that affect the behavior while modeling.
    #[serde(default)]
    #[validate(nested)]
    pub modeling: ProjectModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    #[serde(default, alias = "textEditor")]
    #[validate(nested)]
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "commandBar")]
    #[validate(nested)]
    pub command_bar: CommandBarSettings,
}

/// Project application settings.
// TODO: When we remove backwards compatibility with the old settings file, we can remove the
// aliases to camelCase (and projects plural) from everywhere.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectAppSettings {
    /// The settings for the appearance of the app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub appearance: ProjectAppearanceSettings,
    /// The onboarding status of the app.
    #[serde(default, alias = "onboardingStatus", skip_serializing_if = "is_default")]
    pub onboarding_status: OnboardingStatus,
    /// The hue of the primary theme color for the app.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "themeColor")]
    pub theme_color: Option<FloatOrInt>,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    #[serde(default, alias = "enableSSAO", skip_serializing_if = "Option::is_none")]
    pub enable_ssao: Option<bool>,
    /// Permanently dismiss the banner warning to download the desktop app.
    /// This setting only applies to the web app. And is temporary until we have Linux support.
    #[serde(default, alias = "dismissWebBanner", skip_serializing_if = "is_default")]
    pub dismiss_web_banner: bool,
    /// When the user is idle, and this is true, the stream will be torn down.
    #[serde(default, alias = "streamIdleMode", skip_serializing_if = "is_default")]
    stream_idle_mode: bool,
    /// Whether to show the debug panel, which lets you see various states
    /// of the app to aid in development.
    #[serde(default, alias = "showDebugPanel", skip_serializing_if = "is_default")]
    pub show_debug_panel: bool,
}

/// Per project appearance settings of the app.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct ProjectAppearanceSettings {
    /// The hue of the primary theme color for the app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub color: AppColor,
}

/// Per-project settings that affect the behavior while modeling.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ProjectModelingSettings {
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "defaultUnit", skip_serializing_if = "is_default")]
    pub base_unit: UnitLength,
    /// Highlight edges of 3D objects?
    #[serde(default, alias = "highlightEdges", skip_serializing_if = "is_default")]
    pub highlight_edges: DefaultTrue,
    /// Whether to show the debug panel, which lets you see various states
    /// of the app to aid in development.
    /// Remove this when we remove backwards compatibility with the old settings file.
    #[serde(default, alias = "showDebugPanel", skip_serializing_if = "is_default")]
    pub show_debug_panel: bool,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    #[serde(default, skip_serializing_if = "is_default")]
    pub enable_ssao: DefaultTrue,
    /// Whether or not to show a scale grid in the 3D modeling view
    #[serde(default, alias = "showScaleGrid", skip_serializing_if = "is_default")]
    pub show_scale_grid: bool,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::{
        CommandBarSettings, PerProjectSettings, ProjectAppSettings, ProjectAppearanceSettings, ProjectConfiguration,
        ProjectModelingSettings, TextEditorSettings,
    };
    use crate::settings::types::UnitLength;

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
                settings: PerProjectSettings {
                    app: ProjectAppSettings {
                        appearance: ProjectAppearanceSettings { color: 138.0.into() },
                        onboarding_status: Default::default(),
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                        stream_idle_mode: false,
                        show_debug_panel: true,
                    },
                    modeling: ProjectModelingSettings {
                        base_unit: UnitLength::Yd,
                        highlight_edges: Default::default(),
                        show_debug_panel: Default::default(),
                        enable_ssao: true.into(),
                        show_scale_grid: false,
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: false.into(),
                        blinking_cursor: false.into()
                    },
                    command_bar: CommandBarSettings {
                        include_settings: false.into()
                    },
                }
            }
        );

        // Write the file back out.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(
            serialized,
            r#"[settings.app]
show_debug_panel = true

[settings.app.appearance]
color = 138.0

[settings.modeling]
base_unit = "yd"

[settings.text_editor]
text_wrapping = false
blinking_cursor = false

[settings.command_bar]
include_settings = false
"#
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

[settings.modeling]

[settings.text_editor]

[settings.command_bar]
"#
        );

        let parsed = ProjectConfiguration::backwards_compatible_toml_parse(empty_settings_file).unwrap();
        assert_eq!(parsed, ProjectConfiguration::default());
    }

    #[test]
    fn test_project_settings_color_validation_error() {
        let settings_file = r#"[settings.app.appearance]
color = 1567.4"#;

        let result = ProjectConfiguration::backwards_compatible_toml_parse(settings_file);
        if let Ok(r) = result {
            panic!("Expected an error, but got success: {:?}", r);
        }
        assert!(result.is_err());

        assert!(result
            .unwrap_err()
            .to_string()
            .contains("color: Validation error: color"));
    }
}
