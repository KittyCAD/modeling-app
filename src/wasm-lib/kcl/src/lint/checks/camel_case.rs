use anyhow::Result;

use crate::{
    ast::types::VariableDeclarator,
    executor::SourceRange,
    lint::rule::{def_finding, Discovered, Finding},
    walk::Node,
};

def_finding!(
    Z0001,
    "Identifiers must be lowerCamelCase",
    "\
By convention, variable names are lowerCamelCase, not snake_case, kebab-case,
nor CammelCase. 🐪

For instance, a good identifier for the variable representing 'box height'
would be 'boxHeight', not 'BOX_HEIGHT', 'box_height' nor 'BoxHeight'. For
more information there's a pretty good Wikipedia page at

https://en.wikipedia.org/wiki/Camel_case
"
);

fn lint_lower_camel_case(decl: &VariableDeclarator) -> Result<Vec<Discovered>> {
    let mut findings = vec![];
    let ident = &decl.id;
    let name = &ident.name;

    if !name.chars().next().unwrap().is_lowercase() {
        findings.push(Z0001.at(format!("found '{}'", name), SourceRange::new(ident.start, ident.end)));
        return Ok(findings);
    }

    if name.contains('-') || name.contains('_') {
        findings.push(Z0001.at(format!("found '{}'", name), SourceRange::new(ident.start, ident.end)));
        return Ok(findings);
    }

    Ok(findings)
}

pub fn lint_variables(decl: Node) -> Result<Vec<Discovered>> {
    let Node::VariableDeclaration(decl) = decl else {
        return Ok(vec![]);
    };

    Ok(decl
        .declarations
        .iter()
        .flat_map(|v| lint_lower_camel_case(v).unwrap_or_default())
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{lint_variables, Z0001};
    use crate::lint::rule::{assert_finding, test_finding, test_no_finding};

    #[test]
    fn z0001_const() {
        assert_finding!(lint_variables, Z0001, "const Thickness = 0.5");
        assert_finding!(lint_variables, Z0001, "const THICKNESS = 0.5");
        assert_finding!(lint_variables, Z0001, "const THICC_NES = 0.5");
        assert_finding!(lint_variables, Z0001, "const thicc_nes = 0.5");
    }

    test_finding!(z0001_full_bad, lint_variables, Z0001, "\
// Define constants
const pipeLength = 40
const pipeSmallDia = 10
const pipeLargeDia = 20
const thickness = 0.5

// Create the sketch to be revolved around the y-axis. Use the small diameter, large diameter, length, and thickness to define the sketch.
const Part001 = startSketchOn('XY')
  |> startProfileAt([pipeLargeDia - (thickness / 2), 38], %)
  |> line([thickness, 0], %)
  |> line([0, -1], %)
  |> angledLineToX({
       angle: 60,
       to: pipeSmallDia + thickness
     }, %)
  |> line([0, -pipeLength], %)
  |> angledLineToX({
       angle: -60,
       to: pipeLargeDia + thickness
     }, %)
  |> line([0, -1], %)
  |> line([-thickness, 0], %)
  |> line([0, 1], %)
  |> angledLineToX({ angle: 120, to: pipeSmallDia }, %)
  |> line([0, pipeLength], %)
  |> angledLineToX({ angle: 60, to: pipeLargeDia }, %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)
");

    test_no_finding!(z0001_full_good, lint_variables, Z0001, "\
// Define constants
const pipeLength = 40
const pipeSmallDia = 10
const pipeLargeDia = 20
const thickness = 0.5

// Create the sketch to be revolved around the y-axis. Use the small diameter, large diameter, length, and thickness to define the sketch.
const part001 = startSketchOn('XY')
  |> startProfileAt([pipeLargeDia - (thickness / 2), 38], %)
  |> line([thickness, 0], %)
  |> line([0, -1], %)
  |> angledLineToX({
       angle: 60,
       to: pipeSmallDia + thickness
     }, %)
  |> line([0, -pipeLength], %)
  |> angledLineToX({
       angle: -60,
       to: pipeLargeDia + thickness
     }, %)
  |> line([0, -1], %)
  |> line([-thickness, 0], %)
  |> line([0, 1], %)
  |> angledLineToX({ angle: 120, to: pipeSmallDia }, %)
  |> line([0, pipeLength], %)
  |> angledLineToX({ angle: 60, to: pipeLargeDia }, %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)
");
}
