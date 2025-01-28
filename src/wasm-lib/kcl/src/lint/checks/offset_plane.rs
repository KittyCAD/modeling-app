use std::collections::HashMap;

use anyhow::Result;

use crate::{
    lint::rule::{def_finding, Discovered, Finding},
    parsing::ast::types::{BinaryPart, Expr, LiteralValue, ObjectExpression, UnaryOperator},
    walk::Node,
    SourceRange,
};

def_finding!(
    Z0003,
    "offsetPlane should be used to define a new plane offset from the origin",
    "\
startSketchOn should be an offsetPlane call in this case ✏️

The startSketchOn stdlib function has the ability to define a custom Plane
to begin the sketch on (outside of the built in XY, -YZ planes). There also
exists the offsetPlane stdlib function to create a new Plane offset by some
fixed amount from an existing plane.

This lint rule triggers when a startSketchOn's provided plane is recognized as
being merely offset from a built-in plane. It's much more readable to
use offsetPlane where possible.
"
);

pub fn lint_should_be_offset_plane(node: Node) -> Result<Vec<Discovered>> {
    let Node::CallExpression(call) = node else {
        return Ok(vec![]);
    };

    if call.inner.callee.inner.name != "startSketchOn" {
        return Ok(vec![]);
    }

    if call.arguments.len() != 1 {
        // we only look for single-argument object patterns, if there's more
        // than that we don't have a plane decl
        return Ok(vec![]);
    }

    let Expr::ObjectExpression(arg) = &call.arguments[0] else {
        return Ok(vec![]);
    };

    let Some(plane) = arg.inner.properties.iter().find(|v| v.key.inner.name == "plane") else {
        return Ok(vec![]);
    };

    let Expr::ObjectExpression(ref plane) = plane.inner.value else {
        return Ok(vec![]);
    };

    let mut origin: Option<(f64, f64, f64)> = None;
    let mut x_vec: Option<(f64, f64, f64)> = None;
    let mut y_vec: Option<(f64, f64, f64)> = None;

    for property in &plane.inner.properties {
        let Expr::ObjectExpression(ref point) = property.inner.value else {
            return Ok(vec![]);
        };

        let Some((x, y, z)) = get_xyz(&point.inner) else {
            return Ok(vec![]);
        };

        let property_name = &property.inner.key.inner.name;

        match property_name.as_str() {
            "origin" => origin = Some((x, y, z)),
            "xAxis" => x_vec = Some((x, y, z)),
            "yAxis" => y_vec = Some((x, y, z)),
            _ => {
                continue;
            }
        };
    }

    let Some(origin) = origin else { return Ok(vec![]) };
    let Some(x_vec) = x_vec else { return Ok(vec![]) };
    let Some(y_vec) = y_vec else { return Ok(vec![]) };

    if [origin.0, origin.1, origin.2].iter().filter(|v| **v == 0.0).count() < 2 {
        return Ok(vec![]);
    }
    // two of the origin values are 0, 0; let's work it out and check
    // what's **up**

    /// This will attempt to very poorly translate orientation to a letter
    /// if it's possible to do so. The engine will norm these vectors, so
    /// we'll just use logic off 0 for now, but this sucks, generally speaking.
    fn vector_to_letter<'a>(x: f64, y: f64, z: f64) -> Option<&'a str> {
        if x > 0.0 && y == 0.0 && z == 0.0 {
            return Some("X");
        }
        if x < 0.0 && y == 0.0 && z == 0.0 {
            return Some("-X");
        }

        if x == 0.0 && y > 0.0 && z == 0.0 {
            return Some("Y");
        }
        if x == 0.0 && y < 0.0 && z == 0.0 {
            return Some("-Y");
        }

        if x == 0.0 && y == 0.0 && z > 0.0 {
            return Some("Z");
        }
        if x == 0.0 && y == 0.0 && z < 0.0 {
            return Some("-Z");
        }

        None
    }

    let allowed_planes = HashMap::from([
        // allowed built-in planes
        ("XY".to_owned(), true),
        ("-XY".to_owned(), true),
        ("XZ".to_owned(), true),
        ("-XZ".to_owned(), true),
        ("YZ".to_owned(), true),
        ("-YZ".to_owned(), true),
    ]);
    // Currently, the engine **ONLY** accepts[1] the following:
    //
    // XY
    // -XY
    // XZ
    // -XZ
    // YZ
    // -YZ
    //
    // [1]: https://zoo.dev/docs/kcl/types/PlaneData

    let plane_name = format!(
        "{}{}",
        vector_to_letter(x_vec.0, x_vec.1, x_vec.2).unwrap_or(""),
        vector_to_letter(y_vec.0, y_vec.1, y_vec.2).unwrap_or(""),
    );

    if !allowed_planes.contains_key(&plane_name) {
        return Ok(vec![]);
    };

    let call_source_range = SourceRange::new(call.start, call.end, call.module_id);
    Ok(vec![Z0003.at(
        format!(
            "custom plane in startSketchOn; offsetPlane from {} would work here",
            plane_name
        ),
        call_source_range,
    )])
}

fn get_xyz(point: &ObjectExpression) -> Option<(f64, f64, f64)> {
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut z: Option<f64> = None;

    fn unlitafy(lit: &LiteralValue) -> Option<f64> {
        Some(match lit {
            LiteralValue::Number { value, .. } => *value,
            _ => {
                return None;
            }
        })
    }

    for property in &point.properties {
        let Some(value) = (match &property.value {
            Expr::UnaryExpression(ref value) => {
                if value.operator != UnaryOperator::Neg {
                    continue;
                }
                let BinaryPart::Literal(ref value) = &value.inner.argument else {
                    continue;
                };
                unlitafy(&value.inner.value).map(|v| -v)
            }
            Expr::Literal(ref value) => unlitafy(&value.value),
            _ => {
                continue;
            }
        }) else {
            continue;
        };

        match property.key.inner.name.as_str() {
            "x" => x = Some(value),
            "y" => y = Some(value),
            "z" => z = Some(value),
            _ => {}
        }
    }

    Some((x?, y?, z?))
}

#[cfg(test)]
mod tests {
    use super::{lint_should_be_offset_plane, Z0003};
    use crate::lint::rule::{test_finding, test_no_finding};

    test_finding!(
        z0003_bad_sketch_on,
        lint_should_be_offset_plane,
        Z0003,
        "\
startSketchOn({
  plane: {
    origin: { x: 0, y: -14.3, z: 0 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 0, y: -1, z: 0 }
  }
})
"
    );

    test_no_finding!(
        z0003_good_sketch_on,
        lint_should_be_offset_plane,
        Z0003,
        "\
startSketchOn({
  plane: {
    origin: { x: 10, y: -14.3, z: 0 },
    xAxis: { x: 1, y: 0, z: 0 },
    yAxis: { x: 0, y: 0, z: 1 },
    zAxis: { x: 0, y: -1, z: 0 }
  }
})
"
    );
}
