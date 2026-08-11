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

/// An input rejected by [`CameraView::directed`]. Carries no source range;
/// the std function that calls the constructor attaches the call's range.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DirectedViewError {
    /// `direction` has length zero, so it does not name a direction.
    ZeroDirection,
    /// `up` has length zero, so it does not name a direction.
    ZeroUp,
    /// `direction` and `up` are parallel or nearly parallel under
    /// [`MIN_DIRECTION_UP_ANGLE_SIN`], so they do not span the plane the
    /// camera basis is built from.
    DirectionParallelToUp,
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
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CameraView {
    look: CameraLook,
    /// The point the camera looks at. `None` means: center on the bounds of
    /// the model at activation.
    target: Option<Point3d>,
    /// The distance from the camera to the target. `None` means: fit the
    /// model at activation. Carries the author's numeric unit.
    distance: Option<TyF64>,
    projection: Projection,
    #[serde(skip)]
    meta: Vec<Metadata>,
}

impl CameraView {
    /// Creates a camera view that looks at the model from a standard
    /// orientation. Total: every orientation with any combination of the
    /// optional fields is a valid view. A `projection` of `None` applies the
    /// orthographic default, so a file that never mentions projection renders
    /// identically in every consumer.
    pub(crate) fn oriented(
        orientation: Orientation,
        target: Option<Point3d>,
        distance: Option<TyF64>,
        projection: Option<Projection>,
        meta: Vec<Metadata>,
    ) -> Self {
        CameraView {
            look: CameraLook::Oriented { orientation },
            target,
            distance,
            projection: projection.unwrap_or(Projection::Orthographic),
            meta,
        }
    }

    /// Creates a camera view that looks along a custom direction.
    ///
    /// `direction` and `up` are stored as unit vectors; their magnitudes
    /// carry no information because zoom is `distance`. An `up` of `None`
    /// applies the world-Z default `[0, 0, 1]`. A `projection` of `None`
    /// applies the orthographic default, as in [`CameraView::oriented`].
    ///
    /// Rejected inputs, each a distinct [`DirectedViewError`] variant:
    /// - a `direction` of length zero;
    /// - an `up` of length zero;
    /// - a `direction` parallel or nearly parallel to `up`, under the fixed
    ///   threshold [`MIN_DIRECTION_UP_ANGLE_SIN`].
    pub(crate) fn directed(
        direction: Point3d,
        up: Option<Point3d>,
        target: Option<Point3d>,
        distance: Option<TyF64>,
        projection: Option<Projection>,
        meta: Vec<Metadata>,
    ) -> Result<Self, DirectedViewError> {
        let up = up.unwrap_or(Point3d {
            x: 0.0,
            y: 0.0,
            z: 1.0,
            units: None,
        });
        if norm(&direction) == 0.0 {
            return Err(DirectedViewError::ZeroDirection);
        }
        if norm(&up) == 0.0 {
            return Err(DirectedViewError::ZeroUp);
        }
        let direction = direction.normalize();
        let up = up.normalize();
        // For unit vectors, the length of the cross product is the sine of
        // the angle between them.
        if norm(&cross(&direction, &up)) < MIN_DIRECTION_UP_ANGLE_SIN {
            return Err(DirectedViewError::DirectionParallelToUp);
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

    /// Each degenerate input is rejected with its own error variant.
    #[test]
    fn directed_rejects_degenerate_vectors() {
        let err = |direction: Point3d, up: Option<Point3d>| {
            CameraView::directed(direction, up, None, None, None, vec![]).unwrap_err()
        };

        assert_eq!(err(dir(0.0, 0.0, 0.0), None), DirectedViewError::ZeroDirection);
        assert_eq!(
            err(dir(1.0, 0.0, 0.0), Some(dir(0.0, 0.0, 0.0))),
            DirectedViewError::ZeroUp
        );
        // Parallel and anti-parallel to the default up [0, 0, 1].
        assert_eq!(err(dir(0.0, 0.0, 1.0), None), DirectedViewError::DirectionParallelToUp);
        assert_eq!(err(dir(0.0, 0.0, -1.0), None), DirectedViewError::DirectionParallelToUp);
        // Parallelism is checked on the normalized vectors, so a magnitude
        // difference does not hide it.
        assert_eq!(
            err(dir(2.0, 2.0, 0.0), Some(dir(-5.0, -5.0, 0.0))),
            DirectedViewError::DirectionParallelToUp
        );
    }

    /// The parallel check applies the fixed threshold: the sine of the angle
    /// between the normalized vectors, compared against
    /// `MIN_DIRECTION_UP_ANGLE_SIN`.
    #[test]
    fn directed_parallel_threshold_boundary() {
        // Against up [0, 0, 1], a direction [s, 0, 1] has sine of the angle
        // approximately s for small s.
        let just_inside = dir(MIN_DIRECTION_UP_ANGLE_SIN * 0.5, 0.0, 1.0);
        assert_eq!(
            CameraView::directed(just_inside, None, None, None, None, vec![]).unwrap_err(),
            DirectedViewError::DirectionParallelToUp
        );

        let just_outside = dir(MIN_DIRECTION_UP_ANGLE_SIN * 2.0, 0.0, 1.0);
        assert!(CameraView::directed(just_outside, None, None, None, None, vec![]).is_ok());
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
