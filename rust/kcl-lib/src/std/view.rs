//! Standard library functions for named views.

use kcl_api::UnitLength;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::Artifact;
use crate::execution::ArtifactId;
use crate::execution::CameraView;
use crate::execution::CodeRef;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::NamedViewValue;
use crate::execution::Orientation;
use crate::execution::Point3d;
use crate::execution::Projection;
use crate::execution::Visibility;
use crate::execution::named_view_artifact;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;

/// Create a camera view that looks at the model from a standard orientation.
pub async fn oriented(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // The declared KCL signature has already coerced every argument, so the
    // runtime types passed here only convert, they do not validate. Enum
    // coercion is nominal, so an `any` runtime type still cannot let a
    // different enum through; `wrongly_typed_arguments_are_rejected` pins
    // that, because the fallback if it stopped holding is an internal error
    // rather than a diagnostic the author can act on.
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
    // runtime types passed here only convert, they do not validate. Enum
    // coercion is nominal, so an `any` runtime type still cannot let a
    // different enum through; `wrongly_typed_arguments_are_rejected` pins
    // that, because the fallback if it stopped holding is an internal error
    // rather than a diagnostic the author can act on.
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

/// Create a named view: a camera paired with the objects it shows or hides.
pub async fn named(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    // As in the camera constructors, the declared KCL signature has already
    // coerced every argument, so the runtime types here only convert.
    let name: String = args.get_unlabeled_kw_arg("name", &RuntimeType::string(), exec_state)?;
    let camera: CameraView = args.get_kw_arg("camera", &RuntimeType::any(), exec_state)?;
    let baseline: Visibility = args.get_kw_arg("baseline", &RuntimeType::any(), exec_state)?;
    let except: Option<Vec<KclValue>> = args.get_kw_arg_opt("except", &RuntimeType::any(), exec_state)?;

    let except_ids = except
        .as_ref()
        .map(|objects| except_artifact_ids(objects, &args))
        .transpose()?;

    // The id is taken before the existing views are read, because taking one
    // borrows `exec_state` mutably and reading them borrows it immutably.
    let artifact_id = exec_state.next_artifact_id();
    let view = NamedViewValue::new(
        artifact_id,
        name,
        camera,
        baseline,
        except_ids,
        args.source_range.module_id(),
        exec_state.registered_named_views(),
        vec![args.source_range.into()],
    )
    .map_err(|err| view_error(err, &args))?;
    // A view sends no engine command: it is data for a consumer to activate
    // later, so registering the artifact is the whole effect of the call.
    exec_state.add_artifact(Artifact::NamedView(named_view_artifact(
        &view,
        CodeRef::placeholder(args.source_range),
    )));

    Ok(KclValue::NamedView { value: Box::new(view) })
}

/// Reads the artifact id of each object in an `except` list.
///
/// The three accepted kinds carry their artifact id differently: a solid and a
/// sketch each have an `artifact_id` field distinct from their engine id, while
/// a GD&T annotation has one id used for both, which `gdt::datum` registers as
/// `ArtifactId::new(annotation.id)`. Any other kind of value means coercion
/// against the declared signature did not do its job, which is an internal
/// error rather than something the author can act on.
fn except_artifact_ids(objects: &[KclValue], args: &Args) -> Result<Vec<ArtifactId>, KclError> {
    objects
        .iter()
        .map(|object| match object {
            KclValue::Solid { value } => Ok(value.artifact_id),
            KclValue::Sketch { value } => Ok(value.artifact_id),
            KclValue::GdtAnnotation { value } => Ok(ArtifactId::new(value.id)),
            other => Err(KclError::new_internal(KclErrorDetails::new(
                format!(
                    "`except` cannot hold {}; the declared signature should have rejected it",
                    other.human_friendly_type()
                ),
                vec![args.source_range],
            ))),
        })
        .collect()
}

/// Reports a rejected argument at the source range of the call that supplied
/// it. The error's `Display` text is the whole message; the range is what tells
/// the author which call to look at.
///
/// Both `CameraViewError` and `NamedViewError` are written so that their
/// `Display` text is the author-facing message, which is why one helper serves
/// every function in this module.
fn view_error<E: std::fmt::Display>(err: E, args: &Args) -> KclError {
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
    use crate::execution::ArtifactId;
    use crate::execution::KclValue;
    use crate::execution::Visibility;
    use crate::execution::parse_execute;

    /// A sketch V2 program that leaves two solids bound, `plate` and `boss`,
    /// for a view to except. Mock execution is enough: a view sends no engine
    /// command, and the artifact ids these solids carry are assigned during
    /// execution rather than by the engine.
    const TWO_SOLIDS: &str = r#"@settings(experimentalFeatures = allow)

plateSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 40mm, var 0mm])
  edge2 = line(start = [var 40mm, var 0mm], end = [var 40mm, var 20mm])
  edge3 = line(start = [var 40mm, var 20mm], end = [var 0mm, var 20mm])
  edge4 = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}
