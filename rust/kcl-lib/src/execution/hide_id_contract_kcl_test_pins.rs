//! A KCL `hide()` call writes the id of each hidden object into two id
//! domains at once:
//!
//! - ENGINE OBJECT IDS: the ids the engine's scene knows. `hide()` sends one
//!   per object as `ObjectVisible.object_id` (resolved by
//!   `HideableGeometry::ids`).
//! - ARTIFACT IDS: the ids of the client-facing execution record. The `hide`
//!   `StdLibCall` operation records one per object (the TypeScript client
//!   reads it in `getHideOperationArtifactIds`, `src/lib/operations.ts`), and
//!   the artifact graph is keyed by them.
//!
//! Every KCL value carries one id from each domain (its `id` and
//! `artifact_id` fields). Whether both hold the SAME uuid depends on the
//! value's kind, and these tests pin that relation as it stands today:
//!
//! | KCL value kind | Artifact id vs engine object id |
//! |---|---|
//! | solid from `extrude` (with or without `twistAngle`), `revolve` (either axis form), or `sweep`; a pattern's ORIGINAL | differ |
//! | solid from `loft` or `blend`, each of which overrides the profile id with its own command id | equal |
//! | solid from `mirror3d` | equal |
//! | sketch, plane, helix, GD&T annotation, imported geometry, pattern COPIES | equal |
//!
//! For the divergent kinds, the artifact graph's `Artifact::Sweep` node holds
//! the pair: its `id` is the artifact id and its `path_id` is the engine
//! object id. That node is a client's only route from one domain to the
//! other, and the route matters because the engine silently ignores unknown
//! ids and acks success -- sending an artifact id where an engine object id
//! is required hides nothing and reports nothing.
//!
//! A `Sweep` node's subtype does not by itself decide which row it falls in.
//! `mirror3d` copies the source body's node, overwrites `id` with the mirrored
//! body's engine object id, and leaves `path_id` naming the SOURCE body's path,
//! so a mirrored `extrusion` node sits in the equal row while the node it was
//! copied from sits in the divergent one. The `Path` node's `sweep_id`
//! back-link separates them, because it records the original node only.
//!
//! The relation holds over both sketch construction routes, which differ in
//! what the profile becomes:
//!
//! - sketch V2, also called sketch solve (`sketch(on = ...) { ... }` blocks,
//!   solids from `region(...)` -- the DEFAULT, unsuffixed tests): the solved
//!   block stays a scene object of its own, independently hideable and still
//!   visible after its solid is hidden; the sweep consumes only the REGION,
//!   and the body answers to the region's id. The V2 sweep form also does not
//!   hide its trajectory sketch, unlike the V1 `sweep()` function.
//! - the classic pipeline (`startSketchOn |> startProfile |> ...` -- the
//!   `_v1` tests): the sweep consumes the profile, and the body answers to
//!   the profile's engine object id. That id is the sent side of the
//!   divergence in the table.
//!
//! Sketch V2 is the default: every sketch-involving kind is pinned over V2 by
//! the unsuffixed tests, and `_v1` tests exist only where the classic route's
//! own behavior is the thing pinned. Kinds whose programs contain no sketch
//! at all (helix, plane, imported geometry) are route-independent and appear
//! once.
//!
//! One English word, three systems: in this file "sweep" always names the
//! artifact-graph node kind `Artifact::Sweep`, which covers ALL swept bodies
//! (subtypes extrusion, extrusionTwist, revolve, revolveAboutEdge, loft, blend,
//! sweep). It is not the KCL `sweep()` function and not an engine command,
//! though both exist.
//!
//! Real engine required (`ZOO_API_TOKEN`): mock execution cannot reach some
//! construction paths (pattern copies get engine-assigned ids).

use kittycad_modeling_cmds::ModelingCmd;
use uuid::Uuid;

use super::ExecState;
use super::Operation;
use crate::execution::Artifact;
use crate::execution::ArtifactId;

