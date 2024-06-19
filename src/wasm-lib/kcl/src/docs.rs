//! Functions for generating docs for our stdlib functions.

use std::path::Path;

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionItemLabelDetails, Documentation, InsertTextFormat, MarkupContent,
    MarkupKind, ParameterInformation, ParameterLabel, SignatureHelp, SignatureInformation,
};

use crate::std::Primitive;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StdLibFnData {
    /// The name of the function.
    pub name: String,
    /// The summary of the function.
    pub summary: String,
    /// The description of the function.
    pub description: String,
    /// The tags of the function.
    pub tags: Vec<String>,
    /// The args of the function.
    pub args: Vec<StdLibFnArg>,
    /// The return value of the function.
    pub return_value: Option<StdLibFnArg>,
    /// If the function is unpublished.
    pub unpublished: bool,
    /// If the function is deprecated.
    pub deprecated: bool,
    /// Code examples.
    /// These are tested and we know they compile and execute.
    pub examples: Vec<String>,
}

/// This struct defines a single argument to a stdlib function.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct StdLibFnArg {
    /// The name of the argument.
    pub name: String,
    /// The type of the argument.
    pub type_: String,
    /// The schema of the argument.
    #[ts(type = "any")]
    pub schema: schemars::schema::Schema,
    /// If the argument is required.
    pub required: bool,
}

impl StdLibFnArg {
    #[allow(dead_code)]
    pub fn get_type_string(&self) -> Result<(String, bool)> {
        get_type_string_from_schema(&self.schema.clone())
    }

    pub fn get_autocomplete_string(&self) -> Result<String> {
        get_autocomplete_string_from_schema(&self.schema.clone())
    }

    pub fn get_autocomplete_snippet(&self, index: usize) -> Result<Option<(usize, String)>> {
        if self.type_ == "SketchGroup"
            || self.type_ == "SketchGroupSet"
            || self.type_ == "ExtrudeGroup"
            || self.type_ == "ExtrudeGroupSet"
            || self.type_ == "SketchSurface"
        {
            return Ok(Some((index, format!("${{{}:{}}}", index, "%"))));
        }
        get_autocomplete_snippet_from_schema(&self.schema.clone(), index)
    }

    pub fn description(&self) -> Option<String> {
        get_description_string_from_schema(&self.schema.clone())
    }
}

impl From<StdLibFnArg> for ParameterInformation {
    fn from(arg: StdLibFnArg) -> Self {
        ParameterInformation {
            label: ParameterLabel::Simple(arg.name.to_string()),
            documentation: arg.description().map(|description| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: description,
                })
            }),
        }
    }
}

/// This trait defines functions called upon stdlib functions to generate
/// documentation for them.
pub trait StdLibFn: std::fmt::Debug + Send + Sync {
    /// The name of the function.
    fn name(&self) -> String;

    /// The summary of the function.
    fn summary(&self) -> String;

    /// The description of the function.
    fn description(&self) -> String;

    /// The tags of the function.
    fn tags(&self) -> Vec<String>;

    /// The args of the function.
    fn args(&self) -> Vec<StdLibFnArg>;

    /// The return value of the function.
    fn return_value(&self) -> Option<StdLibFnArg>;

    /// If the function is unpublished.
    fn unpublished(&self) -> bool;

    /// If the function is deprecated.
    fn deprecated(&self) -> bool;

    /// Any example code blocks.
    fn examples(&self) -> Vec<String>;

    /// The function itself.
    fn std_lib_fn(&self) -> crate::std::StdFn;

    /// Helper function to clone the boxed trait object.
    fn clone_box(&self) -> Box<dyn StdLibFn>;

    /// Return a JSON struct representing the function.
    fn to_json(&self) -> Result<StdLibFnData> {
        Ok(StdLibFnData {
            name: self.name(),
            summary: self.summary(),
            description: self.description(),
            tags: self.tags(),
            args: self.args(),
            return_value: self.return_value(),
            unpublished: self.unpublished(),
            deprecated: self.deprecated(),
            examples: self.examples(),
        })
    }

    fn fn_signature(&self) -> String {
        let mut signature = String::new();
        signature.push_str(&format!("{}(", self.name()));
        for (i, arg) in self.args().iter().enumerate() {
            if i > 0 {
                signature.push_str(", ");
            }
            if arg.required {
                signature.push_str(&format!("{}: {}", arg.name, arg.type_));
            } else {
                signature.push_str(&format!("{}?: {}", arg.name, arg.type_));
            }
        }
        signature.push(')');
        if let Some(return_value) = self.return_value() {
            signature.push_str(&format!(" -> {}", return_value.type_));
        }

        signature
    }

