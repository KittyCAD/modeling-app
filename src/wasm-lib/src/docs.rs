//! Functions for generating docs for our stdlib functions.

use anyhow::Result;
use serde::{Deserialize, Serialize};

use crate::std::Primitive;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
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
    pub return_value: StdLibFnArg,
    /// If the function is unpublished.
    pub unpublished: bool,
    /// If the function is deprecated.
    pub deprecated: bool,
}

impl StdLibFnArg {
    #[allow(dead_code)]
    pub fn get_type_string(&self) -> Result<(String, bool)> {
        get_type_string_from_schema(&self.schema)
    }
}

/// This struct defines a single argument to a stdlib function.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
pub struct StdLibFnArg {
    /// The name of the argument.
    pub name: String,
    /// The type of the argument.
    pub type_: String,
    /// The description of the argument.
    pub description: String,
    /// The schema of the argument.
    pub schema: schemars::schema::Schema,
    /// If the argument is required.
    pub required: bool,
}

/// This trait defines functions called upon stdlib functions to generate
/// documentation for them.
pub trait StdLibFn {
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
    fn return_value(&self) -> StdLibFnArg;

    /// If the function is unpublished.
    fn unpublished(&self) -> bool;

    /// If the function is deprecated.
    fn deprecated(&self) -> bool;

    /// The function itself.
    fn std_lib_fn(&self) -> crate::std::StdFn;

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
        })
    }
}

fn get_type_string_from_schema(schema: &schemars::schema::Schema) -> Result<(String, bool)> {
    match schema {
        schemars::schema::Schema::Object(o) => {
            if let Some(format) = &o.format {
                if format == "uuid" {
                    return Ok((Primitive::Uuid.to_string(), false));
                } else if format == "double" || format == "uint" {
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

                    fn_docs.push_str(&format!(
                        "\t\"{}\": {},\n",
                        prop_name,
                        get_type_string_from_schema(prop)?.0,
                    ));
                }

                fn_docs.push('}');

                return Ok((fn_docs, true));
            }

            if let Some(array_val) = &o.array {
                if let Some(schemars::schema::SingleOrVec::Single(items)) = &array_val.items {
                    // Let's print out the object's properties.
                    return Ok((
                        format!("[{}]", get_type_string_from_schema(items)?.0),
                        false,
                    ));
                } else if let Some(items) = &array_val.contains {
                    return Ok((
                        format!("[{}]", get_type_string_from_schema(items)?.0),
                        false,
                    ));
                }
            }

            if let Some(subschemas) = &o.subschemas {
                let mut fn_docs = String::new();
                if let Some(items) = &subschemas.one_of {
                    for (i, item) in items.iter().enumerate() {
                        // Let's print out the object's properties.
                        fn_docs.push_str(&get_type_string_from_schema(item)?.0.to_string());
                        if i < items.len() - 1 {
                            fn_docs.push_str(" |\n");
                        }
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
