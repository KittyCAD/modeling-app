use std::collections::HashMap;

use anyhow::Result;
use base64::Engine;
use convert_case::Casing;
use itertools::Itertools;
use serde_json::json;

use crate::{docs::StdLibFn, std::StdLib};

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
            let (type_format, should_be_indented) = arg.get_type_string().unwrap();
            json!({
                "name": arg.name,
                "type_": arg.type_,
                "description": arg.description(),
                "required": arg.required,
                "type_format": should_be_indented.then_some(type_format),
            })
        }).collect::<Vec<_>>(),
        "return_value": internal_fn.return_value().map(|ret| {
            let (type_format, should_be_indented) = ret.get_type_string().unwrap();
            json!({
                "type_": ret.type_,
                "description": ret.description(),
                "type_format": should_be_indented.then_some(type_format),
            })
        }),
    });

    let output = hbs.render("function", &data)?;
    std::fs::write(format!("../../../docs/kcl/{}.md", fn_name), output)?;

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
