use std::collections::{BTreeMap, HashMap};

use anyhow::Result;
use base64::Engine;
use convert_case::Casing;
use handlebars::Renderable;
use itertools::Itertools;
use serde_json::json;

use crate::{
    docs::{is_primitive, StdLibFn},
    std::StdLib,
};

const TYPES_DIR: &str = "../../../docs/kcl/types";

fn init_handlebars() -> Result<handlebars::Handlebars<'static>> {
    let mut hbs = handlebars::Handlebars::new();
    // Register the 'json' helper
    hbs.register_helper(
        "json",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let param = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");
                out.write(&serde_json::to_string(&param).unwrap())?;
                Ok(())
            },
        ),
    );

    // Register the 'basename' helper
    hbs.register_helper(
        "times",
        Box::new(
            |h: &handlebars::Helper,
             hb: &handlebars::Handlebars,
             ctx: &handlebars::Context,
             rc: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let n = h.param(0).and_then(|v| v.value().as_u64()).ok_or_else(|| {
                    handlebars::RenderErrorReason::Other(
                        "times helper expects an integer as first parameter".to_string(),
                    )
                })?;

                let template = h
                    .template()
                    .ok_or_else(|| handlebars::RenderErrorReason::Other("times helper expects a block".to_string()))?;

                for i in 0..n {
                    let mut local_ctx = ctx.clone();
                    let mut rc = rc.clone();
                    let m = local_ctx.data_mut().as_object_mut().unwrap();
                    m.insert("@index".to_string(), handlebars::JsonValue::Number(i.into()));
                    if i == 0 {
                        m.insert("@first".to_string(), handlebars::JsonValue::Bool(true));
                    }
                    template.render(hb, &local_ctx, &mut rc, out)?;
                }

                Ok(())
            },
        ),
    );

    hbs.register_helper(
        "lte",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let a = h.param(0).and_then(|v| v.value().as_f64()).ok_or_else(|| {
                    handlebars::RenderErrorReason::Other("lte helper expects a number as first parameter".to_string())
                })?;

                let b = h.param(1).and_then(|v| v.value().as_f64()).ok_or_else(|| {
                    handlebars::RenderErrorReason::Other("lte helper expects a number as second parameter".to_string())
                })?;

                let result = a <= b;
                out.write(if result { "true" } else { "false" })?;

                Ok(())
            },
        ),
    );

    hbs.register_helper(
        "neq",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let param1 = h
                    .param(0)
                    .ok_or_else(|| {
                        handlebars::RenderErrorReason::Other("neq helper expects two parameters".to_string())
                    })?
                    .value();
                let param2 = h
                    .param(1)
                    .ok_or_else(|| {
                        handlebars::RenderErrorReason::Other("neq helper expects two parameters".to_string())
                    })?
                    .value();

                let result = param1 != param2;
                out.write(if result { "true" } else { "false" })?;

                Ok(())
            },
        ),
    );

    // Register the 'lowercase' helper
    hbs.register_helper(
        "lowercase",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let param = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");
                out.write(&param.to_lowercase())?;
                Ok(())
            },
        ),
    );

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
                out.write("Invalid enum")?;
                Ok(())
            },
        ),
    );

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
                out.write("Invalid enum")?;
                Ok(())
            },
        ),
    );

    hbs.register_helper(
        "pretty_ref",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let param = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");
                let basename = param.split('/').last().unwrap_or("");
                out.write(&format!("`{}`", basename))?;
                Ok(())
            },
        ),
    );

    // Register helper to remove newlines from a string.
    hbs.register_helper(
        "remove_newlines",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                if let Some(param) = h.param(0) {
                    if let Some(string) = param.value().as_str() {
                        out.write(&string.replace("\n", ""))?;
                        return Ok(());
                    }
                }
                out.write("")?;
                Ok(())
            },
        ),
    );

    // Register a helper to do safe YAML new lines.
    hbs.register_helper(
        "safe_yaml",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                if let Some(param) = h.param(0) {
                    if let Some(string) = param.value().as_str() {
                        // Only get the first part before the newline.
                        // This is to prevent the YAML from breaking.
                        let string = string.split('\n').next().unwrap_or("");
                        out.write(string)?;
                        return Ok(());
                    }
                }
                out.write("")?;
                Ok(())
            },
        ),
    );

    hbs.register_template_string("schemaType", include_str!("templates/schemaType.hbs"))?;
    hbs.register_template_string("properties", include_str!("templates/properties.hbs"))?;
    hbs.register_template_string("array", include_str!("templates/array.hbs"))?;
    hbs.register_template_string("propertyType", include_str!("templates/propertyType.hbs"))?;
    hbs.register_template_string("schema", include_str!("templates/schema.hbs"))?;
    hbs.register_template_string("index", include_str!("templates/index.hbs"))?;
    hbs.register_template_string("function", include_str!("templates/function.hbs"))?;
    hbs.register_template_string("type", include_str!("templates/type.hbs"))?;

    Ok(hbs)
}

