//! Types for kcl project and modeling-app settings.

pub mod project;

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

const DEFAULT_THEME_COLOR: f64 = 264.5;

/// High level configuration.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Configuration {
    /// The settings for the modeling app.
    #[serde(default)]
    pub settings: Settings,
}

impl Configuration {
    // TODO: remove this when we remove backwards compatibility with the old settings file.
    pub fn backwards_compatible_toml_parse(toml_str: &str) -> Result<Self> {
        let mut settings = toml::from_str::<Self>(toml_str)?;

        if let Some(project_directory) = &settings.settings.app.project_directory {
            if settings.settings.project.directory.to_string_lossy().is_empty() {
                settings.settings.project.directory = project_directory.clone();
                settings.settings.app.project_directory = None;
            }
        }

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

/// High level settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    /// The settings for the modeling app.
    #[serde(default)]
    pub app: AppSettings,
    /// Settings that affect the behavior while modeling.
    #[serde(default)]
    pub modeling: ModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    #[serde(default, alias = "textEditor")]
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of project management.
    #[serde(default, alias = "projects")]
    pub project: ProjectSettings,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "commandBar")]
    pub command_bar: CommandBarSettings,
}

/// Application wide settings.
// TODO: When we remove backwards compatibility with the old settings file, we can remove the
// aliases to camelCase (and projects plural) from everywhere.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    /// The settings for the appearance of the app.
    #[serde(default)]
    pub appearance: AppearanceSettings,
    /// The onboarding status of the app.
    #[serde(default, alias = "onboardingStatus")]
    pub onboarding_status: OnboardingStatus,
    /// Backwards compatible project directory setting.
    #[serde(default, alias = "projectDirectory", skip_serializing_if = "Option::is_none")]
    pub project_directory: Option<std::path::PathBuf>,
    /// Backwards compatible theme setting.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme: Option<AppTheme>,
    /// The hue of the primary theme color for the app.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "themeColor")]
    pub theme_color: Option<FloatOrInt>,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    #[serde(default, alias = "enableSSAO", skip_serializing_if = "Option::is_none")]
    pub enable_ssao: Option<bool>,
    /// Permanently dismiss the banner warning to download the desktop app.
    /// This setting only applies to the web app. And is temporary until we have Linux support.
    #[serde(default, alias = "dismissWebBanner")]
    pub dismiss_web_banner: bool,
}

// TODO: When we remove backwards compatibility with the old settings file, we can remove this.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(untagged)]
pub enum FloatOrInt {
    String(String),
    Float(f64),
    Int(i64),
}

impl From<FloatOrInt> for f64 {
    fn from(float_or_int: FloatOrInt) -> Self {
        match float_or_int {
            FloatOrInt::String(s) => s.parse().unwrap(),
            FloatOrInt::Float(f) => f,
            FloatOrInt::Int(i) => i as f64,
        }
    }
}

/// The settings for the theme of the app.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Validate, PartialEq)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppearanceSettings {
    /// The overall theme of the app.
    #[serde(default)]
    pub theme: AppTheme,
    /// The hue of the primary theme color for the app.
    #[serde(default)]
    #[validate(range(min = 0.0, max = 360.0))]
    pub color: f64,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: Default::default(),
            color: DEFAULT_THEME_COLOR,
        }
    }
}

/// The overall appearance of the app.
#[derive(
    Debug, Default, Copy, Clone, Deserialize, Serialize, JsonSchema, Display, FromStr, ts_rs::TS, PartialEq, Eq,
)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum AppTheme {
    /// A light theme.
    Light,
    /// A dark theme.
    Dark,
    /// Use the system theme.
    /// This will use dark theme if the system theme is dark, and light theme if the system theme is light.
    #[default]
    System,
}

impl From<AppTheme> for kittycad::types::Color {
    fn from(theme: AppTheme) -> Self {
        match theme {
            AppTheme::Light => kittycad::types::Color {
                r: 249.0 / 255.0,
                g: 249.0 / 255.0,
                b: 249.0 / 255.0,
                a: 1.0,
            },
            AppTheme::Dark => kittycad::types::Color {
                r: 28.0 / 255.0,
                g: 28.0 / 255.0,
                b: 28.0 / 255.0,
                a: 1.0,
            },
            AppTheme::System => {
                // TODO: Check the system setting for the user.
                todo!()
            }
        }
    }
}