/// An id in the engine object id domain -- what `ObjectVisible.object_id`
/// addresses. Deliberately a different type from `ArtifactId`: the two domains
/// hold different uuids for the same body in the divergent kinds, so every
/// cross-domain comparison in this file must go through [`in_engine_domain`].
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
struct EngineObjectId(Uuid);

/// Reinterprets an artifact id in the engine object id domain. This
/// reinterpretation is the claim the equal kinds pin: the same uuid is valid
/// in both domains. For the divergent kinds it is exactly what does NOT hold.
fn in_engine_domain(artifact_id: ArtifactId) -> EngineObjectId {
    EngineObjectId(Uuid::from(artifact_id))
}

/// The two ids an `Artifact::Sweep` node carries, read from the artifact
/// graph. This node kind is the only place both id domains meet.
struct SweepIds {
    /// The node's own id: the id of the engine command that made the body.
    sweep_id: ArtifactId,
    /// The profile (path) the sweep consumed. For the extrusion, revolve and
    /// sweep subtypes this uuid is also the body's engine object id; for loft
    /// it is not.
    path_id: ArtifactId,
}

/// One execution's `hide()` call as seen by its three observers: the engine
/// channel, the operations stream, and the artifact graph.
struct ObservedIds {
    /// From the engine channel: `(object_id, hidden)` per `ObjectVisible`
    /// command sent.
    sent_to_engine: Vec<(EngineObjectId, bool)>,
    /// From the operations stream: the artifact ids recorded on `hide`
    /// operations, which is what the TypeScript client reads.
    recorded_in_operations: Vec<ArtifactId>,
    /// From the artifact graph: the id pairs that relate the two domains.
    sweep_ids: Vec<SweepIds>,
    /// From the artifact graph: each `Artifact::Path` node's id paired with the
    /// sweep that names it as its base path, if any. A client reads this
    /// back-link to tell an original swept body from a `mirror3d` copy. Both
    /// carry the same `path_id`.
    path_back_links: Vec<(ArtifactId, Option<ArtifactId>)>,
}

impl ObservedIds {
    /// Object ids of the `ObjectVisible` commands with `hidden == true`.
    fn hidden_object_ids(&self) -> Vec<EngineObjectId> {
        self.sent_to_engine
            .iter()
            .filter(|(_, hidden)| *hidden)
            .map(|(id, _)| *id)
            .collect()
    }
}

async fn execute_and_observe(code: &str, current_file: Option<std::path::PathBuf>) -> ObservedIds {
    let ctx = crate::test_server::new_context(true, current_file).await.unwrap();
    let program = crate::Program::parse_no_errs(code).unwrap();
    let mut exec_state = ExecState::new(&ctx);
    ctx.run(&program, &mut exec_state).await.unwrap();

    let sent_to_engine = exec_state
        .global
        .root_module_artifacts
        .commands
        .iter()
        .filter_map(|artifact_command| match &artifact_command.command {
            ModelingCmd::ObjectVisible(object_visible) => {
                Some((EngineObjectId(object_visible.object_id), object_visible.hidden))
            }
            _ => None,
        })
        .collect();

    // Read the ids off the SERIALIZED operation, since that is the form the
    // TypeScript client consumes.
    let recorded_in_operations = exec_state
        .global
        .root_module_artifacts
        .operations
        .iter()
        .filter(|op| matches!(op, Operation::StdLibCall { name, .. } if name == "hide"))
        .flat_map(|op| {
            let op = serde_json::to_value(op).unwrap();
            artifact_ids_in(&op["unlabeledArg"])
        })
        .collect();

    let sweep_ids = exec_state
        .global
        .artifacts
        .graph
        .values()
        .filter_map(|artifact| match artifact {
            Artifact::Sweep(sweep) => Some(SweepIds {
                sweep_id: sweep.id,
                path_id: sweep.path_id,
            }),
            _ => None,
        })
        .collect();

    let path_back_links = exec_state
        .global
        .artifacts
        .graph
        .values()
        .filter_map(|artifact| match artifact {
            Artifact::Path(path) => Some((path.id, path.sweep_id)),
            _ => None,
        })
        .collect();

    ctx.close().await;

    ObservedIds {
        sent_to_engine,
        recorded_in_operations,
        sweep_ids,
        path_back_links,
    }
}

