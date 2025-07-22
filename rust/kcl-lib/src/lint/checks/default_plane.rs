use anyhow::Result;

use crate::{
    errors::Suggestion,
    lint::{
        checks::offset_plane::start_sketch_on_check_specific_plane,
        rule::{Discovered, Finding, def_finding},
    },
    parsing::ast::types::{Node as AstNode, Program},
    walk::Node,
};

def_finding!(
    Z0002,
    "default plane should be called versus explicitly defined",
    "\
startSketchOn should be a default plane in this case ✏️

The startSketchOn stdlib function has the ability to define a default Plane
to begin the sketch on.

These are the default planes: XY, -XY, XZ, -XZ, YZ, -YZ.
"
);

pub fn lint_should_be_default_plane(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Some((call_source_range, plane_name, offset)) = start_sketch_on_check_specific_plane(node)? else {
        return Ok(vec![]);
    };
    // We only care about the default planes.
    if offset != 0.0 {
        return Ok(vec![]);
    }
    let suggestion = Suggestion {
        title: "use defaultPlane instead".to_owned(),
        insert: format!("{plane_name}"),
        source_range: call_source_range,
    };
    Ok(vec![Z0002.at(
        format!("custom plane in startSketchOn; defaultPlane {plane_name} would work here"),
        call_source_range,
        Some(suggestion),
    )])
}

#[cfg(test)]
mod tests {
    use super::{Z0002, lint_should_be_default_plane};
    use crate::lint::rule::{test_finding, test_no_finding};

    test_finding!(
        z0002_bad_sketch_on,
        lint_should_be_default_plane,
        Z0002,
        "\
startSketchOn({
    origin = { x = 0, y = 0, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
|> startProfile(at = [0, 0])
",
        "custom plane in startSketchOn; defaultPlane XZ would work here",
        Some("XZ".to_string())
    );

    test_no_finding!(
        z0002_good_sketch_on,
        lint_should_be_default_plane,
        Z0002,
        "\
startSketchOn({
    origin = { x = 10, y = -14.3, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
"
    );

    test_no_finding!(
        z0002_offset_plane,
        lint_should_be_default_plane,
        Z0002,
        "\
startSketchOn({
    origin = { x = 0, y = -14.3, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
"
    );
}
