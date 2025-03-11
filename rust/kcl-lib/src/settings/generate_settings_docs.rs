use serde_json::json;
use std::fs;
use std::path::PathBuf;

// Note: We don't need to import the actual types since we're just generating documentation
// based on our manually created schema representation

const PROJECT_SETTINGS_DOC_PATH: &str = "../../docs/kcl/settings/project.toml.md";
const USER_SETTINGS_DOC_PATH: &str = "../../docs/kcl/settings/user.toml.md";

fn init_handlebars() -> handlebars::Handlebars<'static> {
    let mut hbs = handlebars::Handlebars::new();
    
    // Register helpers if needed
    
    hbs.register_template_string("settings", include_str!("templates/settings.hbs"))
        .expect("Failed to register settings template");
    
    hbs
}

fn ensure_settings_dir() {
    let settings_dir = PathBuf::from("../../docs/kcl/settings");
    if !settings_dir.exists() {
        fs::create_dir_all(&settings_dir).expect("Failed to create settings directory");
    }
}

pub fn generate_settings_docs() {
    ensure_settings_dir();
    let hbs = init_handlebars();
    
    // Generate project settings documentation
    let project_data = json!({
        "title": "Project Settings",
        "description": "Configuration options for KittyCAD modeling app projects.",
        "config_type": "Project Configuration",
        "file_name": "project.toml",
        "settings": get_project_settings_schema()
    });
    
    let project_output = hbs.render("settings", &project_data)
        .expect("Failed to render project settings documentation");
    
    fs::write(PROJECT_SETTINGS_DOC_PATH, project_output)
        .expect("Failed to write project settings documentation");
    
    // Generate user settings documentation
    let user_data = json!({
        "title": "User Settings",
        "description": "User-specific configuration options for the KittyCAD modeling app.",
        "config_type": "User Configuration",
        "file_name": "user.toml",
        "settings": get_user_settings_schema()
    });
    
    let user_output = hbs.render("settings", &user_data)
        .expect("Failed to render user settings documentation");
    
    fs::write(USER_SETTINGS_DOC_PATH, user_output)
        .expect("Failed to write user settings documentation");
}

