use std::{collections::HashMap, fs, path::Path};

use anyhow::Result;
use base64::Engine;
use convert_case::Casing;
use indexmap::IndexMap;
use itertools::Itertools;
use serde_json::json;
use tokio::task::JoinSet;

use super::kcl_doc::{ConstData, DocData, ExampleProperties, FnData, TyData};
use crate::{docs::StdLibFn, std::StdLib, ExecutorContext};

const LANG_TOPICS: [&str; 4] = ["Types", "Modules", "Settings", "Known Issues"];
// These types are declared in (KCL) std.
const DECLARED_TYPES: [&str; 15] = [
    "any", "number", "string", "tag", "bool", "Sketch", "Solid", "Plane", "Helix", "Face", "Edge", "Point2d",
    "Point3d", "Axis2d", "Axis3d",
];

// Types with special handling.
const SPECIAL_TYPES: [&str; 5] = ["TagDeclarator", "TagIdentifier", "Start", "End", "ImportedGeometry"];

const TYPE_REWRITES: [(&str, &str); 11] = [
    ("TagNode", "TagDeclarator"),
    ("SketchData", "Plane | Solid"),
    ("SketchOrSurface", "Sketch | Plane | Face"),
    ("SketchSurface", "Plane | Face"),
    ("SolidOrImportedGeometry", "[Solid] | ImportedGeometry"),
    (
        "SolidOrSketchOrImportedGeometry",
        "[Solid] | [Sketch] | ImportedGeometry",
    ),
    ("KclValue", "any"),
    ("[KclValue]", "[any]"),
    ("FaceTag", "TagIdentifier | Start | End"),
    ("GeometryWithImportedGeometry", "Solid | Sketch | ImportedGeometry"),
    ("SweepPath", "Sketch | Helix"),
];

fn rename_type(input: &str) -> &str {
    for (i, o) in TYPE_REWRITES {
        if input == i {
            return o;
        }
    }

    input
}

fn init_handlebars() -> Result<handlebars::Handlebars<'static>> {
    let mut hbs = handlebars::Handlebars::new();

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

    hbs.register_template_string("index", include_str!("templates/index.hbs"))?;
    hbs.register_template_string("function", include_str!("templates/function.hbs"))?;
    hbs.register_template_string("const", include_str!("templates/const.hbs"))?;
    hbs.register_template_string("kclType", include_str!("templates/kclType.hbs"))?;

    Ok(hbs)
}

fn generate_index(combined: &IndexMap<String, Box<dyn StdLibFn>>, kcl_lib: &[DocData]) -> Result<()> {
    let hbs = init_handlebars()?;

    let mut functions = HashMap::new();
    functions.insert("std".to_owned(), Vec::new());

    let mut constants = HashMap::new();

    let mut types = HashMap::new();
    types.insert("Primitive types".to_owned(), Vec::new());

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

    for name in SPECIAL_TYPES {
        types
            .get_mut("Primitive types")
            .unwrap()
            .push((name.to_owned(), format!("types#{name}")));
    }

    for d in kcl_lib {
        if d.hide() {
            continue;
        }

        let group = match d {
            DocData::Fn(_) => functions.entry(d.mod_name()).or_default(),
            DocData::Ty(_) => types.entry(d.mod_name()).or_default(),
            DocData::Const(_) => constants.entry(d.mod_name()).or_default(),
        };

        group.push((d.preferred_name().to_owned(), d.file_name()));
    }

    let mut sorted_fns: Vec<_> = functions
        .into_iter()
        .map(|(m, mut fns)| {
            fns.sort();
            let val = json!({
                "name": m,
                "items": fns.into_iter().map(|(n, f)| json!({
                    "name": n,
                    "file_name": f,
                })).collect::<Vec<_>>(),
            });
            (m, val)
        })
        .collect();
    sorted_fns.sort_by(|t1, t2| t1.0.cmp(&t2.0));
    let functions_data: Vec<_> = sorted_fns.into_iter().map(|(_, val)| val).collect();

    let mut sorted_consts: Vec<_> = constants
        .into_iter()
        .map(|(m, mut consts)| {
            consts.sort();
            let val = json!({
                "name": m,
                "items": consts.into_iter().map(|(n, f)| json!({
                    "name": n,
                    "file_name": f,
                })).collect::<Vec<_>>(),
            });
            (m, val)
        })
        .collect();
    sorted_consts.sort_by(|t1, t2| t1.0.cmp(&t2.0));
    let consts_data: Vec<_> = sorted_consts.into_iter().map(|(_, val)| val).collect();

    let mut sorted_types: Vec<_> = types
        .into_iter()
        .map(|(m, mut tys)| {
            tys.sort();
            let val = json!({
                "name": m,
                "items": tys.into_iter().map(|(n, f)| json!({
                    "name": n,
                    "file_name": f,
                })).collect::<Vec<_>>(),
            });
            (m, val)
        })
        .collect();
    sorted_types.sort_by(|t1, t2| t1.0.cmp(&t2.0));
    let types_data: Vec<_> = sorted_types.into_iter().map(|(_, val)| val).collect();

    let topics: Vec<_> = LANG_TOPICS
        .iter()
        .map(|name| {
            json!({
                "name": name,
                "file_name": name.to_lowercase().replace(' ', "-"),
            })
        })
        .collect();

    let data = json!({
        "lang_topics": topics,
        "functions": functions_data,
        "consts": consts_data,
        "types": types_data,
    });

    let output = hbs.render("index", &data)?;

    expectorate::assert_contents("../../docs/kcl/index.md", &output);

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
    if ty.properties.doc_hidden || !DECLARED_TYPES.contains(&&*ty.name) {
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
        "definition": ty.alias.as_ref().map(|t| format!("type {} = {t}", ty.preferred_name)),
        "summary": ty.summary,
        "description": ty.description,
        "deprecated": ty.properties.deprecated,
        "examples": examples,
    });

    let output = hbs.render("kclType", &data)?;
    let output = cleanup_types(&output);
    expectorate::assert_contents(format!("../../docs/kcl/{}.md", file_name), &output);

    Ok(())
}

