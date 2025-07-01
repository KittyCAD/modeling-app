use std::path::PathBuf;

use schemars::{JsonSchema, r#gen::SchemaGenerator};
use serde_json::{Value, json};

use crate::settings::types::{Configuration, project::ProjectConfiguration};

// Project settings example in TOML format
const PROJECT_SETTINGS_EXAMPLE: &str = r#"[settings.app]
# Set the appearance of the application
name = "My Awesome Project"

[settings.app.appearance]
# Use dark mode theme
theme = "dark" 
# Set the app color to blue (240.0 = blue, 0.0 = red, 120.0 = green)
color = 240.0

[settings.modeling]
# Use inches as the default measurement unit
base_unit = "in"
"#;

// User settings example in TOML format
const USER_SETTINGS_EXAMPLE: &str = r#"[settings.app]
# Set the appearance of the application
[settings.app.appearance]
# Use dark mode theme
theme = "dark"
# Set the app color to blue (240.0 = blue, 0.0 = red, 120.0 = green)
color = 240.0

[settings.modeling]
# Use millimeters as the default measurement unit
base_unit = "mm"

[settings.text_editor]
# Disable text wrapping in the editor
text_wrapping = false
"#;

const PROJECT_SETTINGS_DOC_PATH: &str = "../../docs/kcl-lang/settings/project.md";
const USER_SETTINGS_DOC_PATH: &str = "../../docs/kcl-lang/settings/user.md";

fn init_handlebars() -> handlebars::Handlebars<'static> {
    let mut hbs = handlebars::Handlebars::new();

    // Register helper to pretty-format enum values
    hbs.register_helper(
        "pretty_enum",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                if let Some(enum_value) = h.param(0) {
                    if let Some(array) = enum_value.value().as_array() {
                        let pretty_options = array
                            .iter()
                            .filter_map(|v| v.as_str())
                            .map(|s| format!("`{s}`"))
                            .collect::<Vec<_>>()
                            .join(", ");
                        out.write(&pretty_options)?;
                        return Ok(());
                    }
                }
                out.write("No options available")?;
                Ok(())
            },
        ),
    );

    // Helper to format default values better
    hbs.register_helper(
        "format_default",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                if let Some(default) = h.param(0) {
                    let val = default.value();
                    match val {
                        Value::Null => out.write("None")?,
                        Value::Bool(b) => out.write(&b.to_string())?,
                        Value::Number(n) => out.write(&n.to_string())?,
                        Value::String(s) => out.write(&format!("`{s}`"))?,
                        Value::Array(arr) => {
                            let formatted = arr
                                .iter()
                                .map(|v| match v {
                                    Value::String(s) => format!("`{s}`"),
                                    _ => format!("{v}"),
                                })
                                .collect::<Vec<_>>()
                                .join(", ");
                            out.write(&format!("[{formatted}]"))?;
                        }
                        Value::Object(_) => out.write("(complex default)")?,
                    }
                    return Ok(());
                }
                out.write("None")?;
                Ok(())
            },
        ),
    );

    // Register the settings template
    hbs.register_template_string("settings", include_str!("templates/settings.hbs"))
        .expect("Failed to register settings template");

    hbs
}

pub fn generate_settings_docs() {
    let hbs = init_handlebars();

    // Generate project settings documentation
    let mut settings = schemars::r#gen::SchemaSettings::default();
    settings.inline_subschemas = true;
    settings.meta_schema = None; // We don't need the meta schema for docs
    settings.option_nullable = false; // Important - makes Option fields show properly
    settings.option_add_null_type = false;

    let mut generator = SchemaGenerator::new(settings.clone());
    let project_schema = ProjectConfiguration::json_schema(&mut generator);

    // For debugging the schema:
    // fs::write("/tmp/project_schema.json", serde_json::to_string_pretty(&project_schema).unwrap())
    //     .expect("Failed to write debug schema");

    // Extract the description from the schema metadata
    let project_description = if let schemars::schema::Schema::Object(obj) = &project_schema {
        if let Some(metadata) = &obj.metadata {
            metadata.description.clone().unwrap_or_default()
        } else {
            "Project specific settings for the Zoo Design Studio.".to_string()
        }
    } else {
        "Project specific settings for the Zoo Design Studio.".to_string()
    };

    // Convert the schema to our template format
    let project_data = json!({
        "title": "Project Settings",
        "description": project_description,
        "config_type": "Project Configuration",
        "file_name": "project.toml",
        "settings": json!(project_schema),
        "example": PROJECT_SETTINGS_EXAMPLE
    });

    let project_output = hbs
        .render("settings", &project_data)
        .expect("Failed to render project settings documentation");

    expectorate::assert_contents(PROJECT_SETTINGS_DOC_PATH, &project_output);

    // Generate user settings documentation
    let mut generator = SchemaGenerator::new(settings);
    let user_schema = Configuration::json_schema(&mut generator);

    // For debugging the schema:
    // fs::write("/tmp/user_schema.json", serde_json::to_string_pretty(&user_schema).unwrap())
    //     .expect("Failed to write debug schema");

    // Extract the description from the schema metadata
    let user_description = if let schemars::schema::Schema::Object(obj) = &user_schema {
        if let Some(metadata) = &obj.metadata {
            metadata.description.clone().unwrap_or_default()
        } else {
            "User-specific configuration options for the Zoo Design Studio.".to_string()
        }
    } else {
        "User-specific configuration options for the Zoo Design Studio.".to_string()
    };

    // Trim any trailing periods to avoid double periods

    let user_data = json!({
        "title": "User Settings",
        "description": user_description,
        "config_type": "User Configuration",
        "file_name": "user.toml",
        "settings": json!(user_schema),
        "example": USER_SETTINGS_EXAMPLE
    });

    let user_output = hbs
        .render("settings", &user_data)
        .expect("Failed to render user settings documentation");

    expectorate::assert_contents(USER_SETTINGS_DOC_PATH, &user_output);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_settings_docs() {
        // First verify that our TOML examples are valid and match the expected types
        let _project_config: ProjectConfiguration = toml::from_str(PROJECT_SETTINGS_EXAMPLE)
            .expect("Project settings example is not valid according to ProjectConfiguration");
        let _user_config: Configuration = toml::from_str(USER_SETTINGS_EXAMPLE)
            .expect("User settings example is not valid according to Configuration");

        // Expectorate will verify the output matches what we expect,
        // or update it if run with EXPECTORATE=overwrite
        generate_settings_docs();

        // Verify files exist
        let project_path = PathBuf::from(PROJECT_SETTINGS_DOC_PATH);
        let user_path = PathBuf::from(USER_SETTINGS_DOC_PATH);
        assert!(project_path.exists(), "Project settings documentation not generated");
        assert!(user_path.exists(), "User settings documentation not generated");
    }
}
