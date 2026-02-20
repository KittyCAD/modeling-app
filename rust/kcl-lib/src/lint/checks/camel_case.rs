use anyhow::Result;
use convert_case::Casing;

use crate::{
    SourceRange,
    errors::Suggestion,
    lint::rule::{Discovered, Finding, def_finding},
    parsing::ast::types::{Node as AstNode, ObjectProperty, Program, VariableDeclarator},
    walk::Node,
};

def_finding!(
    Z0001,
    "Identifiers should be lowerCamelCase",
    "\
By convention, variable names are lowerCamelCase, not snake_case, kebab-case,
nor upper CamelCase (aka PascalCase). 🐪

For instance, a good identifier for the variable representing 'box height'
would be 'boxHeight', not 'BOX_HEIGHT', 'box_height' nor 'BoxHeight'. For
more information there's a pretty good Wikipedia page at

https://en.wikipedia.org/wiki/Camel_case
",
    crate::lint::rule::FindingFamily::Style
);

fn lint_lower_camel_case_var(decl: &VariableDeclarator, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];
    let ident = &decl.id;
    let name = &ident.name;

    // Get what it should be in camel case.
    let new_name = name.to_case(convert_case::Case::Camel);

    if new_name != *name {
        let mut prog = prog.clone();
        prog.rename_symbol(&new_name, ident.start);
        let recast = prog.recast_top(&Default::default(), 0);

        let suggestion = Suggestion {
            title: format!("rename '{name}' to '{new_name}'"),
            insert: recast,
            source_range: prog.as_source_range(),
        };
        findings.push(Z0001.at(
            format!("found '{name}'"),
            SourceRange::new(ident.start, ident.end, ident.module_id),
            Some(suggestion),
        ));
        return Ok(findings);
    }

    Ok(findings)
}

fn lint_lower_camel_case_property(decl: &ObjectProperty, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];
    let ident = &decl.key;
    let name = &ident.name;

    if name.to_case(convert_case::Case::Camel) != *name {
        // We can't rename the properties yet.
        findings.push(Z0001.at(
            format!("found '{name}'"),
            SourceRange::new(ident.start, ident.end, ident.module_id),
            None,
        ));
        return Ok(findings);
    }

    Ok(findings)
}

pub fn lint_variables(decl: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::VariableDeclaration(decl) = decl else {
        return Ok(vec![]);
    };

    lint_lower_camel_case_var(&decl.declaration, prog)
}