fn generate_function_from_kcl(function: &FnData, file_name: String, example_name: String) -> Result<()> {
    if function.properties.doc_hidden {
        return Ok(());
    }

    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = function
        .examples
        .iter()
        .enumerate()
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();

    let data = json!({
        "name": function.qual_name,
        "summary": function.summary,
        "description": function.description,
        "deprecated": function.properties.deprecated,
        "fn_signature": function.preferred_name.clone() + &function.fn_signature(),
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
    let output = &cleanup_types(&output);
    expectorate::assert_contents(format!("../../docs/kcl/{}.md", file_name), output);

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

fn generate_function(internal_fn: Box<dyn StdLibFn>) -> Result<()> {
    let hbs = init_handlebars()?;

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
        "fn_signature": internal_fn.fn_signature(true),
        "tags": internal_fn.tags(),
        "examples": examples,
        "is_utilities": internal_fn.tags().contains(&"utilities".to_string()),
        "args": internal_fn.args(false).iter().map(|arg| {
            json!({
                "name": arg.name,
                "type_": rename_type(&arg.type_),
                "description": arg.description(),
                "required": arg.required,
            })
        }).collect::<Vec<_>>(),
        "return_value": internal_fn.return_value(false).map(|ret| {
            json!({
                "type_": rename_type(&ret.type_),
                "description": ret.description(),
            })
        }),
    });

    let mut output = hbs.render("function", &data)?;
    // Fix the links to the types.
    output = cleanup_types(&output);

    expectorate::assert_contents(format!("../../docs/kcl/{}.md", fn_name), &output);

    Ok(())
}

fn cleanup_types(input: &str) -> String {
    #[derive(Copy, Clone, Eq, PartialEq, Debug)]
    enum State {
        Text,
        PreCodeBlock,
        CodeBlock,
        CodeBlockType,
        Slash,
        Comment,
    }

    let mut output = String::new();
    let mut code_annot = String::new();
    let mut code = String::new();
    let mut code_type = String::new();
    let mut state = State::Text;
    let mut ticks = 0;

    for c in input.chars() {
        if state == State::CodeBlockType {
            if ['`', ',', '\n', ')', '/'].contains(&c) {
                if code_type.starts_with(' ') {
                    code.push(' ');
                }
                code.push_str(&cleanup_type_string(code_type.trim(), false));
                if code_type.ends_with(' ') {
                    code.push(' ');
                }

                code_type = String::new();
                state = State::CodeBlock;
            } else {
                code_type.push(c);
                continue;
            }
        }
        if c == '`' {
            if state == State::Comment {
                code.push(c);
            } else {
                if state == State::Slash {
                    state = State::CodeBlock;
                }

                ticks += 1;
                if ticks == 3 {
                    if state == State::Text {
                        state = State::PreCodeBlock;
                    } else {
                        output.push_str("```");
                        output.push_str(&code_annot);
                        output.push_str(&code);
                        // `code` includes the first two of three backticks
                        output.push('`');
                        state = State::Text;
                        code_annot = String::new();
                        code = String::new();
                    }
                    ticks = 0;
                } else if state == State::Text && ticks == 2 && !code.is_empty() {
                    output.push_str(&cleanup_type_string(&code, true));
                    code = String::new();
                    ticks = 0;
                } else if state == State::CodeBlock {
                    code.push(c);
                }
            }
        } else {
            if ticks == 2 {
                // Empty code block
                ticks = 0;
            }

            if c == '\n' && (state == State::PreCodeBlock || state == State::Comment) {
                state = State::CodeBlock;
            }

            if c == '/' {
                match state {
                    State::CodeBlock => state = State::Slash,
                    State::Slash => state = State::Comment,
                    _ => {}
                }
            } else if state == State::Slash {
                state = State::CodeBlock;
            }

            match state {
                State::Text if ticks == 0 => output.push(c),
                State::Text if ticks == 1 => code.push(c),
                State::Text => unreachable!(),
                State::PreCodeBlock => code_annot.push(c),
                State::CodeBlock | State::Slash | State::Comment => code.push(c),
                State::CodeBlockType => unreachable!(),
            }

            if c == ':' && state == State::CodeBlock {
                state = State::CodeBlockType;
            }
        }
    }

    output
}

fn cleanup_type_string(input: &str, fmt_for_text: bool) -> String {
    assert!(
        !(input.starts_with('[') && input.ends_with(']') && input.contains('|')),
        "Arrays of unions are not supported"
    );

    let input = rename_type(input);

    let tys: Vec<_> = input
        .split('|')
        .map(|ty| {
            let ty = ty.trim();

            let mut prefix = String::new();
            let mut suffix = String::new();

            if fmt_for_text {
                prefix.push('`');
                suffix.push('`');
            }

            let ty = if ty.starts_with('[') {
                if ty.ends_with("; 1+]") {
                    prefix = format!("{prefix}[");
                    suffix = format!("; 1+]{suffix}");
                    &ty[1..ty.len() - 5]
                } else if ty.ends_with(']') {
                    prefix = format!("{prefix}[");
                    suffix = format!("]{suffix}");
                    &ty[1..ty.len() - 1]
                } else {
                    ty
                }
            } else {
                ty
            };

            // TODO markdown links in code blocks are not turned into links by our website stack.
            // If we can handle signatures more manually we could get highlighting and links and
            // we might want to restore the links by not checking `fmt_for_text` here.

            if fmt_for_text && SPECIAL_TYPES.contains(&ty) {
                format!("[{prefix}{ty}{suffix}](/docs/kcl/types#{ty})")
            } else if fmt_for_text && DECLARED_TYPES.contains(&ty) {
                format!("[{prefix}{ty}{suffix}](/docs/kcl/types/std-types-{ty})")
            } else {
                format!("{prefix}{ty}{suffix}")
            }
        })
        .collect();

    tys.join(if fmt_for_text { " or " } else { " | " })
}

fn clean_function_name(name: &str) -> String {
    // Convert from camel case to snake case.
    let mut fn_name = name.to_case(convert_case::Case::Snake);
    // Clean the fn name.
    if fn_name.starts_with("last_seg_") {
        fn_name = fn_name.replace("last_seg_", "last_segment_");
    } else if fn_name.contains("_2_d") {
        fn_name = fn_name.replace("_2_d", "_2d");
    } else if fn_name.contains("_3_d") {
        fn_name = fn_name.replace("_3_d", "_3d");
    } else if fn_name == "seg_ang" {
        fn_name = "segment_angle".to_string();
    } else if fn_name == "seg_len" {
        fn_name = "segment_length".to_string();
    } else if fn_name.starts_with("seg_") {
        fn_name = fn_name.replace("seg_", "segment_");
    }

    fn_name
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    let stdlib = StdLib::new();
    let combined = stdlib.combined();
    let kcl_std = crate::docs::kcl_doc::walk_prelude();

    // Generate the index which is the table of contents.
    generate_index(&combined, &kcl_std).unwrap();

    for key in combined.keys().sorted() {
        let internal_fn = combined.get(key).unwrap();
        generate_function(internal_fn.clone()).unwrap();
    }

    for d in &kcl_std {
        match d {
            DocData::Fn(f) => generate_function_from_kcl(f, d.file_name(), d.example_name()).unwrap(),
            DocData::Const(c) => generate_const_from_kcl(c, d.file_name(), d.example_name()).unwrap(),
            DocData::Ty(t) => generate_type_from_kcl(t, d.file_name(), d.example_name()).unwrap(),
        }
    }

    // Copy manually written docs to the output directory.
    for entry in fs::read_dir("../../docs/kcl-src").unwrap() {
        let path = entry.unwrap().path();
        fs::copy(&path, Path::new("../../docs/kcl").join(path.file_name().unwrap())).unwrap();
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
        let filename = format!("../../docs/kcl/{}.md", name.to_lowercase().replace(' ', "-"));
        let text = std::fs::read_to_string(&filename).unwrap();

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
    let ctx = ExecutorContext::new_with_default_client().await?;
    let mut exec_state = crate::execution::ExecState::new(&ctx);
    ctx.run(&program, &mut exec_state).await?;
    Ok(())
}