plateRegion = region(point = [20mm, 10mm], sketch = plateSketch)
plate = extrude(plateRegion, length = 5mm)

bossSketch = sketch(on = XY) {
  edge1 = line(start = [var 50mm, var 0mm], end = [var 60mm, var 0mm])
  edge2 = line(start = [var 60mm, var 0mm], end = [var 60mm, var 10mm])
  edge3 = line(start = [var 60mm, var 10mm], end = [var 50mm, var 10mm])
  edge4 = line(start = [var 50mm, var 10mm], end = [var 50mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}
bossRegion = region(point = [55mm, 5mm], sketch = bossSketch)
boss = extrude(bossRegion, length = 8mm)
"#;

    /// A `Show` baseline with no exception list keeps every object visible. The
    /// baseline is required, so this is the shortest view a file can declare.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_shows_everything_under_a_show_baseline() {
        let program = format!(
            "{TWO_SOLIDS}\nv = view::named(\n  \"Overview\",\n  camera = view::oriented(view::Orientation::Isometric),\n  baseline = view::Visibility::Show,\n)\n"
        );
        let result = parse_execute(&program).await.expect("the program executes");

        let KclValue::NamedView { value } = result.variable("v") else {
            panic!("`v` is not a named view");
        };
        assert_eq!(value.name(), "Overview");
        assert_eq!(value.baseline(), Visibility::Show);
        assert!(value.except_ids().is_empty());
    }

    /// The `except` list accepts more than one kind of object in one call, and
    /// the artifact ids it stores are those of the objects named, in the order
    /// written.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_excepts_the_objects_it_is_given() {
        let program = format!(
            "{TWO_SOLIDS}\nv = view::named(\n  \"Plate only\",\n  camera = view::oriented(view::Orientation::Front),\n  baseline = view::Visibility::Hide,\n  except = [plate, boss, plate],\n)\n"
        );
        let result = parse_execute(&program).await.expect("the program executes");

        let KclValue::Solid { value: plate } = result.variable("plate") else {
            panic!("`plate` is not a solid");
        };
        let KclValue::Solid { value: boss } = result.variable("boss") else {
            panic!("`boss` is not a solid");
        };
        let KclValue::NamedView { value } = result.variable("v") else {
            panic!("`v` is not a named view");
        };

        assert_eq!(value.baseline(), Visibility::Hide);
        // The repeated `plate` is dropped, keeping the first occurrence.
        assert_eq!(value.except_ids().to_vec(), vec![plate.artifact_id, boss.artifact_id]);
    }

    /// One `except` list may name objects of different kinds, which the
    /// declared element type `Solid | Sketch | GdtAnnotation` allows. The three
    /// kinds carry their artifact id differently, so each is read by its own
    /// arm and this is what pins all three arms at once.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_excepts_more_than_one_kind() {
        let program = format!(
            "{TWO_SOLIDS}\nnote = gdt::note(note = \"Machine after welding\")\nv = view::named(\n  \"Mixed\",\n  camera = view::oriented(view::Orientation::Top),\n  baseline = view::Visibility::Hide,\n  except = [plate, bossRegion, note],\n)\n"
        );
        let result = parse_execute(&program).await.expect("the program executes");

        let KclValue::Solid { value: plate } = result.variable("plate") else {
            panic!("`plate` is not a solid");
        };
        // A region is the sketch value the extrude consumed; the sketch-block
        // variable itself is an object that coercion converts to a `Sketch`,
        // so it is the region that carries the artifact id to compare against.
        let KclValue::Sketch { value: sketch } = result.variable("bossRegion") else {
            panic!("`bossRegion` is not a sketch");
        };
        let KclValue::GdtAnnotation { value: note } = result.variable("note") else {
            panic!("`note` is not an annotation");
        };
        let KclValue::NamedView { value } = result.variable("v") else {
            panic!("`v` is not a named view");
        };

        assert_eq!(
            value.except_ids().to_vec(),
            vec![plate.artifact_id, sketch.artifact_id, ArtifactId::new(note.id)]
        );
    }

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

    /// Runs `code` WITHOUT the experimental opt-in and returns the diagnostics
    /// it reports. Experimental use is recorded as a non-fatal issue rather
    /// than a returned error, so the program still executes and the issue list
    /// is the only place the gate is visible.
    async fn issues_without_opt_in(code: &str) -> Vec<String> {
        let result = parse_execute(code).await.expect("experimental use is not fatal");
        result.issues().iter().map(|issue| issue.message.clone()).collect()
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

    /// Every name a view cannot be identified by reports the message the author
    /// sees. The rules themselves are pinned in `execution::named_views`, where
    /// they need no executor; these cases pin that `view::named` reports them
    /// rather than accepting the name or failing some other way.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_rejects_names_it_cannot_identify_a_view_by() {
        // The two required arguments, so each case below varies only the name.
        let showing = "camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Show";

        assert_eq!(
            execution_error(&format!(r#"v = view::named("", {showing})"#)).await,
            "A view's name must not be empty."
        );
        assert_eq!(
            execution_error(&format!(r#"v = view::named("   ", {showing})"#)).await,
            "A view's name must not be only whitespace."
        );
        assert_eq!(
            execution_error(&format!(r#"v = view::named("Front ", {showing})"#)).await,
            "A view's name must not start or end with whitespace. Use `string::trim()` to remove it."
        );
        assert_eq!(
            execution_error(&format!(r#"v = view::named(" Front", {showing})"#)).await,
            "A view's name must not start or end with whitespace. Use `string::trim()` to remove it."
        );
        assert_eq!(
            execution_error(&format!(r#"v = view::named("Default View", {showing})"#)).await,
            "`Default View` is reserved for the view of the scene generated on successful execution of the program. Please give this view a different name."
        );
        assert_eq!(
            execution_error(&format!(
                "a = view::named(\"Front\", {showing})\nb = view::named(\"Front\", {showing})"
            ))
            .await,
            "A view named `Front` already exists. Every view needs its own name, and names are compared exactly, so `Front` and `front` are different names."
        );
    }

    /// Two views in one file may differ only in case or spacing, because the
    /// uniqueness rule compares names exactly. This is the accepting half of
    /// the duplicate case above.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_accepts_names_that_differ_only_in_case() {
        let showing = "camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Show";
        let program = format!(
            "@settings(experimentalFeatures = allow)\na = view::named(\"Front\", {showing})\nb = view::named(\"front\", {showing})\n"
        );
        let result = parse_execute(&program).await.expect("the program executes");

        let KclValue::NamedView { value: upper } = result.variable("a") else {
            panic!("`a` is not a named view");
        };
        let KclValue::NamedView { value: lower } = result.variable("b") else {
            panic!("`b` is not a named view");
        };
        assert_eq!(upper.name(), "Front");
        assert_eq!(lower.name(), "front");
    }

    /// Omitting `baseline` is rejected by the declared signature, before `named`
    /// runs. It is required so that a view states what it shows rather than
    /// leaving a reader to know a default, and this pins that the signature is
    /// what enforces it.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_requires_a_baseline() {
        assert_eq!(
            execution_error(r#"v = view::named("Front", camera = view::oriented(view::Orientation::Front))"#).await,
            "The `view::named` function requires a keyword argument `baseline`"
        );
    }

    /// `named`'s required arguments and their types are enforced by the declared
    /// signature. The camera and baseline cases are here for the reason the
    /// constructors have their own: the alternative to a signature rejection is
    /// an internal error from `FromKclValue`, which tells the author nothing.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_rejects_wrongly_typed_arguments() {
        // An omitted required argument.
        assert_eq!(
            execution_error(r#"v = view::named("Front", baseline = view::Visibility::Show)"#).await,
            "The `view::named` function requires a keyword argument `camera`"
        );
        // A value that is not a camera at all. The wrong value is a string
        // rather than a number, because a number additionally draws the
        // incomplete-units hint, which has nothing to do with this rejection.
        assert_eq!(
            execution_error(r#"v = view::named("Front", camera = "nope", baseline = view::Visibility::Show)"#).await,
            "camera requires a value with type `CameraView`, but found a value with type `string`."
        );
        // A different enum where `baseline` is declared, which nominal coercion
        // rejects even though the Rust body reads it with an `any` runtime type.
        assert_eq!(
            execution_error(
                r#"v = view::named("Front", camera = view::oriented(view::Orientation::Front), baseline = view::Orientation::Top)"#
            )
            .await,
            "baseline requires a value with type `Visibility`, but found a value of enum `Orientation` (with type `Orientation`)."
        );
        // A name that is not a string.
        assert_eq!(
            execution_error(
                r#"v = view::named(view::Visibility::Show, camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Show)"#
            )
            .await,
            "The input argument of `view::named` requires a value with type `string`, but found a value of enum `Visibility` (with type `Visibility`)."
        );
    }

    /// Declaring a view without the experimental opt-in is reported, as calling
    /// either camera constructor is. `named` needs its own case: the gate is a
    /// per-function annotation, so covering the constructors says nothing about
    /// this function.
    #[tokio::test(flavor = "multi_thread")]
    async fn declaring_a_view_requires_the_experimental_opt_in() {
        assert!(
            issues_without_opt_in(
                r#"v = view::named("Front", camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Show)"#
            )
            .await
            .contains(&"Use of `view::named` is experimental and may change or be removed.".to_owned())
        );
    }

    /// A sketch-block variable is accepted in `except`, and this pins which id it
    /// contributes. A block and the region taken from it are different artifacts:
    /// the block stores the path artifact of the whole `sketch(on = ...) { ... }`
    /// expression, the region its own. Both are nodes a consumer can resolve, so
    /// the two are a choice the author makes rather than one being wrong. The sim
    /// test `named_views_except_a_sketch_block` shows the node the block names.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_excepts_a_sketch_block_by_its_own_id() {
        let program = format!(
            "{TWO_SOLIDS}\nv = view::named(\n  \"Block\",\n  camera = view::oriented(view::Orientation::Front),\n  baseline = view::Visibility::Hide,\n  except = [plateSketch],\n)\n"
        );
        let result = parse_execute(&program).await.expect("the program executes");

        let KclValue::Sketch { value: region } = result.variable("plateRegion") else {
            panic!("`plateRegion` is not a sketch");
        };
        let KclValue::NamedView { value } = result.variable("v") else {
            panic!("`v` is not a named view");
        };

        assert_eq!(value.except_ids().len(), 1);
        assert_ne!(
            value.except_ids()[0],
            region.artifact_id,
            "the block and the region taken from it are different artifacts"
        );
    }

    /// An empty `except` list is rejected by the declared element count `1+`,
    /// before `named` runs. Nothing in the Rust body depends on that, but a list
    /// that excepts nothing says nothing, so this pins where it is caught.
    #[tokio::test(flavor = "multi_thread")]
    async fn named_rejects_an_empty_except_list() {
        assert_eq!(
            execution_error(
                r#"v = view::named("Front", camera = view::oriented(view::Orientation::Front), baseline = view::Visibility::Hide, except = [])"#
            )
            .await,
            "except requires one or more `Solid`s or `Sketch`s or `GdtAnnotation`s (`[Solid | Sketch | GdtAnnotation; 1+]`), but found an empty array (with type `[any; 0]`)."
        );
    }

    /// An argument of the wrong type is rejected by the declared signature,
    /// before either function runs.
    ///
    /// This is what lets the implementations read `orientation` and
    /// `projection` with an `any` runtime type: enum coercion is nominal, so
    /// the signature admits only the enum it names. Were that to stop
    /// holding, the value would reach `FromKclValue` and fail there, and the
    /// author would get "Mismatch between type coercion and value extraction
    /// (this isn't your fault)" from `std/args.rs` instead of a diagnostic
    /// naming the argument. The point of these cases is that the good message
    /// is the one that appears.
    #[tokio::test(flavor = "multi_thread")]
    async fn wrongly_typed_arguments_are_rejected() {
        // A value of an unrelated type.
        assert_eq!(
            execution_error(r#"v = view::oriented("Front")"#).await,
            "The input argument of `view::oriented` requires a value with type `Orientation`, but found a value with type `string`."
        );
        // A different enum from the same module. Nominal coercion rejects it
        // even though `any` was requested.
        assert_eq!(
            execution_error("v = view::oriented(view::Projection::Perspective)").await,
            "The input argument of `view::oriented` requires a value with type `Orientation`, but found a value of enum `Projection` (with type `Projection`)."
        );
        // A user-defined enum declaring a variant of the same name. Coercion
        // compares the declaring type, not the variant spelling.
        assert_eq!(
            execution_error("type MyOrientation { | Front }\nv = view::oriented(MyOrientation::Front)").await,
            "The input argument of `view::oriented` requires a value with type `Orientation`, but found a value of enum `MyOrientation` (with type `MyOrientation`)."
        );
        // A labeled argument, which reports in its own wording.
        assert_eq!(
            execution_error("v = view::oriented(view::Orientation::Front, projection = view::Orientation::Top)").await,
            "projection requires a value with type `Projection`, but found a value of enum `Orientation` (with type `Orientation`)."
        );
        // The same protection covers the non-enum arguments.
        assert_eq!(
            execution_error(r#"v = view::directed("nope")"#).await,
            "The input argument of `view::directed` requires a value with type `Point3d`, but found a value with type `string`."
        );
    }

    /// Calling either constructor without the experimental opt-in is
    /// reported, whether or not the call mentions an enum.
    ///
    /// The sim test `named_views_module_requires_opt_in` covers the other
    /// half of the gate, a bare enum variant. This covers the functions
    /// themselves: `view::directed` with a plain vector names no enum, so the
    /// only thing gating it is its own `@(experimental = true)`. Named views
    /// stay unreleasable until enums stabilise precisely because a consumer
    /// must opt in, so the gate silently lapsing is the failure to catch.
    #[tokio::test(flavor = "multi_thread")]
    async fn calling_a_constructor_requires_the_experimental_opt_in() {
        assert!(
            issues_without_opt_in("v = view::directed([0, 1, -2])")
                .await
                .contains(&"Use of `view::directed` is experimental and may change or be removed.".to_owned())
        );

        // This call also uses an enum variant, so it reports both halves of
        // the gate; the function's own diagnostic is the one asserted here.
        assert!(
            issues_without_opt_in("v = view::oriented(view::Orientation::Front)")
                .await
                .contains(&"Use of `view::oriented` is experimental and may change or be removed.".to_owned())
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
