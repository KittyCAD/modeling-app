//! Standard library fillets.

use anyhow::Result;
use indexmap::IndexMap;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::CutTypeV2;
use kcmc::shared::EdgeCutVersion;
use kittycad_modeling_cmds as kcmc;
use serde::Deserialize;
use serde::Serialize;

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::EdgeCut;
use crate::execution::ExecState;
use crate::execution::ExtrudeSurface;
use crate::execution::FilletSurface;
use crate::execution::GeoMeta;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::KclVersion;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::TagIdentifier;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::csg::CsgAlgorithm;

/// A tag or a uuid of an edge.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(untagged)]
pub enum EdgeReference {
    /// A uuid of an edge.
    Uuid(uuid::Uuid),
    /// A tag of an edge.
    Tag(Box<TagIdentifier>),
}

impl EdgeReference {
    pub fn get_engine_id(&self, exec_state: &mut ExecState, args: &Args) -> Result<uuid::Uuid, KclError> {
        match self {
            EdgeReference::Uuid(uuid) => Ok(*uuid),
            EdgeReference::Tag(tag) => Ok(args.get_tag_engine_info(exec_state, tag)?.id),
        }
    }

    /// Get all engine IDs for this edge reference.
    /// For region-mapped tags, returns multiple IDs (one per region segment).
    pub fn get_all_engine_ids(&self, exec_state: &mut ExecState, args: &Args) -> Result<Vec<uuid::Uuid>, KclError> {
        match self {
            EdgeReference::Uuid(uuid) => Ok(vec![*uuid]),
            EdgeReference::Tag(tag) => {
                let infos = tag.get_all_cur_info();
                if infos.is_empty() {
                    // Fallback to single ID lookup (checks the stack).
                    Ok(vec![args.get_tag_engine_info(exec_state, tag)?.id])
                } else {
                    Ok(infos.iter().map(|i| i.id).collect())
                }
            }
        }
    }
}

pub(super) fn validate_unique<T: Eq + std::hash::Hash>(tags: &[(T, SourceRange)]) -> Result<(), KclError> {
    // Check if tags contains any duplicate values.
    let mut tag_counts: IndexMap<&T, Vec<SourceRange>> = Default::default();
    for tag in tags {
        tag_counts.entry(&tag.0).or_insert(Vec::new()).push(tag.1);
    }
    let mut duplicate_tags_source = Vec::new();
    for (_tag, count) in tag_counts {
        if count.len() > 1 {
            duplicate_tags_source.extend(count)
        }
    }
    if !duplicate_tags_source.is_empty() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "The same edge ID is being referenced multiple times, which is not allowed. Please select a different edge"
                .to_string(),
            duplicate_tags_source,
        )));
    }
    Ok(())
}

pub(super) enum TaggedEdgeInputs {
    Tags(Vec<(EdgeReference, SourceRange)>),
    EngineRefs(Vec<kcmc::shared::EdgeSpecifier>),
}

pub(super) async fn parse_tagged_edge_inputs(
    edge_refs: Option<Vec<KclValue>>,
    tags_with_source: Option<Vec<(EdgeReference, SourceRange)>>,
    solid: Option<&Solid>,
    exec_state: &mut ExecState,
    args: &Args,
    missing_args_message: &str,
    both_args_message: &str,
) -> Result<TaggedEdgeInputs, KclError> {
    match (edge_refs, tags_with_source) {
        (Some(_), Some(_)) => Err(KclError::new_semantic(KclErrorDetails::new(
            both_args_message.to_owned(),
            vec![args.source_range],
        ))),
        (Some(edge_refs), None) => {
            let edge_refs_parsed =
                super::edge::parse_edge_refs_to_references(edge_refs, solid, exec_state, args).await?;
            Ok(TaggedEdgeInputs::EngineRefs(edge_refs_parsed))
        }
        (None, Some(tags_with_source)) => {
            validate_unique(&tags_with_source)?;
            Ok(TaggedEdgeInputs::Tags(tags_with_source))
        }
        (None, None) => Err(KclError::new_semantic(KclErrorDetails::new(
            missing_args_message.to_owned(),
            vec![args.source_range],
        ))),
    }
}