pub fn lint_object_properties(decl: Node, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Node::ObjectExpression(decl) = decl else {
        return Ok(vec![]);
    };

    Ok(decl
        .properties
        .iter()
        .flat_map(|v| lint_lower_camel_case_property(v, prog).unwrap_or_default())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{Z0001, lint_object_properties, lint_variables};
    use crate::lint::rule::{assert_finding, test_finding, test_no_finding};

    #[tokio::test]
    async fn z0001_const() {
        assert_finding!(
            lint_variables,
            Z0001,
            "Thickness = 0.5",
            "found 'Thickness'",
            Some("thickness = 0.5\n".to_string())
        );
        assert_finding!(
            lint_variables,
            Z0001,
            "THICKNESS = 0.5",
            "found 'THICKNESS'",
            Some("thickness = 0.5\n".to_string())
        );
        assert_finding!(
            lint_variables,
            Z0001,
            "THICC_NES = 0.5",
            "found 'THICC_NES'",
            Some("thiccNes = 0.5\n".to_string())
        );
        assert_finding!(
            lint_variables,
            Z0001,
            "thicc_nes = 0.5",
            "found 'thicc_nes'",
            Some("thiccNes = 0.5\n".to_string())
        );
        assert_finding!(
            lint_variables,
            Z0001,
            "myAPIVar = 0.5",
            "found 'myAPIVar'",
            Some("myApiVar = 0.5\n".to_string())
        );
    }

    const FULL_BAD: &str = "\
// Define constants
pipeLength = 40
pipeSmallDia = 10
pipeLargeDia = 20
thickness = 0.5

// Create the sketch to be revolved around the y-axis. Use the small diameter, large diameter, length, and thickness to define the sketch.
Part001 = startSketchOn(XY)
  |> startProfile(at = [pipeLargeDia - (thickness / 2), 38])
  |> line(end = [thickness, 0])
  |> line(end = [0, -1])
  |> angledLine(angle = 60, endAbsoluteX = pipeSmallDia + thickness)
  |> line(end = [0, -pipeLength])
  |> angledLine(angle = -60, endAbsoluteX = pipeLargeDia + thickness)
  |> line(end = [0, -1])
  |> line(end = [-thickness, 0])
  |> line(end = [0, 1])
  |> angledLine(angle = 120, endAbsoluteX = pipeSmallDia)
  |> line(end = [0, pipeLength])
  |> angledLine(angle = 60, endAbsoluteX = pipeLargeDia)
  |> close()
  |> revolve(axis = Y)
";

    test_finding!(
        z0001_full_bad,
        lint_variables,
        Z0001,
        FULL_BAD,
        "found 'Part001'",
        Some(FULL_BAD.replace("Part001", "part001"))
    );

    test_no_finding!(
        z0001_full_good,
        lint_variables,
        Z0001,
        "\
// Define constants
pipeLength = 40
pipeSmallDia = 10
pipeLargeDia = 20
thickness = 0.5

// Create the sketch to be revolved around the y-axis. Use the small diameter, large diameter, length, and thickness to define the sketch.
part001 = startSketchOn(XY)
  |> startProfile(at = [pipeLargeDia - (thickness / 2), 38])
  |> line(end = [thickness, 0])
  |> line(end = [0, -1])
  |> angledLine(angle = 60, endAbsoluteX = pipeSmallDia + thickness)
  |> line(end = [0, -pipeLength])
  |> angledLine(angle = -60, endAbsoluteX = pipeLargeDia + thickness)
  |> line(end = [0, -1])
  |> line(end = [-thickness, 0])
  |> line(end = [0, 1])
  |> angledLine(angle = 120, endAbsoluteX = pipeSmallDia)
  |> line(end = [0, pipeLength])
  |> angledLine(angle = 60, endAbsoluteX = pipeLargeDia)
  |> close()
  |> revolve(axis = Y)
"
    );

    test_finding!(
        z0001_full_bad_object,
        lint_object_properties,
        Z0001,
        "\
circ = {angle_start = 0, angle_end = 360, radius = 5}
",
        "found 'angle_start'",
        None
    );

    /// Regression test for https://github.com/KittyCAD/modeling-app/issues/10114
    /// Renaming a function (snake_case to camelCase) must rename the definition AND all call sites.
    #[tokio::test]
    async fn z0001_fn_renames_all_call_sites() {
        let kcl = r#"
fn ZOO_O() {
  return 1
}
a = ZOO_O()
b = ZOO_O()
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_variables).unwrap();
        let rename_finding = lints
            .iter()
            .find(|d| d.description.contains("ZOO_O") && d.suggestion.is_some());
        let Some(discovered) = rename_finding else {
            panic!("Expected a Z0001 finding for ZOO_O with a suggestion")
        };
        let applied = discovered.apply_suggestion(kcl).expect("suggestion should apply");
        // All occurrences must be renamed to zooO
        assert!(
            !applied.contains("ZOO_O"),
            "Applied suggestion should not contain ZOO_O; got:\n{applied}"
        );
        let count = applied.matches("zooO").count();
        assert_eq!(
            count, 3,
            "Expected 3 occurrences of zooO (1 definition + 2 calls); got {count}. Applied:\n{applied}"
        );
        crate::execution::parse_execute(&applied).await.unwrap();
    }

    /// Same as above but with a helper called from inside another function (like ZOO_O called from ZOO).
    /// Regression for https://github.com/KittyCAD/modeling-app/issues/10114
    #[tokio::test]
    async fn z0001_fn_renames_all_call_sites_nested_calls() {
        let kcl = r#"
fn ZOO_O() {
  return 1
}
fn ZOO() {
  a = ZOO_O()
  b = ZOO_O()
  return [a, b]
}
result = ZOO()
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_variables).unwrap();
        let rename_finding = lints
            .iter()
            .find(|d| d.description.contains("ZOO_O") && d.suggestion.is_some());
        let Some(discovered) = rename_finding else {
            panic!("Expected a Z0001 finding for ZOO_O with a suggestion; lints: {lints:?}")
        };
        let applied = discovered.apply_suggestion(kcl).expect("suggestion should apply");
        assert!(
            !applied.contains("ZOO_O"),
            "Applied suggestion should not contain ZOO_O; got:\n{applied}"
        );
        let count = applied.matches("zooO").count();
        assert_eq!(
            count, 3,
            "Expected 3 occurrences of zooO (1 definition + 2 calls in ZOO); got {count}. Applied:\n{applied}"
        );
        crate::execution::parse_execute(&applied).await.unwrap();
    }

    /// When renaming a global to camelCase, a function parameter with the same name (shadowing)
    /// must not be renamed: only the global and references outside the function should change.
    #[tokio::test]
    async fn z0001_shadowing_param_not_renamed() {
        let kcl = r#"
GLOBAL_VAR = 1
fn f(GLOBAL_VAR) {
  return GLOBAL_VAR + 1
}
y = GLOBAL_VAR
"#;
        let prog = crate::Program::parse_no_errs(kcl).unwrap();
        let lints = prog.lint(lint_variables).unwrap();
        let rename_finding = lints
            .iter()
            .find(|d| d.description.contains("GLOBAL_VAR") && d.suggestion.is_some());
        let Some(discovered) = rename_finding else {
            panic!("Expected a Z0001 finding for GLOBAL_VAR with a suggestion; lints: {lints:?}")
        };
        let applied = discovered.apply_suggestion(kcl).expect("suggestion should apply");
        // Global and top-level reference renamed
        assert!(
            applied.contains("globalVar = 1"),
            "Global declaration should be renamed; got:\n{applied}"
        );
        assert!(
            applied.contains("y = globalVar"),
            "Top-level reference should be renamed; got:\n{applied}"
        );
        // Parameter and references inside f must stay GLOBAL_VAR (shadowing)
        assert!(
            applied.contains("fn f(GLOBAL_VAR)"),
            "Parameter must not be renamed (shadowing); got:\n{applied}"
        );
        assert!(
            applied.contains("return GLOBAL_VAR + 1"),
            "Reference to param inside f must not be renamed; got:\n{applied}"
        );
        crate::execution::parse_execute(&applied).await.unwrap();
    }
}
