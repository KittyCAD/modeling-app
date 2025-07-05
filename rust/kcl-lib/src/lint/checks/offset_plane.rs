use anyhow::Result;

use crate::{
    SourceRange,
    engine::{DEFAULT_PLANE_INFO, PlaneName},
    errors::Suggestion,
    execution::{PlaneInfo, Point3d, types::UnitLen},
    lint::rule::{Discovered, Finding, def_finding},
    parsing::ast::types::{
        BinaryPart, CallExpressionKw, Expr, LiteralValue, Node as AstNode, ObjectExpression, Program, UnaryOperator,
    },
    walk::Node,
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

pub fn lint_should_be_offset_plane(node: Node, _prog: &AstNode<Program>) -> Result<Vec<Discovered>> {
    let Some((call_source_range, plane_name, offset)) = start_sketch_on_check_specific_plane(node)? else {
        return Ok(vec![]);
    };
    // We don't care about the default planes.
    if offset == 0.0 {
        return Ok(vec![]);
    }
    let suggestion = Suggestion {
        title: "use offsetPlane instead".to_owned(),
        insert: format!("offsetPlane({plane_name}, offset = {offset})"),
        source_range: call_source_range,
    };
    Ok(vec![Z0003.at(
        format!("custom plane in startSketchOn; offsetPlane from {plane_name} would work here"),
        call_source_range,
        Some(suggestion),
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
            Expr::UnaryExpression(value) => {
                if value.operator != UnaryOperator::Neg {
                    continue;
                }
                let BinaryPart::Literal(value) = &value.inner.argument else {
                    continue;
                };
                unlitafy(&value.inner.value).map(|v| -v)
            }
            Expr::Literal(value) => unlitafy(&value.value),
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

fn get_offset(info: &PlaneInfo) -> Option<f64> {
    // Check which number is not a 1 or -1, or zero.
    // Return that back out since that is the offset.

    // This is a bit of a hack, but it works for now.
    // We can do better later.
    if info.origin.x != 1.0 && info.origin.x != -1.0 && info.origin.x != 0.0 {
        return Some(info.origin.x);
    } else if info.origin.y != 1.0 && info.origin.y != -1.0 && info.origin.y != 0.0 {
        return Some(info.origin.y);
    } else if info.origin.z != 1.0 && info.origin.z != -1.0 && info.origin.z != 0.0 {
        return Some(info.origin.z);
    } else if info.x_axis.x != 1.0 && info.x_axis.x != -1.0 && info.x_axis.x != 0.0 {
        return Some(info.x_axis.x);
    } else if info.x_axis.y != 1.0 && info.x_axis.y != -1.0 && info.x_axis.y != 0.0 {
        return Some(info.x_axis.y);
    } else if info.x_axis.z != 1.0 && info.x_axis.z != -1.0 && info.x_axis.z != 0.0 {
        return Some(info.x_axis.z);
    } else if info.y_axis.x != 1.0 && info.y_axis.x != -1.0 && info.y_axis.x != 0.0 {
        return Some(info.y_axis.x);
    } else if info.y_axis.y != 1.0 && info.y_axis.y != -1.0 && info.y_axis.y != 0.0 {
        return Some(info.y_axis.y);
    } else if info.y_axis.z != 1.0 && info.y_axis.z != -1.0 && info.y_axis.z != 0.0 {
        return Some(info.y_axis.z);
    }

    None
}

pub fn start_sketch_on_check_specific_plane(node: Node) -> Result<Option<(SourceRange, PlaneName, f64)>> {
    match node {
        Node::CallExpressionKw(node) => start_sketch_on_check_specific_plane_kw(node),
        _ => Ok(None),
    }
}

pub fn start_sketch_on_check_specific_plane_kw(
    call: &AstNode<CallExpressionKw>,
) -> Result<Option<(SourceRange, PlaneName, f64)>> {
    if call.inner.callee.inner.name.name != "startSketchOn" {
        return Ok(None);
    }

    let Some(ref unlabeled) = call.inner.unlabeled else {
        // we only look for single-argument object patterns, if there's more
        // than that we don't have a plane decl
        return Ok(None);
    };

    let call_source_range = SourceRange::new(unlabeled.start(), unlabeled.end(), unlabeled.module_id());

    let Expr::ObjectExpression(arg) = &unlabeled else {
        return Ok(None);
    };
    common(arg, call_source_range)
}

pub fn common(
    arg: &AstNode<ObjectExpression>,
    call_source_range: SourceRange,
) -> Result<Option<(SourceRange, PlaneName, f64)>> {
    let mut origin: Option<Point3d> = None;
    let mut x_vec: Option<Point3d> = None;
    let mut y_vec: Option<Point3d> = None;

    for property in &arg.inner.properties {
        let Expr::ObjectExpression(ref point) = property.inner.value else {
            return Ok(None);
        };

        let Some((x, y, z)) = get_xyz(&point.inner) else {
            return Ok(None);
        };

        let property_name = &property.inner.key.inner.name;

        match property_name.as_str() {
            "origin" => {
                origin = Some(Point3d {
                    x,
                    y,
                    z,
                    units: UnitLen::Mm,
                })
            }
            "xAxis" => {
                x_vec = Some(Point3d {
                    x,
                    y,
                    z,
                    units: UnitLen::Unknown,
                })
            }
            "yAxis" => {
                y_vec = Some(Point3d {
                    x,
                    y,
                    z,
                    units: UnitLen::Unknown,
                })
            }
            _ => {
                continue;
            }
        };
    }

    let (Some(origin), Some(x_vec), Some(y_vec)) = (origin, x_vec, y_vec) else {
        return Ok(None);
    };

    if [origin.x, origin.y, origin.z].iter().filter(|v| **v == 0.0).count() < 2 {
        return Ok(None);
    }

    let plane_info = PlaneInfo {
        origin,
        x_axis: x_vec,
        y_axis: y_vec,
        z_axis: x_vec.axes_cross_product(&y_vec),
    };

    let plane_equal_excluding_z = |plane: &&PlaneInfo, plane_info: &PlaneInfo| {
        plane.origin == plane_info.origin && plane.x_axis == plane_info.x_axis && plane.y_axis == plane_info.y_axis
    };

    // Return early if we have a default plane.
    if let Some((name, _)) = DEFAULT_PLANE_INFO
        .iter()
        .find(|(_, plane)| plane_equal_excluding_z(plane, &plane_info))
    {
        return Ok(Some((call_source_range, *name, 0.0)));
    }

    let normalized_plane_info = normalize_plane_info(&plane_info);

    println!("normalized plane info: {:#?}", normalized_plane_info);

    // Check our default planes.
    let Some((matched_plane_name, _)) = DEFAULT_PLANE_INFO
        .iter()
        .find(|(_, plane)| plane_equal_excluding_z(plane, &normalized_plane_info))
    else {
        return Ok(None);
    };

    let Some(offset) = get_offset(&plane_info) else {
        return Ok(None);
    };

    Ok(Some((call_source_range, *matched_plane_name, offset)))
}

// Clone the plane info and normalize any number that is not zero to 1.0 or -1.0 (if negative)
// so we can compare it to the built-in planes.
fn normalize_plane_info(plane_info: &PlaneInfo) -> PlaneInfo {
    let mut normalized_plane_info = plane_info.clone();
    normalized_plane_info.origin = Point3d {
        x: 0.0,
        y: 0.0,
        z: 0.0,
        units: normalized_plane_info.origin.units,
    };
    normalized_plane_info.y_axis.x = if normalized_plane_info.y_axis.x != 0.0 {
        normalized_plane_info.y_axis.x.signum()
    } else {
        0.0
    };
    normalized_plane_info.y_axis.y = if normalized_plane_info.y_axis.y != 0.0 {
        normalized_plane_info.y_axis.y.signum()
    } else {
        0.0
    };
    normalized_plane_info.y_axis.z = if normalized_plane_info.y_axis.z != 0.0 {
        normalized_plane_info.y_axis.z.signum()
    } else {
        0.0
    };
    normalized_plane_info
}

#[cfg(test)]
mod tests {
    use super::{Z0003, lint_should_be_offset_plane};
    use crate::lint::rule::{test_finding, test_no_finding};

    // Both axes here are normalized.
    test_finding!(
        z0003_bad_sketch_on,
        lint_should_be_offset_plane,
        Z0003,
        "\
startSketchOn({
    origin = { x = 0, y = -14.3, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
|> startProfile(at = [0, 0])
",
        "custom plane in startSketchOn; offsetPlane from XZ would work here",
        Some("offsetPlane(XZ, offset = -14.3)".to_string())
    );

    // This test uses a Y axis that isn't normalized, to check the normalization code doesn't
    // stop this lint from firing.
    test_finding!(
        z0003_bad_sketch_on_not_normalized_axes,
        lint_should_be_offset_plane,
        Z0003,
        "\
a1 = startSketchOn({
       origin = { x = 0, y = 0, z = 0 },
       xAxis = { x = 1, y = 0, z = 0 },
       yAxis = { x = 0, y = 12, z = 0 },
     })
  |> startProfile(at = [0, 0])
  |> line(end = [100.0, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)
",
        "custom plane in startSketchOn; offsetPlane from XY would work here",
        Some("offsetPlane(XY, offset = 12)".to_string())
    );

    test_no_finding!(
        z0003_good_sketch_on,
        lint_should_be_offset_plane,
        Z0003,
        "\
startSketchOn({
    origin = { x = 10, y = -14.3, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
"
    );

    test_no_finding!(
        z0003_default_plane,
        lint_should_be_offset_plane,
        Z0003,
        "\
startSketchOn({
    origin = { x = 0, y = 0, z = 0 },
    xAxis = { x = 1, y = 0, z = 0 },
    yAxis = { x = 0, y = 0, z = 1 },
})
"
    );
}
