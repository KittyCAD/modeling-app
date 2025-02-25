//! Types for kcl project and modeling-app settings.

pub mod project;

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::{Validate, ValidateRange};

const DEFAULT_THEME_COLOR: f64 = 264.5;
const DEFAULT_PROJECT_NAME_TEMPLATE: &str = "project-$nnn";

/// High level configuration.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Configuration {
    /// The settings for the modeling app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub settings: Settings,
}

impl Configuration {
    // TODO: remove this when we remove backwards compatibility with the old settings file.
    pub fn backwards_compatible_toml_parse(toml_str: &str) -> Result<Self> {
        let mut settings = toml::from_str::<Self>(toml_str)?;

        if let Some(project_directory) = &settings.settings.app.project_directory {
            if settings.settings.project.directory.to_string_lossy().is_empty() {
                settings.settings.project.directory.clone_from(project_directory);
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

        settings.validate()?;

        Ok(settings)
    }
}

/// High level settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct Settings {
    /// The settings for the modeling app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub app: AppSettings,
    /// Settings that affect the behavior while modeling.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub modeling: ModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    #[serde(default, alias = "textEditor", skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of project management.
    #[serde(default, alias = "projects", skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub project: ProjectSettings,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "commandBar", skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub command_bar: CommandBarSettings,
}

/// Application wide settings.
// TODO: When we remove backwards compatibility with the old settings file, we can remove the
// aliases to camelCase (and projects plural) from everywhere.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    /// The settings for the appearance of the app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub appearance: AppearanceSettings,
    /// The onboarding status of the app.
    #[serde(default, alias = "onboardingStatus", skip_serializing_if = "is_default")]
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
    #[serde(default, alias = "dismissWebBanner", skip_serializing_if = "is_default")]
    pub dismiss_web_banner: bool,
    /// When the user is idle, and this is true, the stream will be torn down.
    #[serde(default, alias = "streamIdleMode", skip_serializing_if = "is_default")]
    stream_idle_mode: bool,
    /// When the user is idle, and this is true, the stream will be torn down.
    #[serde(default, alias = "allowOrbitInSketchMode", skip_serializing_if = "is_default")]
    allow_orbit_in_sketch_mode: bool,
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

impl From<FloatOrInt> for AppColor {
    fn from(float_or_int: FloatOrInt) -> Self {
        match float_or_int {
            FloatOrInt::String(s) => s.parse::<f64>().unwrap().into(),
            FloatOrInt::Float(f) => f.into(),
            FloatOrInt::Int(i) => (i as f64).into(),
        }
    }
}

/// The settings for the theme of the app.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct AppearanceSettings {
    /// The overall theme of the app.
    #[serde(default, skip_serializing_if = "is_default")]
    pub theme: AppTheme,
    /// The hue of the primary theme color for the app.
    #[serde(default, skip_serializing_if = "is_default")]
    #[validate(nested)]
    pub color: AppColor,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq)]
#[ts(export)]
#[serde(transparent)]
pub struct AppColor(pub f64);

impl Default for AppColor {
    fn default() -> Self {
        Self(DEFAULT_THEME_COLOR)
    }
}

impl From<AppColor> for f64 {
    fn from(color: AppColor) -> Self {
        color.0
    }
}

impl From<f64> for AppColor {
    fn from(color: f64) -> Self {
        Self(color)
    }
}

