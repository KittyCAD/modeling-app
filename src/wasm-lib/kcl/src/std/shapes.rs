use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::kcl_stdlib::KclStdLibFn;
use crate::{
    ast::types::{FunctionExpression, Program},
    docs::StdLibFn,
};

pub const CIRCLE_FN: &str = r#"
(center, radius, surface) => {
const sg = startProfileAt([center[0] + radius, center[1]], surface)
    |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: radius
     }, %)
    |> close(%)
  return sg
}
    "#;

#[derive(Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
pub struct Circle {
    function: FunctionExpression,
    program: Program,
}

impl Default for Circle {
    fn default() -> Self {
        // TODO in https://github.com/KittyCAD/modeling-app/issues/1018
        // Don't unwrap here, parse it at compile-time.
        let (src, function) = super::kcl_stdlib::extract_function(CIRCLE_FN).unwrap();
        Self {
            function: *function,
            program: src,
        }
    }
}

impl std::fmt::Debug for Circle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        "circle".fmt(f)
    }
}

/// TODO: Parse the KCL in a macro and generate these
impl StdLibFn for Circle {
    fn name(&self) -> String {
        "circle".to_owned()
    }

    fn summary(&self) -> String {
        "Sketch a circle on the given plane".to_owned()
    }

    fn description(&self) -> String {
        String::new()
    }

    fn tags(&self) -> Vec<String> {
        Vec::new()
    }

    fn args(&self) -> Vec<crate::docs::StdLibFnArg> {
        let mut settings = schemars::gen::SchemaSettings::openapi3();
        settings.inline_subschemas = true;
        let mut generator = schemars::gen::SchemaGenerator::new(settings);
        let mut args = Vec::new();
        for parameter in &self.function.params {
            match parameter.identifier.name.as_str() {
                "center" => {
                    args.push(crate::docs::StdLibFnArg {
                        name: parameter.identifier.name.to_owned(),
                        type_: "[number, number]".to_string(),
                        schema: <[f64; 2]>::json_schema(&mut generator),
                        required: true,
                    });
                }
                "radius" => {
                    args.push(crate::docs::StdLibFnArg {
                        name: parameter.identifier.name.to_owned(),
                        type_: "number".to_string(),
                        schema: <f64>::json_schema(&mut generator),
                        required: true,
                    });
                }
                "surface" => {
                    args.push(crate::docs::StdLibFnArg {
                        name: parameter.identifier.name.to_owned(),
                        type_: "SketchSurface".to_string(),
                        schema: <crate::std::sketch::SketchData>::json_schema(&mut generator),
                        required: true,
                    });
                }
                _ => panic!("Unknown parameter: {:?}", parameter.identifier.name),
            }
        }
        args
    }

    fn return_value(&self) -> Option<crate::docs::StdLibFnArg> {
        let mut settings = schemars::gen::SchemaSettings::openapi3();
        settings.inline_subschemas = true;
        let mut generator = schemars::gen::SchemaGenerator::new(settings);
        Some(crate::docs::StdLibFnArg {
            name: "SketchGroup".to_owned(),
            type_: "SketchGroup".to_string(),
            schema: <crate::executor::SketchGroup>::json_schema(&mut generator),
            required: true,
        })
    }

    fn unpublished(&self) -> bool {
        false
    }

    fn deprecated(&self) -> bool {
        false
    }

    fn std_lib_fn(&self) -> crate::std::StdFn {
        todo!()
    }

    fn clone_box(&self) -> Box<dyn StdLibFn> {
        Box::new(self.to_owned())
    }
}

impl KclStdLibFn for Circle {
    fn function(&self) -> &FunctionExpression {
        &self.function
    }
    fn program(&self) -> &Program {
        &self.program
    }

    fn kcl_clone_box(&self) -> Box<dyn KclStdLibFn> {
        Box::new(self.clone())
    }
}
