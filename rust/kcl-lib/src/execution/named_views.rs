//! Runtime values for named views: the camera intent that `std::view`
//! constructor functions produce.
//!
//! `CameraView` stores what the camera looks at and from which direction, not
//! a snapshot of engine camera state; absent fields are resolved by whichever
//! consumer activates the view. `Orientation` and `Projection` are Rust
//! mirrors of the KCL enums declared in `std/view.kcl`; the test
//! `kcl_enum_declarations_match_rust_mirrors` pins each pair of declarations
//! to the same variant list.

use serde::Serialize;

use crate::execution::Metadata;
use crate::execution::Point3d;
use crate::std::args::TyF64;

/// A standard camera orientation.
///
/// Rust mirror of the KCL enum `std::view::Orientation`. Serialized variant
/// names match the KCL spellings exactly.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
pub enum Orientation {
    Front,
    Back,
    Left,
    Right,
    Top,
    Bottom,
    Isometric,
}

impl Orientation {
    /// Returns the variant whose KCL declaration uses this name, or `None`
    /// for a name the mirror does not declare. The test
    /// `kcl_enum_declarations_match_rust_mirrors` keeps the two declarations
    /// aligned, so `None` for a genuine `std::view::Orientation` value
    /// indicates a bug, not bad user input.
    pub(crate) fn from_kcl_variant(name: &str) -> Option<Self> {
        match name {
            "Front" => Some(Orientation::Front),
            "Back" => Some(Orientation::Back),
            "Left" => Some(Orientation::Left),
            "Right" => Some(Orientation::Right),
            "Top" => Some(Orientation::Top),
            "Bottom" => Some(Orientation::Bottom),
            "Isometric" => Some(Orientation::Isometric),
            _ => None,
        }
    }
}

#[cfg(test)]
impl Orientation {
    /// Every variant, in the KCL declaration order. The sync test compares
    /// this list against the KCL declaration, so a variant missing here fails
    /// that test rather than silently narrowing the mirror.
    pub(crate) const ALL: [Orientation; 7] = [
        Orientation::Front,
        Orientation::Back,
        Orientation::Left,
        Orientation::Right,
        Orientation::Top,
        Orientation::Bottom,
        Orientation::Isometric,
    ];

    /// The variant's name as written in the KCL declaration.
    pub(crate) fn kcl_name(self) -> &'static str {
        match self {
            Orientation::Front => "Front",
            Orientation::Back => "Back",
            Orientation::Left => "Left",
            Orientation::Right => "Right",
            Orientation::Top => "Top",
            Orientation::Bottom => "Bottom",
            Orientation::Isometric => "Isometric",
        }
    }
}

/// A camera projection.
///
/// Rust mirror of the KCL enum `std::view::Projection`. Serialized variant
/// names match the KCL spellings exactly.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
pub enum Projection {
    Orthographic,
    Perspective,
}

impl Projection {
    /// Returns the variant whose KCL declaration uses this name, or `None`
    /// for a name the mirror does not declare. See
    /// [`Orientation::from_kcl_variant`].
    pub(crate) fn from_kcl_variant(name: &str) -> Option<Self> {
        match name {
            "Orthographic" => Some(Projection::Orthographic),
            "Perspective" => Some(Projection::Perspective),
            _ => None,
        }
    }
}

#[cfg(test)]
impl Projection {
    /// Every variant, in the KCL declaration order. See `Orientation::ALL`.
    pub(crate) const ALL: [Projection; 2] = [Projection::Orthographic, Projection::Perspective];

    /// The variant's name as written in the KCL declaration.
    pub(crate) fn kcl_name(self) -> &'static str {
        match self {
            Projection::Orthographic => "Orthographic",
            Projection::Perspective => "Perspective",
        }
    }
}

/// Where the camera looks from: one variant per constructor function, so a
/// value can never carry both a curated orientation and a custom direction.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
// Values of this enum are only reached through `Box<CameraView>`, so the size
// difference between the variants does not propagate into `KclValue`.
#[allow(clippy::large_enum_variant)]
pub enum CameraLook {
    /// A curated orientation, produced by `view::oriented`.
    Oriented { orientation: Orientation },
    /// A custom look direction, produced by `view::directed`. Both vectors
    /// are directions without units (`Point3d.units` is `None`) and both are
    /// normalized at construction.
    Directed { direction: Point3d, up: Point3d },
}