impl Validate for AppColor {
    fn validate(&self) -> Result<(), validator::ValidationErrors> {
        if !self.0.validate_range(Some(0.0), None, None, Some(360.0)) {
            let mut errors = validator::ValidationErrors::new();
            let mut err = validator::ValidationError::new("color");
            err.add_param(std::borrow::Cow::from("min"), &0.0);
            err.add_param(std::borrow::Cow::from("exclusive_max"), &360.0);
            errors.add("color", err);
            return Err(errors);
        }
        Ok(())
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
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ModelingSettings {
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "defaultUnit", skip_serializing_if = "is_default")]
    pub base_unit: UnitLength,
    /// The projection mode the camera should use while modeling.
    #[serde(default, alias = "cameraProjection", skip_serializing_if = "is_default")]
    pub camera_projection: CameraProjectionType,
    /// The methodology the camera should use to orbit around the model.
    #[serde(default, alias = "cameraOrbit", skip_serializing_if = "is_default")]
    pub camera_orbit: CameraOrbitType,
    /// The controls for how to navigate the 3D view.
    #[serde(default, alias = "mouseControls", skip_serializing_if = "is_default")]
    pub mouse_controls: MouseControlType,
    /// Highlight edges of 3D objects?
    #[serde(default, alias = "highlightEdges", skip_serializing_if = "is_default")]
    pub highlight_edges: DefaultTrue,
    /// Whether to show the debug panel, which lets you see various states
    /// of the app to aid in development.
    #[serde(default, alias = "showDebugPanel", skip_serializing_if = "is_default")]
    pub show_debug_panel: bool,
    /// Whether or not Screen Space Ambient Occlusion (SSAO) is enabled.
    #[serde(default, skip_serializing_if = "is_default")]
    pub enable_ssao: DefaultTrue,
    /// Whether or not to show a scale grid in the 3D modeling view
    #[serde(default, alias = "showScaleGrid", skip_serializing_if = "is_default")]
    pub show_scale_grid: bool,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "namedViews")]
    #[validate(nested)]
    pub named_views: Vec<NamedView>,
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct NamedView {
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "name", skip_serializing_if = "is_default")]
    pub name: String,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "eyeOffset", skip_serializing_if = "is_default")]
    pub eye_offset: f64,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "fovY", skip_serializing_if = "is_default")]
    pub fov_y: f64,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "isOrtho")]
    pub is_ortho: bool,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "orthoEyeOffset")]
    pub ortho_eye_offset: f64,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "orthoScale", skip_serializing_if = "is_default")]
    pub ortho_scale: f64,
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "pivotPosition", skip_serializing_if = "is_default")]
    pub pivot_position: [f64; 3],
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "pivotRotation", skip_serializing_if = "is_default")]
    pub pivot_rotation: [f64; 4],
    /// The default unit to use in modeling dimensions.
    #[serde(default, alias = "worldCoordSystem", skip_serializing_if = "is_default")]
    pub world_coord_system: String,
}


impl PartialEq for NamedView {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name
    }
}

impl Eq for NamedView {}

#[derive(Debug, Copy, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(transparent)]
pub struct DefaultTrue(pub bool);

impl Default for DefaultTrue {
    fn default() -> Self {
        Self(true)
    }
}

impl From<DefaultTrue> for bool {
    fn from(default_true: DefaultTrue) -> Self {
        default_true.0
    }
}

impl From<bool> for DefaultTrue {
    fn from(b: bool) -> Self {
        Self(b)
    }
}

/// The valid types of length units.
#[derive(
    Debug, Default, Eq, PartialEq, Copy, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr,
)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass(eq, eq_int))]
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

impl From<kittycad_modeling_cmds::units::UnitLength> for UnitLength {
    fn from(unit: kittycad_modeling_cmds::units::UnitLength) -> Self {
        match unit {
            kittycad_modeling_cmds::units::UnitLength::Centimeters => UnitLength::Cm,
            kittycad_modeling_cmds::units::UnitLength::Feet => UnitLength::Ft,
            kittycad_modeling_cmds::units::UnitLength::Inches => UnitLength::In,
            kittycad_modeling_cmds::units::UnitLength::Meters => UnitLength::M,
            kittycad_modeling_cmds::units::UnitLength::Millimeters => UnitLength::Mm,
            kittycad_modeling_cmds::units::UnitLength::Yards => UnitLength::Yd,
        }
    }
}

impl From<UnitLength> for kittycad_modeling_cmds::units::UnitLength {
    fn from(unit: UnitLength) -> Self {
        match unit {
            UnitLength::Cm => kittycad_modeling_cmds::units::UnitLength::Centimeters,
            UnitLength::Ft => kittycad_modeling_cmds::units::UnitLength::Feet,
            UnitLength::In => kittycad_modeling_cmds::units::UnitLength::Inches,
            UnitLength::M => kittycad_modeling_cmds::units::UnitLength::Meters,
            UnitLength::Mm => kittycad_modeling_cmds::units::UnitLength::Millimeters,
            UnitLength::Yd => kittycad_modeling_cmds::units::UnitLength::Yards,
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
    #[display("zoo")]
    #[serde(rename = "zoo", alias = "Zoo", alias = "KittyCAD")]
    Zoo,
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

/// The types of camera projection for the 3D view.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum CameraProjectionType {
    /// Perspective projection https://en.wikipedia.org/wiki/3D_projection#Perspective_projection
    Perspective,
    /// Orthographic projection https://en.wikipedia.org/wiki/3D_projection#Orthographic_projection
    #[default]
    Orthographic,
}

/// The types of camera orbit methods.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum CameraOrbitType {
    /// Orbit using a spherical camera movement.
    #[default]
    #[display("spherical")]
    Spherical,
    /// Orbit using a trackball camera movement.
    #[display("trackball")]
    Trackball,
}

/// Settings that affect the behavior of the KCL text editor.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct TextEditorSettings {
    /// Whether to wrap text in the editor or overflow with scroll.
    #[serde(default, alias = "textWrapping", skip_serializing_if = "is_default")]
    pub text_wrapping: DefaultTrue,
    /// Whether to make the cursor blink in the editor.
    #[serde(default, alias = "blinkingCursor", skip_serializing_if = "is_default")]
    pub blinking_cursor: DefaultTrue,
}

