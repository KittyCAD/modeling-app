//! Functions related to line segments.

use anyhow::Result;
use kittycad_modeling_cmds::shared::Angle;

use super::utils::untype_point;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Sketch;
use crate::execution::TagIdentifier;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;
use crate::std::utils::between;

/// Returns the point at the end of the given segment.
pub async fn segment_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let pt = inner_segment_end(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty)
}

fn inner_segment_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;
    let (p, ty) = path.end_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment end of x.
pub async fn segment_end_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_end_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_end_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(TyF64::new(
        path.get_base().to[0],
        NumericType::length(path.get_base().units),
    ))
}

/// Returns the segment end of y.
pub async fn segment_end_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_end_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_end_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_to()[1].clone())
}

/// Returns the point at the start of the given segment.
pub async fn segment_start(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let pt = inner_segment_start(&tag, exec_state, args.clone())?;

    args.make_kcl_val_from_point([pt[0].n, pt[1].n], pt[0].ty)
}

fn inner_segment_start(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<[TyF64; 2], KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;
    let (p, ty) = path.start_point_components();
    // Docs generation isn't smart enough to handle ([f64; 2], NumericType).
    let point = [TyF64::new(p[0], ty), TyF64::new(p[1], ty)];

    Ok(point)
}

/// Returns the segment start of x.
pub async fn segment_start_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_start_x(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_start_x(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_from()[0].clone())
}

/// Returns the segment start of y.
pub async fn segment_start_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_start_y(&tag, exec_state, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_start_y(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    Ok(path.get_from()[1].clone())
}
/// Returns the last segment of x.
pub async fn last_segment_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_x(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_last_segment_x(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Expected a Sketch with at least one segment, found `{sketch:?}`"),
                vec![args.source_range],
            ))
        })?
        .get_base();

    Ok(TyF64::new(last_line.to[0], NumericType::length(last_line.units)))
}

/// Returns the last segment of y.
pub async fn last_segment_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketch = args.get_unlabeled_kw_arg("sketch", &RuntimeType::Primitive(PrimitiveType::Sketch), exec_state)?;
    let result = inner_last_segment_y(sketch, args.clone())?;

    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_last_segment_y(sketch: Sketch, args: Args) -> Result<TyF64, KclError> {
    let last_line = sketch
        .paths
        .last()
        .ok_or_else(|| {
            KclError::new_type(KclErrorDetails::new(
                format!("Expected a Sketch with at least one segment, found `{sketch:?}`"),
                vec![args.source_range],
            ))
        })?
        .get_base();

    Ok(TyF64::new(last_line.to[1], NumericType::length(last_line.units)))
}

/// Returns the length of the segment.
pub async fn segment_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;
    let result = inner_segment_length(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(result))
}

fn inner_segment_length(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<TyF64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    path.length().ok_or_else(|| {
        KclError::new_semantic(KclErrorDetails::new(
            "Computing the length of this segment type is unsupported".to_owned(),
            vec![args.source_range],
        ))
    })
}

/// Returns the angle of the segment.
pub async fn segment_angle(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;

    let result = inner_segment_angle(&tag, exec_state, args.clone())?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

fn inner_segment_angle(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    let result = between(path.get_base().from, path.get_base().to);

    Ok(result.to_degrees())
}

/// Returns the angle coming out of the end of the segment in degrees.
pub async fn tangent_to_end(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_unlabeled_kw_arg("tag", &RuntimeType::tagged_edge(), exec_state)?;

    let result = inner_tangent_to_end(&tag, exec_state, args.clone()).await?;
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::degrees())))
}

