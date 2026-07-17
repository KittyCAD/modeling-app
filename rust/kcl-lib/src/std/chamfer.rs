//! Standard library chamfers.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kcmc::shared::Angle;
use kcmc::shared::CutStrategy;
use kcmc::shared::CutTypeV2;
use kcmc::shared::EdgeCutVersion;
use kittycad_modeling_cmds::{self as kcmc};

use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ChamferSurface;
use crate::execution::EdgeCut;
use crate::execution::ExecState;
use crate::execution::ExtrudeSurface;
use crate::execution::GeoMeta;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Sketch;
use crate::execution::Solid;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagNode;
use crate::std::Args;
use crate::std::csg::CsgAlgorithm;
use crate::std::fillet::EdgeReference;

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Create chamfers on tagged paths.
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid: Box<Solid> = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let length: TyF64 = args.get_kw_arg("length", &RuntimeType::length(), exec_state)?;
    let second_length = args.get_kw_arg_opt("secondLength", &RuntimeType::length(), exec_state)?;
    let angle = args.get_kw_arg_opt("angle", &RuntimeType::angle(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());
    let edge_cut_number: Option<u32> = args.get_kw_arg_opt("version", &RuntimeType::count(), exec_state)?;
    let edge_cut_version: EdgeCutVersion = edge_cut_number
        .map(|num| {
            num.try_into().map_err(|()| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!("{} is not a version of the Zoo edge cut algorithm", num),
                    vec![args.source_range],
                ))
            })
        })
        .transpose()?
        .unwrap_or_default();

    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    // Edge specifiers are object-shaped payloads, so there is no narrow RuntimeType for them yet.
    // Keep this broad at the boundary and validate the shape in parse_tagged_edge_inputs.
    let edge_refs = args.get_kw_arg_opt("edges", &RuntimeType::any_array(), exec_state)?;
    let tags = args.kw_arg_edge_array_and_source_opt("tags")?;

    let edge_inputs = super::fillet::parse_tagged_edge_inputs(
        edge_refs,
        tags,
        Some(solid.as_ref()),
        exec_state,
        &args,
        "You must provide either 'tags' or 'edges' to chamfer edges",
        "You must provide either 'tags' or 'edges' to chamfer edges, not both",
    )
    .await?;

    match edge_inputs {
        super::fillet::TaggedEdgeInputs::EngineRefs(edge_refs) => {
            let value = inner_chamfer_with_engine_refs(
                solid,
                length,
                edge_refs,
                second_length,
                angle,
                csg_algorithm,
                edge_cut_version,
                tag,
                exec_state,
                args,
            )
            .await?;
            Ok(KclValue::Solid { value })
        }
        super::fillet::TaggedEdgeInputs::Tags(tags) => {
            let value = inner_chamfer(
                solid,
                length,
                tags,
                second_length,
                angle,
                None,
                tag,
                csg_algorithm,
                edge_cut_version,
                exec_state,
                args,
            )
            .await?;
            Ok(KclValue::Solid { value })
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn inner_chamfer(
    solid: Box<Solid>,
    length: TyF64,
    tags: Vec<(EdgeReference, crate::SourceRange)>,
    second_length: Option<TyF64>,
    angle: Option<TyF64>,
    custom_profile: Option<Sketch>,
    tag: Option<TagNode>,
    csg_algorithm: CsgAlgorithm,
    edge_cut_version: EdgeCutVersion,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // If you try and tag multiple edges with a tagged chamfer, we want to return an
    // error to the user that they can only tag one edge at a time.
    if tag.is_some() && tags.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each tag.".to_string(),
            vec![args.source_range],
        )));
    }

    if angle.is_some() && second_length.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot specify both an angle and a second length. Specify only one.".to_string(),
            vec![args.source_range],
        )));
    }

    let strategy = if second_length.is_some() || angle.is_some() || custom_profile.is_some() {
        CutStrategy::Csg
    } else {
        Default::default()
    };

    let second_distance = second_length.map(|x| LengthUnit(x.to_mm()));
    let angle = angle.map(|x| Angle::from_degrees(x.to_degrees(exec_state, args.source_range)));
    if let Some(angle) = angle
        && (angle.ge(&Angle::quarter_circle()) || angle.le(&Angle::zero()))
    {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The angle of a chamfer must be greater than zero and less than 90 degrees.".to_string(),
            vec![args.source_range],
        )));
    }

    let cut_type = if let Some(custom_profile) = custom_profile {
        // Hide the custom profile since it's no longer its own profile
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::ObjectVisible::builder()
                        .object_id(custom_profile.id)
                        .hidden(true)
                        .build(),
                ),
            )
            .await?;
        CutTypeV2::Custom {
            path: custom_profile.id,
        }
    } else {
        CutTypeV2::Chamfer {
            distance: LengthUnit(length.to_mm()),
            second_distance,
            angle,
            swap: false,
        }
    };

    let mut solid = solid.clone();
    let mut tag_entries: Vec<crate::execution::DirectTagFilletTagEntry> = Vec::new();
    for (edge_ref, source_range) in &tags {
        let edge_id = match edge_ref {
            EdgeReference::Uuid(u) => *u,
            EdgeReference::Tag(t) => args.get_tag_engine_info(exec_state, t)?.id,
        };
        let tag_identifier = match edge_ref {
            EdgeReference::Tag(t) => t.value.clone(),
            EdgeReference::Uuid(_) => String::new(),
        };
        if tag_identifier.is_empty() {
            exec_state.record_edge_refactor_meta_from_pending(edge_id, Some(solid.id), *source_range, None);
            continue;
        }
        if let Ok(face_ids) = super::edge::get_face_ids_for_edge(exec_state, solid.id, edge_id, &args).await
            && let [a, b] = face_ids.as_slice()
        {
            tag_entries.push(crate::execution::DirectTagFilletTagEntry {
                tag_identifier,
                edge_id,
                face_ids: [*a, *b],
            });
        }
    }
    if !tag_entries.is_empty() {
        exec_state.record_direct_tag_fillet_meta(crate::execution::DirectTagFilletMeta {
            call_source_range: args.source_range,
            tags: tag_entries,
        });
    }
    for (edge_tag, _) in tags {
        let edge_ids = edge_tag.get_all_engine_ids(exec_state, &args)?;
        for edge_id in edge_ids {
            let id = exec_state.next_uuid();
            exec_state
                .batch_end_cmd(
                    ModelingCmdMeta::from_args_id(exec_state, &args, id),
                    ModelingCmd::from(
                        mcmd::Solid3dCutEdges::builder()
                            .use_legacy(csg_algorithm.is_legacy())
                            .edge_ids(vec![edge_id])
                            .extra_face_ids(vec![])
                            .strategy(strategy)
                            .object_id(solid.id)
                            // We can let the user set this in the future.
                            .tolerance(LengthUnit(DEFAULT_TOLERANCE))
                            .cut_type(cut_type)
                            .version(edge_cut_version)
                            .build(),
                    ),
                )
                .await?;

            solid.edge_cuts.push(EdgeCut::Chamfer {
                id,
                edge_id,
                length: length.clone(),
                tag: Box::new(tag.clone()),
            });

            if let Some(ref tag) = tag {
                solid.value.push(ExtrudeSurface::Chamfer(ChamferSurface {
                    face_id: id,
                    tag: Some(tag.clone()),
                    geo_meta: GeoMeta {
                        id,
                        metadata: args.source_range.into(),
                    },
                }));
            }
        }
    }

    Ok(solid)
}

