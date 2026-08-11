//! Standard library functions for named views.

use kcl_api::UnitLength;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::CameraView;
use crate::execution::CameraViewError;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::Orientation;
use crate::execution::Point3d;
use crate::execution::Projection;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
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

    let view = CameraView::oriented(
        orientation,
        target.map(millimeter_point),
        distance.map(millimeter_length),
        projection,
        vec![args.source_range.into()],
    )
    .map_err(|err| view_error(err, &args))?;
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

    let view = CameraView::directed(
        unitless_direction(direction),
        up.map(unitless_direction),
        target.map(millimeter_point),
        distance.map(millimeter_length),
        projection,
        vec![args.source_range.into()],
    )
    .map_err(|err| view_error(err, &args))?;
    Ok(KclValue::CameraView { value: Box::new(view) })
}

/// Reports a rejected constructor input at the source range of the call that
/// supplied it. The error's `Display` text is the whole message; the range is
/// what tells the author which call to look at.
fn view_error(err: CameraViewError, args: &Args) -> KclError {
    KclError::new_semantic(KclErrorDetails::new(err.to_string(), vec![args.source_range]))
}

// Every length a `CameraView` stores is converted to millimeters here, at the
// boundary where the author's units are still known. A stored view is read by
// more than one consumer -- the modeling app and STEP export -- and some of
// those values become engine commands, which are in millimeters. Storing one
// canonical unit means no consumer has to share a conversion convention with
// the others; a consumer that reads the number and ignores the unit tag still
// gets the right camera.
//
// These conversions are written here rather than through the shared
// `FromKclValue for Point3d` impl (`std/args.rs`), which is deliberate. That
// impl reconciles the three coordinate types with `NumericType::combine_eq_array`
// and keeps the values as written, so a genuinely mixed-unit point such as
// `[1inch, 25.4mm, 0]` is stored as the numbers 1, 25.4, 0 with no units at
// all -- a different point from the one the author wrote. Converting each
// coordinate individually, as below, is correct for that case.

/// Converts a coerced point argument to a point in millimeters.
fn millimeter_point([x, y, z]: [TyF64; 3]) -> Point3d {
    Point3d {
        x: x.to_mm(),
        y: y.to_mm(),
        z: z.to_mm(),
        units: Some(UnitLength::Millimeters),
    }
}

/// Converts a coerced length argument to a length in millimeters.
fn millimeter_length(length: TyF64) -> TyF64 {
    TyF64::new(length.to_mm(), NumericType::mm())
}

/// Converts a coerced point argument to a unitless direction vector. Each
/// coordinate is read in millimeters first, so the coordinates of a
/// mixed-unit vector such as `[1inch, 25.4mm, 0]` are on a common scale and
/// the vector points where the author wrote it. The magnitude is discarded by
/// normalization in the constructor, so the choice of millimeters here only
/// has to be consistent across the three coordinates.
fn unitless_direction([x, y, z]: [TyF64; 3]) -> Point3d {
    Point3d {
        x: x.to_mm(),
        y: y.to_mm(),
        z: z.to_mm(),
        units: None,
    }
}

#[cfg(test)]
mod tests {
    use crate::execution::parse_execute;

    /// Runs `code` with the experimental opt-in these functions require, and
    /// returns the message it fails with. Panics if the program succeeds.
    ///
    /// These cases run against the mock engine rather than as simulation
    /// tests: rejected arguments never reach the engine
    /// Two simulation tests remain, one per constructor
    /// (`named_views_directed_zero_direction` and
    /// `named_views_negative_distance`), which pin the rendered diagnostic
    /// with its source range.
    async fn execution_error(code: &str) -> String {
        let program = format!("@settings(experimentalFeatures = allow)\n{code}");
        match parse_execute(&program).await {
            Ok(_) => panic!("expected `{code}` to be rejected, but it executed"),
            Err(err) => err.message().to_owned(),
        }
    }

    /// Every rejected argument reports which argument to change. Each case
    /// pairs the offending call with the message the author sees.
    #[tokio::test(flavor = "multi_thread")]
    async fn rejected_arguments_report_their_reason() {
        // `1 / 0` is how a KCL program reaches a non-finite value.
        assert_eq!(
            execution_error("v = view::directed([1 / 0, 0, 0])").await,
            "`direction` must have finite coordinates."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 1, 0], up = [0, 0, 1 / 0])").await,
            "`up` must have finite coordinates."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 1, 0], target = [1 / 0, 0, 0])").await,
            "`target` must have finite coordinates."
        );
        assert_eq!(
            execution_error("v = view::oriented(view::Orientation::Front, target = [0, 1 / 0, 0])").await,
            "`target` must have finite coordinates."
        );
        assert_eq!(
            execution_error("v = view::oriented(view::Orientation::Front, distance = 1 / 0)").await,
            "`distance` must be a finite number."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 1, 0], distance = 0)").await,
            "`distance` must be greater than zero."
        );
        assert_eq!(
            execution_error("v = view::oriented(view::Orientation::Front, distance = -50)").await,
            "`distance` must be greater than zero."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 0, 0])").await,
            "`direction` must be a non-zero vector."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 1, 0], up = [0, 0, 0])").await,
            "`up` must be a non-zero vector."
        );
        assert_eq!(
            execution_error("v = view::directed([0, 0, 1])").await,
            "`direction` and `up` must not be parallel or nearly parallel."
        );
    }

    /// The opaque `std::view` types resolve where a signature names them.
    /// Resolution happens when the declaration executes, so executing these
    /// declarations is the whole assertion; neither function is called.
    ///
    /// Type annotations parse only as bare identifiers, so the namespaced
    /// spelling `view::CameraView` cannot appear in a signature and an
    /// explicit import is the only route to these types from user code.
    #[tokio::test(flavor = "multi_thread")]
    async fn opaque_types_resolve_in_signatures() {
        let code = r#"@settings(experimentalFeatures = allow)
import CameraView, NamedView from "std::view"

fn acceptsCamera(@camera: CameraView) {
  return 0
}

fn passesNamed(@input: NamedView): NamedView {
  return input
}
"#;
        if let Err(err) = parse_execute(code).await {
            panic!("expected the declarations to resolve, but got: {}", err.message());
        }
    }
}
