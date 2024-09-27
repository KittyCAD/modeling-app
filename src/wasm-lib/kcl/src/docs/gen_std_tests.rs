use std::collections::HashMap;

use anyhow::Result;
use base64::Engine;
use convert_case::Casing;
use itertools::Itertools;
use serde_json::json;

use crate::{
    docs::{is_primitive, StdLibFn},
    std::StdLib,
};

const TYPES_DIR: &str = "../../../docs/kcl/types";

fn generate_index(combined: &HashMap<String, Box<dyn StdLibFn>>) -> Result<()> {
    let mut hbs = handlebars::Handlebars::new();
    hbs.register_template_string("index", include_str!("templates/index.hbs"))?;

    let mut functions = Vec::new();

    for key in combined.keys().sorted() {
        let internal_fn = combined
            .get(key)
            .ok_or_else(|| anyhow::anyhow!("Failed to get internal function: {}", key))?;

        if internal_fn.unpublished() || internal_fn.deprecated() {
            continue;
        }

        functions.push(json!({
            "name": internal_fn.name(),
        }));
    }

    let data = json!({
        "functions": functions,
    });

    let output = hbs.render("index", &data)?;

    std::fs::write("../../../docs/kcl/index.md", output)?;

    Ok(())
}

fn generate_function(internal_fn: Box<dyn StdLibFn>) -> Result<()> {
    let mut hbs = handlebars::Handlebars::new();
    hbs.register_template_string("function", include_str!("templates/function.hbs"))?;

    if internal_fn.unpublished() {
        return Ok(());
    }

    let fn_name = internal_fn.name();
    let snake_case_name = clean_function_name(&fn_name);

    let examples: Vec<serde_json::Value> = internal_fn
        .examples()
        .iter()
        .enumerate()
        .map(|(index, example)| {
            let image_base64 = if !internal_fn.tags().contains(&"utilities".to_string()) {
                let image_path = format!(
                    "{}/tests/outputs/serial_test_example_{}{}.png",
                    env!("CARGO_MANIFEST_DIR"),
                    snake_case_name,
                    index
                );
                let image_data =
                    std::fs::read(&image_path).unwrap_or_else(|_| panic!("Failed to read image file: {}", image_path));
                base64::engine::general_purpose::STANDARD.encode(&image_data)
            } else {
                String::new()
            };

            json!({
                "content": example,
                "image_base64": image_base64,
            })
        })
        .collect();

    // Generate the type markdown files for each argument.
    let mut types = Vec::new();
    for arg in internal_fn.args() {
        if !arg.is_primitive()? {
            generate_type(&arg.type_, &arg.schema)?;
            if !types.contains(&arg.type_.to_string()) {
                types.push(arg.type_.to_string());
            }
        }
    }

    // Generate the type markdown for the return value.
    if let Some(ret) = internal_fn.return_value() {
        if !ret.is_primitive()? {
            generate_type(&ret.type_, &ret.schema)?;
            if !types.contains(&ret.type_.to_string()) {
                types.push(ret.type_.to_string());
            }
        }
    }

    let data = json!({
        "name": fn_name,
        "summary": internal_fn.summary(),
        "description": internal_fn.description(),
        "deprecated": internal_fn.deprecated(),
        "fn_signature": internal_fn.fn_signature(),
        "tags": internal_fn.tags(),
        "examples": examples,
        "is_utilities": internal_fn.tags().contains(&"utilities".to_string()),
        "args": internal_fn.args().iter().map(|arg| {
            json!({
                "name": arg.name,
                "type_": arg.type_,
                "description": arg.description(),
                "required": arg.required,
            })
        }).collect::<Vec<_>>(),
        "return_value": internal_fn.return_value().map(|ret| {
            json!({
                "type_": ret.type_,
                "description": ret.description(),
            })
        }),
    });

    let mut output = hbs.render("function", &data)?;

    // Fix the links to the types.
    for type_name in types {
        let formatted_type_name = format!("`{}`", type_name);
        if type_name == "TagDeclarator" {
            let link = format!("[`{}`](kcl/types#tag-declaration)", "TagDeclarator");
            output = output.replace(&formatted_type_name, &link);
        } else if type_name == "TagIdentifier" {
            let link = format!("[`{}`](kcl/types#tag-identifier)", "TagIdentifier");
            output = output.replace(&formatted_type_name, &link);
        } else {
            let link = format!("[`{}`](kcl/types/{})", type_name, type_name);
            output = output.replace(&formatted_type_name, &link);
        }
    }

    std::fs::write(format!("../../../docs/kcl/{}.md", fn_name), output)?;

    Ok(())
}