fn generate_index(combined: &HashMap<String, Box<dyn StdLibFn>>) -> Result<()> {
    let hbs = init_handlebars()?;

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

    expectorate::assert_contents("../../../docs/kcl/index.md", &output);

    Ok(())
}

fn generate_function(internal_fn: Box<dyn StdLibFn>) -> Result<BTreeMap<String, schemars::schema::Schema>> {
    let hbs = init_handlebars()?;

    if internal_fn.unpublished() {
        return Ok(BTreeMap::new());
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
    let mut types = BTreeMap::new();
    for arg in internal_fn.args(false) {
        if !arg.is_primitive()? {
            add_to_types(&arg.type_, &arg.schema.schema.into(), &mut types)?;
            // Add each definition as well.
            for (name, definition) in &arg.schema.definitions {
                add_to_types(name, definition, &mut types)?;
            }
        }
    }

    // Generate the type markdown for the return value.
    if let Some(ret) = internal_fn.return_value(false) {
        if !ret.is_primitive()? {
            add_to_types(&ret.type_, &ret.schema.schema.into(), &mut types)?;
            for (name, definition) in &ret.schema.definitions {
                add_to_types(name, definition, &mut types)?;
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
        "args": internal_fn.args(false).iter().map(|arg| {
            json!({
                "name": arg.name,
                "type_": arg.type_,
                "description": arg.description(),
                "required": arg.required,
            })
        }).collect::<Vec<_>>(),
        "return_value": internal_fn.return_value(false).map(|ret| {
            json!({
                "type_": ret.type_,
                "description": ret.description(),
            })
        }),
    });

    let mut output = hbs.render("function", &data)?;
    // Fix the links to the types.
    output = cleanup_type_links(&output, types.keys().cloned().collect());

    expectorate::assert_contents(format!("../../../docs/kcl/{}.md", fn_name), &output);

    Ok(types)
}

fn cleanup_static_links(output: &str) -> String {
    let mut cleaned_output = output.to_string();
    // Fix the links to the types.
    let link = format!("[`{}`](/docs/kcl/types#tag-declaration)", "TagDeclarator");
    cleaned_output = cleaned_output.replace("`TagDeclarator`", &link);
    let link = format!("[`{}`](/docs/kcl/types#tag-identifier)", "TagIdentifier");
    cleaned_output = cleaned_output.replace("`TagIdentifier`", &link);

    cleaned_output
}

// Fix the links to the types.
fn cleanup_type_links(output: &str, types: Vec<String>) -> String {
    let mut cleaned_output = output.to_string();
    // Fix the links to the types.
    for type_name in types {
        if type_name == "TagDeclarator" || type_name == "TagIdentifier" {
            continue;
        } else {
            let link = format!("(/docs/kcl/types/{})", type_name);
            cleaned_output =
                cleaned_output.replace(&format!("`{}`", type_name), &format!("[`{}`]{}", type_name, &link));
            // Do the same for the type with brackets.
            cleaned_output =
                cleaned_output.replace(&format!("`[{}]`", type_name), &format!("[`[{}]`]{}", type_name, link));
        }
    }

    // Cleanup our weird number arrays.
    // TODO: This is a hack for the handlebars template being too complex.
    cleaned_output = cleaned_output.replace("`[, `number`, `number`]`", "`[number, number]`");
    cleaned_output = cleaned_output.replace("`[, `number`, `number`, `number`]`", "`[number, number, number]`");

    cleanup_static_links(&cleaned_output)
}

fn add_to_types(
    name: &str,
    schema: &schemars::schema::Schema,
    types: &mut BTreeMap<String, schemars::schema::Schema>,
) -> Result<()> {
    if name.is_empty() {
        return Err(anyhow::anyhow!("Empty type name"));
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
                    return add_to_types(name.trim_start_matches('[').trim_end_matches(']'), item, types);
                }
                schemars::schema::SingleOrVec::Vec(items) => {
                    for item in items {
                        if is_primitive(item)?.is_some() {
                            continue;
                        }
                        add_to_types(name.trim_start_matches('[').trim_end_matches(']'), item, types)?;
                    }
                    return Ok(());
                }
            }
        } else {
            return Err(anyhow::anyhow!("Failed to get array items"));
        }
    }

    types.insert(name.to_string(), schema.clone());

    Ok(())
}