/// Create fillets on tagged paths.
pub async fn fillet(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body: GeometryWithImportedGeometry = args.get_unlabeled_kw_arg(
        "solid",
        &RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::imported()]),
        exec_state,
    )?;
    let radius: TyF64 = args.get_kw_arg("radius", &RuntimeType::length(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());
    let edge_cut_number: Option<u32> = args.get_kw_arg_opt("version", &RuntimeType::count(), exec_state)?;
    let requested_edge_cut_version: Option<EdgeCutVersion> = edge_cut_number
        .map(|num| {
            num.try_into().map_err(|()| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!("{} is not a version of the Zoo edge cut algorithm", num),
                    vec![args.source_range],
                ))
            })
        })
        .transpose()?;
    let edge_cut_version = edge_cut_version_for_body(
        requested_edge_cut_version,
        &body,
        exec_state.kcl_version(),
        args.source_range,
    )?;

    // Edge specifiers are object-shaped payloads, so there is no narrow RuntimeType for them yet.
    // Keep this broad at the boundary and validate the shape in parse_tagged_edge_inputs.
    let edge_refs: Option<Vec<KclValue>> = args.get_kw_arg_opt("edges", &RuntimeType::any_array(), exec_state)?;
    let tags = args.kw_arg_edge_array_and_source_opt("tags")?;

    let edge_inputs = parse_tagged_edge_inputs(
        edge_refs,
        tags,
        body.as_solid(),
        exec_state,
        &args,
        "You must provide either 'tags' or 'edges' to fillet edges",
        "You must provide either 'tags' or 'edges' to fillet edges, not both",
    )
    .await?;

    match edge_inputs {
        TaggedEdgeInputs::EngineRefs(edge_refs) => {
            let params = FilletEdgeRefParams {
                radius,
                tolerance,
                csg_algorithm,
                edge_cut_version,
                tag,
            };
            let value = inner_fillet_with_engine_refs(body, edge_refs, params, exec_state, args).await?;
            Ok(KclValue::from(value))
        }
        TaggedEdgeInputs::Tags(tags) => {
            let value = inner_fillet(
                body,
                radius,
                tags,
                tolerance,
                csg_algorithm,
                tag,
                edge_cut_version,
                exec_state,
                args,
            )
            .await?;
            Ok(KclValue::from(value))
        }
    }
}

/// What version of the fillet/chamfer algorithm should this KCL version use?
pub(super) fn default_edge_cut_version(kcl_version: KclVersion) -> EdgeCutVersion {
    if kcl_version <= KclVersion::V2 {
        EdgeCutVersion::V1
    } else {
        EdgeCutVersion::V2
    }
}

pub(super) fn edge_cut_version_for_body(
    requested: Option<EdgeCutVersion>,
    body: &GeometryWithImportedGeometry,
    kcl_version: KclVersion,
    source_range: SourceRange,
) -> Result<EdgeCutVersion, KclError> {
    if matches!(body, GeometryWithImportedGeometry::ImportedGeometry(_)) {
        if let Some(requested) = requested
            && requested != EdgeCutVersion::V2
        {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Imported geometry edge cuts require version = 2".to_owned(),
                vec![source_range],
            )));
        }
        return Ok(EdgeCutVersion::V2);
    }

    Ok(requested.unwrap_or_else(|| default_edge_cut_version(kcl_version)))
}