fn generate_type(name: &str, schema: &schemars::schema::Schema) -> Result<()> {
    if name.is_empty() {
        return Err(anyhow::anyhow!("Empty type name"));
    }

    // Skip over TagDeclarator and TagIdentifier since they have custom docs.
    if name == "TagDeclarator" || name == "TagIdentifier" {
        return Ok(());
    }

    let schemars::schema::Schema::Object(o) = schema else {
        return Err(anyhow::anyhow!(
            "Failed to get object schema, should have not been a primitive"
        ));
    };

    // If we have an array we want to generate the type markdown files for each item in the
    // array.
    if let Some(array) = &o.array {
        // Recursively generate the type markdown files for each item in the array.
        if let Some(items) = &array.items {
            match items {
                schemars::schema::SingleOrVec::Single(item) => {
                    if is_primitive(item)?.is_some() {
                        return Ok(());
                    }
                    return generate_type(name.trim_start_matches('[').trim_end_matches(']'), item);
                }
                schemars::schema::SingleOrVec::Vec(items) => {
                    for item in items {
                        if is_primitive(item)?.is_some() {
                            continue;
                        }
                        generate_type(name.trim_start_matches('[').trim_end_matches(']'), item)?;
                    }
                    return Ok(());
                }
            }
        } else {
            return Err(anyhow::anyhow!("Failed to get array items"));
        }
    }

    // Make sure the name is pascal cased.
    if !(name.is_case(convert_case::Case::Pascal)
        || name == "CircularPattern2dData"
        || name == "CircularPattern3dData"
        || name == "LinearPattern2dData"
        || name == "LinearPattern3dData"
        || name == "Mirror2dData")
    {
        return Err(anyhow::anyhow!("Type name is not pascal cased: {}", name));
    }

    // Make sure the types directory exists.
    std::fs::create_dir_all(TYPES_DIR)?;

    let mut hbs = handlebars::Handlebars::new();
    hbs.register_template_string("type", include_str!("templates/type.hbs"))?;

    // Add the name as the title.
    let mut object = o.clone();
    if let Some(metadata) = object.metadata.as_mut() {
        metadata.title = Some(name.to_string());
    } else {
        object.metadata = Some(Box::new(schemars::schema::Metadata {
            title: Some(name.to_string()),
            ..Default::default()
        }));
    }

    let data = json!(schemars::schema::Schema::Object(object));

    let output = hbs.render("type", &data)?;
    std::fs::write(format!("{}/{}.md", TYPES_DIR, name), output)?;

    Ok(())
}

fn clean_function_name(name: &str) -> String {
    // Convert from camel case to snake case.
    let mut fn_name = name.to_case(convert_case::Case::Snake);
    // Clean the fn name.
    if fn_name.starts_with("last_seg_") {
        fn_name = fn_name.replace("last_seg_", "last_segment_");
    } else if fn_name.contains("_2_d") {
        fn_name = fn_name.replace("_2_d", "_2d");
    } else if fn_name.contains("_greater_than_or_eq") {
        fn_name = fn_name.replace("_greater_than_or_eq", "_gte");
    } else if fn_name.contains("_less_than_or_eq") {
        fn_name = fn_name.replace("_less_than_or_eq", "_lte");
    } else if fn_name.contains("_greater_than") {
        fn_name = fn_name.replace("_greater_than", "_gt");
    } else if fn_name.contains("_less_than") {
        fn_name = fn_name.replace("_less_than", "_lt");
    } else if fn_name.contains("_3_d") {
        fn_name = fn_name.replace("_3_d", "_3d");
    } else if fn_name == "seg_ang" {
        fn_name = "segment_angle".to_string();
    } else if fn_name == "seg_len" {
        fn_name = "segment_length".to_string();
    } else if fn_name.starts_with("seg_") {
        fn_name = fn_name.replace("seg_", "segment_");
    } else if fn_name.starts_with("log_") {
        fn_name = fn_name.replace("log_", "log");
    }

    fn_name
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    // Clean the old files.
    std::fs::remove_dir_all(TYPES_DIR).unwrap_or_default();

    let stdlib = StdLib::new();
    let combined = stdlib.combined();

    // Generate the index which is the table of contents.
    generate_index(&combined).unwrap();

    for key in combined.keys().sorted() {
        let internal_fn = combined.get(key).unwrap();
        generate_function(internal_fn.clone()).unwrap();
    }
}

#[test]
fn test_generate_stdlib_json_schema() {
    let stdlib = StdLib::new();
    let combined = stdlib.combined();

    let mut json_data = vec![];

    for key in combined.keys().sorted() {
        let internal_fn = combined.get(key).unwrap();
        json_data.push(internal_fn.to_json().unwrap());
    }
    expectorate::assert_contents(
        "../../../docs/kcl/std.json",
        &serde_json::to_string_pretty(&json_data).unwrap(),
    );
}