/// Collects every value under an artifact-id key, at any depth. The nesting
/// AND the key spelling differ per kind: `OpSolid`/`OpSketch`/`OpHelix` are
/// `rename_all = "camelCase"` structs one level down (`artifactId`), while
/// `OpKclValue::Plane`, `GdtAnnotation` and `ImportedGeometry` are flat enum
/// variants with no rename, so they serialize as `artifact_id`. The TypeScript
/// client reads both shapes in `artifactIdsInOpValue`
/// (`src/lib/operations.ts`), so both are collected on each side.
fn artifact_ids_in(value: &serde_json::Value) -> Vec<ArtifactId> {
    match value {
        serde_json::Value::Object(map) => map
            .iter()
            .flat_map(|(key, inner)| {
                if key == "artifactId" || key == "artifact_id" {
                    vec![ArtifactId::new(Uuid::parse_str(inner.as_str().unwrap()).unwrap())]
                } else {
                    artifact_ids_in(inner)
                }
            })
            .collect(),
        serde_json::Value::Array(values) => values.iter().flat_map(artifact_ids_in).collect(),
        _ => Vec::new(),
    }
}

/// The kind's artifact id, reinterpreted in the engine domain, is among the
/// sent ids. Some std functions send their own internal `ObjectVisible`
/// commands (the KCL `sweep()` function hides its trajectory sketch,
/// sketch-on-plane hides the backing plane object), so the sent set may be
/// larger than the one object the test hides.
#[track_caller]
fn assert_ids_equal(observed: &ObservedIds) {
    let hidden = observed.hidden_object_ids();
    assert_eq!(
        observed.recorded_in_operations.len(),
        1,
        "expected exactly one artifact id recorded on the hide operation, got {:?}",
        observed.recorded_in_operations
    );
    let recorded = observed.recorded_in_operations[0];
    assert!(
        hidden.contains(&in_engine_domain(recorded)),
        "for this kind the artifact id and the engine object id should be the same uuid; \
         recorded on the operation: {recorded:?}, sent as hidden: {hidden:?}"
    );
}

/// The kind diverges across the domains: the artifact id recorded on the
/// operation is an `Artifact::Sweep` node's id, and the engine object id
/// actually sent is that node's `path_id`.
#[track_caller]
fn assert_sweep_bridge(observed: &ObservedIds) {
    let hidden = observed.hidden_object_ids();
    assert_eq!(
        observed.recorded_in_operations.len(),
        1,
        "expected exactly one artifact id recorded on the hide operation, got {:?}",
        observed.recorded_in_operations
    );
    let recorded = observed.recorded_in_operations[0];
    assert!(
        !hidden.contains(&in_engine_domain(recorded)),
        "expected the artifact id and the engine object id to DIFFER for this kind; if they are \
         now equal, the divergence this file pins has been fixed -- update the named-views \
         apply-path translation and these tests together. recorded on the operation: {recorded:?}, \
         sent as hidden: {hidden:?}"
    );
    let bridge = observed.sweep_ids.iter().find(|sweep| sweep.sweep_id == recorded);
    let Some(SweepIds { path_id, .. }) = bridge else {
        panic!("no Artifact::Sweep node with id {recorded:?} in the artifact graph");
    };
    assert!(
        hidden.contains(&in_engine_domain(*path_id)),
        "the Artifact::Sweep node's path_id should be the engine object id that was sent, since \
         that node is the only route from the artifact id domain to the engine domain; \
         path_id: {path_id:?}, sent as hidden: {hidden:?}"
    );
}

