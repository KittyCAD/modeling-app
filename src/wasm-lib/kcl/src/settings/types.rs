//! Types for kcl project and modeling-app settings.

use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

/// Application wide settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    /// The settings for the appearance of the app.
    pub appearance: AppearanceSettings,
    /// Settings that affect the behavior while modeling.
    pub modeling: ModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of project management.
    pub project: ProjectSettings,
    /// Settings that affect the behavior of the command bar.
    pub command_bar: CommandBarSettings,
    /// The onboarding status of the app.
    pub onboarding: OnboardingStatus,
}

/// The settings for the theme of the app.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppearanceSettings {
    /// The overall theme of the app.
    pub theme: AppTheme,
    /// The hue of the primary theme color for the app.
    #[validate(range(min = 0.0, max = 360.0))]
    pub color: f64,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: Default::default(),
            color: 264.5,
        }
    }
}

/// The overall appearance of the app.
#[derive(Debug, Default, Copy, Clone, Deserialize, Serialize, JsonSchema, Display, FromStr, ts_rs::TS)]
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
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ModelingSettings {
    /// The default unit to use in modeling dimensions.
    pub base_unit: UnitLength,
    /// The controls for how to navigate the 3D view.
    pub mouse_controls: MouseControlType,
    /// Highlight edges of 3D objects?
    pub highlight_edges: bool,
    /// Whether to show the debug panel, which lets you see various states
    /// of the app to aid in development.
    pub show_debug_panel: bool,
}

impl Default for ModelingSettings {
    fn default() -> Self {
        Self {
            base_unit: Default::default(),
            mouse_controls: Default::default(),
            highlight_edges: true,
            show_debug_panel: false,
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
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct TextEditorSettings {
    /// Whether to wrap text in the editor or overflow with scroll.
    pub text_wrapping: bool,
    /// Whether to make the cursor blink in the editor.
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
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ProjectSettings {
    /// The directory to save and load projects from.
    pub default_directory: std::path::PathBuf,
    /// The default project name to use when creating a new project.
    pub default_project_name: String,
}

impl Default for ProjectSettings {
    fn default() -> Self {
        Self {
            default_project_name: "project-$nnn".to_string(),
            // TODO: set to the tauri directory.
            default_directory: Default::default(),
        }
    }
}

/// Settings that affect the behavior of the command bar.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct CommandBarSettings {
    /// Whether to include settings in the command bar.
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
