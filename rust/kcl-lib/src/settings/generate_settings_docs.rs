use std::fs;
use std::path::PathBuf;
use schemars::{gen::SchemaGenerator, JsonSchema};
use serde_json::{json, Value};

use crate::settings::types::project::ProjectConfiguration;
use crate::settings::types::Configuration;

const PROJECT_SETTINGS_DOC_PATH: &str = "../../docs/kcl/settings/project.toml.md";
const USER_SETTINGS_DOC_PATH: &str = "../../docs/kcl/settings/user.toml.md";

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
                            .map(|s| format!("`{}`", s))
                            .collect::<Vec<_>>()
                            .join(", ");
                        out.write(&pretty_options)?;
                        return Ok(());
                    }
                }
                out.write("No options available")? ;
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
                        Value::String(s) => out.write(&format!("`{}`", s))?,
                        Value::Array(arr) => {
                            let formatted = arr.iter()
                                .map(|v| match v {
                                    Value::String(s) => format!("`{}`", s),
                                    _ => format!("{}", v),
                                })
                                .collect::<Vec<_>>()
                                .join(", ");
                            out.write(&format!("[{}]", formatted))?;
                        },
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
    let mut settings = schemars::gen::SchemaSettings::default();
    settings.inline_subschemas = true;
    settings.meta_schema = None;   // We don't need the meta schema for docs
    settings.option_nullable = false; // Important - makes Option fields show properly
    settings.option_add_null_type = false;
    
    let mut generator = SchemaGenerator::new(settings.clone());
    let project_schema = ProjectConfiguration::json_schema(&mut generator);
    
    // For debugging the schema:
    // fs::write("/tmp/project_schema.json", serde_json::to_string_pretty(&project_schema).unwrap())
    //     .expect("Failed to write debug schema");
    
    // Convert the schema to our template format
    let project_data = json!({
        "title": "Project Settings",
        "description": "Configuration options for KittyCAD modeling app projects.",
        "config_type": "Project Configuration",
        "file_name": "project.toml",
        "settings": json!(project_schema)
    });
    
    let project_output = hbs.render("settings", &project_data)
        .expect("Failed to render project settings documentation");
    
    fs::write(PROJECT_SETTINGS_DOC_PATH, project_output)
        .expect("Failed to write project settings documentation");
    
    // Generate user settings documentation
    let mut generator = SchemaGenerator::new(settings);
    let user_schema = Configuration::json_schema(&mut generator);
    
    // For debugging the schema:
    // fs::write("/tmp/user_schema.json", serde_json::to_string_pretty(&user_schema).unwrap())
    //     .expect("Failed to write debug schema");
    
    let user_data = json!({
        "title": "User Settings",
        "description": "User-specific configuration options for the KittyCAD modeling app.",
        "config_type": "User Configuration",
        "file_name": "user.toml",
        "settings": json!(user_schema)
    });
    
    let user_output = hbs.render("settings", &user_data)
        .expect("Failed to render user settings documentation");
    
    fs::write(USER_SETTINGS_DOC_PATH, user_output)
        .expect("Failed to write user settings documentation");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_settings_docs() {
        generate_settings_docs();
    }
}
