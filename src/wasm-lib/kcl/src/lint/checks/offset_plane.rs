use anyhow::Result;

use crate::{
    ast::types::{BinaryPart, Expr, LiteralValue, ObjectExpression, UnaryOperator},
    lint::rule::{def_finding, Discovered, Finding},
    walk::Node,
};

def_finding!(
    Z0003,
    "offsetPlane should be used to define a new plane offset from the origin",
    "\
...
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

    let Some(plane) = arg
        .inner
        .properties
        .iter()
        .filter(|v| v.key.inner.name == "plane")
        .next()
    else {
        return Ok(vec![]);
    };

    let Expr::ObjectExpression(ref plane) = plane.inner.value else {
        return Ok(vec![]);
    };

    for property in &plane.inner.properties {
        let property_name = &property.inner.key.inner.name;

        match property_name.as_str() {
            "origin" => {}
            "xAxis" => {}
            "yAxis" => {}
            "zAxis" => {}
            _ => {
                continue;
            }
        };

        let Expr::ObjectExpression(ref point) = property.inner.value else {
            return Ok(vec![]);
        };

        let Some((x, y, z)) = get_xyz(&point.inner) else {
            return Ok(vec![]);
        };

        eprintln!("{:?} {} {} {}", property_name, x, y, z);
    }

    Ok(vec![])
}

fn get_xyz(point: &ObjectExpression) -> Option<(f64, f64, f64)> {
    let mut x: Option<f64> = None;
    let mut y: Option<f64> = None;
    let mut z: Option<f64> = None;

    fn unlitafy(lit: &LiteralValue) -> Option<f64> {
        Some(match lit {
            LiteralValue::IInteger(value) => *value as f64,
            LiteralValue::Fractional(value) => *value,
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
    use crate::lint::rule::test_finding;

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
}
