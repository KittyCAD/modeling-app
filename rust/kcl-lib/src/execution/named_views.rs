//! Runtime values for named views: the camera intent that `std::view`
//! constructor functions produce, and the view value `view::named` returns.
//!
//! `CameraView` stores what the camera looks at and from which direction, not
//! a snapshot of engine camera state; absent fields are resolved by whichever
//! consumer activates the view. `NamedViewValue` pairs one of those cameras
//! with the visibility the author declared. `Orientation`, `Visibility` and
//! `Projection` are Rust mirrors of the KCL enums declared in `std/view.kcl`;
//! the test `kcl_enum_declarations_match_rust_mirrors` pins each pair of
//! declarations to the same variant list.

use std::collections::HashSet;

use serde::Serialize;

use crate::execution::ArtifactId;
use crate::execution::Metadata;
use crate::execution::Point3d;
use crate::modules::ModuleId;
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

/// Whether the objects of a named view start visible or hidden.
///
/// Rust mirror of the KCL enum `std::view::Visibility`. Serialized variant
/// names match the KCL spellings exactly.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq, ts_rs::TS)]
#[ts(export)]
pub enum Visibility {
    Show,
    Hide,
}

impl Visibility {
    /// Returns the variant whose KCL declaration uses this name, or `None`
    /// for a name the mirror does not declare. See
    /// [`Orientation::from_kcl_variant`].
    pub(crate) fn from_kcl_variant(name: &str) -> Option<Self> {
        match name {
            "Show" => Some(Visibility::Show),
            "Hide" => Some(Visibility::Hide),
            _ => None,
        }
    }
}

#[cfg(test)]
impl Visibility {
    /// Every variant, in the KCL declaration order. See `Orientation::ALL`.
    pub(crate) const ALL: [Visibility; 2] = [Visibility::Show, Visibility::Hide];

    /// The variant's name as written in the KCL declaration.
    pub(crate) fn kcl_name(self) -> &'static str {
        match self {
            Visibility::Show => "Show",
            Visibility::Hide => "Hide",
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

/// The name of the default view: the scene generated on successful execution of
/// the program, which is the artifact graph minus the artifacts named in the
/// program's `hide` calls. No KCL declares that view. A consumer computes it
/// from the artifact graph and the recorded operations, and it carries no
/// camera, so activating it resets the camera rather than setting one.
///
/// A file may not declare a view under this name. A view is activated by name,
/// so two views answering to one name would leave activation ambiguous.
/// Reserving the name before anything computes the default view means no file
/// written today stops being valid once it exists.
pub(crate) const RESERVED_DEFAULT_VIEW_NAME: &str = "Default View";

/// An input rejected by [`NamedViewValue::new`].
///
/// Each variant's `Display` text is the message the KCL author sees, as in
/// [`CameraViewError`]. `DuplicateName` is the one variant that repeats the
/// rejected value: the source range locates the second declaration but not the
/// first, and the name is what connects the two for the author.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub(crate) enum NamedViewError {
    /// `name` is the empty string. A view is identified by its name, so a view
    /// without one cannot be referred to.
    #[error("A view's name must not be empty.")]
    EmptyName,
    /// `name` contains nothing but whitespace. It is not the empty string, but
    /// it displays as nothing, so it identifies a view no better than the empty
    /// string does. It is reported separately because the fix differs: this name
    /// needs text, whereas a name with surrounding whitespace needs trimming.
    #[error("A view's name must not be only whitespace.")]
    WhitespaceOnly,
    /// `name` starts or ends with whitespace. Names are compared exactly, so
    /// `Front ` and `Front` would be two views that a reader sees as one.
    #[error("A view's name must not start or end with whitespace. Use `string::trim()` to remove it.")]
    SurroundingWhitespace,
    /// `name` is [`RESERVED_DEFAULT_VIEW_NAME`].
    #[error(
        "`{RESERVED_DEFAULT_VIEW_NAME}` is reserved for the view of the scene generated on successful execution of the program. Please give this view a different name."
    )]
    ReservedName,
    /// Another view declared by the same module already uses `name`.
    #[error(
        "A view named `{0}` already exists. Every view needs its own name, and names are compared exactly, so `Front` and `front` are different names."
    )]
    DuplicateName(String),
}

