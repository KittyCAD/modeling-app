//! Capture the engine's trimmed region curves while its connection is live.

use std::collections::BTreeSet;

use kittycad_modeling_cmds as cmds;
use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::SketchGetInfo;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::CurveDebug;
use kittycad_modeling_cmds::shared::CurveTypeDebug;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;

use super::sampling::distance;
use super::sampling::sample_arc;
use super::sampling::sample_circle;
use super::types::CONTACT_TOLERANCE;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationPoint;
use crate::ExecOutcome;
use crate::ExecutorContext;
use crate::execution::KclValueView;

/// Engine-resolved, sampled closed contours. Capturing these is opt-in; ordinary
/// execution and constraint checks do not need an additional engine request.
#[derive(Debug, Clone)]
pub struct ResolvedSketchRegion {
    pub(crate) name: String,
    pub(crate) id: uuid::Uuid,
    pub(crate) origin_sketch_id: uuid::Uuid,
    pub(super) contours: Vec<Vec<SketchVisualizationPoint>>,
}

impl ResolvedSketchRegion {
    pub fn name(&self) -> &str {
        &self.name
    }
}

impl ExecOutcome {
    /// Capture a region before closing its engine session. KCL's local region
    /// paths copy the original curves and are not authoritative trimmed edges.
    pub async fn resolve_sketch_region(
        &self,
        ctx: &ExecutorContext,
        name: &str,
    ) -> Result<ResolvedSketchRegion, SketchVisualizationError> {
        let region = match self.variables.get(name) {
            Some(KclValueView::Sketch { value }) => value,
            Some(_) => return Err(SketchVisualizationError::NotARegion { name: name.to_owned() }),
            None => return Err(SketchVisualizationError::RegionNotFound { name: name.to_owned() }),
        };
        let origin_sketch_id = region
            .origin_sketch_id
            .ok_or_else(|| SketchVisualizationError::NotARegion { name: name.to_owned() })?;
        let OkModelingCmdResponse::GetEntityType(entity) = query(
            ctx,
            cmds::GetEntityType::builder().entity_id(region.id).build().into(),
            name,
        )
        .await?
        else {
            return Err(invalid_boundary(name));
        };
        let polylines = if matches!(
            entity.entity_type,
            cmds::shared::EntityType::Object | cmds::shared::EntityType::Region | cmds::shared::EntityType::Solid2D
        ) {
            // Current regions own real child curves, not a Path. KCL's local
            // region mappings can include obsolete IDs, so query the engine.
            region_object_curves(ctx, region, name).await?
        } else {
            let response = ctx
                .engine
                .send_modeling_cmd(
                    &ctx.engine_batch,
                    uuid::Uuid::new_v4(),
                    Default::default(),
                    &ModelingCmd::from(SketchGetInfo::builder().path_id(region.id.into()).build()),
                )
                .await?;
            let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::SketchGetInfo(info),
            } = response
            else {
                return Err(invalid_boundary(name));
            };
            let expected_ids = region
                .paths
                .iter()
                .chain(&region.inner_paths)
                .map(|path| path.get_id())
                .collect::<BTreeSet<_>>();
            let actual_ids = info
                .curves
                .iter()
                .map(|curve| uuid::Uuid::from(curve.id))
                .collect::<BTreeSet<_>>();
            // The debug API must not silently omit unsupported curves, or a partial
            // contour could incorrectly shade an area that the engine did not select.
            if expected_ids.is_empty() || expected_ids != actual_ids || actual_ids.len() != info.curves.len() {
                return Err(invalid_boundary(name));
            }
            info.curves
                .iter()
                .map(|curve| sample_region_curve(curve).ok_or_else(|| invalid_boundary(name)))
                .collect::<Result<Vec<_>, _>>()?
        };
        let mut contours = closed_contours(polylines).ok_or_else(|| invalid_boundary(name))?;
        // Engine curves use millimeters; frontend points use the sketch's
        // module length unit. Keep the fill in the same space as its strokes.
        let scale = crate::execution::types::adjust_length(kcl_api::UnitLength::Millimeters, 1.0, region.units).0;
        for point in contours.iter_mut().flatten() {
            point.x *= scale;
            point.y *= scale;
        }
        Ok(ResolvedSketchRegion {
            name: name.to_owned(),
            id: region.id,
            origin_sketch_id,
            contours,
        })
    }
}