#[allow(clippy::too_many_arguments)]
async fn inner_fillet(
    mut body: GeometryWithImportedGeometry,
    radius: TyF64,
    tags: Vec<(EdgeReference, SourceRange)>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    tag: Option<TagNode>,
    edge_cut_version: EdgeCutVersion,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<GeometryWithImportedGeometry, KclError> {
    // If you try and tag multiple edges with a tagged fillet, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && tags.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged fillet. Either delete the tag for the fillet fn if you don't need it OR separate into individual fillet functions for each tag.".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        }));
    }
    if tags.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must fillet at least one tag".to_owned(),
            backtrace: Default::default(),
        }));
    }
    reject_tagged_imported_edge_cut(&body, tag.as_ref(), &args)?;

    let body_id = body.id(&args.ctx).await?;
    let mut edge_ids = Vec::new();
    let mut tag_entries: Vec<crate::execution::DirectTagFilletTagEntry> = Vec::new();
    for (edge_ref, source_range) in &tags {
        let ids = edge_ref.get_all_engine_ids(exec_state, &args)?;
        edge_ids.extend(ids.iter().copied());
        let tag_identifier = match edge_ref {
            EdgeReference::Tag(t) => t.value.clone(),
            EdgeReference::Uuid(_) => String::new(),
        };
        for edge_id in ids {
            if let Ok(face_ids) = super::edge::get_face_ids_for_edge(exec_state, body_id, edge_id, &args).await
                && let [a, b] = face_ids.as_slice()
            {
                if !tag_identifier.is_empty() {
                    tag_entries.push(crate::execution::DirectTagFilletTagEntry {
                        tag_identifier: tag_identifier.clone(),
                        edge_id,
                        face_ids: [*a, *b],
                    });
                } else {
                    exec_state.record_edge_refactor_meta_from_pending(edge_id, *source_range, [*a, *b]);
                }
            }
        }
    }
    if !tag_entries.is_empty() {
        exec_state.record_direct_tag_fillet_meta(crate::execution::DirectTagFilletMeta {
            call_source_range: args.source_range,
            tags: tag_entries,
        });
    }

    let id = exec_state.next_uuid();
    let mut extra_face_ids = Vec::new();
    let num_extra_ids = edge_ids.len() - 1;
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }
    batch_edge_cut_for_body(
        exec_state,
        &args,
        id,
        &body,
        ModelingCmd::from(
            mcmd::Solid3dCutEdges::builder()
                .use_legacy(csg_algorithm.is_legacy())
                .edge_ids(edge_ids.clone())
                .extra_face_ids(extra_face_ids)
                .strategy(Default::default())
                .object_id(body_id)
                .version(edge_cut_version)
                .tolerance(LengthUnit(
                    tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                ))
                .cut_type(CutTypeV2::Fillet {
                    radius: LengthUnit(radius.to_mm()),
                    second_length: None,
                })
                .build(),
        ),
    )
    .await?;

    if let GeometryWithImportedGeometry::Solid(solid) = &mut body {
        let new_edge_cuts = edge_ids.into_iter().map(|edge_id| EdgeCut::Fillet {
            id,
            edge_id,
            radius: radius.clone(),
            tag: Box::new(tag.clone()),
        });
        solid.edge_cuts.extend(new_edge_cuts);

        if let Some(ref tag) = tag {
            solid.value.push(ExtrudeSurface::Fillet(FilletSurface {
                face_id: id,
                tag: Some(tag.clone()),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            }));
        }
    }

    Ok(body)
}

struct FilletEdgeRefParams {
    radius: TyF64,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    edge_cut_version: EdgeCutVersion,
    tag: Option<TagNode>,
}