/// A named view: a display name, a camera and the visibility the author
/// declared.
///
/// The value keeps the form the author wrote -- one `baseline` and one
/// exception list -- rather than the artifact's pair of lists, so a value
/// cannot carry an exception for `Show` and an exception for `Hide` at the
/// same time. `view::named` splits `except_ids` into the artifact's `show_ids`
/// and `hide_ids` when it registers the view.
///
/// Fields stay private for the reason [`CameraView`]'s do: a value is only
/// produced by `view::named`, which checks the name before building one.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NamedViewValue {
    /// The artifact this view was registered as. A consumer holding the value
    /// finds the view in the artifact graph under this id.
    artifact_id: ArtifactId,
    /// The display name the author gave the view.
    name: String,
    camera: CameraView,
    /// Whether the view's objects start visible or hidden.
    baseline: Visibility,
    /// The exception to the baseline, as artifact ids: the hidden objects
    /// under a `Show` baseline, and the only visible objects under `Hide`. An
    /// empty list excepts nothing, so everything is visible under `Show` and
    /// nothing is visible under `Hide`.
    except_ids: Vec<ArtifactId>,
    #[serde(skip)]
    meta: Vec<Metadata>,
}

impl NamedViewValue {
    /// Creates a named view, applying every rule the declared KCL signature
    /// cannot express.
    ///
    /// `declared_in` is the module the constructing call appears in, and
    /// `existing_views` pairs each view registered so far with the module that
    /// declared it. Names are unique per declaring module rather than per
    /// program, so two files may each declare `Front`; taking the pairs as an
    /// argument applies that rule here, where the whole contract is testable
    /// without an executor.
    ///
    /// Every rejected input is a name, each a distinct [`NamedViewError`]
    /// variant, tested in this order:
    /// - an empty `name`;
    /// - a `name` of nothing but whitespace;
    /// - a `name` with leading or trailing whitespace;
    /// - a `name` equal to [`RESERVED_DEFAULT_VIEW_NAME`];
    /// - a `name` that another view declared in `declared_in` already uses.
    ///
    /// The visibility arguments need no rule of their own. `baseline` is
    /// required by the KCL signature and `except_ids` is the exception to it, so
    /// every combination of the two means something and none has to be
    /// rejected here.
    ///
    /// Repeated ids in `except_ids` are dropped, keeping the first occurrence.
    /// Visibility is a set: naming an object twice cannot mean more than
    /// naming it once, and a list built by concatenating two groups repeats an
    /// object that belongs to both.
    // The argument list is long because the whole name contract is checked here.
    // No two arguments share a type, so the compiler checks the call order.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new<'a>(
        artifact_id: ArtifactId,
        name: String,
        camera: CameraView,
        baseline: Visibility,
        except_ids: Option<Vec<ArtifactId>>,
        declared_in: ModuleId,
        existing_views: impl IntoIterator<Item = (ModuleId, &'a str)>,
        meta: Vec<Metadata>,
    ) -> Result<Self, NamedViewError> {
        if name.is_empty() {
            return Err(NamedViewError::EmptyName);
        }
        // Tested before the surrounding-whitespace rule, which a name of pure
        // whitespace also breaks, so that such a name is reported as the case it
        // is rather than as one needing trimming.
        if name.trim().is_empty() {
            return Err(NamedViewError::WhitespaceOnly);
        }
        if name.trim() != name.as_str() {
            return Err(NamedViewError::SurroundingWhitespace);
        }
        if name == RESERVED_DEFAULT_VIEW_NAME {
            return Err(NamedViewError::ReservedName);
        }
        if existing_views
            .into_iter()
            .any(|(module, existing)| module == declared_in && existing == name.as_str())
        {
            return Err(NamedViewError::DuplicateName(name));
        }

        // `except_ids` is `None` when the author omitted `except`, which the
        // baseline alone then describes: everything is visible under `Show`, and
        // nothing is under `Hide`.
        let except_ids = match except_ids {
            Some(mut ids) => {
                let mut seen = HashSet::with_capacity(ids.len());
                ids.retain(|id| seen.insert(*id));
                ids
            }
            None => Vec::new(),
        };

        Ok(NamedViewValue {
            artifact_id,
            name,
            camera,
            baseline,
            except_ids,
            meta,
        })
    }

