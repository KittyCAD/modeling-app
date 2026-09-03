use std::collections::BTreeMap;

use serde::Serialize;
use ts_rs::TS;

use super::kcl_doc;
use super::kcl_doc::ArgKind;
use super::kcl_doc::DocData;
use super::kcl_doc::ModData;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "StdLibCommandTypes.ts")]
struct StdLibLiteralValueShape {
    // The literal exactly as it appears in KCL source, including units and
    // string delimiters.
    source: String,
}

// Export the stdlib signature metadata needed by command-bar type adapters.
#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "StdLibCommandTypes.ts")]
struct StdLibCommandShape {
    name: String,
    preferred_name: String,
    qual_name: String,
    module_name: String,
    return_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    summary: Option<String>,
    deprecated: bool,
    deprecated_since: Option<String>,
    experimental: bool,
    doc_hidden: bool,
    args: Vec<StdLibCommandArgShape>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "StdLibCommandTypes.ts")]
struct StdLibCommandArgShape {
    name: String,
    ty: Option<String>,
    docs: Option<String>,
    required: bool,
    special: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    default_value: Option<StdLibLiteralValueShape>,
    experimental: bool,
    added_in: Option<String>,
    deprecated: bool,
    deprecated_since: Option<String>,
    removed_since: Option<String>,
}

#[derive(Debug, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "StdLibCommandTypes.ts")]
struct StdLibConstantShape {
    name: String,
    preferred_name: String,
    qual_name: String,
    module_name: String,
    ty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    value: Option<StdLibLiteralValueShape>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    summary: Option<String>,
    deprecated: bool,
    deprecated_since: Option<String>,
    experimental: bool,
    doc_hidden: bool,
}

fn literal_value(source: &Option<String>) -> Option<StdLibLiteralValueShape> {
    source
        .as_ref()
        .map(|source| StdLibLiteralValueShape { source: source.clone() })
}

fn stdlib_commands(stdlib: &ModData) -> BTreeMap<String, StdLibCommandShape> {
    stdlib
        .all_docs()
        .filter_map(|doc| {
            let DocData::Fn(func) = doc else {
                return None;
            };
            Some((
                func.preferred_name.clone(),
                StdLibCommandShape {
                    name: func.name.clone(),
                    preferred_name: func.preferred_name.clone(),
                    qual_name: func.qual_name.clone(),
                    module_name: func.module_name.clone(),
                    return_type: func.return_type.clone(),
                    summary: func.summary.clone(),
                    deprecated: func.properties.deprecated,
                    deprecated_since: func.properties.deprecated_since.as_ref().map(ToString::to_string),
                    experimental: func.properties.experimental,
                    doc_hidden: func.properties.doc_hidden,
                    args: func
                        .args
                        .iter()
                        .map(|arg| StdLibCommandArgShape {
                            name: arg.name.clone(),
                            ty: arg.ty.clone(),
                            docs: arg.docs.clone(),
                            required: arg.kind.required(),
                            special: matches!(arg.kind, ArgKind::Special),
                            default_value: literal_value(&arg.default_value),
                            experimental: arg.experimental,
                            added_in: arg.added_in.as_ref().map(ToString::to_string),
                            deprecated: arg.deprecated,
                            deprecated_since: arg.deprecated_since.as_ref().map(ToString::to_string),
                            removed_since: arg.removed_since.as_ref().map(ToString::to_string),
                        })
                        .collect(),
                },
            ))
        })
        .collect()
}

fn stdlib_constants(stdlib: &ModData) -> BTreeMap<String, StdLibConstantShape> {
    let mut constants = BTreeMap::new();
    for doc in stdlib.all_docs() {
        let DocData::Const(constant) = doc else {
            continue;
        };
        let key = constant.preferred_name.clone();
        let shape = StdLibConstantShape {
            name: constant.name.clone(),
            preferred_name: constant.preferred_name.clone(),
            qual_name: constant.qual_name.clone(),
            module_name: constant.module_name.clone(),
            ty: constant.ty.clone(),
            value: literal_value(&constant.literal_value),
            summary: constant.summary.clone(),
            deprecated: constant.properties.deprecated,
            deprecated_since: constant.properties.deprecated_since.as_ref().map(ToString::to_string),
            experimental: constant.properties.experimental,
            doc_hidden: constant.properties.doc_hidden,
        };
        if let Some(previous) = constants.insert(key.clone(), shape) {
            panic!(
                "duplicate stdlib constant key {key}: {} and {}",
                previous.qual_name, constant.qual_name
            );
        }
    }
    constants
}

fn write_data_module<T: Serialize>(out_dir: &std::path::Path, file_name: &str, value: &T) {
    let json = serde_json::to_string_pretty(value).unwrap();
    std::fs::create_dir_all(out_dir).unwrap();
    std::fs::write(
        out_dir.join(file_name),
        format!(
            "// This file was generated by `cargo test -p kcl-lib export_bindings`.\n\
             // Do not edit this file by hand.\n\n\
             export default {json} as const\n"
        ),
    )
    .unwrap();
}

#[test]
fn export_bindings_stdlib_metadata() {
    let stdlib = kcl_doc::walk_stdlib();
    let commands = stdlib_commands(&stdlib);
    let constants = stdlib_constants(&stdlib);

    let ts_config = ts_rs::Config::from_env();
    StdLibCommandShape::export_all(&ts_config).unwrap();
    StdLibConstantShape::export_all(&ts_config).unwrap();

    // ts-rs owns the structural TypeScript declarations in
    // StdLibCommandTypes.ts. Runtime stdlib metadata is emitted as data-only
    // TypeScript modules with `as const` so names and literal source values
    // remain narrow types for adapters.
    let out_dir = ts_config.out_dir();
    write_data_module(out_dir, "StdLibCommands.ts", &commands);
    write_data_module(out_dir, "StdLibConstants.ts", &constants);
}

#[test]
fn stdlib_metadata_preserves_source_backed_ui_metadata() {
    let stdlib = kcl_doc::walk_stdlib();
    let commands = stdlib_commands(&stdlib);
    let constants = stdlib_constants(&stdlib);

    let extrude = &commands["extrude"];
    assert!(extrude.summary.as_deref().is_some_and(|summary| !summary.is_empty()));

    let loft_degree = commands["loft"].args.iter().find(|arg| arg.name == "vDegree").unwrap();
    assert_eq!(
        loft_degree.default_value,
        Some(StdLibLiteralValueShape { source: "2".to_owned() })
    );

    for (name, source) in [
        ("MERGE", "\"merge\""),
        ("NEW", "\"new\""),
        ("SOLID", "\"solid\""),
        ("SURFACE", "\"surface\""),
    ] {
        assert_eq!(
            constants[name].value,
            Some(StdLibLiteralValueShape {
                source: source.to_owned()
            })
        );
        assert_eq!(constants[name].ty.as_deref(), Some("string"));
        assert_eq!(constants[name].qual_name, format!("std::{name}"));
    }
    assert!(!constants.contains_key("hole::holeTypeSimple"));
    assert_eq!(constants["sweep::TRAJECTORY"].qual_name, "std::sweep::TRAJECTORY");
    assert_eq!(constants["sweep::TRAJECTORY"].module_name, "sweep");
}