/// Minimum sine of the angle between `direction` and `up` accepted by
/// [`CameraView::directed`]. Below it, the camera basis vector
/// `direction x up` is too short to normalize reliably, and the engine's
/// look-at API has no tolerance parameter of its own, so this check is the
/// only guard in the chain. The threshold is fixed rather than an argument
/// so that whether a program executes does not vary per call site.
const MIN_DIRECTION_UP_ANGLE_SIN: f64 = 1e-6;

/// An input rejected by a [`CameraView`] constructor.
///
/// Each variant's `Display` text is the message the KCL author sees. The
/// value that caused the rejection is deliberately absent from it: the
/// std function attaches the call's source range, and miette renders the
/// offending call, which locates the argument without repeating it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub(crate) enum CameraViewError {
    /// A coordinate of `direction` is infinite or NaN.
    #[error("`direction` must have finite coordinates.")]
    NonFiniteDirection,
    /// A coordinate of `up` is infinite or NaN.
    #[error("`up` must have finite coordinates.")]
    NonFiniteUp,
    /// A coordinate of `target` is infinite or NaN.
    #[error("`target` must have finite coordinates.")]
    NonFiniteTarget,
    /// `distance` is infinite or NaN.
    #[error("`distance` must be a finite number.")]
    NonFiniteDistance,
    /// `distance` is zero or negative. Zero puts the camera on the point it
    /// looks at, leaving no direction to look along; a negative value puts it
    /// behind the target, which is not what the argument means.
    #[error("`distance` must be greater than zero.")]
    NonPositiveDistance,
    /// `direction` has length zero, so it does not name a direction.
    #[error("`direction` must be a non-zero vector.")]
    ZeroDirection,
    /// `up` has length zero, so it does not name a direction.
    #[error("`up` must be a non-zero vector.")]
    ZeroUp,
    /// `direction` and `up` are parallel or nearly parallel under
    /// [`MIN_DIRECTION_UP_ANGLE_SIN`], so they do not span the plane the
    /// camera basis is built from.
    #[error("`direction` and `up` must not be parallel or nearly parallel.")]
    DirectionParallelToUp,
}

/// Returns whether every coordinate of `p` is finite. An infinite or NaN
/// coordinate has no resolution rule a consumer could apply, so the
/// constructors reject it rather than storing it.
fn is_finite_point(p: &Point3d) -> bool {
    p.x.is_finite() && p.y.is_finite() && p.z.is_finite()
}

/// Validates the fields both constructors accept.
///
/// A `target` may hold any finite coordinates, including negative ones, since
/// it names a point in space. A `distance` must additionally be positive: it
/// is a separation, and no camera is a negative distance from what it looks
/// at. Finiteness is tested first, so a NaN distance reports as non-finite
/// rather than as non-positive.
fn check_shared_fields(target: Option<&Point3d>, distance: Option<&TyF64>) -> Result<(), CameraViewError> {
    if let Some(target) = target
        && !is_finite_point(target)
    {
        return Err(CameraViewError::NonFiniteTarget);
    }
    if let Some(distance) = distance {
        if !distance.n.is_finite() {
            return Err(CameraViewError::NonFiniteDistance);
        }
        // Also catches -0.0, which compares equal to 0.0.
        if distance.n <= 0.0 {
            return Err(CameraViewError::NonPositiveDistance);
        }
    }
    Ok(())
}

/// The Euclidean length of `v`, with the coordinates read as plain numbers.
fn norm(v: &Point3d) -> f64 {
    f64::sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
}

/// The cross product `a x b`, with the coordinates read as plain numbers.
/// The result is unitless; for unit vectors its length is the sine of the
/// angle between them.
fn cross(a: &Point3d, b: &Point3d) -> Point3d {
    Point3d {
        x: a.y * b.z - a.z * b.y,
        y: a.z * b.x - a.x * b.z,
        z: a.x * b.y - a.y * b.x,
        units: None,
    }
}