/// Asserts that a `mirror3d` body owns its engine object id.
///
/// A mirrored node inherits its subtype from the source body, so subtype alone
/// cannot decide the translation. `mirror_3d_artifact_updates` copies the source
/// body's `Artifact::Sweep` node, overwrites `id` with the mirrored body's engine
/// object id, and leaves `path_id` naming the SOURCE body's path.
///
/// Three assertions pin what a client depends on:
///
/// - the recorded artifact id, reinterpreted, is among the sent ids, so the two
///   domains agree for this body;
/// - `path_id` is a different id, and the path it names does not record the
///   mirrored node as its sweep;
/// - `path_id` was NOT sent, so translating through it addresses the source
///   body.
#[track_caller]
fn assert_mirrored_body_owns_its_engine_id(observed: &ObservedIds) {
    let hidden = observed.hidden_object_ids();
    assert_eq!(
        observed.recorded_in_operations.len(),
        1,
        "expected exactly one artifact id recorded on the hide operation, got {:?}",
        observed.recorded_in_operations
    );
    let recorded = observed.recorded_in_operations[0];
    assert!(
        hidden.contains(&in_engine_domain(recorded)),
        "a mirrored body should hold the same uuid in both domains; recorded on the operation: \
         {recorded:?}, sent as hidden: {hidden:?}"
    );

    let mirrored = observed.sweep_ids.iter().find(|sweep| sweep.sweep_id == recorded);
    let Some(SweepIds { path_id, .. }) = mirrored else {
        panic!("no Artifact::Sweep node with id {recorded:?} in the artifact graph");
    };
    assert_ne!(
        *path_id, recorded,
        "the mirrored node should carry the source body's path_id, which is a different id"
    );

    let Some((_, back_link)) = observed.path_back_links.iter().find(|(path, _)| path == path_id) else {
        panic!("no Artifact::Path node with id {path_id:?} in the artifact graph");
    };
    assert_ne!(
        *back_link,
        Some(recorded),
        "the base path should NOT record the mirrored node as its sweep; if it now does, the \
         back-link a client tests no longer separates a mirror3d copy from an original -- update \
         the named-views apply-path translation and this test together. path_id: {path_id:?}"
    );
    assert!(
        !hidden.contains(&in_engine_domain(*path_id)),
        "path_id was not sent for this hide, so translating the mirrored body through it would \
         address the source body instead; path_id: {path_id:?}, sent as hidden: {hidden:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_sketch() {
    let code = r#"sketchHidden = sketch(on = XY) {
  circle1 = circle(start = [var 3, var 0], center = [var 0, var 0])
}

hide(sketchHidden)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_extrude() {
    let code = r#"sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var 0, var 10])
  line4 = line(start = [var 0, var 10], end = [var 0, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

part001 = extrude(region(point = [5, 5], sketch = sketch001), length = 5)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

/// The twist subtype reaches `TwistExtrude` but shares `do_post_extrude` with
/// plain extrusion, so it diverges the same way. That shared handling is the
/// only reason it does, and nothing else in the suite sends that command.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_extrude_twist() {
    let code = r#"sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var 0, var 10])
  line4 = line(start = [var 0, var 10], end = [var 0, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

part001 = extrude(region(point = [5, 5], sketch = sketch001), length = 5, twistAngle = 45deg)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_revolve() {
    let code = r#"sketch001 = sketch(on = XZ) {
  line1 = line(start = [var 5, var 0], end = [var 8, var 0])
  line2 = line(start = [var 8, var 0], end = [var 8, var 3])
  line3 = line(start = [var 8, var 3], end = [var 5, var 3])
  line4 = line(start = [var 5, var 3], end = [var 5, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

part001 = revolve(region(point = [6.5, 1.5], sketch = sketch001), axis = Y)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

/// A solved segment as the axis reaches `RevolveAboutEdge`, which the artifact
/// graph records under its own subtype. It calls the same `do_post_extrude` as
/// the axis form, so it diverges identically.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_revolve_about_edge() {
    let code = r#"sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -3.34mm, var -1.89mm], end = [var -1.62mm, var -1.89mm])
  line2 = line(start = [var -1.62mm, var -1.89mm], end = [var -1.62mm, var 0.56mm])
  line3 = line(start = [var -1.62mm, var 0.56mm], end = [var -3.34mm, var 0.56mm])
  line4 = line(start = [var -3.34mm, var 0.56mm], end = [var -3.34mm, var -1.89mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  line5 = line(start = [var 0.94mm, var -3.66mm], end = [var 0.05mm, var 4.57mm])
}

region001 = region(segments = [sketch001.line1, sketch001.line2])
part001 = revolve(region001, angle = 36deg, axis = sketch001.line5)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_sweep() {
    let code = r#"@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2, var 0], center = [var 0, var 0])
}
profile = region(point = [0, 0], sketch = sketch001)

sketch002 = sketch(on = XZ) {
  line1 = line(start = [var 0, var 0], end = [var 0, var 15])
}
path = [sketch002.line1]

part001 = sweep(path, profile, version = 2)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

/// Loft is the sweep subtype that does NOT diverge: `loft.rs` overrides the
/// base sketch's id with the loft command id before `do_post_extrude`
/// ("Override its id with the loft id so we can get its faces later"), so the
/// solid's `id` equals its `artifact_id` and the engine knows the body under
/// the command id directly. Consequence for the client's apply translation:
/// `pathId` is the engine id for extrusion/revolve/sweep subtypes only; a
/// loft sweep's engine id is its own artifact id (its `pathId` is merely the
/// first section).
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_loft() {
    let code = r#"sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 6, var 0], center = [var 0, var 0])
}

sketch002 = sketch(on = offsetPlane(XY, offset = 12)) {
  circle1 = circle(start = [var 2, var 0], center = [var 0, var 0])
}

part001 = loft([
  region(point = [0, 0], sketch = sketch001),
  region(point = [0, 0], sketch = sketch002)
])

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

/// `blend` is the second sweep subtype that does not diverge. `surfaces.rs`
/// builds its result as `Solid { id, artifact_id: id.into() }`, so the engine
/// knows the body under its artifact id. Its KCL function takes edges, not
/// sketches, so its `path_id` is a surface's path.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_blend() {
    let code = r#"sketch001 = sketch(on = YZ) {
  line1 = line(start = [var 4.1mm, var -0.1mm], end = [var 5.5mm, var 0mm])
  line2 = line(start = [var 5.5mm, var 0mm], end = [var 5.5mm, var 3mm])
  line3 = line(start = [var 5.5mm, var 3mm], end = [var 3.9mm, var 2.8mm])
  line4 = line(start = [var 4.1mm, var 3mm], end = [var 4.5mm, var -0.2mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

sketch002 = sketch(on = -XZ) {
  line5 = line(start = [var -5.3mm, var -0.1mm], end = [var -3.5mm, var -0.1mm])
  line6 = line(start = [var -3.5mm, var -0.1mm], end = [var -3.5mm, var 3.1mm])
  line7 = line(start = [var -3.5mm, var 4.5mm], end = [var -5.4mm, var 4.5mm])
  line8 = line(start = [var -5.3mm, var 3.1mm], end = [var -5.3mm, var -0.1mm])
  coincident([line5.end, line6.start])
  coincident([line6.end, line7.start])
  coincident([line7.end, line8.start])
  coincident([line8.end, line5.start])
}

region001 = region(segments = [sketch002.line5, sketch002.line6])
extrude001 = extrude(region001, length = -2mm, bodyType = SURFACE)
region002 = region(segments = [sketch001.line1, sketch001.line2])
extrude002 = extrude(region002, length = -2mm, bodyType = SURFACE)

part001 = blend([extrude001.sketch.tags.line7, extrude002.sketch.tags.line3])

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_gdt_annotation() {
    let code = r#"@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 5, var 0])
  line2 = line(start = [var 5, var 0], end = [var 5, var 5])
  line3 = line(start = [var 5, var 5], end = [var 0, var 5])
  line4 = line(start = [var 0, var 5], end = [var 0, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

region001 = region(point = [2.5, 2.5], sketch = sketch001)
extrude(region001, length = 5)

label = gdt::datum(
  face = region001.tags.line2,
  name = "A",
  framePosition = [10, 0],
  framePlane = XZ,
)

hide(label)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

/// Route-independent: the program contains no sketch, so V1/V2 does not
/// apply and this kind is pinned once.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_plane() {
    let code = r#"plane001 = offsetPlane(YZ, offset = 500)

hide(plane001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

/// Route-independent: the program contains no sketch, so V1/V2 does not
/// apply and this kind is pinned once.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_helix() {
    let code = r#"helix001 = helix(
  axis = Z,
  radius = 5,
  length = 10,
  revolutions = 3,
  angleStart = 360,
  ccw = false,
)

hide(helix001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}

/// Route-independent: the program contains no sketch, so V1/V2 does not
/// apply and this kind is pinned once.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_imported_geometry() {
    let code = r#"import "cube.step" as cube

cube

hide(cube)
"#;
    let current_file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("inputs")
        .join("main.kcl");
    let observed = execute_and_observe(code, Some(current_file)).await;
    assert_ids_equal(&observed);
}

/// A pattern of an extruded solid: the ORIGINAL diverges across the domains,
/// while every COPY holds the same uuid in both. The combined contract: every
/// artifact id recorded on the operation either is itself the engine object
/// id sent, or routes to one through an `Artifact::Sweep` node's `path_id`.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_pattern_copies() {
    let code = r#"sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 5, var 0])
  line2 = line(start = [var 5, var 0], end = [var 5, var 5])
  line3 = line(start = [var 5, var 5], end = [var 0, var 5])
  line4 = line(start = [var 0, var 5], end = [var 0, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

part001 = extrude(region(point = [2, 2], sketch = sketch001), length = 5)
  |> patternLinear3d(instances = 3, distance = 15, axis = [1, 0, 0])

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    let hidden = observed.hidden_object_ids();
    assert_eq!(
        observed.recorded_in_operations.len(),
        3,
        "expected three artifact ids recorded on the hide operation"
    );

    let mut bridged = 0;
    for recorded in &observed.recorded_in_operations {
        if hidden.contains(&in_engine_domain(*recorded)) {
            continue;
        }
        let bridge = observed.sweep_ids.iter().find(|sweep| sweep.sweep_id == *recorded);
        let Some(SweepIds { path_id, .. }) = bridge else {
            panic!(
                "recorded artifact id {recorded:?} is neither an engine object id that was sent \
                 nor an Artifact::Sweep node's id"
            );
        };
        assert!(
            hidden.contains(&in_engine_domain(*path_id)),
            "recorded artifact id {recorded:?} routes to path_id {path_id:?}, which was never sent"
        );
        bridged += 1;
    }
    assert_eq!(
        bridged, 1,
        "exactly the original solid should need the Artifact::Sweep route"
    );
}

// The `_v1` tests below pin the classic pipeline's OWN behavior -- the parts
// of the old route that differ from sketch V2 and remain in production. They
// are deliberately few; sketch V2 is the default suite above.

/// A mirrored extrusion. The node's subtype is `extrusion`, its two id domains
/// agree, and its `path_id` names the source body's path. That combination is
/// what makes the subtype table insufficient on its own.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_mirror3d() {
    let code = r#"sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var 0, var 10])
  line4 = line(start = [var 0, var 10], end = [var 0, var 0])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

part001 = extrude(region(point = [5, 5], sketch = sketch001), length = 5)
mirrored001 = mirror3d(part001, across = YZ)

hide(mirrored001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_mirrored_body_owns_its_engine_id(&observed);
}

/// Classic route only: the extrude consumes its profile, so the body answers
/// to the profile's engine object id. This is the divergence as it was first
/// found; the V2 route reaches the same relation through the region's id.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_extrude_v1() {
    let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> close()
  |> extrude(length = 5)

hide(part001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_sweep_bridge(&observed);
}

/// Classic route only: an unextruded pipeline sketch carries the same uuid in
/// both domains, like a solved V2 block does.
#[tokio::test(flavor = "multi_thread")]
async fn named_views_hide_ids_sketch_v1() {
    let code = r#"sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> close()

hide(sketch001)
"#;
    let observed = execute_and_observe(code, None).await;
    assert_ids_equal(&observed);
}