/// Settings that affect the behavior of project management.
#[derive(Debug, Clone, Default, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct ProjectSettings {
    /// The directory to save and load projects from.
    #[serde(default, skip_serializing_if = "is_default")]
    pub directory: std::path::PathBuf,
    /// The default project name to use when creating a new project.
    #[serde(default, alias = "defaultProjectName", skip_serializing_if = "is_default")]
    pub default_project_name: ProjectNameTemplate,
}

#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
#[serde(transparent)]
pub struct ProjectNameTemplate(pub String);

impl Default for ProjectNameTemplate {
    fn default() -> Self {
        Self(DEFAULT_PROJECT_NAME_TEMPLATE.to_string())
    }
}

impl From<ProjectNameTemplate> for String {
    fn from(project_name: ProjectNameTemplate) -> Self {
        project_name.0
    }
}

impl From<String> for ProjectNameTemplate {
    fn from(s: String) -> Self {
        Self(s)
    }
}

/// Settings that affect the behavior of the command bar.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Eq, Validate)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub struct CommandBarSettings {
    /// Whether to include settings in the command bar.
    #[serde(default, alias = "includeSettings", skip_serializing_if = "is_default")]
    pub include_settings: DefaultTrue,
}

/// The types of onboarding status.
#[derive(Debug, Default, Eq, PartialEq, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, Display, FromStr)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum OnboardingStatus {
    /// The unset state.
    #[serde(rename = "")]
    #[display("")]
    Unset,
    /// The user has completed onboarding.
    Completed,
    /// The user has not completed onboarding.
    #[default]
    Incomplete,
    /// The user has dismissed onboarding.
    Dismissed,

    // Routes
    #[serde(rename = "/")]
    #[display("/")]
    Index,
    #[serde(rename = "/camera")]
    #[display("/camera")]
    Camera,
    #[serde(rename = "/streaming")]
    #[display("/streaming")]
    Streaming,
    #[serde(rename = "/editor")]
    #[display("/editor")]
    Editor,
    #[serde(rename = "/parametric-modeling")]
    #[display("/parametric-modeling")]
    ParametricModeling,
    #[serde(rename = "/interactive-numbers")]
    #[display("/interactive-numbers")]
    InteractiveNumbers,
    #[serde(rename = "/command-k")]
    #[display("/command-k")]
    CommandK,
    #[serde(rename = "/user-menu")]
    #[display("/user-menu")]
    UserMenu,
    #[serde(rename = "/project-menu")]
    #[display("/project-menu")]
    ProjectMenu,
    #[serde(rename = "/export")]
    #[display("/export")]
    Export,
    #[serde(rename = "/move")]
    #[display("/move")]
    Move,
    #[serde(rename = "/sketching")]
    #[display("/sketching")]
    Sketching,
    #[serde(rename = "/future-work")]
    #[display("/future-work")]
    FutureWork,
}

