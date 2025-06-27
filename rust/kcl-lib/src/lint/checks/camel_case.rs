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
"
);

fn lint_lower_camel_case_var(decl: &VariableDeclarator, prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];
    let ident = &decl.id;
    let name = &ident.name;

    if !name.is_case(convert_case::Case::Camel) {
        // Get what it should be.
        let new_name = name.to_case(convert_case::Case::Camel);

        let mut prog = prog.clone();
        prog.rename_symbol(&new_name, ident.start);
        let recast = prog.recast(&Default::default(), 0);

        let suggestion = Suggestion {
            title: format!("rename '{name}' to '{new_name}'"),
            insert: recast,
            source_range: prog.as_source_range(),
        };
        findings.push(Z0001.at(
            format!("found '{name}'"),
            SourceRange::new(ident.start, ident.end, ident.module_id),
            Some(suggestion.clone()),
        ));
        return Ok(findings);
    }

    Ok(findings)
}

fn lint_lower_camel_case_property(decl: &ObjectProperty, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let mut findings = vec![];
    let ident = &decl.key;
    let name = &ident.name;

    if !name.is_case(convert_case::Case::Camel) {
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
        Some(FULL_BAD.replace("Part001", "part001").to_string())
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
}