fn get_project_settings_schema() -> serde_json::Value {
    // Define the schema for ProjectConfiguration
    // This is a manual representation of the structure we'd need for documentation
    json!({
        "settings": {
            "type": "object",
            "description": "The settings section contains all project-specific configuration options.",
            "properties": {
                "app": {
                    "type": "object",
                    "description": "Application-specific settings for this project.",
                    "properties": {
                        "appearance": {
                            "type": "object",
                            "description": "Controls the visual appearance of the application for this project.",
                            "properties": {
                                "color": {
                                    "type": "number",
                                    "description": "The hue of the primary theme color (0-360).",
                                    "default": "264.5"
                                }
                            }
                        },
                        "onboarding_status": {
                            "type": "string",
                            "description": "The onboarding status for this project.",
                            "enum": ["", "completed", "incomplete", "dismissed"],
                            "default": "incomplete"
                        },
                        "theme_color": {
                            "type": "number",
                            "description": "DEPRECATED: Use appearance.color instead. The hue of the primary theme color.",
                            "default": "null"
                        },
                        "enable_ssao": {
                            "type": "boolean",
                            "description": "DEPRECATED: Use modeling.enable_ssao instead. Whether Screen Space Ambient Occlusion is enabled.",
                            "default": "null"
                        },
                        "dismiss_web_banner": {
                            "type": "boolean",
                            "description": "Permanently dismiss the banner warning to download the desktop app.",
                            "default": "false"
                        },
                        "stream_idle_mode": {
                            "type": "boolean",
                            "description": "When the user is idle, and this is true, the stream will be torn down.",
                            "default": "false"
                        },
                        "allow_orbit_in_sketch_mode": {
                            "type": "boolean",
                            "description": "Whether to allow orbit camera controls in sketch mode.",
                            "default": "false"
                        },
                        "show_debug_panel": {
                            "type": "boolean",
                            "description": "Whether to show the debug panel, which lets you see various states of the app.",
                            "default": "false"
                        },
                        "named_views": {
                            "type": "object",
                            "description": "User-defined camera positions saved as named views.",
                            "additionalProperties": {
                                "type": "object",
                                "properties": {
                                    "name": {
                                        "type": "string",
                                        "description": "User defined name to identify the named view."
                                    },
                                    "eye_offset": {
                                        "type": "number",
                                        "description": "Engine camera eye offset."
                                    },
                                    "fov_y": {
                                        "type": "number",
                                        "description": "Engine camera vertical field of view."
                                    },
                                    "is_ortho": {
                                        "type": "boolean",
                                        "description": "Whether the engine camera uses orthographic projection."
                                    },
                                    "ortho_scale_enabled": {
                                        "type": "boolean",
                                        "description": "Whether orthographic camera scaling is enabled."
                                    },
                                    "ortho_scale_factor": {
                                        "type": "number",
                                        "description": "Engine camera orthographic scaling factor."
                                    },
                                    "pivot_position": {
                                        "type": "array",
                                        "description": "Engine camera position that the camera pivots around.",
                                        "items": {"type": "number"},
                                        "minItems": 3,
                                        "maxItems": 3
                                    },
                                    "pivot_rotation": {
                                        "type": "array",
                                        "description": "Engine camera orientation in relation to the pivot position.",
                                        "items": {"type": "number"},
                                        "minItems": 4,
                                        "maxItems": 4
                                    },
                                    "world_coord_system": {
                                        "type": "string",
                                        "description": "Engine camera world coordinate system orientation."
                                    },
                                    "version": {
                                        "type": "number",
                                        "description": "Version number of the view point.",
                                        "default": "1.0"
                                    }
                                }
                            }
                        }
                    }
                },
                "modeling": {
                    "type": "object",
                    "description": "Settings that affect the behavior while modeling.",
                    "properties": {
                        "base_unit": {
                            "type": "string",
                            "description": "The default unit to use in modeling dimensions.",
                            "enum": ["cm", "ft", "in", "m", "mm", "yd"],
                            "default": "mm"
                        },
                        "highlight_edges": {
                            "type": "boolean",
                            "description": "Whether to highlight edges of 3D objects.",
                            "default": "true"
                        },
                        "show_debug_panel": {
                            "type": "boolean",
                            "description": "DEPRECATED: Use app.show_debug_panel instead.",
                            "default": "false"
                        },
                        "enable_ssao": {
                            "type": "boolean",
                            "description": "Whether Screen Space Ambient Occlusion is enabled.",
                            "default": "true"
                        }
                    }
                },
                "text_editor": {
                    "type": "object",
                    "description": "Settings that affect the behavior of the KCL text editor.",
                    "properties": {
                        "text_wrapping": {
                            "type": "boolean",
                            "description": "Whether to wrap text in the editor or overflow with scroll.",
                            "default": "true"
                        },
                        "blinking_cursor": {
                            "type": "boolean",
                            "description": "Whether to make the cursor blink in the editor.",
                            "default": "true"
                        }
                    }
                },
                "command_bar": {
                    "type": "object",
                    "description": "Settings that affect the behavior of the command bar.",
                    "properties": {
                        "include_settings": {
                            "type": "boolean",
                            "description": "Whether to include settings in the command bar.",
                            "default": "true"
                        }
                    }
                }
            }
        }
    })
}

