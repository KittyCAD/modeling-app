use std::{
    collections::{BTreeMap, HashMap},
    fs::File,
    io::Read as _,
};

use anyhow::Result;
use base64::Engine;
use convert_case::Casing;
use handlebars::Renderable;
use indexmap::IndexMap;
use itertools::Itertools;
use serde_json::json;
use tokio::task::JoinSet;

use super::kcl_doc::{ConstData, DocData, ExampleProperties, FnData, TyData};
use crate::{
    docs::{is_primitive, StdLibFn},
    std::StdLib,
    ExecutorContext,
};

const TYPES_DIR: &str = "../../docs/kcl/types";
const LANG_TOPICS: [&str; 5] = ["Types", "Modules", "Settings", "Known Issues", "Constants"];
// These types are declared in std.
const DECLARED_TYPES: [&str; 12] = [
    "number", "string", "tag", "bool", "Sketch", "Solid", "Plane", "Helix", "Face", "Edge", "Point2d", "Point3d",
];

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
        "firstLine",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                // Get the first parameter passed to the helper
                let param = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");

                // Get the first line using lines() iterator
                let first = param.lines().next().unwrap_or("");

                // Write the result
                out.write(first)?;
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
    hbs.register_template_string("consts-index", include_str!("templates/consts-index.hbs"))?;
    hbs.register_template_string("function", include_str!("templates/function.hbs"))?;
    hbs.register_template_string("const", include_str!("templates/const.hbs"))?;
    hbs.register_template_string("type", include_str!("templates/type.hbs"))?;
    hbs.register_template_string("kclType", include_str!("templates/kclType.hbs"))?;

    Ok(hbs)
}

fn generate_index(combined: &IndexMap<String, Box<dyn StdLibFn>>, kcl_lib: &[DocData]) -> Result<()> {
    let hbs = init_handlebars()?;

    let mut functions = HashMap::new();
    functions.insert("std".to_owned(), Vec::new());

    let mut constants = HashMap::new();
    constants.insert("std".to_owned(), Vec::new());

    for key in combined.keys() {
        let internal_fn = combined
            .get(key)
            .ok_or_else(|| anyhow::anyhow!("Failed to get internal function: {}", key))?;

        if internal_fn.unpublished() || internal_fn.deprecated() {
            continue;
        }

        functions
            .get_mut("std")
            .unwrap()
            .push((internal_fn.name(), internal_fn.name()));
    }

    for d in kcl_lib {
        if d.hide() {
            continue;
        }

        functions.entry(d.mod_name()).or_default().push(match d {
            DocData::Fn(f) => (f.preferred_name.clone(), d.file_name()),
            DocData::Const(c) => (c.preferred_name.clone(), d.file_name()),
            DocData::Ty(t) => (t.preferred_name.clone(), d.file_name()),
        });

        if let DocData::Const(c) = d {
            constants
                .entry(d.mod_name())
                .or_default()
                .push((c.name.clone(), d.file_name()));
        }
    }

    // TODO we should sub-divide into types, constants, and functions.
    let mut sorted: Vec<_> = functions
        .into_iter()
        .map(|(m, mut fns)| {
            fns.sort();
            let val = json!({
                "name": m,
                "functions": fns.into_iter().map(|(n, f)| json!({
                    "name": n,
                    "file_name": f,
                })).collect::<Vec<_>>(),
            });
            (m, val)
        })
        .collect();
    sorted.sort_by(|t1, t2| t1.0.cmp(&t2.0));
    let data: Vec<_> = sorted.into_iter().map(|(_, val)| val).collect();

    let topics: Vec<_> = LANG_TOPICS
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "file_name": name.to_lowercase().replace(' ', "-").replace("constants", "consts"),
            })
        })
        .collect();
    let data = json!({
        "lang_topics": topics,
        "modules": data,
    });

    let output = hbs.render("index", &data)?;

    expectorate::assert_contents("../../docs/kcl/index.md", &output);

    // Generate the index for the constants.
    let mut sorted_consts: Vec<_> = constants
        .into_iter()
        .map(|(m, mut consts)| {
            consts.sort();
            let val = json!({
                "name": m,
                "consts": consts.into_iter().map(|(n, f)| json!({
                    "name": n,
                    "file_name": f,
                })).collect::<Vec<_>>(),
            });
            (m, val)
        })
        .collect();
    sorted_consts.sort_by(|t1, t2| t1.0.cmp(&t2.0));
    let data: Vec<_> = sorted_consts.into_iter().map(|(_, val)| val).collect();
    let data = json!({
        "consts": data,
    });

    let output = hbs.render("consts-index", &data)?;

    expectorate::assert_contents("../../docs/kcl/consts.md", &output);

    Ok(())
}