async fn inner_tangent_to_end(tag: &TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<f64, KclError> {
    let line = args.get_tag_engine_info(exec_state, tag)?;
    let path = line.path.clone().ok_or_else(|| {
        KclError::new_type(KclErrorDetails::new(
            format!("Expected a line segment with a path, found `{line:?}`"),
            vec![args.source_range],
        ))
    })?;

    let from = untype_point(path.get_to()).0;

    // Undocumented voodoo from get_tangential_arc_to_info
    let tangent_info = path.get_tangential_info();
    let tan_previous_point = tangent_info.tan_previous_point(from);

    // Calculate the end point from the angle and radius.
    // atan2 outputs radians.
    let previous_end_tangent = Angle::from_radians(libm::atan2(
        from[1] - tan_previous_point[1],
        from[0] - tan_previous_point[0],
    ));

    Ok(previous_end_tangent.to_degrees())
}

#[cfg(test)]
mod tests {
    use std::f64::consts::PI;

    use kcl_api::UnitLength;

    use crate::execution::parse_execute;
    use crate::execution::types::NumericType;
    use crate::execution::types::NumericTypeExt;
    use crate::std::args::TyF64;

    /// Runs `code` and returns the number called `len`.
    async fn seg_len_of(code: &str) -> TyF64 {
        let result = parse_execute(code).await.unwrap();
        result.variable("len").as_ty_f64().expect("`len` should be a number")
    }

    /// The KCL versions every test runs under.
    const VERSIONS: [&str; 2] = ["2.0", "3.0"];

    /// Draws a line along +X to [10, 0] and then `segment` (which must tag
    /// itself `$arc`), and checks `segLen(arc)` against `expected` for each
    /// case. The line gives the tangential arcs their starting direction.
    async fn assert_arc_lengths(cases: &[(&str, f64)]) {
        for version in VERSIONS {
            for (segment, expected) in cases {
                let code = format!(
                    "@settings(kclVersion = {version})
s = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> {segment}
len = segLen(arc)"
                );
                let len = seg_len_of(&code).await;
                assert!(
                    (len.n - expected).abs() < 1e-9,
                    "expected segLen(arc) = {expected}, got {} for:\n{code}",
                    len.n
                );
                assert_eq!(len.ty, NumericType::length(UnitLength::Millimeters), "{code}");
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_tangential_arc_by_angle_is_the_arc_length() {
        // Radius 10, so each arc is 10 * angle long.
        assert_arc_lengths(&[
            ("tangentialArc(angle = 90deg, radius = 10, tag = $arc)", 5.0 * PI),
            ("tangentialArc(angle = 180deg, radius = 10, tag = $arc)", 10.0 * PI),
            ("tangentialArc(angle = 225deg, radius = 10, tag = $arc)", 12.5 * PI),
            ("tangentialArc(angle = 270deg, radius = 10, tag = $arc)", 15.0 * PI),
            ("tangentialArc(angle = -90deg, radius = 10, tag = $arc)", 5.0 * PI),
            ("tangentialArc(angle = -180deg, radius = 10, tag = $arc)", 10.0 * PI),
            ("tangentialArc(angle = -225deg, radius = 10, tag = $arc)", 12.5 * PI),
            ("tangentialArc(angle = -270deg, radius = 10, tag = $arc)", 15.0 * PI),
        ])
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_tangential_arc_to_point_is_the_arc_length() {
        // Leaving [10, 0] along +X, these end points all sit on a circle of
        // radius 10 centered at [10, 10] (turning left) or [10, -10] (turning
        // right).
        assert_arc_lengths(&[
            ("tangentialArc(end = [10, 10], tag = $arc)", 5.0 * PI),
            ("tangentialArc(end = [0, 20], tag = $arc)", 10.0 * PI),
            (
                "tangentialArc(end = [-7.0710678118654755, 17.071067811865476], tag = $arc)",
                12.5 * PI,
            ),
            ("tangentialArc(end = [-10, 10], tag = $arc)", 15.0 * PI),
            ("tangentialArc(end = [10, -10], tag = $arc)", 5.0 * PI),
            ("tangentialArc(end = [0, -20], tag = $arc)", 10.0 * PI),
            (
                "tangentialArc(end = [-7.0710678118654755, -17.071067811865476], tag = $arc)",
                12.5 * PI,
            ),
            ("tangentialArc(end = [-10, -10], tag = $arc)", 15.0 * PI),
        ])
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_arc_by_angles_is_the_arc_length() {
        // Radius 5, so each arc is 5 * swept angle long.
        assert_arc_lengths(&[
            (
                "arc(angleStart = 0, angleEnd = 90deg, radius = 5, tag = $arc)",
                2.5 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = 180deg, radius = 5, tag = $arc)",
                5.0 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = 225deg, radius = 5, tag = $arc)",
                6.25 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = 270deg, radius = 5, tag = $arc)",
                7.5 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = -90deg, radius = 5, tag = $arc)",
                2.5 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = -180deg, radius = 5, tag = $arc)",
                5.0 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = -225deg, radius = 5, tag = $arc)",
                6.25 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = -270deg, radius = 5, tag = $arc)",
                7.5 * PI,
            ),
            // Start and end angles 360 degrees apart draw a full circle.
            (
                "arc(angleStart = 0, angleEnd = 360deg, radius = 5, tag = $arc)",
                10.0 * PI,
            ),
            (
                "arc(angleStart = 0, angleEnd = -360deg, radius = 5, tag = $arc)",
                10.0 * PI,
            ),
        ])
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_arc_through_three_points_is_the_arc_length() {
        // Every arc starts at [10, 0] on a circle of radius 5 centered at
        // [5, 0]; the interior point picks the direction.
        assert_arc_lengths(&[
            (
                "arc(interiorAbsolute = [8.535533905932738, 3.5355339059327373], endAbsolute = [5, 5], tag = $arc)",
                2.5 * PI,
            ),
            ("arc(interiorAbsolute = [5, 5], endAbsolute = [0, 0], tag = $arc)", 5.0 * PI),
            (
                "arc(interiorAbsolute = [3.086582838174551, 4.619397662556434], endAbsolute = [1.4644660940672627, -3.5355339059327373], tag = $arc)",
                6.25 * PI,
            ),
            (
                "arc(interiorAbsolute = [1.4644660940672627, 3.5355339059327373], endAbsolute = [5, -5], tag = $arc)",
                7.5 * PI,
            ),
            (
                "arc(interiorAbsolute = [8.535533905932738, -3.5355339059327373], endAbsolute = [5, -5], tag = $arc)",
                2.5 * PI,
            ),
            ("arc(interiorAbsolute = [5, -5], endAbsolute = [0, 0], tag = $arc)", 5.0 * PI),
            (
                "arc(interiorAbsolute = [3.086582838174551, -4.619397662556434], endAbsolute = [1.4644660940672627, 3.5355339059327373], tag = $arc)",
                6.25 * PI,
            ),
            (
                "arc(interiorAbsolute = [1.4644660940672627, -3.5355339059327373], endAbsolute = [5, 5], tag = $arc)",
                7.5 * PI,
            ),
        ])
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_a_circle_is_its_circumference() {
        for version in VERSIONS {
            // p1, p2 and p3 lie on a circle of radius 5 * sqrt(2) centered at [5, 5].
            let three_point = seg_len_of(&format!(
                "@settings(kclVersion = {version})
c = startSketchOn(XY)
  |> circleThreePoint(p1 = [0, 0], p2 = [10, 0], p3 = [0, 10], tag = $circ)
len = segLen(circ)"
            ))
            .await;
            assert!(
                (three_point.n - 10.0 * PI * 2f64.sqrt()).abs() < 1e-9,
                "got {} in KCL {version}",
                three_point.n
            );

            let by_radius = seg_len_of(&format!(
                "@settings(kclVersion = {version})
c = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 5, tag = $circ)
len = segLen(circ)"
            ))
            .await;
            assert!(
                (by_radius.n - 10.0 * PI).abs() < 1e-9,
                "got {} in KCL {version}",
                by_radius.n
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_an_arc_keeps_the_sketch_units() {
        // A quarter turn of radius 10in is 5 * pi inches, however the radius
        // was written.
        for version in VERSIONS {
            for radius in ["10", "254mm"] {
                let code = format!(
                    "@settings(kclVersion = {version}, defaultLengthUnit = in)
s = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(angle = 90deg, radius = {radius}, tag = $arc)
len = segLen(arc)"
                );
                let len = seg_len_of(&code).await;
                assert!((len.n - 5.0 * PI).abs() < 1e-9, "got {} for:\n{code}", len.n);
                assert_eq!(len.ty, NumericType::length(UnitLength::Inches), "{code}");
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn seg_len_of_a_tiny_arc_is_the_same_in_mm_and_m_files() {
        // The same tiny arc, written in a mm file and in a m file. Its ends are
        // about 1.7e-7 mm apart. That is more than the "same point" tolerance
        // (about 2.3e-10 mm), so it is not a full circle in either file.
        // Radius 1000mm, angle 1e-8 degrees.
        let expected_mm = 1000.0 * 1e-8_f64.to_radians();
        for version in VERSIONS {
            for (unit, unit_length, line, radius, to_mm) in [
                ("mm", UnitLength::Millimeters, 10000, 1000, 1.0),
                ("m", UnitLength::Meters, 10, 1, 1000.0),
            ] {
                let code = format!(
                    "@settings(kclVersion = {version}, defaultLengthUnit = {unit})
s = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [{line}, 0])
  |> tangentialArc(angle = 0.00000001deg, radius = {radius}, tag = $arc)
len = segLen(arc)"
                );
                let len = seg_len_of(&code).await;
                assert_eq!(len.ty, NumericType::length(unit_length), "{code}");
                let got_mm = len.n * to_mm;
                assert!(
                    (got_mm - expected_mm).abs() < 1e-3 * expected_mm,
                    "expected {expected_mm}mm, got {got_mm}mm for:\n{code}"
                );
            }
        }
    }
}
