use anyhow::Result;
use std::cell::Cell;

use crate::SourceRange;
use crate::errors::Suggestion;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::DefaultParamVal;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::FormatOptions;
use crate::parsing::ast::types::FunctionExpression;
use crate::parsing::ast::types::ItemVisibility;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::parsing::ast::types::VariableDeclaration;
use crate::walk::Node;
use crate::walk::Visitable;
use crate::walk::walk;

def_finding!(
    Z0007,
    "Functions that produce geometry should be components",
    "\
Functions are best for computation. When a function creates sketches, solids, surfaces,
or other scene geometry, use a component so the definition and its instances can be
edited with point-and-click workflows.
",
    crate::lint::rule::FindingFamily::Correctness
);

fn geometry_producing_call_name(name: &str) -> bool {
    matches!(
        name,
        "angledLine"
            | "angledLineThatIntersects"
            | "appearance"
            | "arc"
            | "bezierCurve"
            | "blend"
            | "chamfer"
            | "circle"
            | "circleThreePoint"
            | "clone"
            | "close"
            | "conic"
            | "deleteFace"
            | "ellipse"
            | "elliptic"
            | "ellipticPoint"
            | "extrude"
            | "fillet"
            | "flipSurface"
            | "helix"
            | "hollow"
            | "hyperbolic"
            | "hyperbolicPoint"
            | "intersect"
            | "joinSurfaces"
            | "line"
            | "loft"
            | "mirror2d"
            | "mirror3d"
            | "offsetPlane"
            | "parabolic"
            | "parabolicPoint"
            | "patternCircular2d"
            | "patternCircular3d"
            | "patternLinear2d"
            | "patternLinear3d"
            | "patternTransform"
            | "patternTransform2d"
            | "polygon"
            | "rectangle"
            | "revolve"
            | "rotate"
            | "scale"
            | "shell"
            | "split"
            | "startSketchOn"
            | "subtract"
            | "subtract2d"
            | "sweep"
            | "tangentialArc"
            | "translate"
            | "union"
            | "xLine"
            | "yLine"
    )
}

fn first_geometry_node(node: Node<'_>) -> Option<(String, SourceRange)> {
    match node {
        Node::FunctionExpression(_) | Node::ComponentBlock(_) => None,
        Node::SketchBlock(sketch) => Some(("sketch block".to_owned(), SourceRange::from(sketch))),
        Node::CallExpressionKw(call) => {
            if let Some(name) = call.callee.local_ident()
                && geometry_producing_call_name(name.inner)
            {
                return Some((name.inner.to_owned(), SourceRange::from(call)));
            }

            node.children().into_iter().find_map(first_geometry_node)
        }
        _ => node.children().into_iter().find_map(first_geometry_node),
    }
}

fn first_geometry_in_function(function: &AstNode<FunctionExpression>) -> Option<(String, SourceRange)> {
    function.body.body.iter().map(Node::from).find_map(first_geometry_node)
}

fn params_as_component_args(function: &FunctionExpression) -> Option<String> {
    let mut args = Vec::with_capacity(function.params.len());
    for param in &function.params {
        if !param.labeled {
            return None;
        }
        let Some(DefaultParamVal::Literal(literal)) = &param.default_value else {
            return None;
        };

        args.push(format!("{} = {}", param.identifier.name, literal.raw));
    }

    Some(args.join(", "))
}

fn callsites_are_component_compatible(name: &str, prog: &AstNode<Program>) -> bool {
    let compatible = Cell::new(true);
    let _ = walk(prog, |node| {
        let Node::CallExpressionKw(call) = node else {
            return Ok::<bool, anyhow::Error>(true);
        };
        let Some(callee) = call.callee.local_ident() else {
            return Ok(true);
        };
        if callee.inner != name {
            return Ok(true);
        }

        if call.unlabeled.is_some() || call.arguments.is_empty() {
            compatible.set(false);
            return Ok(false);
        }

        Ok(true)
    });

    compatible.get()
}