    fn to_completion_item(&self) -> Result<CompletionItem> {
        Ok(CompletionItem {
            label: self.name(),
            label_details: Some(CompletionItemLabelDetails {
                detail: Some(self.fn_signature().replace(&self.name(), "")),
                description: None,
            }),
            kind: Some(CompletionItemKind::FUNCTION),
            detail: None,
            documentation: Some(Documentation::MarkupContent(MarkupContent {
                kind: MarkupKind::Markdown,
                value: if !self.description().is_empty() {
                    format!("{}\n\n{}", self.summary(), self.description())
                } else {
                    self.summary()
                },
            })),
            deprecated: Some(self.deprecated()),
            preselect: None,
            sort_text: None,
            filter_text: None,
            insert_text: Some(self.to_autocomplete_snippet()?),
            insert_text_format: Some(InsertTextFormat::SNIPPET),
            insert_text_mode: None,
            text_edit: None,
            additional_text_edits: None,
            command: None,
            commit_characters: None,
            data: None,
            tags: None,
        })
    }

    fn to_autocomplete_snippet(&self) -> Result<String> {
        let mut args = Vec::new();
        let mut index = 0;
        for arg in self.args().iter() {
            if let Some((i, arg_str)) = arg.get_autocomplete_snippet(index)? {
                index = i + 1;
                args.push(arg_str);
            }
        }
        // We end with ${} so you can jump to the end of the snippet.
        // After the last argument.
        Ok(format!("{}({})${{}}", self.name(), args.join(", ")))
    }

    fn to_signature_help(&self) -> SignatureHelp {
        // Fill this in based on the current position of the cursor.
        let active_parameter = None;

        SignatureHelp {
            signatures: vec![SignatureInformation {
                label: self.name(),
                documentation: Some(Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: if !self.description().is_empty() {
                        format!("{}\n\n{}", self.summary(), self.description())
                    } else {
                        self.summary()
                    },
                })),
                parameters: Some(self.args().into_iter().map(|arg| arg.into()).collect()),
                active_parameter,
            }],
            active_signature: Some(0),
            active_parameter,
        }
    }
}

impl JsonSchema for dyn StdLibFn {
    fn schema_name() -> String {
        "StdLibFn".to_string()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        gen.subschema_for::<StdLibFnData>()
    }
}

impl Serialize for Box<dyn StdLibFn> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.to_json().unwrap().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for Box<dyn StdLibFn> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let data = StdLibFnData::deserialize(deserializer)?;
        let stdlib = crate::std::StdLib::new();
        let stdlib_fn = stdlib
            .get(&data.name)
            .ok_or_else(|| serde::de::Error::custom(format!("StdLibFn {} not found", data.name)))?;
        Ok(stdlib_fn)
    }
}

impl ts_rs::TS for dyn StdLibFn {
    type WithoutGenerics = Self;

    fn name() -> String {
        "StdLibFnData".to_string()
    }

    fn decl() -> String {
        StdLibFnData::decl()
    }

    fn decl_concrete() -> String {
        StdLibFnData::decl_concrete()
    }

    fn inline() -> String {
        StdLibFnData::inline()
    }

    fn inline_flattened() -> String {
        StdLibFnData::inline_flattened()
    }

    fn output_path() -> Option<&'static Path> {
        StdLibFnData::output_path()
    }
}

impl Clone for Box<dyn StdLibFn> {
    fn clone(&self) -> Box<dyn StdLibFn> {
        self.clone_box()
    }
}

pub fn get_description_string_from_schema(schema: &schemars::schema::Schema) -> Option<String> {
    if let schemars::schema::Schema::Object(o) = schema {
        if let Some(metadata) = &o.metadata {
            if let Some(description) = &metadata.description {
                return Some(description.to_string());
            }
        }
    }

    None
}