fn generate_example(index: usize, src: &str, props: &ExampleProperties, file_name: &str) -> Option<serde_json::Value> {
    if props.inline && props.norun {
        return None;
    }

    let content = if props.inline { "" } else { src };

    let image_base64 = if props.norun {
        String::new()
    } else {
        let image_path = format!(
            "{}/tests/outputs/serial_test_example_{}{}.png",
            env!("CARGO_MANIFEST_DIR"),
            file_name,
            index
        );
        let image_data =
            std::fs::read(&image_path).unwrap_or_else(|_| panic!("Failed to read image file: {}", image_path));
        base64::engine::general_purpose::STANDARD.encode(&image_data)
    };

    Some(json!({
        "content": content,
        "image_base64": image_base64,
    }))
}

fn generate_type_from_kcl(ty: &TyData, file_name: String, example_name: String) -> Result<()> {
    if ty.properties.doc_hidden {
        return Ok(());
    }

    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = ty
        .examples
        .iter()
        .enumerate()
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();

    let data = json!({
        "name": ty.qual_name(),
        "definition": ty.alias.as_ref().map(|t| format!("type {} = {t}", ty.name)),
        "summary": ty.summary,
        "description": ty.description,
        "deprecated": ty.properties.deprecated,
        "examples": examples,
    });

    let output = hbs.render("kclType", &data)?;
    let output = cleanup_type_links(
        &output,
        ty.referenced_types.iter().filter(|t| !DECLARED_TYPES.contains(&&***t)),
    );
    expectorate::assert_contents(format!("../../docs/kcl/{}.md", file_name), &output);

    Ok(())
}

fn generate_function_from_kcl(function: &FnData, file_name: String) -> Result<()> {
    if function.properties.doc_hidden {
        return Ok(());
    }

    let hbs = init_handlebars()?;

    let name = function.name.clone();

    let examples: Vec<serde_json::Value> = function
        .examples
        .iter()
        .enumerate()
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &file_name))
        .collect();

    let data = json!({
        "name": function.qual_name,
        "summary": function.summary,
        "description": function.description,
        "deprecated": function.properties.deprecated,
        "fn_signature": name.clone() + &function.fn_signature(),
        "tags": [],
        "examples": examples,
        "is_utilities": false,
        "args": function.args.iter().map(|arg| {
            json!({
                "name": arg.name,
                "type_": arg.ty,
                "description": arg.docs.as_deref().unwrap_or(""),
                "required": arg.kind.required(),
            })
        }).collect::<Vec<_>>(),
        "return_value": function.return_type.as_ref().map(|t| {
            json!({
                "type_": t,
                "description": "",
            })
        }),
    });

    let output = hbs.render("function", &data)?;
    let output = cleanup_type_links(
        &output,
        function
            .referenced_types
            .iter()
            .filter(|t| !DECLARED_TYPES.contains(&&***t)),
    );
    expectorate::assert_contents(format!("../../docs/kcl/{}.md", file_name), &output);

    Ok(())
}