fn component_replacement(var_decl: &AstNode<VariableDeclaration>, function: &FunctionExpression) -> Option<String> {
    if function.return_type.is_some() || !var_decl.outer_attrs.is_empty() {
        return None;
    }

    let args = params_as_component_args(function)?;
    let mut replacement = String::new();
    if matches!(var_decl.visibility, ItemVisibility::Export) {
        replacement.push_str("export ");
    }
    replacement.push_str(var_decl.name());
    replacement.push_str(" = component(");
    replacement.push_str(&args);
    replacement.push_str(") {\n");

    let mut options = FormatOptions::default();
    options.insert_final_newline = false;
    function.body.recast(&mut replacement, &options, 1);
    replacement.push('\n');
    replacement.push('}');

    Some(replacement)
}

pub fn lint_geometry_fns_should_be_components(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::VariableDeclaration(var_decl) = node else {
        return Ok(vec![]);
    };
    let Expr::FunctionExpression(function) = &var_decl.declaration.init else {
        return Ok(vec![]);
    };

    let Some((geometry_name, geometry_range)) = first_geometry_in_function(function) else {
        return Ok(vec![]);
    };

    let suggestion = if callsites_are_component_compatible(var_decl.name(), prog) {
        component_replacement(var_decl, function).map(|insert| Suggestion {
            title: format!("Convert `{}` to a component", var_decl.name()),
            insert,
            source_range: SourceRange::from(var_decl),
        })
    } else {
        None
    };

    Ok(vec![Z0007.at(
        format!(
            "function `{}` produces geometry with `{geometry_name}`",
            var_decl.name()
        ),
        geometry_range,
        suggestion,
    )])
}

#[cfg(test)]
mod tests {
    use super::Z0007;
    use super::lint_geometry_fns_should_be_components;
    use crate::lint::lint_and_fix_all;

    #[test]
    fn z0007_geometry_function_has_autofix_when_signature_and_calls_are_component_compatible() {
        let kcl = r#"fn makeSurface(length? = 5) {
  profile = sketch(on = XY) {
    line1 = line(start = [0, 0], end = [1, 0])
  }
  return extrude(profile.line1, length = length)
}

surfaceB = makeSurface(length = 2)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_geometry_fns_should_be_components).unwrap();
        let lint = lints.iter().find(|lint| lint.finding == Z0007).unwrap();

        assert!(lint.suggestion.is_some());
        assert_eq!(
            lint.apply_suggestion(kcl).unwrap(),
            r#"makeSurface = component(length = 5) {
  profile = sketch(on = XY) {
    line1 = line(start = [0, 0], end = [1, 0])
  }
  return extrude(profile.line1, length = length)
}

surfaceB = makeSurface(length = 2)
"#
        );
    }

    #[test]
    fn z0007_lint_and_fix_all_rewrites_geometry_function() {
        let kcl = r#"fn makeSurface(length? = 5) {
  return extrude(profile, length = length)
}

surfaceB = makeSurface(length = 2)
"#;
        let (fixed, unfixed) = lint_and_fix_all(kcl.to_owned()).unwrap();

        assert!(!unfixed.iter().any(|lint| lint.finding == Z0007));
        assert!(fixed.contains("makeSurface = component(length = 5)"));
    }

    #[test]
    fn z0007_reports_but_does_not_autofix_required_params() {
        let kcl = r#"fn makeSurface(length) {
  return extrude(profile, length = length)
}

surfaceB = makeSurface(length = 2)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_geometry_fns_should_be_components).unwrap();
        let lint = lints.iter().find(|lint| lint.finding == Z0007).unwrap();

        assert!(lint.suggestion.is_none());
    }

    #[test]
    fn z0007_reports_but_does_not_autofix_incompatible_callsites() {
        let kcl = r#"fn makeSurface(length? = 5) {
  return extrude(profile, length = length)
}

surfaceB = makeSurface(2)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_geometry_fns_should_be_components).unwrap();
        let lint = lints.iter().find(|lint| lint.finding == Z0007).unwrap();

        assert!(lint.suggestion.is_none());
    }

    #[test]
    fn z0007_ignores_computation_helpers() {
        let kcl = r#"fn addOne(x) {
  return x + 1
}

result = addOne(2)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_geometry_fns_should_be_components).unwrap();

        assert!(!lints.iter().any(|lint| lint.finding == Z0007));
    }
}