pub fn get_type_string_from_schema(schema: &schemars::schema::Schema) -> Result<(String, bool)> {
    match schema {
        schemars::schema::Schema::Object(o) => {
            if let Some(enum_values) = &o.enum_values {
                let mut parsed_enum_values: Vec<String> = Default::default();
                let mut had_enum_string = false;
                for enum_value in enum_values {
                    if let serde_json::value::Value::String(enum_value) = enum_value {
                        had_enum_string = true;
                        parsed_enum_values.push(format!("\"{}\"", enum_value));
                    } else {
                        had_enum_string = false;
                        break;
                    }
                }

                if had_enum_string {
                    return Ok((parsed_enum_values.join(" | "), false));
                }
            }

            // Check if there
            if let Some(format) = &o.format {
                if format == "uuid" {
                    return Ok((Primitive::Uuid.to_string(), false));
                } else if format == "double"
                    || format == "uint"
                    || format == "int64"
                    || format == "uint32"
                    || format == "uint64"
                {
                    return Ok((Primitive::Number.to_string(), false));
                } else {
                    anyhow::bail!("unknown format: {}", format);
                }
            }

            if let Some(obj_val) = &o.object {
                let mut fn_docs = String::new();
                fn_docs.push_str("{\n");
                // Let's print out the object's properties.
                for (prop_name, prop) in obj_val.properties.iter() {
                    if prop_name.starts_with('_') {
                        continue;
                    }

                    if let Some(description) = get_description_string_from_schema(prop) {
                        fn_docs.push_str(&format!("\t// {}\n", description));
                    }
                    fn_docs.push_str(&format!("\t{}: {},\n", prop_name, get_type_string_from_schema(prop)?.0,));
                }

                fn_docs.push('}');

                return Ok((fn_docs, true));
            }

            if let Some(array_val) = &o.array {
                if let Some(schemars::schema::SingleOrVec::Single(items)) = &array_val.items {
                    // Let's print out the object's properties.
                    match array_val.max_items {
                        Some(val) => {
                            return Ok((
                                format!(
                                    "[{}]",
                                    (0..val)
                                        .map(|_| get_type_string_from_schema(items).unwrap().0)
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                ),
                                false,
                            ));
                        }
                        None => {
                            return Ok((format!("[{}]", get_type_string_from_schema(items)?.0), false));
                        }
                    };
                } else if let Some(items) = &array_val.contains {
                    return Ok((format!("[{}]", get_type_string_from_schema(items)?.0), false));
                }
            }

            if let Some(subschemas) = &o.subschemas {
                let mut fn_docs = String::new();
                if let Some(items) = &subschemas.one_of {
                    let mut had_enum_string = false;
                    let mut parsed_enum_values: Vec<String> = Vec::new();
                    for item in items {
                        if let schemars::schema::Schema::Object(o) = item {
                            if let Some(enum_values) = &o.enum_values {
                                for enum_value in enum_values {
                                    if let serde_json::value::Value::String(enum_value) = enum_value {
                                        had_enum_string = true;
                                        parsed_enum_values.push(format!("\"{}\"", enum_value));
                                    } else {
                                        had_enum_string = false;
                                        break;
                                    }
                                }
                                if !had_enum_string {
                                    break;
                                }
                            } else {
                                had_enum_string = false;
                                break;
                            }
                        } else {
                            had_enum_string = false;
                            break;
                        }
                    }

                    if !had_enum_string {
                        for (i, item) in items.iter().enumerate() {
                            // Let's print out the object's properties.
                            fn_docs.push_str(&get_type_string_from_schema(item)?.0.to_string());
                            if i < items.len() - 1 {
                                fn_docs.push_str(" |\n");
                            }
                        }
                    } else {
                        fn_docs.push_str(&parsed_enum_values.join(" | "));
                    }
                } else if let Some(items) = &subschemas.any_of {
                    for (i, item) in items.iter().enumerate() {
                        // Let's print out the object's properties.
                        fn_docs.push_str(&get_type_string_from_schema(item)?.0.to_string());
                        if i < items.len() - 1 {
                            fn_docs.push_str(" |\n");
                        }
                    }
                } else {
                    anyhow::bail!("unknown subschemas: {:#?}", subschemas);
                }

                return Ok((fn_docs, true));
            }

            if let Some(schemars::schema::SingleOrVec::Single(_string)) = &o.instance_type {
                return Ok((Primitive::String.to_string(), false));
            }

            anyhow::bail!("unknown type: {:#?}", o)
        }
        schemars::schema::Schema::Bool(_) => Ok((Primitive::Bool.to_string(), false)),
    }
}

