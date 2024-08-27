//! Functions implemented for language execution.

pub mod args;
pub mod assert;
pub mod chamfer;
pub mod convert;
pub mod extrude;
pub mod fillet;
pub mod helix;
pub mod import;
pub mod kcl_stdlib;
pub mod loft;
pub mod math;
pub mod patterns;
pub mod planes;
pub mod polar;
pub mod revolve;
pub mod segment;
pub mod shapes;
pub mod shell;
pub mod sketch;
pub mod types;
pub mod units;
pub mod utils;

use std::collections::HashMap;

use anyhow::Result;
pub use args::Args;
use derive_docs::stdlib;
use lazy_static::lazy_static;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    ast::types::FunctionExpression,
    docs::StdLibFn,
    errors::KclError,
    executor::{KclValue, ProgramMemory, SketchGroup, SketchSurface},
    std::kcl_stdlib::KclStdLibFn,
};

pub type StdFn = fn(Args) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<KclValue, KclError>> + Send>>;

pub type FnMap = HashMap<String, StdFn>;

lazy_static! {
    static ref CORE_FNS: Vec<Box<dyn StdLibFn>> = vec![
        Box::new(LegLen),
        Box::new(LegAngX),
        Box::new(LegAngY),
        Box::new(crate::std::convert::Int),
        Box::new(crate::std::extrude::Extrude),
        Box::new(crate::std::segment::SegEndX),
        Box::new(crate::std::segment::SegEndY),
        Box::new(crate::std::segment::LastSegX),
        Box::new(crate::std::segment::LastSegY),
        Box::new(crate::std::segment::SegLen),
        Box::new(crate::std::segment::SegAng),
        Box::new(crate::std::segment::AngleToMatchLengthX),
        Box::new(crate::std::segment::AngleToMatchLengthY),
        Box::new(crate::std::shapes::Circle),
        Box::new(crate::std::sketch::LineTo),
        Box::new(crate::std::sketch::Line),
        Box::new(crate::std::sketch::XLineTo),
        Box::new(crate::std::sketch::XLine),
        Box::new(crate::std::sketch::YLineTo),
        Box::new(crate::std::sketch::YLine),
        Box::new(crate::std::sketch::AngledLineToX),
        Box::new(crate::std::sketch::AngledLineToY),
        Box::new(crate::std::sketch::AngledLine),
        Box::new(crate::std::sketch::AngledLineOfXLength),
        Box::new(crate::std::sketch::AngledLineOfYLength),
        Box::new(crate::std::sketch::AngledLineThatIntersects),
        Box::new(crate::std::sketch::StartSketchAt),
        Box::new(crate::std::sketch::StartSketchOn),
        Box::new(crate::std::sketch::StartProfileAt),
        Box::new(crate::std::sketch::ProfileStartX),
        Box::new(crate::std::sketch::ProfileStartY),
        Box::new(crate::std::sketch::ProfileStart),
        Box::new(crate::std::sketch::Close),
        Box::new(crate::std::sketch::Arc),
        Box::new(crate::std::sketch::TangentialArc),
        Box::new(crate::std::sketch::TangentialArcTo),
        Box::new(crate::std::sketch::TangentialArcToRelative),
        Box::new(crate::std::sketch::BezierCurve),
        Box::new(crate::std::sketch::Hole),
        Box::new(crate::std::patterns::PatternLinear2D),
        Box::new(crate::std::patterns::PatternLinear3D),
        Box::new(crate::std::patterns::PatternCircular2D),
        Box::new(crate::std::patterns::PatternCircular3D),
        Box::new(crate::std::patterns::PatternTransform),
        Box::new(crate::std::chamfer::Chamfer),
        Box::new(crate::std::fillet::Fillet),
        Box::new(crate::std::fillet::GetOppositeEdge),
        Box::new(crate::std::fillet::GetNextAdjacentEdge),
        Box::new(crate::std::fillet::GetPreviousAdjacentEdge),
        Box::new(crate::std::helix::Helix),
        Box::new(crate::std::shell::Shell),
        Box::new(crate::std::shell::Hollow),
        Box::new(crate::std::revolve::Revolve),
        Box::new(crate::std::loft::Loft),
        Box::new(crate::std::planes::OffsetPlane),
        Box::new(crate::std::import::Import),
        Box::new(crate::std::math::Cos),
        Box::new(crate::std::math::Sin),
        Box::new(crate::std::math::Tan),
        Box::new(crate::std::math::Acos),
        Box::new(crate::std::math::Asin),
        Box::new(crate::std::math::Atan),
        Box::new(crate::std::math::Pi),
        Box::new(crate::std::math::E),
        Box::new(crate::std::math::Tau),
        Box::new(crate::std::math::Sqrt),
        Box::new(crate::std::math::Abs),
        Box::new(crate::std::math::Floor),
        Box::new(crate::std::math::Ceil),
        Box::new(crate::std::math::Min),
        Box::new(crate::std::math::Max),
        Box::new(crate::std::math::Pow),
        Box::new(crate::std::math::Log),
        Box::new(crate::std::math::Log2),
        Box::new(crate::std::math::Log10),
        Box::new(crate::std::math::Ln),
        Box::new(crate::std::math::ToDegrees),
        Box::new(crate::std::math::ToRadians),
        Box::new(crate::std::units::Mm),
        Box::new(crate::std::units::Inch),
        Box::new(crate::std::units::Ft),
        Box::new(crate::std::units::M),
        Box::new(crate::std::units::Cm),
        Box::new(crate::std::units::Yd),
        Box::new(crate::std::polar::Polar),
        Box::new(crate::std::assert::Assert),
        Box::new(crate::std::assert::AssertEqual),
        Box::new(crate::std::assert::AssertLessThan),
        Box::new(crate::std::assert::AssertGreaterThan),
        Box::new(crate::std::assert::AssertLessThanOrEq),
        Box::new(crate::std::assert::AssertGreaterThanOrEq),
    ];
}