fn get_user_settings_schema() -> serde_json::Value {
    // Define the schema for Configuration (user settings)
    json!({
        "settings": {
            "type": "object",
            "description": "The settings section contains all user-specific configuration options.",
            "properties": {
                "app": {
                    "type": "object",
                    "description": "Application-wide settings.",
                    "properties": {
                        "appearance": {
                            "type": "object",
                            "description": "Controls the visual appearance of the application.",
                            "properties": {
                                "theme": {
                                    "type": "string",
                                    "description": "The overall theme of the app.",
                                    "enum": ["light", "dark", "system"],
                                    "default": "system"
                                },
                                "color": {
                                    "type": "number",
                                    "description": "The hue of the primary theme color (0-360).",
                                    "default": "264.5"
                                }
                            }
                        },
                        "onboarding_status": {
                            "type": "string",
                            "description": "The onboarding status for the user.",
                            "enum": ["", "completed", "incomplete", "dismissed"],
                            "default": "incomplete"
                        },
                        "project_directory": {
                            "type": "string",
                            "description": "DEPRECATED: Use project.directory instead. The directory to save and load projects from.",
                            "default": "null"
                        },
                        "theme": {
                            "type": "string",
                            "description": "DEPRECATED: Use appearance.theme instead. The overall theme of the app.",
                            "enum": ["light", "dark", "system"],
                            "default": "null"
                        },
                        "theme_color": {
                            "type": "number",
                            "description": "DEPRECATED: Use appearance.color instead. The hue of the primary theme color.",
                            "default": "null"
                        },
                        "enable_ssao": {
                            "type": "boolean",
                            "description": "DEPRECATED: Use modeling.enable_ssao instead. Whether Screen Space Ambient Occlusion is enabled.",
                            "default": "null"
                        },
                        "dismiss_web_banner": {
                            "type": "boolean",
                            "description": "Permanently dismiss the banner warning to download the desktop app.",
                            "default": "false"
                        },
                        "stream_idle_mode": {
                            "type": "boolean",
                            "description": "When the user is idle, and this is true, the stream will be torn down.",
                            "default": "false"
                        },
                        "allow_orbit_in_sketch_mode": {
                            "type": "boolean",
                            "description": "Whether to allow orbit camera controls in sketch mode.",
                            "default": "false"
                        },
                        "show_debug_panel": {
                            "type": "boolean",
                            "description": "Whether to show the debug panel, which lets you see various states of the app.",
                            "default": "false"
                        }
                    }
                },
                "modeling": {
                    "type": "object",
                    "description": "Settings that affect the behavior while modeling.",
                    "properties": {
                        "base_unit": {
                            "type": "string",
                            "description": "The default unit to use in modeling dimensions.",
                            "enum": ["cm", "ft", "in", "m", "mm", "yd"],
                            "default": "mm"
                        },
                        "camera_projection": {
                            "type": "string",
                            "description": "The projection mode the camera should use while modeling.",
                            "enum": ["perspective", "orthographic"],
                            "default": "orthographic"
                        },
                        "camera_orbit": {
                            "type": "string",
                            "description": "The methodology the camera should use to orbit around the model.",
                            "enum": ["spherical", "trackball"],
                            "default": "spherical"
                        },
                        "mouse_controls": {
                            "type": "string",
                            "description": "The controls for how to navigate the 3D view.",
                            "enum": ["zoo", "onshape", "trackpad_friendly", "solidworks", "nx", "creo", "autocad"],
                            "default": "zoo"
                        },
                        "highlight_edges": {
                            "type": "boolean",
                            "description": "Whether to highlight edges of 3D objects.",
                            "default": "true"
                        },
                        "show_debug_panel": {
                            "type": "boolean",
                            "description": "DEPRECATED: Use app.show_debug_panel instead.",
                            "default": "false"
                        },
                        "enable_ssao": {
                            "type": "boolean",
                            "description": "Whether Screen Space Ambient Occlusion is enabled.",
                            "default": "true"
                        },
                        "show_scale_grid": {
                            "type": "boolean",
                            "description": "Whether to show a scale grid in the 3D modeling view.",
                            "default": "false"
                        }
                    }
                },
                "text_editor": {
                    "type": "object",
                    "description": "Settings that affect the behavior of the KCL text editor.",
                    "properties": {
                        "text_wrapping": {
                            "type": "boolean",
                            "description": "Whether to wrap text in the editor or overflow with scroll.",
                            "default": "true"
                        },
                        "blinking_cursor": {
                            "type": "boolean",
                            "description": "Whether to make the cursor blink in the editor.",
                            "default": "true"
                        }
                    }
                },
                "project": {
                    "type": "object",
                    "description": "Settings that affect the behavior of project management.",
                    "properties": {
                        "directory": {
                            "type": "string",
                            "description": "The directory to save and load projects from.",
                            "default": ""
                        },
                        "default_project_name": {
                            "type": "string",
                            "description": "The default project name template to use when creating new projects. Use $nnn as a placeholder for incremental numbers.",
                            "default": "project-$nnn"
                        }
                    }
                },
                "command_bar": {
                    "type": "object",
                    "description": "Settings that affect the behavior of the command bar.",
                    "properties": {
                        "include_settings": {
                            "type": "boolean",
                            "description": "Whether to include settings in the command bar.",
                            "default": "true"
                        }
                    }
                }
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_settings_docs() {
        generate_settings_docs();
    }
}