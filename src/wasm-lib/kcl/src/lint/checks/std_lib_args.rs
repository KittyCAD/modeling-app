use std::sync::Arc;

use anyhow::Result;

use crate::{
    docs::StdLibFn,
    lint::rule::{def_finding, Discovered, Finding},
    parsing::ast::types::{CallExpression, NodeRef},
    std::{FunctionKind, StdLib},
    walk::Node,
    SourceRange,
};

def_finding!(
    Z0002,
    "Too many arguments to stdlib function",
    "\
Previously, we have not been failing when too many arguments are passed to a stdlib function. This is a problem because it can lead to unexpected behavior. We will in the future fail when too many arguments are passed to a function. So fix your code now."
);

fn lint_too_many_args_std_lib_function(
    f: Box<dyn StdLibFn>,
    exp: NodeRef<'_, CallExpression>,
) -> Result<Vec<Discovered>> {
    let mut findings = vec![];

    if f.name() == "pow" {
        if exp.arguments.len() != 2 {
            findings.push(Z0002.at(
                format!("expected 2 arguments, found {}", exp.arguments.len()),
                SourceRange::new(exp.start, exp.end, exp.module_id),
            ));
        }
        return Ok(findings);
    }

    if f.name() == "max" || f.name() == "min" {
        if exp.arguments.len() < 2 {
            findings.push(Z0002.at(
                format!("expected at least 2 arguments, found {}", exp.arguments.len()),
                SourceRange::new(exp.start, exp.end, exp.module_id),
            ));
        }
        return Ok(findings);
    }

    let fn_args_len = f.args(false).len();
    if exp.arguments.len() > fn_args_len {
        findings.push(Z0002.at(
            format!("expected {} arguments, found {}", fn_args_len, exp.arguments.len()),
            SourceRange::new(exp.start, exp.end, exp.module_id),
        ));
    }

    Ok(findings)
}

pub fn lint_call_expressions(exp: Node) -> Result<Vec<Discovered>> {
    // Yes this is dumb but its only for a temporary amount of time so its fine.
    let stdlib = Arc::new(StdLib::new());
    let Node::CallExpression(exp) = exp else {
        return Ok(vec![]);
    };

    match stdlib.get_either(&exp.callee.name) {
        FunctionKind::Core(func) => lint_too_many_args_std_lib_function(func, exp),
        _ => Ok(vec![]),
    }
}

#[cfg(test)]
mod tests {
    use super::{lint_call_expressions, Z0002};
    use crate::lint::rule::{test_finding, test_no_finding};

    test_finding!(
        z0002_full_bad,
        lint_call_expressions,
        Z0002,
        "\
// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.

// Define our bracket feet lengths
const shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
const wallMountL = 6 // the length of the bracket

// Define constants required to calculate the thickness needed to support 300 lbs
const sigmaAllow = 35000 // psi
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const shelfLength = 12 // inches
const moment = shelfLength * p / 2 // Moment experienced at fixed end of bracket
const factorOfSafety = 2 // Factor of safety of 2 to be conservative

// Calculate the thickness off the bending stress and factor of safety
const thickness = sqrt(6 * moment * factorOfSafety / (width * sigmaAllow))

// 0.25 inch fillet radius
const filletR = 0.25

// Sketch the bracket and extrude with fillets
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %, $outerEdge)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, $innerEdge)
  |> line([0, -wallMountL + thickness], %)
  |> close()
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [getPreviousAdjacentEdge(innerEdge, %)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getPreviousAdjacentEdge(outerEdge, %)]
     }, %)
"
    );

    test_no_finding!(
        z0002_full_good,
        lint_call_expressions,
        Z0002,
        "\
// Shelf Bracket
// This is a shelf bracket made out of 6061-T6 aluminum sheet metal. The required thickness is calculated based on a point load of 300 lbs applied to the end of the shelf. There are two brackets holding up the shelf, so the moment experienced is divided by 2. The shelf is 1 foot long from the wall.

// Define our bracket feet lengths
const shelfMountL = 8 // The length of the bracket holding up the shelf is 6 inches
const wallMountL = 6 // the length of the bracket

// Define constants required to calculate the thickness needed to support 300 lbs
const sigmaAllow = 35000 // psi
const width = 6 // inch
const p = 300 // Force on shelf - lbs
const shelfLength = 12 // inches
const moment = shelfLength * p / 2 // Moment experienced at fixed end of bracket
const factorOfSafety = 2 // Factor of safety of 2 to be conservative

// Calculate the thickness off the bending stress and factor of safety
const thickness = sqrt(6 * moment * factorOfSafety / (width * sigmaAllow))

// 0.25 inch fillet radius
const filletR = 0.25

// Sketch the bracket and extrude with fillets
const bracket = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, wallMountL], %, $outerEdge)
  |> line([-shelfMountL, 0], %)
  |> line([0, -thickness], %)
  |> line([shelfMountL - thickness, 0], %, $innerEdge)
  |> line([0, -wallMountL + thickness], %)
  |> close()
  |> extrude(width, %)
  |> fillet({
       radius: filletR,
       tags: [getPreviousAdjacentEdge(innerEdge)]
     }, %)
  |> fillet({
       radius: filletR + thickness,
       tags: [getPreviousAdjacentEdge(outerEdge)]
     }, %)
"
    );
}
