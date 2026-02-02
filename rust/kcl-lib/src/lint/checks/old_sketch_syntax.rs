use anyhow::Result;

use crate::{
    SourceRange,
    lint::rule::{Discovered, Finding, FindingFamily, def_finding},
    parsing::ast::types::{Expr, Node as AstNode, PipeExpression, Program},
    walk::Node,
};

def_finding!(
    Z0005,
    "Old sketch syntax can be converted to new sketch block syntax",
    "\
The old sketch syntax using startProfile in a pipe expression can be converted to the new sketch block syntax.

The new syntax is more explicit and easier to understand. For example:

Old: profile001 = startProfile(sketch001, at = [0, 0]) |> line(end = [10, 0]) |> line(end = [10, 10])
New: profile001 = sketch(on = XY) { line1 = sketch2::line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm]) ... }

Use the transpile function to convert this to the new format.
",
    FindingFamily::Simplify
);

/// Check if a pipe expression contains startProfile
/// This is the source of truth for detecting old sketch syntax.
/// Both the lint and transpiler use this function to ensure consistency.
pub fn contains_start_profile(pipe_expr: &PipeExpression) -> bool {
    pipe_expr.body.iter().any(|expr| {
        if let Expr::CallExpressionKw(call) = expr {
            call.callee.name.name == "startProfile"
        } else {
            false
        }
    })
}

/// Lint that detects old sketch syntax (startProfile in pipe expressions).
/// This is detection-only - actual transpilation is done via WASM API function.
pub fn lint_old_sketch_syntax(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];

    // Only check variable declarations
    let Node::VariableDeclaration(var_decl) = node else {
        return Ok(findings);
    };

    // Check if the variable declaration has a pipe expression with startProfile
    if let Expr::PipeExpression(pipe) = &var_decl.declaration.init
        && contains_start_profile(pipe)
    {
        let var_name = &var_decl.declaration.id.name;
        let init_node = &var_decl.declaration.init;
        let source_range = SourceRange::new(init_node.start(), init_node.end(), init_node.module_id());

        // Just detect - no suggestion since transpilation requires ExecOutcome
        findings.push(Z0005.at(
            format!("found old sketch syntax in '{}'", var_name),
            source_range,
            None, // No suggestion - use WASM transpile function
        ));
    }

    Ok(findings)
}
