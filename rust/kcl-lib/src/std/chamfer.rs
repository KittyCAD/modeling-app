//! Standard library chamfers.

use anyhow::Result;
use kcmc::{
    ModelingCmd, each_cmd as mcmd,
    length_unit::LengthUnit,
    shared::{CutStrategy, CutTypeV2},
};
use kittycad_modeling_cmds::{self as kcmc, shared::Angle};

use super::args::TyF64;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        ChamferSurface, EdgeCut, ExecState, ExtrudeSurface, GeoMeta, KclValue, ModelingCmdMeta, Sketch, Solid,
        types::RuntimeType,
    },
    parsing::ast::types::TagNode,
    std::{Args, fillet::EdgeReference},
};

pub(crate) const DEFAULT_TOLERANCE: f64 = 0.0000001;

/// Create chamfers on tagged paths.
pub async fn chamfer(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid: Box<Solid> = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let length: TyF64 = args.get_kw_arg("length", &RuntimeType::length(), exec_state)?;
    let second_length = args.get_kw_arg_opt("secondLength", &RuntimeType::length(), exec_state)?;
    let angle = args.get_kw_arg_opt("angle", &RuntimeType::angle(), exec_state)?;
    // TODO: custom profiles not ready yet

    let tag = args.get_kw_arg_opt("tag", &RuntimeType::tag_decl(), exec_state)?;

    // Primary kwarg is "edges"; accept "edgeRefs" and "edge_refs" for backward compatibility.
    let edge_refs = args.get_kw_arg_opt_any_key(
        &["edges", "edgeRefs", "edge_refs"],
        &RuntimeType::any_array(),
        exec_state,
    )?;
    let tags_result = args.kw_arg_edge_array_and_source_any_key(&["tags", "Tags"]);

    let (has_edge_refs, has_tags) = (edge_refs.is_some(), tags_result.is_ok());

    if has_edge_refs && has_tags {
        // Both provided: merge tags and edges into one list and use the edges engine path.
        let edge_refs = edge_refs.unwrap();
        let tags_with_source = tags_result.unwrap();
        super::fillet::validate_unique(&tags_with_source)?;
        let tags: Vec<EdgeReference> = tags_with_source.into_iter().map(|item| item.0).collect();
        #[cfg(feature = "artifact-graph")]
        {
            let mut tag_entries: Vec<crate::execution::DirectTagFilletTagEntry> = Vec::new();
            for edge_ref in &tags {
                if let Ok(edge_id) = edge_ref.get_engine_id(exec_state, &args)
                    && let Ok(face_ids) = super::edge::get_face_ids_for_edge(exec_state, solid.id, edge_id, &args).await
                {
                    let tag_identifier = match edge_ref {
                        EdgeReference::Tag(t) => t.value.clone(),
                        EdgeReference::Uuid(_) => String::new(),
                    };
                    if !tag_identifier.is_empty() {
                        tag_entries.push(crate::execution::DirectTagFilletTagEntry {
                            tag_identifier,
                            edge_id,
                            face_ids,
                        });
                    }
                }
            }
            if !tag_entries.is_empty() {
                exec_state.record_direct_tag_fillet_meta(crate::execution::DirectTagFilletMeta {
                    call_source_range: args.source_range,
                    tags: tag_entries,
                });
            }
        }
        let tags_as_refs = super::fillet::tags_to_engine_edge_references(solid.id, tags, exec_state, &args).await?;
        let edge_refs_parsed =
            super::fillet::parse_edge_refs_to_references(edge_refs, solid.id, exec_state, &args).await?;
        let mut all_refs = tags_as_refs;
        all_refs.extend(edge_refs_parsed);
        let value =
            inner_chamfer_with_engine_refs(solid, length, all_refs, second_length, angle, tag, exec_state, args)
                .await?;
        Ok(KclValue::Solid { value })
    } else if let Some(edge_refs) = edge_refs {
        let value = inner_chamfer_with_edge_refs(
            solid,
            length,
            edge_refs,
            second_length,
            angle,
            None,
            tag,
            exec_state,
            args,
        )
        .await?;
        Ok(KclValue::Solid { value })
    } else if let Ok(tags_with_source) = tags_result {
        super::fillet::validate_unique(&tags_with_source)?;
        let tags: Vec<EdgeReference> = tags_with_source.into_iter().map(|item| item.0).collect();
        let value = inner_chamfer(solid, length, tags, second_length, angle, None, tag, exec_state, args).await?;
        Ok(KclValue::Solid { value })
    } else {
        let fallback = args.kw_arg_edge_array_and_source_first_other(&["length", "secondLength", "angle", "tag"]);
        match fallback {
            Ok(tags) => {
                super::fillet::validate_unique(&tags)?;
                let tags: Vec<EdgeReference> = tags.into_iter().map(|item| item.0).collect();
                let value =
                    inner_chamfer(solid, length, tags, second_length, angle, None, tag, exec_state, args).await?;
                Ok(KclValue::Solid { value })
            }
            Err(_) => Err(KclError::new_semantic(KclErrorDetails::new(
                "You must provide either 'tags' or 'edges' to chamfer edges".to_string(),
                vec![args.source_range],
            ))),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn inner_chamfer(
    solid: Box<Solid>,
    length: TyF64,
    tags: Vec<EdgeReference>,
    second_length: Option<TyF64>,
    angle: Option<TyF64>,
    custom_profile: Option<Sketch>,
    tag: Option<TagNode>,
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
    #[cfg(feature = "artifact-graph")]
    {
        let mut tag_entries: Vec<crate::execution::DirectTagFilletTagEntry> = Vec::new();
        for edge_ref in &tags {
            let edge_id = match edge_ref {
                EdgeReference::Uuid(u) => *u,
                EdgeReference::Tag(t) => args.get_tag_engine_info(exec_state, t)?.id,
            };
            if let Ok(face_ids) = super::edge::get_face_ids_for_edge(exec_state, solid.id, edge_id, &args).await {
                let tag_identifier = match edge_ref {
                    EdgeReference::Tag(t) => t.value.clone(),
                    EdgeReference::Uuid(_) => String::new(),
                };
                if !tag_identifier.is_empty() {
                    tag_entries.push(crate::execution::DirectTagFilletTagEntry {
                        tag_identifier,
                        edge_id,
                        face_ids,
                    });
                }
            }
        }
        if !tag_entries.is_empty() {
            exec_state.record_direct_tag_fillet_meta(crate::execution::DirectTagFilletMeta {
                call_source_range: args.source_range,
                tags: tag_entries,
            });
        }
    }
    for edge_tag in tags {
        let edge_id = match edge_tag {
            EdgeReference::Uuid(uuid) => uuid,
            EdgeReference::Tag(edge_tag) => args.get_tag_engine_info(exec_state, &edge_tag)?.id,
        };

        let id = exec_state.next_uuid();
        exec_state
            .batch_end_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, id),
                ModelingCmd::from(
                    mcmd::Solid3dCutEdges::builder()
                        .edge_ids(vec![edge_id])
                        .extra_face_ids(vec![])
                        .strategy(strategy)
                        .object_id(solid.id)
                        .tolerance(LengthUnit(DEFAULT_TOLERANCE)) // We can let the user set this in the future.
                        .cut_type(cut_type)
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

    Ok(solid)
}

#[allow(clippy::too_many_arguments)]
async fn inner_chamfer_with_edge_refs(
    solid: Box<Solid>,
    length: TyF64,
    edge_refs: Vec<KclValue>,
    second_length: Option<TyF64>,
    angle: Option<TyF64>,
    _custom_profile: Option<Sketch>,
    tag: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    if tag.is_some() && edge_refs.len() > 1 {
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

    let edge_references = super::fillet::parse_edge_refs_to_references(edge_refs, solid.id, exec_state, &args).await?;
    inner_chamfer_with_engine_refs(
        solid,
        length,
        edge_references,
        second_length,
        angle,
        tag,
        exec_state,
        args,
    )
    .await
}

#[allow(clippy::too_many_arguments)]
async fn inner_chamfer_with_engine_refs(
    solid: Box<Solid>,
    length: TyF64,
    edge_references: Vec<kcmc::shared::EdgeSpecifier>,
    second_length: Option<TyF64>,
    angle: Option<TyF64>,
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
    let mut extra_face_ids = Vec::new();
    let num_extra_ids = edge_references.len().saturating_sub(1);
    for _ in 0..num_extra_ids {
        extra_face_ids.push(exec_state.next_uuid());
    }

    let mut solid = solid.clone();
    exec_state
        .batch_end_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(mcmd::Solid3dCutEdgeReferences {
                object_id: solid.id,
                edges_references: edge_references,
                cut_type,
                tolerance: LengthUnit(DEFAULT_TOLERANCE),
                strategy,
                extra_face_ids,
            }),
        )
        .await?;

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