async fn query(
    ctx: &ExecutorContext,
    command: ModelingCmd,
    name: &str,
) -> Result<OkModelingCmdResponse, SketchVisualizationError> {
    match ctx
        .engine
        .send_modeling_cmd(&ctx.engine_batch, uuid::Uuid::new_v4(), Default::default(), &command)
        .await?
    {
        OkWebSocketResponseData::Modeling { modeling_response } => Ok(modeling_response),
        _ => Err(invalid_boundary(name)),
    }
}

async fn region_object_curves(
    ctx: &ExecutorContext,
    region: &crate::execution::Sketch,
    name: &str,
) -> Result<Vec<Vec<SketchVisualizationPoint>>, SketchVisualizationError> {
    let OkModelingCmdResponse::EntityGetAllChildUuids(children) = query(
        ctx,
        cmds::EntityGetAllChildUuids::builder()
            .entity_id(region.id)
            .build()
            .into(),
        name,
    )
    .await?
    else {
        return Err(invalid_boundary(name));
    };
    let mut curves = Vec::new();
    let mut controls = Vec::new();
    let ids = children
        .entity_ids
        .into_iter()
        .chain(region.inner_paths.iter().map(|path| path.get_id()))
        .collect::<BTreeSet<_>>();
    for id in ids {
        let OkModelingCmdResponse::GetEntityType(entity) =
            query(ctx, cmds::GetEntityType::builder().entity_id(id).build().into(), name).await?
        else {
            return Err(invalid_boundary(name));
        };
        match entity.entity_type {
            cmds::shared::EntityType::Vertex | cmds::shared::EntityType::Face => continue,
            cmds::shared::EntityType::Curve => {}
            _ => return Err(invalid_boundary(name)),
        }
        let OkModelingCmdResponse::CurveGetType(kind) =
            query(ctx, cmds::CurveGetType::builder().curve_id(id).build().into(), name).await?
        else {
            return Err(invalid_boundary(name));
        };
        if !matches!(
            kind.curve_type,
            cmds::shared::CurveType::Line | cmds::shared::CurveType::Arc
        ) {
            return Err(invalid_boundary(name));
        }
        let OkModelingCmdResponse::CurveGetControlPoints(points) = query(
            ctx,
            cmds::CurveGetControlPoints::builder().curve_id(id).build().into(),
            name,
        )
        .await?
        else {
            return Err(invalid_boundary(name));
        };
        curves.push((kind.curve_type, points.control_points.len()));
        controls.extend(points.control_points);
    }
    if controls.is_empty() {
        return Err(invalid_boundary(name));
    }
    // These path control points are already sketch-local, even when the
    // sketch is on XZ/a rotated plane. Projecting them again would flatten it.
    if controls
        .iter()
        .any(|p| !p.z.is_finite() || p.z.abs() > CONTACT_TOLERANCE)
    {
        return Err(invalid_boundary(name));
    }
    let points = controls
        .iter()
        .map(|p| SketchVisualizationPoint { x: p.x, y: p.y })
        .collect::<Vec<_>>();
    let mut offset = 0;
    curves
        .into_iter()
        .map(|(kind, count)| {
            let result =
                sample_controlled_curve(kind, &points[offset..offset + count]).ok_or_else(|| invalid_boundary(name));
            offset += count;
            result
        })
        .collect()
}

