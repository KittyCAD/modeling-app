use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use serde_json::json;
use tokio::task::JoinSet;

use super::kcl_doc::ConstData;
use super::kcl_doc::DocCategory;
use super::kcl_doc::DocData;
use super::kcl_doc::ExampleProperties;
use super::kcl_doc::ExampleSketchSyntax;
use super::kcl_doc::FnData;
use super::kcl_doc::ModData;
use super::kcl_doc::TyData;
use super::kcl_doc::remove_md_links;
use crate::ConnectionError;
use crate::ExecutorContext;
use crate::errors::ExecErrorWithState;
use crate::util::RetryConfig;
use crate::util::execute_with_retries;

mod type_formatter;

fn escape_frontmatter_value(value: &str) -> String {
    // YAML frontmatter is double-quoted in templates, so escape backslashes and quotes.
    value.replace('\\', "\\\\").replace('"', "\\\"")
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

    hbs.register_helper(
        "frontmatter_escape",
        Box::new(
            |h: &handlebars::Helper,
             _: &handlebars::Handlebars,
             _: &handlebars::Context,
             _: &mut handlebars::RenderContext,
             out: &mut dyn handlebars::Output|
             -> handlebars::HelperResult {
                let input = h.param(0).and_then(|v| v.value().as_str()).unwrap_or("");
                let first_line = input.lines().next().unwrap_or("");
                out.write(&escape_frontmatter_value(first_line))?;
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
                if let Some(param) = h.param(0)
                    && let Some(string) = param.value().as_str()
                {
                    // Only get the first part before the newline.
                    // This is to prevent the YAML from breaking.
                    let first_line = string.lines().next().unwrap_or("");
                    out.write(&escape_frontmatter_value(first_line))?;
                    return Ok(());
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

#[derive(Clone, Copy)]
enum StdlibDocFlavor {
    Combined,
    Legacy,
    SketchSolve,
}

impl StdlibDocFlavor {
    const ALL: [Self; 3] = [Self::Combined, Self::Legacy, Self::SketchSolve];

    fn stdlib_dir(self) -> &'static str {
        match self {
            Self::Combined => "kcl-std",
            Self::Legacy => "kcl-std-legacy",
            Self::SketchSolve => "kcl-std-sketch-solve",
        }
    }

    fn stdlib_link_prefix(self) -> String {
        format!("/docs/{}", self.stdlib_dir())
    }

    fn kcl_lang_types_link(self) -> &'static str {
        match self {
            Self::SketchSolve => "/docs/kcl-sketch-solve/types",
            Self::Combined | Self::Legacy => "/docs/kcl-lang/types",
        }
    }

    fn include_example(self, props: &ExampleProperties) -> bool {
        match self {
            Self::Combined => true,
            Self::Legacy => matches!(
                props.sketch_syntax,
                ExampleSketchSyntax::SketchSyntaxAgnostic | ExampleSketchSyntax::Legacy
            ),
            Self::SketchSolve => matches!(
                props.sketch_syntax,
                ExampleSketchSyntax::SketchSyntaxAgnostic | ExampleSketchSyntax::SketchSolve
            ),
        }
    }

    // Only the combined docs are published as the full linked reference.
    // Legacy and sketch-solve outputs are later synced into ZooKeeper-facing
    // docs from modeling-app, so we strip markdown links there instead of
    // emitting stale hardcoded paths.
    fn preserve_markdown_links(self) -> bool {
        matches!(self, Self::Combined)
    }

    fn output_root(self) -> PathBuf {
        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        manifest_dir.join("../../docs").join(self.stdlib_dir())
    }
}

fn sanitize_markdown_links(flavor: StdlibDocFlavor, input: Option<String>) -> Option<String> {
    input.map(|text| sanitize_markdown_links_str(flavor, &text))
}

fn sanitize_markdown_links_str(flavor: StdlibDocFlavor, input: &str) -> String {
    if flavor.preserve_markdown_links() {
        input.to_owned()
    } else {
        // Legacy and sketch-solve should keep the visible text but drop markdown
        // link targets before the docs are written out for ZooKeeper consumption.
        remove_md_links(input)
    }
}

fn write_doc_output(flavor: StdlibDocFlavor, relative_file_name: &str, output: &str) -> Result<()> {
    let path = flavor.output_root().join(format!("{relative_file_name}.md"));
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    expectorate::assert_contents(path, output);
    Ok(())
}

fn generate_index(kcl_lib: &ModData, flavor: StdlibDocFlavor) -> Result<()> {
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

        let group = match d.doc_category() {
            DocCategory::Functions => functions.entry(d.mod_name()).or_default(),
            DocCategory::Constants => constants.entry(d.mod_name()).or_default(),
            DocCategory::Modules => continue,
            DocCategory::Types => types.entry(d.mod_name()).or_default(),
        };

        group.push((
            d.preferred_name().to_owned(),
            format!("{}/{}", flavor.stdlib_link_prefix(), d.file_name()),
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
                flavor.kcl_lang_types_link().to_owned()
            } else {
                format!("{}/modules/{}", flavor.stdlib_link_prefix(), m.replace("::", "-"))
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
        "types_overview_link": flavor.kcl_lang_types_link(),
    });

    let output = hbs.render("index", &data)?;

    write_doc_output(flavor, "index", &output)?;

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

    let gltf_path = if props.norun || props.no3d {
        String::new()
    } else {
        // Refers to the specific path of zoo.dev that assets are served under.
        // Look in website repo's ContentLayer configuration to find how this is set.
        // Right now, we assume the GLTF export is called 'output' but in the future, we should
        // pass its name in from the process which ran the export.
        format!("/kcl-test-outputs/models/serial_test_example_{file_name}{index}_output.gltf")
    };

    let image_path = if props.norun {
        String::new()
    } else {
        // Refers to the specific path of zoo.dev that assets are served under.
        // Look in website repo's ContentLayer configuration to find how this is set.
        format!("/kcl-test-outputs/serial_test_example_{file_name}{index}.png")
    };

    Some(json!({
        "content": content,
        "gltf_path": gltf_path,
        "image_path": image_path,
    }))
}

fn generate_type_from_kcl(
    ty: &TyData,
    file_name: String,
    example_name: String,
    kcl_std: &ModData,
    flavor: StdlibDocFlavor,
) -> Result<()> {
    if ty.properties.doc_hidden {
        return Ok(());
    }

    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = ty
        .examples
        .iter()
        .enumerate()
        .filter(|(_, example)| flavor.include_example(&example.1))
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();

    let data = json!({
        "name": ty.preferred_name,
        "module": mod_name_std(&ty.module_name),
        "definition": ty.alias.as_ref().map(|t| format!("type {} = {t}", ty.preferred_name)),
        "summary": sanitize_markdown_links(flavor, ty.summary.clone()),
        "description": sanitize_markdown_links(flavor, ty.description.clone()),
        "deprecated": ty.properties.deprecated,
        "experimental": ty.properties.experimental,
        "examples": examples,
    });

    let output = hbs.render("kclType", &data)?;
    let output = cleanup_types(&output, kcl_std, flavor);
    write_doc_output(flavor, &file_name, &output)?;

    Ok(())
}

fn generate_mod_from_kcl(m: &ModData, file_name: String, flavor: StdlibDocFlavor) -> Result<()> {
    fn list_items(m: &ModData, namespace: &str, flavor: StdlibDocFlavor) -> Vec<gltf_json::Value> {
        let mut items: Vec<_> = m
            .children
            .iter()
            .filter(|(k, _)| k.starts_with(namespace))
            .map(|(_, v)| {
                (
                    v.preferred_name().to_owned(),
                    format!("{}/{}", flavor.stdlib_link_prefix(), v.file_name()),
                )
            })
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

    let functions = list_items(m, "I:", flavor);
    let modules = list_items(m, "M:", flavor);
    let types = list_items(m, "T:", flavor);

    let data = json!({
        "name": m.name,
        "module": mod_name_std(&m.module_name),
        "summary": sanitize_markdown_links(flavor, m.summary.clone()),
        "description": sanitize_markdown_links(flavor, m.description.clone()),
        "experimental": m.properties.experimental,
        "modules": modules,
        "functions": functions,
        "types": types,
    });

    let output = hbs.render("module", &data)?;
    write_doc_output(flavor, &file_name, &output)?;

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
    flavor: StdlibDocFlavor,
) -> Result<()> {
    if function.properties.doc_hidden {
        return Ok(());
    }

    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = function
        .examples
        .iter()
        .enumerate()
        .filter(|(_, example)| flavor.include_example(&example.1))
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();
    let args = function
        .args
        .iter()
        .map(|arg| {
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
                "description": sanitize_markdown_links_str(
                    flavor,
                    &docs
                        .or_else(|| arg.ty.as_ref().and_then(|t| docs_for_type(t, kcl_std)))
                        .unwrap_or_default(),
                ),
                "required": arg.kind.required(),
            })
        })
        .collect::<Vec<_>>();

    let data = json!({
        "name": function.preferred_name,
        "module": mod_name_std(&function.module_name),
        "summary": sanitize_markdown_links(flavor, function.summary.clone()),
        "description": sanitize_markdown_links(flavor, function.description.clone()),
        "deprecated": function.properties.deprecated,
        "experimental": function.properties.experimental,
        "fn_signature": function.preferred_name.clone() + &function.fn_signature(),
        "examples": examples,
        "args": args,
        "return_value": function.return_type.as_ref().map(|t| {
            json!({
                "type_": t,
                "description": sanitize_markdown_links_str(
                    flavor,
                    &docs_for_type(t, kcl_std).unwrap_or_default(),
                ),
            })
        }),
    });

    let output = hbs.render("function", &data)?;
    let output = &cleanup_types(&output, kcl_std, flavor);
    write_doc_output(flavor, &file_name, output)?;

    Ok(())
}

fn docs_for_type(ty: &str, kcl_std: &ModData) -> Option<String> {
    let key = if ty.starts_with("number") { "number" } else { ty };

    if !key.contains('|')
        && !key.contains('[')
        && let Some(data) = kcl_std.find_by_name(key)
    {
        return data.summary().cloned();
    }

    None
}

fn generate_const_from_kcl(
    cnst: &ConstData,
    file_name: String,
    example_name: String,
    kcl_std: &ModData,
    flavor: StdlibDocFlavor,
) -> Result<()> {
    if cnst.properties.doc_hidden {
        return Ok(());
    }
    let hbs = init_handlebars()?;

    let examples: Vec<serde_json::Value> = cnst
        .examples
        .iter()
        .enumerate()
        .filter(|(_, example)| flavor.include_example(&example.1))
        .filter_map(|(index, example)| generate_example(index, &example.0, &example.1, &example_name))
        .collect();

    let data = json!({
        "name": cnst.preferred_name,
        "module": mod_name_std(&cnst.module_name),
        "summary": sanitize_markdown_links(flavor, cnst.summary.clone()),
        "description": sanitize_markdown_links(flavor, cnst.description.clone()),
        "deprecated": cnst.properties.deprecated,
        "experimental": cnst.properties.experimental,
        "type_": cnst.ty,
        "type_desc": cnst.ty.as_ref().map(|t| {
            sanitize_markdown_links_str(flavor, &docs_for_type(t, kcl_std).unwrap_or_default())
        }),
        "examples": examples,
        "value": cnst.value.as_deref().unwrap_or(""),
    });

    let output = hbs.render("const", &data)?;
    let output = cleanup_types(&output, kcl_std, flavor);
    write_doc_output(flavor, &file_name, &output)?;

    Ok(())
}

fn cleanup_types(input: &str, kcl_std: &ModData, flavor: StdlibDocFlavor) -> String {
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
                code.push_str(&cleanup_type_string(code_type.trim(), false, kcl_std, flavor));
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
                    output.push_str(&cleanup_type_string(&code, true, kcl_std, flavor));
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

fn cleanup_type_string(input: &str, fmt_for_text: bool, kcl_std: &ModData, flavor: StdlibDocFlavor) -> String {
    let type_tree = match type_formatter::parse(input) {
        Ok(type_tree) => type_tree,
        Err(e) => {
            eprintln!("Could not parse: {input} because {e}");
            return input.to_owned();
        }
    };
    // Linked type rendering is only valid in the combined docs. For legacy and
    // sketch-solve, render the type text without markdown links so downstream
    // ZooKeeper docs do not inherit `/docs/kcl-std/...` paths.
    let fmtd = type_tree.format(fmt_for_text && flavor.preserve_markdown_links(), kcl_std);
    if !fmtd.contains('`') && fmt_for_text {
        format!("`{fmtd}`")
    } else {
        fmtd
    }
}

#[test]
fn test_generate_stdlib_markdown_docs() {
    let kcl_std = crate::docs::kcl_doc::walk_prelude();

    for flavor in StdlibDocFlavor::ALL {
        generate_index(&kcl_std, flavor).unwrap();

        for d in kcl_std.all_docs() {
            match d {
                DocData::Fn(f) => {
                    generate_function_from_kcl(f, d.file_name(), d.example_name(), &kcl_std, flavor).unwrap()
                }
                DocData::Const(c) => {
                    generate_const_from_kcl(c, d.file_name(), d.example_name(), &kcl_std, flavor).unwrap()
                }
                DocData::Ty(t) => generate_type_from_kcl(t, d.file_name(), d.example_name(), &kcl_std, flavor).unwrap(),
                DocData::Mod(m) => generate_mod_from_kcl(m, d.file_name(), flavor).unwrap(),
            }
        }
        generate_mod_from_kcl(&kcl_std, "modules/std".to_owned(), flavor).unwrap();
    }
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
            join_set.spawn(async move { (format!("{f}, example {i}"), run_example_with_retries(&eg).await) });
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

/// Execute the example code, with retries if we get a transient error from the
/// engine.
async fn run_example_with_retries(text: &str) -> Result<()> {
    let program = crate::Program::parse_no_errs(text)?;
    execute_with_retries(&RetryConfig::default(), || run_example(&program)).await?;
    Ok(())
}

async fn run_example(program: &crate::Program) -> Result<(), ExecErrorWithState> {
    let ctx = ExecutorContext::new_with_default_client()
        .await
        .map_err(ConnectionError::CouldNotMakeClient)?;
    let mut exec_state = crate::execution::ExecState::new(&ctx);
    let result = ctx
        .run(program, &mut exec_state)
        .await
        .map_err(|err| ExecErrorWithState::new(err.into(), exec_state, None));
    // Always close, even when there's an error.
    ctx.close().await;
    result.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cleanup_type_string() {
        let kcl_std = crate::docs::kcl_doc::walk_prelude();

        struct Test {
            input: &'static str,
            expected_text_combined: &'static str,
            expected_text_linkless: &'static str,
            expected_no_text: &'static str,
        }

        let tests = [
            Test {
                input: "v",
                expected_text_combined: "`v`",
                expected_text_linkless: "`v`",
                expected_no_text: "v",
            },
            Test {
                input: "number(mm)",
                expected_text_combined: "[`number(mm)`](/docs/kcl-std/types/std-types-number)",
                expected_text_linkless: "`number(mm)`",
                expected_no_text: "number(mm)",
            },
            Test {
                input: "number(mm) | string",
                expected_text_combined: "[`number(mm)`](/docs/kcl-std/types/std-types-number) or [`string`](/docs/kcl-std/types/std-types-string)",
                expected_text_linkless: "`number(mm) | string`",
                expected_no_text: "number(mm) | string",
            },
            Test {
                input: "[string; 1+]",
                expected_text_combined: "[[`string`](/docs/kcl-std/types/std-types-string); 1+]",
                expected_text_linkless: "`[string; 1+]`",
                expected_no_text: "[string; 1+]",
            },
            Test {
                input: "[string; 1+] | number(mm)",
                expected_text_combined: "[[`string`](/docs/kcl-std/types/std-types-string); 1+] or [`number(mm)`](/docs/kcl-std/types/std-types-number)",
                expected_text_linkless: "`[string; 1+] | number(mm)`",
                expected_no_text: "[string; 1+] | number(mm)",
            },
            Test {
                input: "[string | number(mm)]",
                expected_text_combined: "[[`string`](/docs/kcl-std/types/std-types-string) or [`number(mm)`](/docs/kcl-std/types/std-types-number)]",
                expected_text_linkless: "`[string | number(mm)]`",
                expected_no_text: "[string | number(mm)]",
            },
            Test {
                input: "[a, b, c]",
                expected_text_combined: "`[a, b, c]`",
                expected_text_linkless: "`[a, b, c]`",
                expected_no_text: "[a, b, c]",
            },
        ];
        for test in tests {
            let actual_text_combined = cleanup_type_string(test.input, true, &kcl_std, StdlibDocFlavor::Combined);
            assert_eq!(
                actual_text_combined, test.expected_text_combined,
                "Failed combined text"
            );
            let actual_text_linkless = cleanup_type_string(test.input, true, &kcl_std, StdlibDocFlavor::SketchSolve);
            assert_eq!(
                actual_text_linkless, test.expected_text_linkless,
                "Failed linkless text"
            );
            let actual_no_text = cleanup_type_string(test.input, false, &kcl_std, StdlibDocFlavor::Combined);
            assert_eq!(actual_no_text, test.expected_no_text, "Failed no text");
        }
    }
}