/// A camera viewpoint, stored as intent.
///
/// Fields the author omitted stay absent in the value: the consumer that
/// activates the view resolves them against the model it is showing, so the
/// same value is valid for any model. Construction goes through
/// [`CameraView::oriented`] and [`CameraView::directed`]; fields stay private
/// so a value cannot bypass the validation those constructors apply.
///
/// Every length is stored in millimeters, whatever unit the author wrote.
/// More than one consumer reads these values and some of them become engine
/// commands, which are in millimeters, so one canonical unit removes the
/// conversion convention those consumers would otherwise have to share.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CameraView {
    look: CameraLook,
    /// The point the camera looks at, in millimeters. `None` means: center on
    /// the bounds of the model at activation.
    target: Option<Point3d>,
    /// The distance from the camera to the target, in millimeters. `None`
    /// means: fit the model at activation.
    distance: Option<TyF64>,
    projection: Projection,
    #[serde(skip)]
    meta: Vec<Metadata>,
}

impl CameraView {
    /// Creates a camera view that looks at the model from a standard
    /// orientation. Every orientation, with any combination of the optional
    /// fields, is a valid view. A `projection` of `None` applies the
    /// orthographic default, so a file that never mentions projection renders
    /// identically in every consumer.
    ///
    /// Rejected inputs, each a distinct [`CameraViewError`] variant:
    /// - a `target` with an infinite or NaN coordinate;
    /// - an infinite or NaN `distance`.
    pub(crate) fn oriented(
        orientation: Orientation,
        target: Option<Point3d>,
        distance: Option<TyF64>,
        projection: Option<Projection>,
        meta: Vec<Metadata>,
    ) -> Result<Self, CameraViewError> {
        check_shared_fields(target.as_ref(), distance.as_ref())?;
        Ok(CameraView {
            look: CameraLook::Oriented { orientation },
            target,
            distance,
            projection: projection.unwrap_or(Projection::Orthographic),
            meta,
        })
    }

    /// Creates a camera view that looks along a custom direction.
    ///
    /// `direction` and `up` are stored as unit vectors; their magnitudes
    /// carry no information because zoom is `distance`. An `up` of `None`
    /// applies the world-Z default `[0, 0, 1]`. A `projection` of `None`
    /// applies the orthographic default, as in [`CameraView::oriented`].
    ///
    /// Rejected inputs, each a distinct [`CameraViewError`] variant:
    /// - a `direction` or `up` with an infinite or NaN coordinate;
    /// - a `target` with an infinite or NaN coordinate;
    /// - an infinite or NaN `distance`;
    /// - a `direction` of length zero;
    /// - an `up` of length zero;
    /// - a `direction` parallel or nearly parallel to `up`, under the fixed
    ///   threshold [`MIN_DIRECTION_UP_ANGLE_SIN`].
    ///
    /// Finiteness is checked before length, because normalizing an infinite
    /// vector yields NaN coordinates that would then pass both the
    /// zero-length and the parallelism check.
    pub(crate) fn directed(
        direction: Point3d,
        up: Option<Point3d>,
        target: Option<Point3d>,
        distance: Option<TyF64>,
        projection: Option<Projection>,
        meta: Vec<Metadata>,
    ) -> Result<Self, CameraViewError> {
        let up = up.unwrap_or(Point3d {
            x: 0.0,
            y: 0.0,
            z: 1.0,
            units: None,
        });
        if !is_finite_point(&direction) {
            return Err(CameraViewError::NonFiniteDirection);
        }
        if !is_finite_point(&up) {
            return Err(CameraViewError::NonFiniteUp);
        }
        check_shared_fields(target.as_ref(), distance.as_ref())?;
        if norm(&direction) == 0.0 {
            return Err(CameraViewError::ZeroDirection);
        }
        if norm(&up) == 0.0 {
            return Err(CameraViewError::ZeroUp);
        }
        let direction = direction.normalize();
        let up = up.normalize();
        // For unit vectors, the length of the cross product is the sine of
        // the angle between them.
        if norm(&cross(&direction, &up)) < MIN_DIRECTION_UP_ANGLE_SIN {
            return Err(CameraViewError::DirectionParallelToUp);
        }
        Ok(CameraView {
            look: CameraLook::Directed { direction, up },
            target,
            distance,
            projection: projection.unwrap_or(Projection::Orthographic),
            meta,
        })
    }