pub fn name_in_stdlib(name: &str) -> bool {
    CORE_FNS.iter().any(|f| f.name() == name)
}

pub fn get_stdlib_fn(name: &str) -> Option<Box<dyn StdLibFn>> {
    CORE_FNS.iter().find(|f| f.name() == name).cloned()
}

pub struct StdLib {
    pub fns: HashMap<String, Box<dyn StdLibFn>>,
    pub kcl_fns: HashMap<String, Box<dyn KclStdLibFn>>,
}

impl std::fmt::Debug for StdLib {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StdLib")
            .field("fns.len()", &self.fns.len())
            .field("kcl_fns.len()", &self.kcl_fns.len())
            .finish()
    }
}

impl StdLib {
    pub fn new() -> Self {
        let fns = CORE_FNS
            .clone()
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        let kcl_internal_fns: [Box<dyn KclStdLibFn>; 0] = [];
        let kcl_fns = kcl_internal_fns
            .into_iter()
            .map(|internal_fn| (internal_fn.name(), internal_fn))
            .collect();

        Self { fns, kcl_fns }
    }

    // Get the combined hashmaps.
    pub fn combined(&self) -> HashMap<String, Box<dyn StdLibFn>> {
        let mut combined = self.fns.clone();
        for (k, v) in self.kcl_fns.clone() {
            combined.insert(k, v.std_lib());
        }
        combined
    }

    pub fn get(&self, name: &str) -> Option<Box<dyn StdLibFn>> {
        self.fns.get(name).cloned()
    }

    pub fn get_kcl(&self, name: &str) -> Option<Box<dyn KclStdLibFn>> {
        self.kcl_fns.get(name).cloned()
    }

    pub fn get_either(&self, name: &str) -> FunctionKind {
        if let Some(f) = self.get(name) {
            FunctionKind::Core(f)
        } else if let Some(f) = self.get_kcl(name) {
            FunctionKind::Std(f)
        } else {
            FunctionKind::UserDefined
        }
    }

    pub fn contains_key(&self, key: &str) -> bool {
        self.fns.contains_key(key) || self.kcl_fns.contains_key(key)
    }
}

impl Default for StdLib {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub enum FunctionKind {
    Core(Box<dyn StdLibFn>),
    Std(Box<dyn KclStdLibFn>),
    UserDefined,
}

/// Compute the length of the given leg.
pub async fn leg_length(args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_length(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Compute the length of the given leg.
///
/// ```no_run
/// legLen(5, 3)
/// ```
#[stdlib {
    name = "legLen",
    tags = ["utilities"],
}]
fn inner_leg_length(hypotenuse: f64, leg: f64) -> f64 {
    (hypotenuse.powi(2) - f64::min(hypotenuse.abs(), leg.abs()).powi(2)).sqrt()
}

/// Compute the angle of the given leg for x.
pub async fn leg_angle_x(args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_x(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Compute the angle of the given leg for x.
///
/// ```no_run
/// legAngX(5, 3)
/// ```
#[stdlib {
    name = "legAngX",
    tags = ["utilities"],
}]
fn inner_leg_angle_x(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).acos().to_degrees()
}

/// Compute the angle of the given leg for y.
pub async fn leg_angle_y(args: Args) -> Result<KclValue, KclError> {
    let (hypotenuse, leg) = args.get_hypotenuse_leg()?;
    let result = inner_leg_angle_y(hypotenuse, leg);
    args.make_user_val_from_f64(result)
}

/// Compute the angle of the given leg for y.
///
/// ```no_run
/// legAngY(5, 3)
/// ```
#[stdlib {
    name = "legAngY",
    tags = ["utilities"],
}]
fn inner_leg_angle_y(hypotenuse: f64, leg: f64) -> f64 {
    (leg.min(hypotenuse) / hypotenuse).asin().to_degrees()
}

/// The primitive types that can be used in a KCL file.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema, Display, FromStr)]
#[serde(rename_all = "lowercase")]
#[display(style = "lowercase")]
pub enum Primitive {
    /// A boolean value.
    Bool,
    /// A number value.
    Number,
    /// A string value.
    String,
    /// A uuid value.
    Uuid,
}

