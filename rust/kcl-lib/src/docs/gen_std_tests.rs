use std::{collections::HashMap, fs, path::Path};

use anyhow::Result;
use base64::Engine;
use serde_json::json;
use tokio::task::JoinSet;

use super::kcl_doc::{ConstData, DocData, ExampleProperties, FnData, ModData, TyData};
use crate::ExecutorContext;

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
    hbs.register_template_string("module", include_str!("templates/module.hbs"))?;
    hbs.register_template_string("kclType", include_str!("templates/kclType.hbs"))?;

    Ok(hbs)
}

fn generate_index(kcl_lib: &ModData) -> Result<()> {
    let hbs = init_handlebars()?;

    let mut functions = HashMap::new();
    functions.insert("std".to_owned(), Vec::new());

    let mut constants = HashMap::new();

    let mut types = HashMap::new();
    types.insert("Primitive types".to_owned(), Vec::new());

    for d in kcl_lib.all_docs() {
        if d.hide() {
            continue;
        }

        let group = match d {
            DocData::Fn(_) => functions.entry(d.mod_name()).or_default(),
            DocData::Ty(_) => types.entry(d.mod_name()).or_default(),
            DocData::Const(_) => constants.entry(d.mod_name()).or_default(),
            DocData::Mod(_) => continue,
        };

        group.push((
            d.preferred_name().to_owned(),
            format!("/docs/kcl-std/{}", d.file_name()),
        ));
    }

    let mut sorted_fns: Vec<_> = functions
        .into_iter()
        .map(|(m, mut fns)| {
            fns.sort();
            let val = json!({
                "name": m,
                "file_name": format!("/docs/kcl-std/modules/{}", m.replace("::", "-")),
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
                "file_name": format!("/docs/kcl-std/modules/{}", m.replace("::", "-")),
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
            let file_name = if m == "Primitive types" {
                "/docs/kcl-lang/types".to_owned()
            } else {
                format!("/docs/kcl-std/modules/{}", m.replace("::", "-"))
            };
            tys.sort();
            let val = json!({
                "name": m,
                "file_name": file_name,
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

    let data = json!({
        "functions": functions_data,
        "consts": consts_data,
        "types": types_data,
    });

    let output = hbs.render("index", &data)?;

    expectorate::assert_contents("../../docs/kcl-std/index.md", &output);

    Ok(())
}

fn generate_example(index: usize, src: &str, props: &ExampleProperties, file_name: &str) -> Option<serde_json::Value> {
    if props.inline && props.norun {
        return None;
    }

    let content = if props.inline {
        String::new()
    } else {
        crate::unparser::fmt(src).unwrap()
    };

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
            std::fs::read(&image_path).unwrap_or_else(|_| panic!("Failed to read image file: {image_path}"));
        base64::engine::general_purpose::STANDARD.encode(&image_data)
    };

    Some(json!({
        "content": content,
        "image_base64": image_base64,
    }))
}

fn generate_type_from_kcl(ty: &TyData, file_name: String, example_name: String, kcl_std: &ModData) -> Result<()> {
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
        "name": ty.preferred_name,
        "module": mod_name_std(&ty.module_name),
        "definition": ty.alias.as_ref().map(|t| format!("type {} = {t}", ty.preferred_name)),
        "summary": ty.summary,
        "description": ty.description,
        "deprecated": ty.properties.deprecated,
        "examples": examples,
    });

    let output = hbs.render("kclType", &data)?;
    let output = cleanup_types(&output, kcl_std);
    expectorate::assert_contents(format!("../../docs/kcl-std/{file_name}.md"), &output);

    Ok(())
}

fn generate_mod_from_kcl(m: &ModData, file_name: String) -> Result<()> {
    fn list_items(m: &ModData, namespace: &str) -> Vec<gltf_json::Value> {
        let mut items: Vec<_> = m
            .children
            .iter()
            .filter(|(k, _)| k.starts_with(namespace))
            .map(|(_, v)| (v.preferred_name().to_owned(), v.file_name()))
            .collect();

        items.sort();
        items
            .into_iter()
            .map(|(n, f)| {
                json!({
                    "name": n,
                    "file_name": f,
                })
            })
            .collect()
    }
    let hbs = init_handlebars()?;

    let functions = list_items(m, "I:");
    let modules = list_items(m, "M:");
    let types = list_items(m, "T:");

    let data = json!({
        "name": m.name,
        "module": mod_name_std(&m.module_name),
        "summary": m.summary,
        "description": m.description,
        "modules": modules,
        "functions": functions,
        "types": types,
    });

    let output = hbs.render("module", &data)?;
    expectorate::assert_contents(format!("../../docs/kcl-std/{file_name}.md"), &output);

    Ok(())
}

fn mod_name_std(name: &str) -> String {
    assert_ne!(name, "prelude");
    if name == "std" {
        name.to_owned()
    } else {
        format!("std::{name}")
    }
}

fn generate_function_from_kcl(
    function: &FnData,
    file_name: String,
    example_name: String,
    kcl_std: &ModData,
) -> Result<()> {
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
    let args = function.args.iter().map(|arg| {
        let docs = arg.docs.clone();
        if let Some(docs) = &docs {
            // We deliberately truncate to one line in the template so that if we are using the docs
            // from the type, then we only take the summary. However, if there's a newline in the 
            // arg docs, then they would get truncated unintentionally.
            assert!(!docs.contains('\n'), "Arg docs will get truncated");
        };
        json!({
            "name": arg.name,
            "type_": arg.ty,
            "description": docs.or_else(|| arg.ty.as_ref().and_then(|t| docs_for_type(t, kcl_std))).unwrap_or_default(),
            "required": arg.kind.required(),
        })
    }).collect::<Vec<_>>();

    let data = json!({
        "name": function.preferred_name,
        "module": mod_name_std(&function.module_name),
        "summary": function.summary,
        "description": function.description,
        "deprecated": function.properties.deprecated,
        "fn_signature": function.preferred_name.clone() + &function.fn_signature(),
        "examples": examples,
        "args": args,
        "return_value": function.return_type.as_ref().map(|t| {
            json!({
                "type_": t,
                "description": docs_for_type(t, kcl_std).unwrap_or_default(),
            })
        }),
    });

    let output = hbs.render("function", &data)?;
    let output = &cleanup_types(&output, kcl_std);
    expectorate::assert_contents(format!("../../docs/kcl-std/{file_name}.md"), output);

    Ok(())
}

fn docs_for_type(ty: &str, kcl_std: &ModData) -> Option<String> {
    let key = if ty.starts_with("number") { "number" } else { ty };

    if !key.contains('|') && !key.contains('[') {
        if let Some(data) = kcl_std.find_by_name(key) {
            return data.summary().cloned();
        }
    }

    None
}

fn generate_const_from_kcl(cnst: &ConstData, file_name: String, example_name: String, kcl_std: &ModData) -> Result<()> {
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
        "name": cnst.preferred_name,
        "module": mod_name_std(&cnst.module_name),
        "summary": cnst.summary,
        "description": cnst.description,
        "deprecated": cnst.properties.deprecated,
        "type_": cnst.ty,
        "type_desc": cnst.ty.as_ref().map(|t| docs_for_type(t, kcl_std).unwrap_or_default()),
        "examples": examples,
        "value": cnst.value.as_deref().unwrap_or(""),
    });

    let output = hbs.render("const", &data)?;
    let output = cleanup_types(&output, kcl_std);
    expectorate::assert_contents(format!("../../docs/kcl-std/{file_name}.md"), &output);

    Ok(())
}

fn cleanup_types(input: &str, kcl_std: &ModData) -> String {
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
                code.push_str(&cleanup_type_string(code_type.trim(), false, kcl_std));
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
                    output.push_str(&cleanup_type_string(&code, true, kcl_std));
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

fn cleanup_type_string(input: &str, fmt_for_text: bool, kcl_std: &ModData) -> String {
    assert!(
        !(input.starts_with('[') && input.ends_with(']') && input.contains('|')),
        "Arrays of unions are not supported"
    );

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

            if fmt_for_text && ty.starts_with("number") {
                format!("[{prefix}{ty}{suffix}](/docs/kcl-std/types/std-types-number)")
            } else if fmt_for_text && ty.starts_with("fn") {
                format!("[{prefix}{ty}{suffix}](/docs/kcl-std/types/std-types-fn)")
            // Special case for `tag` because it exists as a type but is deprecated and mostly used as an arg name
            } else if fmt_for_text && matches!(kcl_std.find_by_name(ty), Some(DocData::Ty(_))) && ty != "tag" {
                format!("[{prefix}{ty}{suffix}](/docs/kcl-std/types/std-types-{ty})")
            } else {
                format!("{prefix}{ty}{suffix}")
            }
        })
        .collect();

    tys.join(if fmt_for_text { " or " } else { " | " })
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    let kcl_std = crate::docs::kcl_doc::walk_prelude();

    // Generate the index which is the table of contents.
    generate_index(&kcl_std).unwrap();

    for d in kcl_std.all_docs() {
        match d {
            DocData::Fn(f) => generate_function_from_kcl(f, d.file_name(), d.example_name(), &kcl_std).unwrap(),
            DocData::Const(c) => generate_const_from_kcl(c, d.file_name(), d.example_name(), &kcl_std).unwrap(),
            DocData::Ty(t) => generate_type_from_kcl(t, d.file_name(), d.example_name(), &kcl_std).unwrap(),
            DocData::Mod(m) => generate_mod_from_kcl(m, d.file_name()).unwrap(),
        }
    }
    generate_mod_from_kcl(&kcl_std, "modules/std".to_owned()).unwrap();
}

#[tokio::test(flavor = "multi_thread")]
async fn test_code_in_topics() {
    let mut join_set = JoinSet::new();
    for entry in fs::read_dir("../../docs/kcl-lang").unwrap() {
        let entry = entry.unwrap();
        if entry.file_type().unwrap().is_dir() {
            continue;
        }
        let path = entry.path();
        let text = std::fs::read_to_string(&path).unwrap();

        for (i, (eg, attr)) in find_examples(&text, &path).into_iter().enumerate() {
            if attr.contains("norun") || attr == "no_run" || !attr.contains("kcl") {
                continue;
            }

            let f = path.display().to_string();
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

fn find_examples(text: &str, filename: &Path) -> Vec<(String, String)> {
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

    assert!(!in_eg, "Unclosed code tags in {}", filename.display());

    result
}

async fn run_example(text: &str) -> Result<()> {
    let program = crate::Program::parse_no_errs(text)?;
    let ctx = ExecutorContext::new_with_default_client().await?;
    let mut exec_state = crate::execution::ExecState::new(&ctx);
    ctx.run(&program, &mut exec_state).await?;
    Ok(())
}