/// Engine circular curves use rational quadratic spans: endpoints at even
/// indices, tangent intersections at odd indices. Never treat the control
/// polygon itself as a boundary or assume a generic NURBS curve is circular.
fn sample_controlled_curve(
    kind: cmds::shared::CurveType,
    controls: &[SketchVisualizationPoint],
) -> Option<Vec<SketchVisualizationPoint>> {
    if controls.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
        return None;
    }
    if kind == cmds::shared::CurveType::Line {
        return (controls.len() == 2).then(|| controls.to_vec());
    }
    if kind != cmds::shared::CurveType::Arc || controls.len() < 3 || controls.len() % 2 != 1 {
        return None;
    }
    let start = controls[0];
    let end = *controls.last()?;
    let tangent = point_sub(controls[1], start);
    let normal = SketchVisualizationPoint {
        x: -tangent.y,
        y: tangent.x,
    };
    let chord = point_sub(controls[2], start);
    let denominator = 2.0 * (normal.x * chord.x + normal.y * chord.y);
    if denominator.abs() <= f64::EPSILON {
        return None;
    }
    let t = (chord.x * chord.x + chord.y * chord.y) / denominator;
    let center = SketchVisualizationPoint {
        x: start.x + t * normal.x,
        y: start.y + t * normal.y,
    };
    let radius = distance(start, center);
    if !radius.is_finite() || radius <= CONTACT_TOLERANCE {
        return None;
    }
    for span in controls.windows(3).step_by(2) {
        for p in [span[0], span[2]] {
            if (distance(p, center) - radius).abs() > 1e-6 * libm::fmax(radius, 1.0) {
                return None;
            }
            let radial = point_sub(p, center);
            let tangent = point_sub(span[1], p);
            if (radial.x * tangent.x + radial.y * tangent.y).abs()
                > 1e-6 * radius * libm::fmax(distance(span[1], p), 1.0)
            {
                return None;
            }
        }
    }
    let radial = point_sub(start, center);
    let mut points = sample_arc(center, start, end, radial.x * tangent.y - radial.y * tangent.x > 0.0);
    *points.first_mut()? = start;
    *points.last_mut()? = end;
    Some(points)
}

