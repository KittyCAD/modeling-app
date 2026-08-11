//! Standard library functions for named views.

use kcl_api::UnitLength;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::CameraView;
use crate::execution::DirectedViewError;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Orientation;
use crate::execution::Point3d;
use crate::execution::Projection;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

/// Create a camera view that looks at the model from a standard orientation.
pub async fn oriented(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // The declared KCL signature has already coerced every argument, so the
    // runtime types passed here only convert, they do not validate.
    let orientation: Orientation = args.get_unlabeled_kw_arg("orientation", &RuntimeType::any(), exec_state)?;
    let target: Option<[TyF64; 3]> = args.get_kw_arg_opt("target", &RuntimeType::point3d(), exec_state)?;
    let distance: Option<TyF64> = args.get_kw_arg_opt("distance", &RuntimeType::length(), exec_state)?;
    let projection: Option<Projection> = args.get_kw_arg_opt("projection", &RuntimeType::any(), exec_state)?;

    let target = target.map(|[x, y, z]| Point3d {
        x: x.to_mm(),
        y: y.to_mm(),
        z: z.to_mm(),
        units: Some(UnitLength::Millimeters),
    });

    let view = CameraView::oriented(
        orientation,
        target,
        distance,
        projection,
        vec![args.source_range.into()],
    );
    Ok(KclValue::CameraView { value: Box::new(view) })
}

/// Create a camera view that looks along a custom direction.
pub async fn directed(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // The declared KCL signature has already coerced every argument, so the
    // runtime types passed here only convert, they do not validate.
    let direction: [TyF64; 3] = args.get_unlabeled_kw_arg("direction", &RuntimeType::point3d(), exec_state)?;
    let up: Option<[TyF64; 3]> = args.get_kw_arg_opt("up", &RuntimeType::point3d(), exec_state)?;
    let target: Option<[TyF64; 3]> = args.get_kw_arg_opt("target", &RuntimeType::point3d(), exec_state)?;
    let distance: Option<TyF64> = args.get_kw_arg_opt("distance", &RuntimeType::length(), exec_state)?;
    let projection: Option<Projection> = args.get_kw_arg_opt("projection", &RuntimeType::any(), exec_state)?;

    let direction = unitless_direction(direction);
    let up = up.map(unitless_direction);
    let target = target.map(|[x, y, z]| Point3d {
        x: x.to_mm(),
        y: y.to_mm(),
        z: z.to_mm(),
        units: Some(UnitLength::Millimeters),
    });

    let view = CameraView::directed(
        direction,
        up,
        target,
        distance,
        projection,
        vec![args.source_range.into()],
    )
    .map_err(|err| {
        let message = match err {
            DirectedViewError::ZeroDirection => "`direction` must be a non-zero vector.",
            DirectedViewError::ZeroUp => "`up` must be a non-zero vector.",
            DirectedViewError::DirectionParallelToUp => "`direction` and `up` must not be parallel or nearly parallel.",
        };
        KclError::new_semantic(KclErrorDetails::new(message.to_owned(), vec![args.source_range]))
    })?;
    Ok(KclValue::CameraView { value: Box::new(view) })
}

/// Converts a coerced point argument to a unitless direction vector. Each
/// coordinate is read in millimeters first, so a mixed-unit vector such as
/// `[1inch, 25.4, 0]` points where the author wrote it.
fn unitless_direction([x, y, z]: [TyF64; 3]) -> Point3d {
    Point3d {
        x: x.to_mm(),
        y: y.to_mm(),
        z: z.to_mm(),
        units: None,
    }
}