async fn inner_fillet_with_engine_refs(
    mut body: GeometryWithImportedGeometry,
    edge_references: Vec<kcmc::shared::EdgeSpecifier>,
    params: FilletEdgeRefParams,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<GeometryWithImportedGeometry, KclError> {
    if edge_references.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails {
            source_ranges: vec![args.source_range],
            message: "You must provide at least one edge".to_owned(),
            backtrace: Default::default(),
        }));
    }

    if params.tag.is_some() && edge_references.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails {
            message: "You can only tag one edge at a time with a tagged fillet. Either delete the tag for the fillet fn if you don't need it OR separate into individual fillet functions for each edge.".to_string(),
            source_ranges: vec![args.source_range],
            backtrace: Default::default(),
        }));
    }
    reject_tagged_imported_edge_cut(&body, params.tag.as_ref(), &args)?;

    let body_id = body.id(&args.ctx).await?;

    let id = exec_state.next_uuid();
    let num_extra_ids = edge_references.len().saturating_sub(1);
    let mut extra_face_ids = Vec::with_capacity(num_extra_ids);
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }

    batch_edge_cut_for_body(
        exec_state,
        &args,
        id,
        &body,
        ModelingCmd::from(
            mcmd::Solid3dCutEdgeReferences::builder()
                .object_id(body_id)
                .edges_references(edge_references.clone())
                .cut_type(CutTypeV2::Fillet {
                    radius: LengthUnit(params.radius.to_mm()),
                    second_length: None,
                })
                .tolerance(LengthUnit(
                    params
                        .tolerance
                        .as_ref()
                        .map(|t| t.to_mm())
                        .unwrap_or(DEFAULT_TOLERANCE_MM),
                ))
                .strategy(Default::default())
                .extra_face_ids(extra_face_ids)
                .use_legacy(params.csg_algorithm.is_legacy())
                .version(params.edge_cut_version)
                .build(),
        ),
    )
    .await?;

    if let GeometryWithImportedGeometry::Solid(solid) = &mut body {
        solid.pending_edge_cut_ids.push(id);

        if let Some(ref tag) = params.tag {
            solid.value.push(ExtrudeSurface::Fillet(FilletSurface {
                face_id: id,
                tag: Some(tag.clone()),
                geo_meta: GeoMeta {
                    id,
                    metadata: args.source_range.into(),
                },
            }));
        }
    }

    Ok(body)
}

pub(super) async fn batch_edge_cut_for_body(
    exec_state: &mut ExecState,
    args: &Args,
    id: uuid::Uuid,
    body: &GeometryWithImportedGeometry,
    cmd: ModelingCmd,
) -> Result<(), KclError> {
    let meta = ModelingCmdMeta::from_args_id(exec_state, args, id);
    if matches!(body, GeometryWithImportedGeometry::ImportedGeometry(_)) {
        exec_state.batch_modeling_cmd(meta, cmd).await
    } else {
        exec_state.batch_edge_cut_cmd(meta, cmd).await
    }
}

