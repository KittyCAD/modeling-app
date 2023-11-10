use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::kcl_stdlib::KclStdLibFn;
use crate::{
    ast::types::{FunctionExpression, Program},
    docs::StdLibFn,
};

pub const CIRCLE_FN: &str = r#"
(plane, center, radius) => {
  const sg = startSketchOn(plane)
    |> startProfileAt([center[0] + radius, center[1]], %)
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
        "unstable_stdlib_circle".to_owned()
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
        Vec::new() // TODO
    }

    fn return_value(&self) -> Option<crate::docs::StdLibFnArg> {
        None
    }

    fn unpublished(&self) -> bool {
        true
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