pub fn get_autocomplete_snippet_from_schema(
    schema: &schemars::schema::Schema,
    index: usize,
) -> Result<Option<(usize, String)>> {
    match schema {
        schemars::schema::Schema::Object(o) => {
            if let Some(serde_json::Value::Bool(nullable)) = o.extensions.get("nullable") {
                if *nullable {
                    return Ok(None);
                }
            }
            if o.enum_values.is_some() {
                let auto_str = get_autocomplete_string_from_schema(schema)?;
                return Ok(Some((index, format!("${{{}:{}}}", index, auto_str))));
            }

            if let Some(format) = &o.format {
                if format == "uuid" {
                    return Ok(Some((index, format!(r#"${{{}:"tag_or_edge_fn"}}"#, index))));
                } else if format == "double"
                    || format == "uint"
                    || format == "int64"
                    || format == "uint32"
                    || format == "uint64"
                {
                    return Ok(Some((index, format!(r#"${{{}:3.14}}"#, index))));
                } else {
                    anyhow::bail!("unknown format: {}", format);
                }
            }

            if let Some(obj_val) = &o.object {
                let mut fn_docs = String::new();
                fn_docs.push_str("{\n");
                // Let's print out the object's properties.
                for (i, (prop_name, prop)) in obj_val.properties.iter().enumerate() {
                    if prop_name.starts_with('_') {
                        continue;
                    }

                    if let Some((_, snippet)) = get_autocomplete_snippet_from_schema(prop, index + i)? {
                        fn_docs.push_str(&format!("\t{}: {},\n", prop_name, snippet));
                    }
                }

                fn_docs.push('}');

                return Ok(Some((index + obj_val.properties.len() - 1, fn_docs)));
            }

            if let Some(array_val) = &o.array {
                if let Some(schemars::schema::SingleOrVec::Single(items)) = &array_val.items {
                    // Let's print out the object's properties.
                    match array_val.max_items {
                        Some(val) => {
                            return Ok(Some((
                                index + (val as usize) - 1,
                                format!(
                                    "[{}]",
                                    (0..val)
                                        .map(|v| get_autocomplete_snippet_from_schema(items, index + (v as usize))
                                            .unwrap()
                                            .unwrap()
                                            .1)
                                        .collect::<Vec<_>>()
                                        .join(", ")
                                ),
                            )));
                        }
                        None => {
                            return Ok(Some((
                                index,
                                format!(
                                    "[{}]",
                                    get_autocomplete_snippet_from_schema(items, index)?
                                        .ok_or_else(|| anyhow::anyhow!("expected snippet"))?
                                        .1
                                ),
                            )));
                        }
                    };
                } else if let Some(items) = &array_val.contains {
                    return Ok(Some((
                        index,
                        format!(
                            "[{}]",
                            get_autocomplete_snippet_from_schema(items, index)?
                                .ok_or_else(|| anyhow::anyhow!("expected snippet"))?
                                .1
                        ),
                    )));
                }
            }

            if let Some(subschemas) = &o.subschemas {
                let mut fn_docs = String::new();
                if let Some(items) = &subschemas.one_of {
                    let mut had_enum_string = false;
                    let mut parsed_enum_values: Vec<String> = Vec::new();
                    for item in items {
                        if let schemars::schema::Schema::Object(o) = item {
                            if let Some(enum_values) = &o.enum_values {
                                for enum_value in enum_values {
                                    if let serde_json::value::Value::String(enum_value) = enum_value {
                                        had_enum_string = true;
                                        parsed_enum_values.push(format!("\"{}\"", enum_value));
                                    } else {
                                        had_enum_string = false;
                                        break;
                                    }
                                }
                                if !had_enum_string {
                                    break;
                                }
                            } else {
                                had_enum_string = false;
                                break;
                            }
                        } else {
                            had_enum_string = false;
                            break;
                        }
                    }

                    if had_enum_string && !parsed_enum_values.is_empty() {
                        return Ok(Some((index, parsed_enum_values[0].to_string())));
                    } else if let Some(item) = items.iter().next() {
                        if let Some((_, snippet)) = get_autocomplete_snippet_from_schema(item, index)? {
                            fn_docs.push_str(&snippet);
                        }
                    }
                } else if let Some(items) = &subschemas.any_of {
                    if let Some(item) = items.iter().next() {
                        if let Some((_, snippet)) = get_autocomplete_snippet_from_schema(item, index)? {
                            fn_docs.push_str(&snippet);
                        }
                    }
                } else {
                    anyhow::bail!("unknown subschemas: {:#?}", subschemas);
                }

                return Ok(Some((index, fn_docs)));
            }

            if let Some(schemars::schema::SingleOrVec::Single(_string)) = &o.instance_type {
                return Ok(Some((index, format!(r#"${{{}:"string"}}"#, index))));
            }

            anyhow::bail!("unknown type: {:#?}", o)
        }
        schemars::schema::Schema::Bool(_) => Ok(Some((index, format!(r#"${{{}:false}}"#, index)))),
    }
}

pub fn get_autocomplete_string_from_schema(schema: &schemars::schema::Schema) -> Result<String> {
    match schema {
        schemars::schema::Schema::Object(o) => {
            if let Some(enum_values) = &o.enum_values {
                let mut parsed_enum_values: Vec<String> = Default::default();
                let mut had_enum_string = false;
                for enum_value in enum_values {
                    if let serde_json::value::Value::String(enum_value) = enum_value {
                        had_enum_string = true;
                        parsed_enum_values.push(format!("\"{}\"", enum_value));
                    } else {
                        had_enum_string = false;
                        break;
                    }
                }

                if had_enum_string && !parsed_enum_values.is_empty() {
                    return Ok(parsed_enum_values[0].to_string());
                }
            }

            if let Some(format) = &o.format {
                if format == "uuid" {
                    return Ok(Primitive::Uuid.to_string());
                } else if format == "double"
                    || format == "uint"
                    || format == "int64"
                    || format == "uint32"
                    || format == "uint64"
                {
                    return Ok(Primitive::Number.to_string());
                } else {
                    anyhow::bail!("unknown format: {}", format);
                }
            }

            if let Some(obj_val) = &o.object {
                let mut fn_docs = String::new();
                fn_docs.push_str("{\n");
                // Let's print out the object's properties.
                for (prop_name, prop) in obj_val.properties.iter() {
                    if prop_name.starts_with('_') {
                        continue;
                    }

                    fn_docs.push_str(&format!(
                        "\t{}: {},\n",
                        prop_name,
                        get_autocomplete_string_from_schema(prop)?,
                    ));
                }

                fn_docs.push('}');

                return Ok(fn_docs);
            }

            if let Some(array_val) = &o.array {
                if let Some(schemars::schema::SingleOrVec::Single(items)) = &array_val.items {
                    // Let's print out the object's properties.
                    match array_val.max_items {
                        Some(val) => {
                            return Ok(format!(
                                "[{}]",
                                (0..val).map(|_| "number").collect::<Vec<_>>().join(", ")
                            ));
                        }
                        None => {
                            return Ok(format!("[{}]", get_autocomplete_string_from_schema(items)?));
                        }
                    };
                } else if let Some(items) = &array_val.contains {
                    return Ok(format!("[{}]", get_autocomplete_string_from_schema(items)?));
                }
            }

            if let Some(subschemas) = &o.subschemas {
                let mut fn_docs = String::new();
                if let Some(items) = &subschemas.one_of {
                    let mut had_enum_string = false;
                    let mut parsed_enum_values: Vec<String> = Vec::new();
                    for item in items {
                        if let schemars::schema::Schema::Object(o) = item {
                            if let Some(enum_values) = &o.enum_values {
                                for enum_value in enum_values {
                                    if let serde_json::value::Value::String(enum_value) = enum_value {
                                        had_enum_string = true;
                                        parsed_enum_values.push(format!("\"{}\"", enum_value));
                                    } else {
                                        had_enum_string = false;
                                        break;
                                    }
                                }
                                if !had_enum_string {
                                    break;
                                }
                            } else {
                                had_enum_string = false;
                                break;
                            }
                        } else {
                            had_enum_string = false;
                            break;
                        }
                    }

                    if had_enum_string && !parsed_enum_values.is_empty() {
                        return Ok(parsed_enum_values[0].to_string());
                    } else if let Some(item) = items.iter().next() {
                        // Let's print out the object's properties.
                        fn_docs.push_str(&get_autocomplete_string_from_schema(item)?);
                    }
                } else if let Some(items) = &subschemas.any_of {
                    if let Some(item) = items.iter().next() {
                        // Let's print out the object's properties.
                        fn_docs.push_str(&get_autocomplete_string_from_schema(item)?);
                    }
                } else {
                    anyhow::bail!("unknown subschemas: {:#?}", subschemas);
                }

                return Ok(fn_docs);
            }

            if let Some(schemars::schema::SingleOrVec::Single(_string)) = &o.instance_type {
                return Ok(Primitive::String.to_string());
            }

            anyhow::bail!("unknown type: {:#?}", o)
        }
        schemars::schema::Schema::Bool(_) => Ok(Primitive::Bool.to_string()),
    }
}

pub fn completion_item_from_enum_schema(
    schema: &schemars::schema::Schema,
    kind: CompletionItemKind,
) -> Result<CompletionItem> {
    // Get the docs for the schema.
    let description = get_description_string_from_schema(schema).unwrap_or_default();
    let schemars::schema::Schema::Object(o) = schema else {
        anyhow::bail!("expected object schema: {:#?}", schema);
    };
    let Some(enum_values) = o.enum_values.as_ref() else {
        anyhow::bail!("expected enum values: {:#?}", o);
    };

    if enum_values.len() > 1 {
        anyhow::bail!("expected only one enum value: {:#?}", o);
    }

    if enum_values.is_empty() {
        anyhow::bail!("expected at least one enum value: {:#?}", o);
    }

    let serde_json::Value::String(ref enum_value) = enum_values[0] else {
        anyhow::bail!("expected string enum value: {:#?}", enum_values[0]);
    };

    Ok(CompletionItem {
        label: enum_value.to_string(),
        label_details: None,
        kind: Some(kind),
        detail: Some(description.to_string()),
        documentation: Some(Documentation::MarkupContent(MarkupContent {
            kind: MarkupKind::Markdown,
            value: description.to_string(),
        })),
        deprecated: Some(false),
        preselect: None,
        sort_text: None,
        filter_text: None,
        insert_text: None,
        insert_text_format: None,
        insert_text_mode: None,
        text_edit: None,
        additional_text_edits: None,
        command: None,
        commit_characters: None,
        data: None,
        tags: None,
    })
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::StdLibFn;

    #[test]
    fn test_serialize_function() {
        let some_function = crate::ast::types::Function::StdLib {
            func: Box::new(crate::std::sketch::Line),
        };
        let serialized = serde_json::to_string(&some_function).unwrap();
        assert!(serialized.contains(r#"{"type":"StdLib""#));
    }

    #[test]
    fn test_deserialize_function() {
        let some_function_string = r#"{"type":"StdLib","func":{"name":"line","summary":"","description":"","tags":[],"returnValue":{"type":"","required":false,"name":"","schema":{}},"args":[],"unpublished":false,"deprecated":false, "examples": []}}"#;
        let some_function: crate::ast::types::Function = serde_json::from_str(some_function_string).unwrap();

        assert_eq!(
            some_function,
            crate::ast::types::Function::StdLib {
                func: Box::new(crate::std::sketch::Line),
            }
        );
    }

    #[test]
    fn get_autocomplete_snippet_line() {
        let line_fn: Box<dyn StdLibFn> = Box::new(crate::std::sketch::Line);
        let snippet = line_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(snippet, r#"line([${0:3.14}, ${1:3.14}], ${2:%})${}"#);
    }

    #[test]
    fn get_autocomplete_snippet_extrude() {
        let extrude_fn: Box<dyn StdLibFn> = Box::new(crate::std::extrude::Extrude);
        let snippet = extrude_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(snippet, r#"extrude(${0:3.14}, ${1:%})${}"#);
    }

    #[test]
    fn get_autocomplete_snippet_fillet() {
        let fillet_fn: Box<dyn StdLibFn> = Box::new(crate::std::fillet::Fillet);
        let snippet = fillet_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(
            snippet,
            r#"fillet({
	radius: ${0:3.14},
	tags: [${1:"tag_or_edge_fn"}],
}, ${2:%})${}"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_start_sketch_on() {
        let start_sketch_on_fn: Box<dyn StdLibFn> = Box::new(crate::std::sketch::StartSketchOn);
        let snippet = start_sketch_on_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(snippet, r#"startSketchOn(${0:"XY"})${}"#);
    }

    #[test]
    fn get_autocomplete_snippet_pattern_circular_3d() {
        let pattern_fn: Box<dyn StdLibFn> = Box::new(crate::std::patterns::PatternCircular3D);
        let snippet = pattern_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(
            snippet,
            r#"patternCircular3d({
	arcDegrees: ${0:3.14},
	axis: [${1:3.14}, ${2:3.14}, ${3:3.14}],
	center: [${2:3.14}, ${3:3.14}, ${4:3.14}],
	repetitions: ${3:3.14},
	rotateDuplicates: ${4:"string"},
}, ${5:%})${}"#
        );
    }

    #[test]
    fn get_autocomplete_snippet_revolve() {
        let revolve_fn: Box<dyn StdLibFn> = Box::new(crate::std::revolve::Revolve);
        let snippet = revolve_fn.to_autocomplete_snippet().unwrap();
        assert_eq!(
            snippet,
            r#"revolve({
	axis: ${1:"X"},
}, ${2:%})${}"#
        );
    }
}