pub(super) fn reject_tagged_imported_edge_cut(
    body: &GeometryWithImportedGeometry,
    tag: Option<&TagNode>,
    args: &Args,
) -> Result<(), KclError> {
    if tag.is_some() && matches!(body, GeometryWithImportedGeometry::ImportedGeometry(_)) {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Tagging the generated face of an imported geometry edge cut is not supported".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::ExecTestResults;
    use crate::execution::parse_execute;
    use crate::execution::parse_execute_with_project_dir;

    #[tokio::test(flavor = "multi_thread")]
    async fn fillet_accepts_imported_geometry() {
        let code = r#"@settings(kclVersion = 2.0, experimentalFeatures = allow)

@(targetRepresentation = brep)
import "cube.step" as cube

selectedEdge = edgeId(cube, index = 0)
result = fillet(cube, tags = [selectedEdge], radius = 1mm)
"#;
        let project_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("inputs");
        let result = parse_execute_with_project_dir(code, Some(crate::TypedPath(project_dir)))
            .await
            .unwrap();
        let body_id = match result.variable("result") {
            KclValue::ImportedGeometry(value) => value.id,
            value => panic!("expected fillet to preserve imported geometry, got {value:?}"),
        };
        let cut = result
            .root_module_artifact_commands()
            .iter()
            .find_map(|artifact_command| match &artifact_command.command {
                ModelingCmd::Solid3dCutEdges(command) => Some(command),
                _ => None,
            })
            .expect("fillet should emit a Solid3dCutEdges command");
        assert_eq!(cut.object_id, body_id);
        assert_eq!(cut.version, EdgeCutVersion::V2);
    }

    /// Test what version of fillet each KCL version uses by default.
    #[tokio::test(flavor = "multi_thread")]
    async fn fillet_default_depends_on_kcl_version() {
        assert_eq!(emitted_fillet_version("1.0", None).await, EdgeCutVersion::V1);
        assert_eq!(emitted_fillet_version("2.0", None).await, EdgeCutVersion::V1);
        assert_eq!(
            emitted_fillet_version("\"3.0-preview\"", None).await,
            EdgeCutVersion::V2
        );
    }

    /// If the user chooses a fillet algorithm version, KCL should respect it,
    /// and not use that KCL version's default fillet algorithm version.
    #[tokio::test(flavor = "multi_thread")]
    async fn explicit_fillet_version_overrides_kcl_default() {
        assert_eq!(emitted_fillet_version("2.0", Some(2)).await, EdgeCutVersion::V2);
    }

    /// KCL 3.0 removed `fillet(version = )`. Passing it is reported like any
    /// other unknown argument, and the default algorithm is used.
    #[tokio::test(flavor = "multi_thread")]
    async fn fillet_version_is_removed_in_kcl_3() {
        let result = run_fillet("\"3.0-preview\"", Some(1)).await;
        assert!(
            result
                .issues()
                .iter()
                .any(|issue| {
                    issue.message
                        == "`version` is not an argument of `fillet`; it was removed in KCL 3.0, but this program uses KCL 3.0-preview"
                }),
            "issues: {:#?}",
            result.issues()
        );
        assert_eq!(emitted_cut_edges_version(&result), EdgeCutVersion::V2);
    }

    /// For a given KCL version, and optional `fillet(version = )` version,
    /// show what fillet algorithm version the runtime sent to the engine.
    async fn emitted_fillet_version(kcl_version: &str, explicit_version: Option<u32>) -> EdgeCutVersion {
        emitted_cut_edges_version(&run_fillet(kcl_version, explicit_version).await)
    }

    /// Fillet one edge of a box under the given KCL version, optionally
    /// passing `fillet(version = )`.
    async fn run_fillet(kcl_version: &str, explicit_version: Option<u32>) -> ExecTestResults {
        let version_arg = explicit_version
            .map(|version| format!(", version = {version}"))
            .unwrap_or_default();
        let code = format!(
            r#"@settings(kclVersion = {kcl_version}, experimentalFeatures = allow)

profile = sketch(on = XY) {{
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 10mm])
  edge3 = line(start = [var 10mm, var 10mm], end = [var 0mm, var 10mm])
  edge4 = line(start = [var 0mm, var 10mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}}
profileRegion = region(point = [5mm, 5mm], sketch = profile)
solid = extrude(profileRegion, length = 10mm, tagEnd = $top)
fillet(solid, tags = [getCommonEdge(faces = [profileRegion.tags.edge1, top])], radius = 1mm{version_arg})
"#
        );
        parse_execute(&code).await.unwrap()
    }

    /// The fillet algorithm version the runtime sent to the engine.
    fn emitted_cut_edges_version(result: &ExecTestResults) -> EdgeCutVersion {
        result
            .root_module_artifact_commands()
            .iter()
            .find_map(|artifact_command| match &artifact_command.command {
                ModelingCmd::Solid3dCutEdges(command) => Some(command.version),
                _ => None,
            })
            .expect("fillet should emit a Solid3dCutEdges command")
    }

    #[test]
    fn test_validate_unique() {
        let dup_a = SourceRange::from([1, 3, 0]);
        let dup_b = SourceRange::from([10, 30, 0]);
        // Two entries are duplicates (abc) with different source ranges.
        let tags = vec![("abc", dup_a), ("abc", dup_b), ("def", SourceRange::from([2, 4, 0]))];
        let actual = validate_unique(&tags);
        // Both the duplicates should show up as errors, with both of the
        // source ranges they correspond to.
        // But the unique source range 'def' should not.
        let expected = vec![dup_a, dup_b];
        assert_eq!(actual.err().unwrap().source_ranges(), expected);
    }
}