/// Settings that affect the behavior while modeling.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ModelingSettings {
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "defaultUnit")]
    pub base_unit: UnitLength,
    /// The controls for how to navigate the 3D view.
    #[serde(default, alias = "mouseControls")]
    pub mouse_controls: MouseControlType,
    /// Highlight edges of 3D objects?
    #[serde(default, alias = "highlightEdges")]
    pub highlight_edges: bool,
    /// Whether to show the debug panel, which lets you see various states
    /// of the app to aid in development.
    #[serde(default, alias = "showDebugPanel")]
    pub show_debug_panel: bool,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    #[serde(default)]
    pub enable_ssao: bool,
}

impl Default for ModelingSettings {
    fn default() -> Self {
        Self {
            base_unit: Default::default(),
            mouse_controls: Default::default(),
            highlight_edges: true,
            show_debug_panel: false,
            enable_ssao: true,
        }
    }
}

/// The valid types of length units.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "lowercase")]
#[display(style = "lowercase")]
pub enum UnitLength {
    /// Centimeters <https://en.wikipedia.org/wiki/Centimeter>
    Cm,
    /// Feet <https://en.wikipedia.org/wiki/Foot_(unit)>
    Ft,
    /// Inches <https://en.wikipedia.org/wiki/Inch>
    In,
    /// Meters <https://en.wikipedia.org/wiki/Meter>
    M,
    /// Millimeters <https://en.wikipedia.org/wiki/Millimeter>
    #[default]
    Mm,
    /// Yards <https://en.wikipedia.org/wiki/Yard>
    Yd,
}

impl From<kittycad::types::UnitLength> for UnitLength {
    fn from(unit: kittycad::types::UnitLength) -> Self {
        match unit {
            kittycad::types::UnitLength::Cm => UnitLength::Cm,
            kittycad::types::UnitLength::Ft => UnitLength::Ft,
            kittycad::types::UnitLength::In => UnitLength::In,
            kittycad::types::UnitLength::M => UnitLength::M,
            kittycad::types::UnitLength::Mm => UnitLength::Mm,
            kittycad::types::UnitLength::Yd => UnitLength::Yd,
        }
    }
}

impl From<UnitLength> for kittycad::types::UnitLength {
    fn from(unit: UnitLength) -> Self {
        match unit {
            UnitLength::Cm => kittycad::types::UnitLength::Cm,
            UnitLength::Ft => kittycad::types::UnitLength::Ft,
            UnitLength::In => kittycad::types::UnitLength::In,
            UnitLength::M => kittycad::types::UnitLength::M,
            UnitLength::Mm => kittycad::types::UnitLength::Mm,
            UnitLength::Yd => kittycad::types::UnitLength::Yd,
        }
    }
}

/// The types of controls for how to navigate the 3D view.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum MouseControlType {
    #[default]
    #[display("kittycad")]
    #[serde(rename = "kittycad", alias = "KittyCAD")]
    KittyCad,
    #[display("onshape")]
    #[serde(rename = "onshape", alias = "OnShape")]
    OnShape,
    #[serde(alias = "Trackpad Friendly")]
    TrackpadFriendly,
    #[serde(alias = "Solidworks")]
    Solidworks,
    #[serde(alias = "NX")]
    Nx,
    #[serde(alias = "Creo")]
    Creo,
    #[display("autocad")]
    #[serde(rename = "autocad", alias = "AutoCAD")]
    AutoCad,
}

/// Settings that affect the behavior of the KCL text editor.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct TextEditorSettings {
    /// Whether to wrap text in the editor or overflow with scroll.
    #[serde(default, alias = "textWrapping")]
    pub text_wrapping: bool,
    /// Whether to make the cursor blink in the editor.
    #[serde(default, alias = "blinkingCursor")]
    pub blinking_cursor: bool,
}

impl Default for TextEditorSettings {
    fn default() -> Self {
        Self {
            text_wrapping: true,
            blinking_cursor: true,
        }
    }
}

/// Settings that affect the behavior of project management.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ProjectSettings {
    /// The directory to save and load projects from.
    #[serde(default)]
    pub directory: std::path::PathBuf,
    /// The default project name to use when creating a new project.
    #[serde(default, alias = "defaultProjectName")]
    pub default_project_name: String,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            default_project_name: "project-$nnn".to_string(),
            // TODO: set to the tauri directory.
            directory: Default::default(),
        }
    }
}