fn generate_const_from_kcl(cnst: &ConstData, file_name: String, example_name: String) -> Result<()> {
    if cnst.properties.doc_hidden {
        return Ok(());
    }
    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = cnst
        .examples
        .iter()
        .enumerate()
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();

    let data = json!({
        "name": cnst.qual_name,
        "summary": cnst.summary,
        "description": cnst.description,
        "deprecated": cnst.properties.deprecated,
        "type_": cnst.ty,
        "examples": examples,
        "value": cnst.value.as_deref().unwrap_or(""),
    });

    let output = hbs.render("const", &data)?;
    expectorate::assert_contents(format!("../../docs/kcl/{}.md", file_name), &output);

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
        }
        // Add each definition as well.
        for (name, definition) in &arg.schema.definitions {
            add_to_types(name, definition, &mut types)?;
        }
    }

    // Generate the type markdown for the return value.
    if let Some(ret) = internal_fn.return_value(false) {
        if !ret.is_primitive()? {
            add_to_types(&ret.type_, &ret.schema.schema.into(), &mut types)?;
        }
        for (name, definition) in &ret.schema.definitions {
            add_to_types(name, definition, &mut types)?;
        }
    }

    let data = json!({
        "name": fn_name,
        "summary": internal_fn.summary(),
        "description": internal_fn.description(),
        "deprecated": internal_fn.deprecated(),
        "fn_signature": internal_fn.fn_signature(true),
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
    output = cleanup_type_links(&output, types.keys());

    expectorate::assert_contents(format!("../../docs/kcl/{}.md", fn_name), &output);

    Ok(types)
}

fn cleanup_static_links(output: &str) -> String {
    let mut cleaned_output = output.to_string();
    // Fix the links to the types.
    // Gross hack for the stupid alias types.
    cleaned_output = cleaned_output.replace("TagNode", "TagDeclarator");

    let link = format!("[`{}`](/docs/kcl/types#tag-declaration)", "TagDeclarator");
    cleaned_output = cleaned_output.replace("`TagDeclarator`", &link);
    let link = format!("[`{}`](/docs/kcl/types#tag-identifier)", "TagIdentifier");
    cleaned_output = cleaned_output.replace("`TagIdentifier`", &link);

    cleaned_output
}

// Fix the links to the types.
fn cleanup_type_links<'a>(output: &str, types: impl Iterator<Item = &'a String>) -> String {
    let mut cleaned_output = output.to_string();

    // Cleanup our weird number arrays.
    // TODO: This is a hack for the handlebars template being too complex.
    cleaned_output = cleaned_output.replace("`[, `number`, `number`]`", "`[number, number]`");
    cleaned_output = cleaned_output.replace("`[, `number`, `number`, `number`]`", "`[number, number, number]`");

    // Fix the links to the types.
    for type_name in types.map(|s| &**s).chain(DECLARED_TYPES) {
        if type_name == "TagDeclarator" || type_name == "TagIdentifier" || type_name == "TagNode" {
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

    // TODO handle union types generically rather than special casing them.
    cleaned_output = cleaned_output.replace(
        "`Sketch | Plane | Face`",
        "[`Sketch`](/docs/kcl/types/Sketch) `|` [`Plane`](/docs/kcl/types/Face) `|` [`Plane`](/docs/kcl/types/Face)",
    );

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

    if DECLARED_TYPES.contains(&name) {
        return Ok(());
    }

    if name.starts_with("number(") {
        panic!("uom number");
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
                    if is_primitive(item)?.is_some() && name != "SourceRange" {
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
    if name == "TagDeclarator" || name == "TagIdentifier" || name == "TagNode" {
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
        || name == "Mirror2dData"
        || name == "Axis2dOrEdgeReference"
        || name == "Axis3dOrEdgeReference"
        || name == "AxisAndOrigin2d"
        || name == "AxisAndOrigin3d")
    {
        return Err(anyhow::anyhow!("Type name is not pascal cased: {}", name));
    }

    let cleaned_schema = recurse_and_create_references(name, schema, types)?;
    let new_schema = super::cleanup_number_tuples(&cleaned_schema);

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

    // Cleanup the description.
    let object = cleanup_type_description(&object)
        .map_err(|e| anyhow::anyhow!("Failed to cleanup type description for type `{}`: {}", name, e))?;

    let data = json!(schemars::schema::Schema::Object(object));

    let mut output = hbs.render("type", &data)?;
    // Fix the links to the types.
    output = cleanup_type_links(&output, types.keys());
    expectorate::assert_contents(format!("{}/{}.md", TYPES_DIR, name), &output);

    Ok(())
}

fn cleanup_type_description(object: &schemars::schema::SchemaObject) -> Result<schemars::schema::SchemaObject> {
    let mut object = object.clone();
    if let Some(metadata) = object.metadata.as_mut() {
        if let Some(description) = metadata.description.as_mut() {
            // Find any ```kcl code blocks and format the code.
            // Parse any code blocks from the doc string.
            let mut code_blocks = Vec::new();
            let d = description.clone();
            for line in d.lines() {
                if line.starts_with("```kcl") && line.ends_with("```") {
                    code_blocks.push(line);
                }
            }

            // Parse the kcl and recast it.
            for code_block in &code_blocks {
                let trimmed = code_block.trim_start_matches("```kcl").trim_end_matches("```");
                let program = crate::Program::parse_no_errs(trimmed)?;

                let options = crate::parsing::ast::types::FormatOptions {
                    insert_final_newline: false,
                    ..Default::default()
                };
                let cleaned = program.ast.recast(&options, 0);

                *description = description.replace(code_block, &format!("```kcl\n{}\n```", cleaned));
            }
        }
    }

    Ok(object)
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
    } else if fn_name.ends_with("tan_2") {
        fn_name = fn_name.replace("tan_2", "tan2");
    }

    fn_name
}

/// Recursively create references for types we already know about.
fn recurse_and_create_references(
    name: &str,
    schema: &schemars::schema::Schema,
    types: &BTreeMap<String, schemars::schema::Schema>,
) -> Result<schemars::schema::Schema> {
    if DECLARED_TYPES.contains(&name) {
        return Ok(schema.clone());
    }

    let schemars::schema::Schema::Object(o) = schema else {
        return Err(anyhow::anyhow!(
            "Failed to get object schema, should have not been a primitive"
        ));
    };

    // If we already have a reference add the metadata to the reference if it has none.
    if let Some(reference) = &o.reference {
        let mut obj = o.clone();
        let reference = reference.trim_start_matches("#/components/schemas/");
        if DECLARED_TYPES.contains(&reference) {
            return Ok(schema.clone());
        }

        let t = types
            .get(reference)
            .ok_or_else(|| anyhow::anyhow!("Failed to get type: {} {:?}", reference, types.keys()))?;

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

        let obj = cleanup_type_description(&obj)
            .map_err(|e| anyhow::anyhow!("Failed to cleanup type description for type `{}`: {}", name, e))?;
        return Ok(schemars::schema::Schema::Object(obj));
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

    let obj = cleanup_type_description(&obj)
        .map_err(|e| anyhow::anyhow!("Failed to cleanup type description for type `{}`: {}", name, e))?;

    Ok(schemars::schema::Schema::Object(obj.clone()))
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    let stdlib = StdLib::new();
    let combined = stdlib.combined();
    let kcl_std = crate::docs::kcl_doc::walk_prelude();

    // Generate the index which is the table of contents.
    generate_index(&combined, &kcl_std).unwrap();

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

    for d in &kcl_std {
        match d {
            DocData::Fn(f) => generate_function_from_kcl(f, d.file_name()).unwrap(),
            DocData::Const(c) => generate_const_from_kcl(c, d.file_name(), d.example_name()).unwrap(),
            DocData::Ty(t) => generate_type_from_kcl(t, d.file_name(), d.example_name()).unwrap(),
        }
    }
}

#[test]
fn test_generate_stdlib_json_schema() {
    // If this test fails and you've modified the AST or something else which affects the json repr
    // of stdlib functions, you should rerun the test with `EXPECTORATE=overwrite` to create new
    // test data, then check `/docs/kcl/std.json` to ensure the changes are expected.
    // Alternatively, run `just redo-kcl-stdlib-docs` (make sure to have just installed).
    let stdlib = StdLib::new();
    let combined = stdlib.combined();

    let json_data: Vec<_> = combined
        .keys()
        .sorted()
        .map(|key| {
            let internal_fn = combined.get(key).unwrap();
            internal_fn.to_json().unwrap()
        })
        .collect();
    expectorate::assert_contents(
        "../../docs/kcl/std.json",
        &serde_json::to_string_pretty(&json_data).unwrap(),
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn test_code_in_topics() {
    let mut join_set = JoinSet::new();
    for name in LANG_TOPICS {
        let filename =
            format!("../../docs/kcl/{}.md", name.to_lowercase().replace(' ', "-")).replace("constants", "consts");
        let mut file = File::open(&filename).unwrap();
        let mut text = String::new();
        file.read_to_string(&mut text).unwrap();

        for (i, (eg, attr)) in find_examples(&text, &filename).into_iter().enumerate() {
            if attr == "norun" {
                continue;
            }

            let f = filename.clone();
            join_set.spawn(async move { (format!("{f}, example {i}"), run_example(&eg).await) });
        }
    }
    let results: Vec<_> = join_set
        .join_all()
        .await
        .into_iter()
        .filter_map(|a| a.1.err().map(|e| format!("{}: {}", a.0, e)))
        .collect();
    assert!(results.is_empty(), "Failures: {}", results.join(", "))
}

fn find_examples(text: &str, filename: &str) -> Vec<(String, String)> {
    let mut buf = String::new();
    let mut attr = String::new();
    let mut in_eg = false;
    let mut result = Vec::new();
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("```") {
            if in_eg {
                result.push((buf, attr));
                buf = String::new();
                attr = String::new();
                in_eg = false;
            } else {
                attr = rest.to_owned();
                in_eg = true;
            }
            continue;
        }
        if in_eg {
            buf.push('\n');
            buf.push_str(line)
        }
    }

    assert!(!in_eg, "Unclosed code tags in {}", filename);

    result
}

async fn run_example(text: &str) -> Result<()> {
    let program = crate::Program::parse_no_errs(text)?;
    let ctx = ExecutorContext::new_with_default_client(crate::UnitLength::Mm).await?;
    let mut exec_state = crate::execution::ExecState::new(&ctx);
    ctx.run(&program, &mut exec_state).await?;
    Ok(())
}
