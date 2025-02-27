//! Types specific for modeling-app projects.

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use validator::Validate;

use crate::settings::types::{
    AppColor, AppSettings, AppTheme, CommandBarSettings, ModelingSettings, TextEditorSettings,
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
        settings.settings.app.project_directory = None;

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

/// High level project settings.
#[derive(Debug, Default, Clone, Deserialize, Serialize, JsonSchema, ts_rs::TS, PartialEq, Validate)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub struct PerProjectSettings {
    /// The settings for the modeling app.
    #[serde(default)]
    #[validate(nested)]
    pub app: AppSettings,
    /// Settings that affect the behavior while modeling.
    #[serde(default)]
    #[validate(nested)]
    pub modeling: ModelingSettings,
    /// Settings that affect the behavior of the KCL text editor.
    #[serde(default, alias = "textEditor")]
    #[validate(nested)]
    pub text_editor: TextEditorSettings,
    /// Settings that affect the behavior of the command bar.
    #[serde(default, alias = "commandBar")]
    #[validate(nested)]
    pub command_bar: CommandBarSettings,
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::{
        AppSettings, AppTheme, CommandBarSettings, ModelingSettings, PerProjectSettings, ProjectConfiguration,
        TextEditorSettings,
    };
    use crate::settings::types::{AppearanceSettings, NamedView, UnitLength};

    use serde_json::Value;

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
                        named_views: Vec::default()
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

    #[test]
    fn named_view_serde_json() {
        let json = r#"
        [
          {
            "name":"dog",
            "pivot_rotation":[0.53809947,0.0,0.0,0.8428814],
            "pivot_position":[0.5,0,0.5],
            "eye_offset":231.52048,
            "fov_y":45,
            "ortho_scale_factor":1.574129,
            "is_ortho":true,
            "ortho_scale_enabled":true,
            "world_coord_system":"RightHandedUpZ"
          }
    ]
    "#;
        // serde_json to a NamedView will produce default values
        let named_views: Vec<NamedView> = serde_json::from_str(json).unwrap();
        let uuid_string = named_views[0].id.to_string();
        let version = named_views[0].version;
        assert_eq!(uuid_string.len(), 36);
        assert_eq!(version, 1.0);
    }

    #[test]
    fn named_view_serde_json_string() {
        let json = r#"
        [
          {
            "name":"dog",
            "pivot_rotation":[0.53809947,0.0,0.0,0.8428814],
            "pivot_position":[0.5,0,0.5],
            "eye_offset":231.52048,
            "fov_y":45,
            "ortho_scale_factor":1.574129,
            "is_ortho":true,
            "ortho_scale_enabled":true,
            "world_coord_system":"RightHandedUpZ"
          }
    ]
    "#;

        // serde_json to string does not produce default values
        let named_views: Value = match serde_json::from_str(json) {
            Ok(x) => x,
            Err(_) => return,
        };
        println!("{}", named_views);
    }

    #[test]
    fn test_project_settings_named_views() {
        let conf = ProjectConfiguration {
            settings: PerProjectSettings {
                app: AppSettings {
                    appearance: AppearanceSettings {
                        theme: AppTheme::Dark,
                        color: 138.0.into(),
                    },
                    onboarding_status: Default::default(),
                    project_directory: None,
                    theme: None,
                    theme_color: None,
                    dismiss_web_banner: false,
                    enable_ssao: None,
                    stream_idle_mode: false,
                    allow_orbit_in_sketch_mode: false,
                    named_views: vec![
                        NamedView {
                            name: String::from("Hello"),
                            eye_offset: 1236.4015,
                            fov_y: 45.0,
                            is_ortho: false,
                            ortho_scale_enabled: false,
                            ortho_scale_factor: 45.0,
                            pivot_position: [-100.0, 100.0, 100.0],
                            pivot_rotation: [-0.16391756, 0.9862819, -0.01956843, 0.0032552152],
                            world_coord_system: String::from("RightHandedUpZ"),
                            id: uuid::uuid!("323611ea-66e3-43c9-9d0d-1091ba92948c"),
                            version: 1.0,
                        },
                        NamedView {
                            name: String::from("Goodbye"),
                            eye_offset: 1236.4015,
                            fov_y: 45.0,
                            is_ortho: false,
                            ortho_scale_enabled: false,
                            ortho_scale_factor: 45.0,
                            pivot_position: [-100.0, 100.0, 100.0],
                            pivot_rotation: [-0.16391756, 0.9862819, -0.01956843, 0.0032552152],
                            world_coord_system: String::from("RightHandedUpZ"),
                            id: uuid::uuid!("423611ea-66e3-43c9-9d0d-1091ba92948c"),
                            version: 1.0,
                        },
                    ],
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
                },
                text_editor: TextEditorSettings {
                    text_wrapping: false.into(),
                    blinking_cursor: false.into(),
                },
                command_bar: CommandBarSettings {
                    include_settings: false.into(),
                },
            },
        };
        let serialized = toml::to_string(&conf).unwrap();
        let old_project_file = r#"[settings.app.appearance]
theme = "dark"
color = 138.0

[settings.modeling]
base_unit = "yd"
show_debug_panel = true


[[settings.app.named_views]]
name = "Hello"
eye_offset = 1236.4015
fov_y = 45.0
is_ortho = false
ortho_scale_enabled = false
ortho_scale_factor = 45.0
pivot_position = [-100.0, 100.0, 100.0]
pivot_rotation = [-0.16391756, 0.9862819, -0.01956843, 0.0032552152]
world_coord_system = RightHandedUpZ
_id = 323611ea-66e3-43c9-9d0d-1091ba92948c
_version = 1.0

[[settings.app.named_views]]
name = Goodbye
eye_offset = 1236.4015
fov_y = 45.0
is_ortho = false
ortho_scale_enabled = false
ortho_scale_factor = 45.0
pivot_position = [-100.0, 100.0, 100.0]
pivot_rotation = [-0.16391756, 0.9862819, -0.01956843, 0.0032552152]
world_coord_system = RightHandedUpZ
_id = 423611ea-66e3-43c9-9d0d-1091ba92948c
_version = 1.0

[settings.text_editor]
text_wrapping = false
blinking_cursor = false

[settings.command_bar]
include_settings = false
"#;

        assert_eq!(serialized, old_project_file)
    }
}