#[expect(clippy::too_many_arguments)]
async fn inner_chamfer_with_engine_refs(
    solid: Box<Solid>,
    length: TyF64,
    edge_references: Vec<kcmc::shared::EdgeSpecifier>,
    second_length: Option<TyF64>,
    angle: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    edge_cut_version: EdgeCutVersion,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    if tag.is_some() && edge_references.len() > 1 {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You can only tag one edge at a time with a tagged chamfer. Either delete the tag for the chamfer fn if you don't need it OR separate into individual chamfer functions for each edgeRef.".to_string(),
            vec![args.source_range],
        )));
    }

    if angle.is_some() && second_length.is_some() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot specify both an angle and a second length. Specify only one.".to_string(),
            vec![args.source_range],
        )));
    }

    let strategy = if second_length.is_some() || angle.is_some() {
        CutStrategy::Csg
    } else {
        Default::default()
    };

    let second_distance = second_length.map(|x| LengthUnit(x.to_mm()));
    let angle = angle.map(|x| Angle::from_degrees(x.to_degrees(exec_state, args.source_range)));
    if let Some(angle) = angle
        && (angle.ge(&Angle::quarter_circle()) || angle.le(&Angle::zero()))
    {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "The angle of a chamfer must be greater than zero and less than 90 degrees.".to_string(),
            vec![args.source_range],
        )));
    }

    let cut_type = CutTypeV2::Chamfer {
        distance: LengthUnit(length.to_mm()),
        second_distance,
        angle,
        swap: false,
    };

    let id = exec_state.next_uuid();
    let num_extra_ids = edge_references.len().saturating_sub(1);
    let mut extra_face_ids = Vec::with_capacity(num_extra_ids);
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }

    let mut solid = solid.clone();
    exec_state
        .batch_end_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(
                mcmd::Solid3dCutEdgeReferences::builder()
                    .object_id(solid.id)
                    .edges_references(edge_references)
                    .cut_type(cut_type)
                    .tolerance(LengthUnit(DEFAULT_TOLERANCE))
                    .strategy(strategy)
                    .extra_face_ids(extra_face_ids)
                    .use_legacy(csg_algorithm.is_legacy())
                    .version(edge_cut_version)
                    .build(),
            ),
        )
        .await?;

    solid.pending_edge_cut_ids.push(id);

    if let Some(ref tag) = tag {
        solid.value.push(ExtrudeSurface::Chamfer(ChamferSurface {
            face_id: id,
            tag: Some(tag.clone()),
            geo_meta: GeoMeta {
                id,
                metadata: args.source_range.into(),
            },
        }));
    }

    Ok(solid)
}