fn point_sub(a: SketchVisualizationPoint, b: SketchVisualizationPoint) -> SketchVisualizationPoint {
    SketchVisualizationPoint {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}

fn invalid_boundary(name: &str) -> SketchVisualizationError {
    SketchVisualizationError::RegionBoundaryNotFound {
        region_name: name.to_owned(),
    }
}

fn sample_region_curve(curve: &CurveDebug) -> Option<Vec<SketchVisualizationPoint>> {
    let point = |p: kittycad_modeling_cmds::shared::Point2d<f64>| SketchVisualizationPoint { x: p.x, y: p.y };
    let start = point(curve.start?);
    let mut points = match curve.segment_type {
        CurveTypeDebug::Line => vec![start, point(curve.end?)],
        CurveTypeDebug::Circle => {
            let center = point(curve.center?);
            sample_circle(center, distance(start, center))
        }
        CurveTypeDebug::ThreePointArc => {
            let end = point(curve.end?);
            let mid = point(curve.mid?);
            // SketchGetInfo can omit the center for trimmed three-point arcs.
            let center = curve
                .center
                .map(point)
                .or_else(|| center_through_points(start, mid, end))?;
            // Use the engine's on-arc midpoint, not the original segment's
            // direction: trimming can reverse traversal or choose the other arc.
            let cross = (mid.x - start.x) * (end.y - mid.y) - (mid.y - start.y) * (end.x - mid.x);
            if cross.abs() <= f64::EPSILON {
                return None;
            }
            let mut points = sample_arc(center, start, end, cross > 0.0);
            *points.first_mut()? = start;
            *points.last_mut()? = end;
            points
        }
    };
    if points.iter().any(|point| !point.x.is_finite() || !point.y.is_finite()) {
        return None;
    }
    if matches!(curve.segment_type, CurveTypeDebug::Circle) {
        *points.last_mut()? = *points.first()?;
    }
    Some(points)
}

fn center_through_points(
    start: SketchVisualizationPoint,
    mid: SketchVisualizationPoint,
    end: SketchVisualizationPoint,
) -> Option<SketchVisualizationPoint> {
    let a = point_sub(mid, start);
    let b = point_sub(end, start);
    let d = 2.0 * (a.x * b.y - a.y * b.x);
    if d.abs() <= f64::EPSILON {
        return None;
    }
    let aa = a.x * a.x + a.y * a.y;
    let bb = b.x * b.x + b.y * b.y;
    Some(SketchVisualizationPoint {
        x: start.x + (b.y * aa - a.y * bb) / d,
        y: start.y + (a.x * bb - b.x * aa) / d,
    })
}

/// Assemble all loops without inventing closing chords. Even-odd filling later
/// preserves holes without relying on the engine's contour ordering or winding.
fn closed_contours(mut polylines: Vec<Vec<SketchVisualizationPoint>>) -> Option<Vec<Vec<SketchVisualizationPoint>>> {
    let mut contours = Vec::new();
    while let Some(mut contour) = polylines.pop() {
        let start = *contour.first()?;
        while distance(*contour.last()?, start) > CONTACT_TOLERANCE {
            let end = *contour.last()?;
            let matches = polylines
                .iter()
                .enumerate()
                .filter_map(|(index, line)| {
                    if distance(end, *line.first()?) <= CONTACT_TOLERANCE {
                        Some((index, false))
                    } else if distance(end, *line.last()?) <= CONTACT_TOLERANCE {
                        Some((index, true))
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            let [(index, reverse)] = matches.as_slice() else {
                return None;
            };
            let mut next = polylines.remove(*index);
            if *reverse {
                next.reverse();
            }
            contour.extend(next.into_iter().skip(1));
        }
        if contour.len() < 4 {
            return None;
        }
        *contour.last_mut()? = start;
        contours.push(contour);
    }
    (!contours.is_empty()).then_some(contours)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(x: f64, y: f64) -> SketchVisualizationPoint {
        SketchVisualizationPoint { x, y }
    }

    #[test]
    fn samples_circular_controls_but_rejects_unsupported_shapes() {
        let controls = [point(1.0, 0.0), point(1.0, 1.0), point(0.0, 1.0)];
        let arc = sample_controlled_curve(cmds::shared::CurveType::Arc, &controls).unwrap();
        assert_eq!(arc.first(), controls.first());
        assert_eq!(arc.last(), controls.last());
        assert!(arc.iter().all(|p| (libm::hypot(p.x, p.y) - 1.0).abs() < 1e-9));
        assert!(sample_controlled_curve(cmds::shared::CurveType::Nurbs, &controls).is_none());
        let noncircular = [point(1.0, 0.0), point(1.0, 1.0), point(0.0, 2.0)];
        assert!(sample_controlled_curve(cmds::shared::CurveType::Arc, &noncircular).is_none());
        assert!(sample_controlled_curve(cmds::shared::CurveType::Line, &controls).is_none());
    }

    #[test]
    fn assembles_reversed_edges_without_closing_gaps_or_branches() {
        let edges = vec![
            vec![point(0.0, 0.0), point(2.0, 0.0)],
            vec![point(0.0, 2.0), point(2.0, 0.0)],
            vec![point(0.0, 2.0), point(0.0, 0.0)],
        ];
        assert_eq!(closed_contours(edges.clone()).unwrap()[0].len(), 4);
        assert!(closed_contours(edges[..2].to_vec()).is_none());
        let mut branched = edges;
        branched.push(vec![point(0.0, 0.0), point(-1.0, -1.0)]);
        assert!(closed_contours(branched).is_none());
    }

    #[test]
    fn arc_midpoint_selects_minor_or_major_sweep() {
        let mut curve = CurveDebug {
            id: uuid::Uuid::nil().into(),
            segment_type: CurveTypeDebug::ThreePointArc,
            start: Some([1.0, 0.0].into()),
            end: Some([0.0, 1.0].into()),
            center: Some([0.0, 0.0].into()),
            mid: Some([0.5f64.sqrt(), 0.5f64.sqrt()].into()),
        };
        let minor = sample_region_curve(&curve).unwrap();
        assert!(minor.iter().all(|p| p.x >= -1e-9 && p.y >= -1e-9));
        curve.center = None;
        let without_center = sample_region_curve(&curve).unwrap();
        assert!(without_center.iter().zip(&minor).all(|(a, b)| distance(*a, *b) < 1e-9));
        curve.mid = Some([-0.5f64.sqrt(), -0.5f64.sqrt()].into());
        let major = sample_region_curve(&curve).unwrap();
        assert!(major.iter().any(|p| p.x < -0.9));
        assert!(major.iter().any(|p| p.y < -0.9));
        curve.mid = None;
        assert!(sample_region_curve(&curve).is_none());
        curve.start = Some([f64::NAN, 0.0].into());
        assert!(sample_region_curve(&curve).is_none());
    }
}
