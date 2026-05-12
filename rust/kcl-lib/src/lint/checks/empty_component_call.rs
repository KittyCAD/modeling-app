use std::collections::HashSet;

use anyhow::Result;

use crate::SourceRange;
use crate::errors::Suggestion;
use crate::lint::rule::Discovered;
use crate::lint::rule::Finding;
use crate::lint::rule::def_finding;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::Node as AstNode;
use crate::parsing::ast::types::Program;
use crate::walk::Node;

def_finding!(
    Z0006,
    "Use clone() to duplicate a component default instance",
    "\
Calling a component with no overrides is ambiguous with referencing the default instance.
Use `clone(componentName)` when you want a duplicate of the default component output.
",
    crate::lint::rule::FindingFamily::Correctness
);

fn component_definition_names(prog: &AstNode<Program>) -> HashSet<String> {
    prog.body
        .iter()
        .filter_map(|item| {
            let BodyItem::VariableDeclaration(var_decl) = item else {
                return None;
            };
            if matches!(var_decl.declaration.init, Expr::ComponentBlock(_)) {
                Some(var_decl.name().to_owned())
            } else {
                None
            }
        })
        .collect()
}

pub fn lint_empty_component_calls(node: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::CallExpressionKw(call) = node else {
        return Ok(vec![]);
    };

    if call.unlabeled.is_some() || !call.arguments.is_empty() {
        return Ok(vec![]);
    }

    let Some(name) = call.callee.local_ident() else {
        return Ok(vec![]);
    };
    if !component_definition_names(prog).contains(name.inner) {
        return Ok(vec![]);
    }

    let callee_name = call.callee.to_string();
    let suggestion = Suggestion {
        title: format!("Replace with clone({callee_name})"),
        insert: format!("clone({callee_name})"),
        source_range: SourceRange::from(call),
    };

    Ok(vec![Z0006.at(
        format!("found empty component call `{callee_name}()`"),
        SourceRange::from(call),
        Some(suggestion),
    )])
}

#[cfg(test)]
mod tests {
    use super::Z0006;
    use super::lint_empty_component_calls;
    use crate::lint::lint_and_fix_all;

    #[test]
    fn z0006_empty_component_call_has_autofix() {
        let kcl = r#"
mySurfaceLine = component(start = 1) {
  return start
}

duplicate = mySurfaceLine()
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_empty_component_calls).unwrap();
        let lint = lints.iter().find(|lint| lint.finding == Z0006).unwrap();

        assert_eq!(
            lint.suggestion.as_ref().map(|suggestion| suggestion.insert.clone()),
            Some("clone(mySurfaceLine)".to_owned())
        );
        assert_eq!(
            lint.apply_suggestion(kcl).unwrap(),
            r#"
mySurfaceLine = component(start = 1) {
  return start
}

duplicate = clone(mySurfaceLine)
"#
        );
    }

    #[test]
    fn z0006_lint_and_fix_all_rewrites_empty_component_call() {
        let kcl = r#"
mySurfaceLine = component(start = 1) {
  return start
}

duplicate = mySurfaceLine()
"#;
        let (fixed, unfixed) = lint_and_fix_all(kcl.to_owned()).unwrap();

        assert!(!unfixed.iter().any(|lint| lint.finding == Z0006));
        assert!(fixed.contains("duplicate = clone(mySurfaceLine)"));
    }

    #[test]
    fn z0006_ignores_non_component_zero_arg_calls_and_component_overrides() {
        let kcl = r#"
fn helper() {
  return 1
}
mySurfaceLine = component(start = 1) {
  return start
}

a = helper()
b = mySurfaceLine(start = 2)
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_empty_component_calls).unwrap();

        assert!(!lints.iter().any(|lint| lint.finding == Z0006));
    }
}