/// Settings that affect the behavior of the command bar.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct CommandBarSettings {
    /// Whether to include settings in the command bar.
    #[serde(default, alias = "includeSettings")]
    pub include_settings: bool,
}

impl Default for CommandBarSettings {
    fn default() -> Self {
        Self { include_settings: true }
    }
}

/// The types of onboarding status.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum OnboardingStatus {
    /// The user has completed onboarding.
    Completed,
    /// The user has not completed onboarding.
    #[default]
    Incomplete,
    /// The user has dismissed onboarding.
    Dismissed,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::{
        AppSettings, AppTheme, AppearanceSettings, CommandBarSettings, Configuration, ModelingSettings,
        ProjectSettings, Settings, TextEditorSettings, UnitLength,
    };
    use crate::settings::types::{OnboardingStatus, DEFAULT_THEME_COLOR};

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

        //let parsed = toml::from_str::<Configuration(old_project_file).unwrap();
        let parsed = Configuration::backwards_compatible_toml_parse(old_project_file).unwrap();
        assert_eq!(
            parsed,
            Configuration {
                settings: Settings {
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
                    project: Default::default(),
                    command_bar: CommandBarSettings {
                        include_settings: false,
                    },
                }
            }
        );
    }

    #[test]
    // Test that we can deserialize a app settings file from the old format.
    // TODO: We can remove this functionality after a few versions.
    fn test_backwards_compatible_app_settings_file() {
        let old_app_settings_file = r#"[settings.app]
onboardingStatus = "dismissed"
projectDirectory = "/Users/macinatormax/Documents/kittycad-modeling-projects"
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

[settings.projects]
defaultProjectName = "projects-$nnn"
#"#;

        //let parsed = toml::from_str::<Configuration>(old_app_settings_file).unwrap();
        let parsed = Configuration::backwards_compatible_toml_parse(old_app_settings_file).unwrap();
        assert_eq!(
            parsed,
            Configuration {
                settings: Settings {
                    app: AppSettings {
                        appearance: AppearanceSettings {
                            theme: AppTheme::Dark,
                            color: 138.0,
                        },
                        onboarding_status: OnboardingStatus::Dismissed,
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
                    project: ProjectSettings {
                        directory: "/Users/macinatormax/Documents/kittycad-modeling-projects".into(),
                        default_project_name: "projects-$nnn".to_string(),
                    },
                    command_bar: CommandBarSettings {
                        include_settings: false,
                    },
                }
            }
        );
    }

    #[test]
    fn test_settings_backwards_compat_partial() {
        let partial_settings_file = r#"[settings.app]
onboardingStatus = "dismissed"
projectDirectory = "/Users/macinatormax/Documents/kittycad-modeling-projects""#;

        //let parsed = toml::from_str::<Configuration>(partial_settings_file).unwrap();
        let parsed = Configuration::backwards_compatible_toml_parse(partial_settings_file).unwrap();
        assert_eq!(
            parsed,
            Configuration {
                settings: Settings {
                    app: AppSettings {
                        appearance: AppearanceSettings {
                            theme: AppTheme::System,
                            color: DEFAULT_THEME_COLOR,
                        },
                        onboarding_status: OnboardingStatus::Dismissed,
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::Mm,
                        mouse_controls: Default::default(),
                        highlight_edges: true,
                        show_debug_panel: false,
                        enable_ssao: true,
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: true,
                        blinking_cursor: true,
                    },
                    project: ProjectSettings {
                        directory: "/Users/macinatormax/Documents/kittycad-modeling-projects".into(),
                        default_project_name: "project-$nnn".to_string(),
                    },
                    command_bar: CommandBarSettings { include_settings: true },
                }
            }
        );

        // Write the file back out.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(
            serialized,
            r#"[settings.app]
onboarding_status = "dismissed"
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

[settings.project]
directory = "/Users/macinatormax/Documents/kittycad-modeling-projects"
default_project_name = "project-$nnn"

[settings.command_bar]
include_settings = true
"#
        );
    }

    #[test]
    fn test_settings_empty_file_parses() {
        let empty_settings_file = r#""#;

        let parsed = toml::from_str::<Configuration>(empty_settings_file).unwrap();
        assert_eq!(parsed, Configuration::default());

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

[settings.project]
directory = ""
default_project_name = "project-$nnn"

[settings.command_bar]
include_settings = true
"#
        );

        let parsed = Configuration::backwards_compatible_toml_parse(empty_settings_file).unwrap();
        assert_eq!(parsed, Configuration::default());
    }
}