fn generate_type(
    name: &str,
    schema: &schemars::schema::Schema,
    types: &BTreeMap<String, schemars::schema::Schema>,
) -> Result<()> {
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
                    return generate_type(name.trim_start_matches('[').trim_end_matches(']'), item, types);
                }
                schemars::schema::SingleOrVec::Vec(items) => {
                    for item in items {
                        if is_primitive(item)?.is_some() {
                            continue;
                        }
                        generate_type(name.trim_start_matches('[').trim_end_matches(']'), item, types)?;
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
        || name == "Point3d"
        || name == "Point2d"
        || name == "CircularPattern2dData"
        || name == "CircularPattern3dData"
        || name == "LinearPattern2dData"
        || name == "LinearPattern3dData"
        || name == "Mirror2dData")
    {
        return Err(anyhow::anyhow!("Type name is not pascal cased: {}", name));
    }

    let new_schema = recurse_and_create_references(name, schema, types)?;

    let schemars::schema::Schema::Object(o) = new_schema else {
        return Err(anyhow::anyhow!(
            "Failed to get object schema, should have not been a primitive"
        ));
    };

    let hbs = init_handlebars()?;

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

    let mut output = hbs.render("type", &data)?;
    // Fix the links to the types.
    output = cleanup_type_links(&output, types.keys().cloned().collect());
    expectorate::assert_contents(format!("{}/{}.md", TYPES_DIR, name), &output);

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

/// Check if a schema is the same as another schema, but don't check the description.
fn is_same_schema(sa: &schemars::schema::Schema, sb: &schemars::schema::Schema) -> bool {
    let schemars::schema::Schema::Object(a) = sa else {
        return sa == sb;
    };

    let schemars::schema::Schema::Object(b) = sb else {
        return sa == sb;
    };

    let mut a = a.clone();
    a.metadata = None;
    let mut b = b.clone();
    b.metadata = None;

    a == b
}

/// Recursively create references for types we already know about.
fn recurse_and_create_references(
    name: &str,
    schema: &schemars::schema::Schema,
    types: &BTreeMap<String, schemars::schema::Schema>,
) -> Result<schemars::schema::Schema> {
    let schemars::schema::Schema::Object(o) = schema else {
        return Err(anyhow::anyhow!(
            "Failed to get object schema, should have not been a primitive"
        ));
    };

    // If we already have a reference add the metadata to the reference if it has none.
    if o.reference.is_some() {
        let mut obj = o.clone();
        let t = types
            .get(name)
            .ok_or_else(|| anyhow::anyhow!("Failed to get type: {}", name))?;
        let schemars::schema::Schema::Object(to) = t else {
            return Err(anyhow::anyhow!(
                "Failed to get object schema, should have not been a primitive"
            ));
        };
        if let Some(metadata) = obj.metadata.as_mut() {
            if metadata.description.is_none() {
                metadata.description = to.metadata.as_ref().and_then(|m| m.description.clone());
            }
        } else {
            obj.metadata = to.metadata.clone();
        }
        return Ok(schemars::schema::Schema::Object(obj));
    }

    // Check if this is the type we already know about.
    for (n, s) in types {
        if is_same_schema(schema, s) && name != n && !n.starts_with("[") {
            // Return a reference to the type.
            let sref = schemars::schema::Schema::new_ref(n.to_string());
            // Add the existing metadata to the reference.
            let schemars::schema::Schema::Object(ro) = sref else {
                return Err(anyhow::anyhow!(
                    "Failed to get object schema, should have not been a primitive"
                ));
            };
            let mut ro = ro.clone();
            ro.metadata = o.metadata.clone();

            return Ok(schemars::schema::Schema::Object(ro));
        }
    }

    let mut obj = o.clone();

    // If we have an object iterate over the properties and recursively create references.
    if let Some(object) = &mut obj.object {
        for (_, value) in object.properties.iter_mut() {
            let new_value = recurse_and_create_references(name, value, types)?;
            *value = new_value;
        }
    }

    // If we have an array iterate over the items and recursively create references.
    if let Some(array) = &mut obj.array {
        if let Some(items) = &mut array.items {
            match items {
                schemars::schema::SingleOrVec::Single(item) => {
                    let new_item = recurse_and_create_references(name, item, types)?;
                    *item = Box::new(new_item);
                }
                schemars::schema::SingleOrVec::Vec(items) => {
                    for item in items {
                        let new_item = recurse_and_create_references(name, item, types)?;
                        *item = new_item;
                    }
                }
            }
        }
    }

    // If we have subschemas iterate over them and recursively create references.
    if let Some(subschema) = &mut obj.subschemas {
        // Do anyOf.
        if let Some(any_of) = &mut subschema.any_of {
            // If we only have one item in anyOf we can just return that item.
            if any_of.len() == 1 {
                let mut new_item = recurse_and_create_references(name, &any_of[0], types)?;
                if let schemars::schema::Schema::Object(new_obj) = &mut new_item {
                    if let Some(metadata) = new_obj.metadata.as_mut() {
                        metadata.description = obj.metadata.as_ref().and_then(|m| m.description.clone());
                    } else {
                        new_obj.metadata = obj.metadata.clone();
                    }
                }
                return Ok(new_item);
            }
            for item in any_of {
                let new_item = recurse_and_create_references(name, item, types)?;
                *item = new_item;
            }
        }

        // Do allOf.
        if let Some(all_of) = &mut subschema.all_of {
            // If we only have one item in allOf we can just return that item.
            if all_of.len() == 1 {
                let mut new_item = recurse_and_create_references(name, &all_of[0], types)?;
                if let schemars::schema::Schema::Object(new_obj) = &mut new_item {
                    if let Some(metadata) = new_obj.metadata.as_mut() {
                        metadata.description = obj.metadata.as_ref().and_then(|m| m.description.clone());
                    } else {
                        new_obj.metadata = obj.metadata.clone();
                    }
                }
                return Ok(new_item);
            }
            for item in all_of {
                let new_item = recurse_and_create_references(name, item, types)?;
                *item = new_item;
            }
        }

        // Do oneOf.
        if let Some(one_of) = &mut subschema.one_of {
            // If we only have one item in oneOf we can just return that item.
            if one_of.len() == 1 {
                let mut new_item = recurse_and_create_references(name, &one_of[0], types)?;
                if let schemars::schema::Schema::Object(new_obj) = &mut new_item {
                    if let Some(metadata) = new_obj.metadata.as_mut() {
                        metadata.description = obj.metadata.as_ref().and_then(|m| m.description.clone());
                    } else {
                        new_obj.metadata = obj.metadata.clone();
                    }
                }
                return Ok(new_item);
            }
            for item in one_of {
                let new_item = recurse_and_create_references(name, item, types)?;
                *item = new_item;
            }
        }
    }

    Ok(schemars::schema::Schema::Object(obj.clone()))
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    let stdlib = StdLib::new();
    let combined = stdlib.combined();

    // Generate the index which is the table of contents.
    generate_index(&combined).unwrap();

    let mut types = BTreeMap::new();
    for key in combined.keys().sorted() {
        let internal_fn = combined.get(key).unwrap();
        let fn_types = generate_function(internal_fn.clone()).unwrap();
        types.extend(fn_types);
    }

    // Generate the type markdown files.
    for (name, schema) in &types {
        generate_type(name, schema, &types).unwrap();
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