    /// Where the camera looks from.
    pub fn look(&self) -> &CameraLook {
        &self.look
    }

    /// The point the camera looks at, if the author fixed one.
    pub fn target(&self) -> Option<&Point3d> {
        self.target.as_ref()
    }

    /// The camera-to-target distance, if the author fixed one.
    pub fn distance(&self) -> Option<&TyF64> {
        self.distance.as_ref()
    }

    /// The camera projection.
    pub fn projection(&self) -> Projection {
        self.projection
    }

    /// The source metadata of the constructing call.
    pub fn meta(&self) -> &[Metadata] {
        &self.meta
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::docs::kcl_doc::DocData;
    use crate::docs::kcl_doc::walk_prelude;

    /// Returns the variant names of the named KCL enum in `std::view`,
    /// in declaration order.
    fn kcl_variant_names(type_name: &str) -> Vec<String> {
        let std_docs = walk_prelude();
        let Some(DocData::Ty(ty)) = std_docs.find_by_name(type_name) else {
            panic!("std::view::{type_name} is not a documented type");
        };
        ty.variants.iter().map(|v| v.name.clone()).collect()
    }

    /// The Rust enums in this module and the KCL enums in `std/view.kcl` must
    /// declare the same variants in the same order. Adding a variant on either
    /// side without the other fails here instead of at runtime.
    #[test]
    fn kcl_enum_declarations_match_rust_mirrors() {
        let rust_orientation: Vec<&str> = Orientation::ALL.iter().map(|v| v.kcl_name()).collect();
        assert_eq!(kcl_variant_names("Orientation"), rust_orientation);

        let rust_projection: Vec<&str> = Projection::ALL.iter().map(|v| v.kcl_name()).collect();
        assert_eq!(kcl_variant_names("Projection"), rust_projection);
    }

    /// `from_kcl_variant` and `kcl_name` are two hand-written mappings over
    /// the same variants; this pins them as inverses.
    #[test]
    fn variant_name_mappings_are_inverses() {
        for v in Orientation::ALL {
            assert_eq!(Orientation::from_kcl_variant(v.kcl_name()), Some(v));
        }
        for v in Projection::ALL {
            assert_eq!(Projection::from_kcl_variant(v.kcl_name()), Some(v));
        }
    }

    /// A unitless vector, as `CameraView::directed` receives them.
    fn dir(x: f64, y: f64, z: f64) -> Point3d {
        Point3d { x, y, z, units: None }
    }

    /// A length in millimeters, as both constructors receive `distance`.
    fn mm(n: f64) -> TyF64 {
        use crate::execution::types::NumericTypeExt;
        TyF64::new(n, crate::execution::types::NumericType::mm())
    }

    /// Asserts that `directed` rejects these vectors with `expected`, with
    /// every other argument absent. `#[track_caller]` reports the failing
    /// case's own line, so each case below reads as its own test.
    #[track_caller]
    fn directed_rejects(direction: Point3d, up: Option<Point3d>, expected: CameraViewError) {
        let actual = CameraView::directed(direction, up, None, None, None, vec![]).unwrap_err();
        assert_eq!(actual, expected);
    }

    /// Asserts that `directed` accepts these vectors.
    #[track_caller]
    fn directed_accepts(direction: Point3d, up: Option<Point3d>) {
        CameraView::directed(direction, up, None, None, None, vec![]).unwrap();
    }

    /// Asserts that both constructors treat this `target` and `distance`
    /// identically, since they share one validation path. The `directed` call
    /// passes a direction known to be valid, so only the shared fields decide
    /// the outcome.
    #[track_caller]
    fn both_constructors_agree(target: Option<Point3d>, distance: Option<TyF64>, expected: Option<CameraViewError>) {
        let from_oriented = CameraView::oriented(Orientation::Front, target, distance.clone(), None, vec![]).err();
        let from_directed = CameraView::directed(dir(0.0, 1.0, 0.0), None, target, distance, None, vec![]).err();
        assert_eq!(from_oriented, expected);
        assert_eq!(from_directed, expected);
    }

    /// A non-finite coordinate is rejected whichever vector and whichever axis
    /// carries it, for every non-finite value KCL arithmetic can produce
    /// (`1 / 0` yields an infinity, and arithmetic on infinities yields NaN).
    ///
    /// Without these checks, normalizing an infinity produces NaN coordinates
    /// that pass both the zero-length and the parallelism test, and the view
    /// is stored with a NaN direction no consumer can resolve.
    #[test]
    fn directed_rejects_non_finite_vectors() {
        use CameraViewError::NonFiniteDirection as BadDir;
        use CameraViewError::NonFiniteUp as BadUp;
        let ok_dir = dir(0.0, 1.0, 0.0);

        directed_rejects(dir(f64::INFINITY, 0.0, 1.0), None, BadDir);
        directed_rejects(dir(0.0, f64::INFINITY, 1.0), None, BadDir);
        directed_rejects(dir(1.0, 0.0, f64::INFINITY), None, BadDir);
        directed_rejects(dir(f64::NEG_INFINITY, 0.0, 1.0), None, BadDir);
        directed_rejects(dir(0.0, f64::NEG_INFINITY, 1.0), None, BadDir);
        directed_rejects(dir(1.0, 0.0, f64::NEG_INFINITY), None, BadDir);
        directed_rejects(dir(f64::NAN, 0.0, 1.0), None, BadDir);
        directed_rejects(dir(0.0, f64::NAN, 1.0), None, BadDir);
        directed_rejects(dir(1.0, 0.0, f64::NAN), None, BadDir);

        directed_rejects(ok_dir, Some(dir(f64::INFINITY, 0.0, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, f64::INFINITY, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, 0.0, f64::INFINITY)), BadUp);
        directed_rejects(ok_dir, Some(dir(f64::NEG_INFINITY, 0.0, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, f64::NEG_INFINITY, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, 0.0, f64::NEG_INFINITY)), BadUp);
        directed_rejects(ok_dir, Some(dir(f64::NAN, 0.0, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, f64::NAN, 1.0)), BadUp);
        directed_rejects(ok_dir, Some(dir(0.0, 0.0, f64::NAN)), BadUp);
    }

    /// `target` and `distance` are stored verbatim by both constructors, so
    /// both reject the same non-finite values and accept the same finite ones.
    #[test]
    fn both_constructors_agree_on_shared_fields() {
        use CameraViewError::NonFiniteDistance as BadDistance;
        use CameraViewError::NonFiniteTarget as BadTarget;
        use CameraViewError::NonPositiveDistance as NotPositive;

        both_constructors_agree(Some(dir(f64::INFINITY, 0.0, 0.0)), None, Some(BadTarget));
        both_constructors_agree(Some(dir(0.0, f64::NEG_INFINITY, 0.0)), None, Some(BadTarget));
        both_constructors_agree(Some(dir(0.0, 0.0, f64::NAN)), None, Some(BadTarget));
        both_constructors_agree(None, Some(mm(f64::INFINITY)), Some(BadDistance));
        both_constructors_agree(None, Some(mm(f64::NEG_INFINITY)), Some(BadDistance));
        both_constructors_agree(None, Some(mm(f64::NAN)), Some(BadDistance));

        // A distance is a separation, so it must be positive.
        both_constructors_agree(None, Some(mm(0.0)), Some(NotPositive));
        both_constructors_agree(None, Some(mm(-0.0)), Some(NotPositive));
        both_constructors_agree(None, Some(mm(-50.0)), Some(NotPositive));
        both_constructors_agree(None, Some(mm(f64::MIN_POSITIVE)), None);

        // A target names a point, so negative coordinates are ordinary.
        both_constructors_agree(Some(dir(-1.0, -2.0, -3.0)), None, None);
        both_constructors_agree(None, None, None);
        both_constructors_agree(Some(dir(1.0, 2.0, 3.0)), Some(mm(500.0)), None);
    }

    /// Finiteness is checked before length and parallelism, so an input that
    /// is both non-finite and degenerate reports the non-finite cause. The
    /// order matters: normalizing first would turn an infinity into NaN and
    /// report the wrong reason, or none at all.
    #[test]
    fn non_finite_is_reported_before_degeneracy() {
        // Non-finite and parallel to the default up [0, 0, 1].
        directed_rejects(dir(0.0, 0.0, f64::INFINITY), None, CameraViewError::NonFiniteDirection);
        // Non-finite up, with a direction that is itself zero-length.
        directed_rejects(
            dir(0.0, 0.0, 0.0),
            Some(dir(0.0, 0.0, f64::NAN)),
            CameraViewError::NonFiniteUp,
        );
        // A negative infinity is reported as non-finite rather than as
        // non-positive, even though it satisfies `<= 0`.
        both_constructors_agree(
            None,
            Some(mm(f64::NEG_INFINITY)),
            Some(CameraViewError::NonFiniteDistance),
        );
    }

    /// Each variant has its own message, so an error tells the author which
    /// argument to change.
    #[test]
    fn error_messages_are_distinct() {
        let all = [
            CameraViewError::NonFiniteDirection,
            CameraViewError::NonFiniteUp,
            CameraViewError::NonFiniteTarget,
            CameraViewError::NonFiniteDistance,
            CameraViewError::NonPositiveDistance,
            CameraViewError::ZeroDirection,
            CameraViewError::ZeroUp,
            CameraViewError::DirectionParallelToUp,
        ];
        let mut messages: Vec<String> = all.iter().map(|e| e.to_string()).collect();
        messages.sort_unstable();
        let count = messages.len();
        messages.dedup();
        assert_eq!(messages.len(), count, "every variant needs its own message");
    }

    /// Each degenerate input is rejected with its own error variant.
    #[test]
    fn directed_rejects_degenerate_vectors() {
        use CameraViewError::DirectionParallelToUp as Parallel;

        directed_rejects(dir(0.0, 0.0, 0.0), None, CameraViewError::ZeroDirection);
        directed_rejects(dir(1.0, 0.0, 0.0), Some(dir(0.0, 0.0, 0.0)), CameraViewError::ZeroUp);
        // Parallel and anti-parallel to the default up [0, 0, 1].
        directed_rejects(dir(0.0, 0.0, 1.0), None, Parallel);
        directed_rejects(dir(0.0, 0.0, -1.0), None, Parallel);
        // Parallelism is checked on the normalized vectors, so neither a
        // magnitude difference nor opposite signs hide it.
        directed_rejects(dir(2.0, 2.0, 0.0), Some(dir(-5.0, -5.0, 0.0)), Parallel);
    }

    /// The parallel check applies the fixed threshold: the sine of the angle
    /// between the normalized vectors, compared against
    /// `MIN_DIRECTION_UP_ANGLE_SIN`. Against the default up `[0, 0, 1]`, a
    /// direction `[s, 0, 1]` has a sine of approximately `s` for small `s`.
    #[test]
    fn directed_parallel_threshold_boundary() {
        directed_rejects(
            dir(MIN_DIRECTION_UP_ANGLE_SIN * 0.5, 0.0, 1.0),
            None,
            CameraViewError::DirectionParallelToUp,
        );
        directed_accepts(dir(MIN_DIRECTION_UP_ANGLE_SIN * 2.0, 0.0, 1.0), None);
    }

    /// Both stored vectors are normalized, and an omitted `up` becomes the
    /// world-Z default.
    #[test]
    fn directed_normalizes_and_defaults() {
        let view = CameraView::directed(dir(0.0, -10.0, 0.0), None, None, None, None, vec![]).unwrap();
        let CameraLook::Directed { direction, up } = view.look() else {
            panic!("directed constructor must produce CameraLook::Directed");
        };
        assert_eq!(*direction, dir(0.0, -1.0, 0.0));
        assert_eq!(*up, dir(0.0, 0.0, 1.0));
        assert_eq!(view.projection(), Projection::Orthographic);

        let view =
            CameraView::directed(dir(0.0, -1.0, 0.0), Some(dir(0.0, 0.0, 7.0)), None, None, None, vec![]).unwrap();
        let CameraLook::Directed { up, .. } = view.look() else {
            panic!("directed constructor must produce CameraLook::Directed");
        };
        assert_eq!(*up, dir(0.0, 0.0, 1.0));
    }
}