fn is_default<T: Default + PartialEq>(t: &T) -> bool {
    t == &T::default()
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;
    use validator::Validate;

    use super::{
        AppColor, AppSettings, AppTheme, AppearanceSettings, CameraProjectionType, CommandBarSettings, Configuration,
        ModelingSettings, OnboardingStatus, ProjectSettings, Settings, TextEditorSettings, UnitLength,
    };
    use crate::settings::types::CameraOrbitType;

    #[test]
    // Test that we can deserialize a project file from the old format.
    // TODO: We can remove this functionality after a few versions.
    fn test_backwards_compatible_project_settings_file_pw() {
        let old_project_file = r#"[settings.app]
theme = "dark"
onboardingStatus = "dismissed"
projectDirectory = ""
enableSSAO = false

[settings.modeling]
defaultUnit = "in"
cameraProjection = "orthographic"
mouseControls = "KittyCAD"
showDebugPanel = true

[settings.projects]
defaultProjectName = "project-$nnn"

[settings.textEditor]
textWrapping = true
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
                            color: Default::default()
                        },
                        onboarding_status: OnboardingStatus::Dismissed,
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                        stream_idle_mode: false,
                        allow_orbit_in_sketch_mode: false,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::In,
                        camera_projection: CameraProjectionType::Orthographic,
                        camera_orbit: Default::default(),
                        mouse_controls: Default::default(),
                        highlight_edges: Default::default(),
                        show_debug_panel: true,
                        enable_ssao: false.into(),
                        show_scale_grid: false,
                        named_views: Vec::default()
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: true.into(),
                        blinking_cursor: true.into()
                    },
                    project: Default::default(),
                    command_bar: CommandBarSettings {
                        include_settings: true.into()
                    },
                }
            }
        );
    }

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
                            color: 138.0.into()
                        },
                        onboarding_status: Default::default(),
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                        stream_idle_mode: false,
                        allow_orbit_in_sketch_mode: false,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::Yd,
                        camera_projection: Default::default(),
                        camera_orbit: Default::default(),
                        mouse_controls: Default::default(),
                        highlight_edges: Default::default(),
                        show_debug_panel: true,
                        enable_ssao: true.into(),
                        show_scale_grid: false,
                        named_views: Vec::default()
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: false.into(),
                        blinking_cursor: false.into()
                    },
                    project: Default::default(),
                    command_bar: CommandBarSettings {
                        include_settings: false.into()
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
                            color: 138.0.into()
                        },
                        onboarding_status: OnboardingStatus::Dismissed,
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                        stream_idle_mode: false,
                        allow_orbit_in_sketch_mode: false,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::Yd,
                        camera_projection: Default::default(),
                        camera_orbit: CameraOrbitType::Spherical,
                        mouse_controls: Default::default(),
                        highlight_edges: Default::default(),
                        show_debug_panel: true,
                        enable_ssao: true.into(),
                        show_scale_grid: false,
                        named_views: Vec::default()
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: false.into(),
                        blinking_cursor: false.into()
                    },
                    project: ProjectSettings {
                        directory: "/Users/macinatormax/Documents/kittycad-modeling-projects".into(),
                        default_project_name: "projects-$nnn".to_string().into()
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
onboarding_status = "dismissed"

[settings.app.appearance]
theme = "dark"
color = 138.0

[settings.modeling]
base_unit = "yd"
show_debug_panel = true

[settings.text_editor]
text_wrapping = false
blinking_cursor = false

[settings.project]
directory = "/Users/macinatormax/Documents/kittycad-modeling-projects"
default_project_name = "projects-$nnn"

[settings.command_bar]
include_settings = false
"#
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
                            color: Default::default()
                        },
                        onboarding_status: OnboardingStatus::Dismissed,
                        project_directory: None,
                        theme: None,
                        theme_color: None,
                        dismiss_web_banner: false,
                        enable_ssao: None,
                        stream_idle_mode: false,
                        allow_orbit_in_sketch_mode: false,
                    },
                    modeling: ModelingSettings {
                        base_unit: UnitLength::Mm,
                        camera_projection: Default::default(),
                        camera_orbit: Default::default(),
                        mouse_controls: Default::default(),
                        highlight_edges: true.into(),
                        show_debug_panel: false,
                        enable_ssao: true.into(),
                        show_scale_grid: false,
                        named_views: Vec::default()
                    },
                    text_editor: TextEditorSettings {
                        text_wrapping: true.into(),
                        blinking_cursor: true.into()
                    },
                    project: ProjectSettings {
                        directory: "/Users/macinatormax/Documents/kittycad-modeling-projects".into(),
                        default_project_name: "project-$nnn".to_string().into()
                    },
                    command_bar: CommandBarSettings {
                        include_settings: true.into()
                    },
                }
            }
        );

        // Write the file back out.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(
            serialized,
            r#"[settings.app]
onboarding_status = "dismissed"

[settings.project]
directory = "/Users/macinatormax/Documents/kittycad-modeling-projects"
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
        assert_eq!(serialized, r#""#);

        let parsed = Configuration::backwards_compatible_toml_parse(empty_settings_file).unwrap();
        assert_eq!(parsed, Configuration::default());
    }

    #[test]
    fn test_color_validation() {
        let color = AppColor(360.0);

        let result = color.validate();
        if let Ok(r) = result {
            panic!("Expected an error, but got success: {:?}", r);
        }
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("color: Validation error: color"));

        let appearance = AppearanceSettings {
            theme: AppTheme::System,
            color: AppColor(361.5),
        };
        let result = appearance.validate();
        if let Ok(r) = result {
            panic!("Expected an error, but got success: {:?}", r);
        }
        assert!(result.is_err());
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("color: Validation error: color"));
    }

    #[test]
    fn test_settings_color_validation_error() {
        let settings_file = r#"[settings.app.appearance]
color = 1567.4"#;

        let result = Configuration::backwards_compatible_toml_parse(settings_file);
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