    /// The id of the artifact registered for this view.
    pub fn artifact_id(&self) -> ArtifactId {
        self.artifact_id
    }

    /// The display name the author gave the view.
    pub fn name(&self) -> &str {
        &self.name
    }

    /// The camera the view activates.
    pub fn camera(&self) -> &CameraView {
        &self.camera
    }

    /// Whether the view's objects start visible or hidden.
    pub fn baseline(&self) -> Visibility {
        self.baseline
    }

    /// The objects that are the exception to the baseline.
    pub fn except_ids(&self) -> &[ArtifactId] {
        &self.except_ids
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

    /// The client repeats this reserved name as a TypeScript literal.
    /// This test fails when the Rust constant changes without the TypeScript
    /// literal. `kclNamedViews.test.ts` covers the opposite direction.
    #[test]
    fn reserved_default_view_name_matches_typescript() {
        let ts_path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/lang/std/kclNamedViews.ts");
        let source =
            std::fs::read_to_string(&ts_path).unwrap_or_else(|err| panic!("cannot read {}: {err}", ts_path.display()));
        let expected = format!("export const KCL_DEFAULT_VIEW_NAME = '{RESERVED_DEFAULT_VIEW_NAME}'");

        assert!(
            source.contains(&expected),
            "{} should declare `{expected}`. The reserved default view name is repeated on both \
             sides of the wasm boundary and they have drifted apart; update the TypeScript literal \
             to match this crate's RESERVED_DEFAULT_VIEW_NAME.",
            ts_path.display()
        );
    }

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

        let rust_visibility: Vec<&str> = Visibility::ALL.iter().map(|v| v.kcl_name()).collect();
        assert_eq!(kcl_variant_names("Visibility"), rust_visibility);

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
        for v in Visibility::ALL {
            assert_eq!(Visibility::from_kcl_variant(v.kcl_name()), Some(v));
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

    /// A valid camera, for the named-view cases below. Which camera a view
    /// holds does not take part in any rule `NamedViewValue::new` applies.
    fn a_camera() -> CameraView {
        CameraView::oriented(Orientation::Front, None, None, None, vec![]).unwrap()
    }

    /// An artifact id that differs for each `n`, so a test can tell the ids in
    /// an exception list apart.
    fn artifact_id(n: u128) -> ArtifactId {
        ArtifactId::new(uuid::Uuid::from_u128(n))
    }

    /// Builds a named view, taking every argument that a rule reads. The cases
    /// below go through this so that each one varies only what it is about.
    fn named_view(
        declared_in: ModuleId,
        name: &str,
        baseline: Visibility,
        except_ids: Option<Vec<ArtifactId>>,
        existing_views: &[(ModuleId, &str)],
    ) -> Result<NamedViewValue, NamedViewError> {
        NamedViewValue::new(
            artifact_id(1),
            name.to_owned(),
            a_camera(),
            baseline,
            except_ids,
            declared_in,
            existing_views.iter().copied(),
            vec![],
        )
    }

    /// A view named `name`, declared by the root module with no view registered
    /// before it and no exception list. Only the name decides the outcome.
    fn view_named(name: &str) -> Result<NamedViewValue, NamedViewError> {
        named_view(ModuleId::default(), name, Visibility::Show, None, &[])
    }

    /// Each rule a name has to satisfy, with the name that breaks it.
    #[test]
    fn named_view_rejects_names_it_cannot_identify_a_view_by() {
        assert_eq!(view_named("").unwrap_err(), NamedViewError::EmptyName);

        // Surrounding whitespace is invisible to a reader but significant to
        // the exact comparison the uniqueness rule makes.
        assert_eq!(view_named(" Front").unwrap_err(), NamedViewError::SurroundingWhitespace);
        assert_eq!(view_named("Front ").unwrap_err(), NamedViewError::SurroundingWhitespace);
        assert_eq!(
            view_named("\tFront\n").unwrap_err(),
            NamedViewError::SurroundingWhitespace
        );
        // A name of nothing but whitespace breaks the rule above as well, and is
        // reported as its own case because the fix is to supply text rather than
        // to trim.
        assert_eq!(view_named("   ").unwrap_err(), NamedViewError::WhitespaceOnly);
        assert_eq!(view_named("\t\n").unwrap_err(), NamedViewError::WhitespaceOnly);

        assert_eq!(
            view_named(RESERVED_DEFAULT_VIEW_NAME).unwrap_err(),
            NamedViewError::ReservedName
        );
        // Only the reserved name itself is reserved.
        view_named("Default View 2").unwrap();
        view_named("default view").unwrap();

        // A name is display text, so interior spaces and punctuation are
        // ordinary.
        assert_eq!(view_named("Plate only (rev B)").unwrap().name(), "Plate only (rev B)");
    }

    /// A name has to be unique among the views the same module declares, and
    /// only among those. Two files may each declare `Front`, so the rule reads
    /// the declaring module of every registered view rather than the name
    /// alone.
    #[test]
    fn named_view_name_is_unique_per_declaring_module() {
        let root = ModuleId::default();
        let imported = ModuleId::from_usize(1);
        let declare =
            |name: &str, existing: &[(ModuleId, &str)]| named_view(root, name, Visibility::Show, None, existing);

        assert_eq!(
            declare("Front", &[(root, "Front")]).unwrap_err(),
            NamedViewError::DuplicateName("Front".to_owned())
        );
        // A view of the same name declared by another module is not a repeat.
        declare("Front", &[(imported, "Front")]).unwrap();
        // Names are compared exactly, so case and spacing distinguish them.
        declare("front", &[(root, "Front")]).unwrap();
        declare("Front view", &[(root, "Front")]).unwrap();
        // The rule reads every registered view, not only the most recent.
        assert_eq!(
            declare("Front", &[(root, "Back"), (imported, "Front"), (root, "Front")]).unwrap_err(),
            NamedViewError::DuplicateName("Front".to_owned())
        );
    }

    /// Every combination of the two visibility arguments is accepted and stored
    /// as written. There is nothing to reject: the baseline is required, so a
    /// list always has one to be the exception to, and a baseline without a list
    /// describes the whole scene on its own.
    #[test]
    fn named_view_stores_every_visibility_combination() {
        let root = ModuleId::default();
        let visibility = |baseline, except_ids| named_view(root, "Front", baseline, except_ids, &[]);

        for baseline in Visibility::ALL {
            let with_list = visibility(baseline, Some(vec![artifact_id(2)])).unwrap();
            assert_eq!(with_list.baseline(), baseline);
            assert_eq!(with_list.except_ids(), [artifact_id(2)]);

            let without_list = visibility(baseline, None).unwrap();
            assert_eq!(without_list.baseline(), baseline);
            assert!(without_list.except_ids().is_empty());
        }
    }

    /// Visibility is a set, so a repeated id is applied once. Order is kept, so
    /// the stored list still reads as the author wrote it.
    #[test]
    fn named_view_drops_repeated_except_ids() {
        let (a, b, c) = (artifact_id(2), artifact_id(3), artifact_id(4));
        let view = named_view(
            ModuleId::default(),
            "Front",
            Visibility::Hide,
            Some(vec![b, a, b, c, a, b]),
            &[],
        )
        .unwrap();
        assert_eq!(view.except_ids(), [b, a, c]);
    }

    /// Each variant has its own message, so an error tells the author what to
    /// change, and the reserved-name message states the name it reserves.
    #[test]
    fn named_view_error_messages_are_distinct() {
        let all = [
            NamedViewError::EmptyName,
            NamedViewError::WhitespaceOnly,
            NamedViewError::SurroundingWhitespace,
            NamedViewError::ReservedName,
            NamedViewError::DuplicateName("Front".to_owned()),
        ];
        let mut messages: Vec<String> = all.iter().map(|e| e.to_string()).collect();
        messages.sort_unstable();
        let count = messages.len();
        messages.dedup();
        assert_eq!(messages.len(), count, "every variant needs its own message");

        assert!(
            NamedViewError::ReservedName
                .to_string()
                .contains(RESERVED_DEFAULT_VIEW_NAME),
            "the reserved-name message must name the reserved name"
        );
        assert!(
            NamedViewError::DuplicateName("Front".to_owned())
                .to_string()
                .contains("`Front`"),
            "the duplicate-name message must name the view that collided"
        );
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