pub struct FnAsArg<'a> {
    pub func: &'a crate::executor::MemoryFunction,
    pub expr: Box<FunctionExpression>,
    pub memory: Box<ProgramMemory>,
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use convert_case::Casing;
    use itertools::Itertools;

    use crate::std::StdLib;

    #[test]
    fn test_generate_stdlib_markdown_docs() {
        let stdlib = StdLib::new();
        let combined = stdlib.combined();
        let mut buf = String::new();

        buf.push_str(
            r#"---
title: "KCL Standard Library"
excerpt: "Documentation for the KCL standard library for the Zoo Modeling App."
layout: manual
---

"#,
        );

        // Generate a table of contents.
        buf.push_str("## Table of Contents\n\n");

        buf.push_str("* [Types](kcl/types)\n");
        buf.push_str("* [Known Issues](kcl/KNOWN-ISSUES)\n");

        for key in combined.keys().sorted() {
            let internal_fn = combined.get(key).unwrap();
            if internal_fn.unpublished() || internal_fn.deprecated() {
                continue;
            }

            buf.push_str(&format!("* [`{}`](kcl/{})\n", internal_fn.name(), internal_fn.name()));
        }

        // Write the index.
        expectorate::assert_contents("../../../docs/kcl/index.md", &buf);

        for key in combined.keys().sorted() {
            let mut buf = String::new();
            let internal_fn = combined.get(key).unwrap();
            if internal_fn.unpublished() {
                continue;
            }

            let mut fn_docs = String::new();

            fn_docs.push_str(&format!(
                r#"---
title: "{}"
excerpt: "{}"
layout: manual
---

"#,
                internal_fn.name(),
                internal_fn.summary()
            ));

            if internal_fn.deprecated() {
                fn_docs.push_str("**WARNING:** This function is deprecated.\n\n");
            }

            fn_docs.push_str(&format!("{}\n\n", internal_fn.summary()));
            fn_docs.push_str(&format!("{}\n\n", internal_fn.description()));

            fn_docs.push_str("```js\n");
            let signature = internal_fn.fn_signature();
            fn_docs.push_str(&signature);
            fn_docs.push_str("\n```\n\n");

            // If the function has tags, we should add them to the docs.
            let tags = internal_fn.tags().clone();
            if !tags.is_empty() {
                fn_docs.push_str("### Tags\n\n");
                for tag in tags {
                    fn_docs.push_str(&format!("* `{}`\n", tag));
                }
                fn_docs.push('\n');
            }

            if !internal_fn.examples().is_empty() {
                fn_docs.push_str("### Examples\n\n");

                for (index, example) in internal_fn.examples().iter().enumerate() {
                    fn_docs.push_str("```js\n");
                    fn_docs.push_str(example);
                    fn_docs.push_str("\n```\n\n");

                    // If this is not a "utilities" function,
                    // we should add the image to the docs.
                    if !internal_fn.tags().contains(&"utilities".to_string()) {
                        // Get the path to this specific rust file.
                        let dir = env!("CARGO_MANIFEST_DIR");

                        // Convert from camel case to snake case.
                        let mut fn_name = internal_fn.name().to_case(convert_case::Case::Snake);
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

                        // Read the image file and encode as base64.
                        let image_path = format!("{}/tests/outputs/serial_test_example_{}{}.png", dir, fn_name, index);

                        let image_data = std::fs::read(&image_path)
                            .unwrap_or_else(|_| panic!("Failed to read image file: {}", image_path));
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&image_data);

                        fn_docs.push_str(&format!(
                            r#"![Rendered example of {} {}](data:image/png;base64,{})

"#,
                            internal_fn.name(),
                            index,
                            encoded,
                        ));
                    }
                }
            }

            fn_docs.push_str("### Arguments\n\n");
            for arg in internal_fn.args() {
                let (format, should_be_indented) = arg.get_type_string().unwrap();
                let optional_string = if arg.required { " (REQUIRED)" } else { " (OPTIONAL)" }.to_string();
                if let Some(description) = arg.description() {
                    fn_docs.push_str(&format!(
                        "* `{}`: `{}` - {}{}\n",
                        arg.name, arg.type_, description, optional_string
                    ));
                } else {
                    fn_docs.push_str(&format!("* `{}`: `{}`{}\n", arg.name, arg.type_, optional_string));
                }

                if should_be_indented {
                    fn_docs.push_str(&format!("```js\n{}\n```\n", format));
                }
            }

            if let Some(return_type) = internal_fn.return_value() {
                fn_docs.push_str("\n### Returns\n\n");
                if let Some(description) = return_type.description() {
                    fn_docs.push_str(&format!("`{}` - {}\n", return_type.type_, description));
                } else {
                    fn_docs.push_str(&format!("`{}`\n", return_type.type_));
                }

                let (format, should_be_indented) = return_type.get_type_string().unwrap();
                if should_be_indented {
                    fn_docs.push_str(&format!("```js\n{}\n```\n", format));
                }
            }

            fn_docs.push_str("\n\n\n");

            buf.push_str(&fn_docs);

            // Write the file.
            expectorate::assert_contents(&format!("../../../docs/kcl/{}.md", internal_fn.name()), &buf);
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
}
