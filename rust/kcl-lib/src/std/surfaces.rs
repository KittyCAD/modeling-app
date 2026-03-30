//! Standard library appearance.

use std::collections::HashSet;

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::output as mout;
use kittycad_modeling_cmds::shared::BodyType;
use kittycad_modeling_cmds::shared::FractionOfEdge;
use kittycad_modeling_cmds::shared::SurfaceEdgeReference;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::BoundedEdge;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::SolidCreator;
use crate::execution::types::ArrayLen;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::DEFAULT_TOLERANCE_MM;
use crate::std::args::TyF64;
use crate::std::sketch::FaceTag;

/// Flips the orientation of a surface, swapping which side is the front and which is the reverse.
pub async fn flip_surface(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let surface = args.get_unlabeled_kw_arg("surface", &RuntimeType::solids(), exec_state)?;
    let out = inner_flip_surface(surface, exec_state, args).await?;
    Ok(out.into())
}

async fn inner_flip_surface(
    surfaces: Vec<Solid>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    for surface in &surfaces {
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(mcmd::Solid3dFlip::builder().object_id(surface.id).build()),
            )
            .await?;
    }

    Ok(surfaces)
}

/// Check if this object is a solid or not.
pub async fn is_solid(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let argument = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let meta = vec![crate::execution::Metadata {
        source_range: args.source_range,
    }];

    let res = inner_is_equal_body_type(argument, exec_state, args, BodyType::Solid).await?;
    Ok(KclValue::Bool { value: res, meta })
}

/// Check if this object is a surface or not.
pub async fn is_surface(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let argument = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let meta = vec![crate::execution::Metadata {
        source_range: args.source_range,
    }];

    let res = inner_is_equal_body_type(argument, exec_state, args, BodyType::Surface).await?;
    Ok(KclValue::Bool { value: res, meta })
}

async fn inner_is_equal_body_type(
    surface: Solid,
    exec_state: &mut ExecState,
    args: Args,
    expected: BodyType,
) -> Result<bool, KclError> {
    let meta = ModelingCmdMeta::from_args(exec_state, &args);
    let cmd = ModelingCmd::from(mcmd::Solid3dGetBodyType::builder().object_id(surface.id).build());

    let response = exec_state.send_modeling_cmd(meta, cmd).await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetBodyType(body),
    } = response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned Solid3dGetBodyType but it returned {response:#?}"
            ),
            vec![args.source_range],
        )));
    };

    Ok(expected == body.body_type)
}

pub async fn delete_face(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let faces: Option<Vec<FaceTag>> = args.get_kw_arg_opt(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let face_indices: Option<Vec<TyF64>> = args.get_kw_arg_opt(
        "faceIndices",
        &RuntimeType::Array(Box::new(RuntimeType::count()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let face_indices = if let Some(face_indices) = face_indices {
        let faces = face_indices
            .into_iter()
            .map(|num| {
                crate::try_f64_to_u32(num.n).ok_or_else(|| {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!("Face indices must be whole numbers, got {}", num.n),
                        vec![args.source_range],
                    ))
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        Some(faces)
    } else {
        None
    };
    inner_delete_face(body, faces, face_indices, exec_state, args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Solid { value })
}

async fn inner_delete_face(
    body: Solid,
    tagged_faces: Option<Vec<FaceTag>>,
    face_indices: Option<Vec<u32>>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Solid, KclError> {
    // Validate args:
    // User has to give us SOMETHING to delete.
    if tagged_faces.is_none() && face_indices.is_none() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "You must use either the `faces` or the `faceIndices` parameter".to_string(),
            vec![args.source_range],
        )));
    }

    // Early return for mock response, just return the same solid.
    // If we tracked faces, we would remove some faces... but we don't really.
    let no_engine_commands = args.ctx.no_engine_commands().await;
    if no_engine_commands {
        return Ok(body);
    }

    // Combine the list of faces, both tagged and indexed.
    let tagged_faces = tagged_faces.unwrap_or_default();
    let face_indices = face_indices.unwrap_or_default();
    // Get the face's ID
    let mut face_ids = HashSet::with_capacity(face_indices.len() + tagged_faces.len());

    for tagged_face in tagged_faces {
        let face_id = tagged_face.get_face_id(&body, exec_state, &args, false).await?;
        face_ids.insert(face_id);
    }

    for face_index in face_indices {
        let face_uuid_response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::Solid3dGetFaceUuid::builder()
                        .object_id(body.id)
                        .face_index(face_index)
                        .build(),
                ),
            )
            .await?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Solid3dGetFaceUuid(inner_resp),
        } = face_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned Solid3dGetFaceUuid but it returned {face_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        face_ids.insert(inner_resp.face_id);
    }

    // Now that we've got all the faces, delete them all.
    let delete_face_response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::EntityDeleteChildren::builder()
                    .entity_id(body.id)
                    .child_entity_ids(face_ids)
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EntityDeleteChildren(mout::EntityDeleteChildren { .. }),
    } = delete_face_response
    else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Engine returned invalid response, it should have returned EntityDeleteChildren but it returned {delete_face_response:?}"
            ),
            vec![args.source_range],
        )));
    };

    // Return the same body, it just has fewer faces.
    Ok(body)
}

/// Create a new surface that blends between two edges of separate surface bodies
pub async fn blend(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let edges: Vec<KclValue> = args.get_unlabeled_kw_arg(
        "edges",
        &RuntimeType::Array(
            Box::new(RuntimeType::Union(vec![
                RuntimeType::Primitive(PrimitiveType::BoundedEdge),
                RuntimeType::tagged_edge(),
            ])),
            ArrayLen::Known(2),
        ),
        exec_state,
    )?;

    let mut bounded_edges = Vec::with_capacity(edges.len());
    for edge in edges {
        bounded_edges.push(resolve_blend_edge(edge, exec_state, &args).await?);
    }

    inner_blend(bounded_edges, exec_state, args.clone())
        .await
        .map(Box::new)
        .map(|value| KclValue::Solid { value })
}

async fn resolve_blend_edge(edge: KclValue, exec_state: &mut ExecState, args: &Args) -> Result<BoundedEdge, KclError> {
    match edge {
        KclValue::BoundedEdge { value, .. } => Ok(value),
        KclValue::TagIdentifier(tag) => {
            let tagged_edge = args.get_tag_engine_info(exec_state, &tag)?;
            Ok(BoundedEdge {
                face_id: tagged_edge.geometry.id(),
                edge_id: tagged_edge.id,
                lower_bound: 0.0,
                upper_bound: 1.0,
            })
        }
        _ => Err(KclError::new_internal(KclErrorDetails::new(
            "Unexpected edge value while preparing blend edges.".to_owned(),
            vec![args.source_range],
        ))),
    }
}

async fn inner_blend(edges: Vec<BoundedEdge>, exec_state: &mut ExecState, args: Args) -> Result<Solid, KclError> {
    let id = exec_state.next_uuid();

    let surface_refs: Vec<SurfaceEdgeReference> = edges
        .iter()
        .map(|edge| {
            SurfaceEdgeReference::builder()
                .object_id(edge.face_id)
                .edges(vec![
                    FractionOfEdge::builder()
                        .edge_id(edge.edge_id)
                        .lower_bound(edge.lower_bound)
                        .upper_bound(edge.upper_bound)
                        .build(),
                ])
                .build()
        })
        .collect();

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(mcmd::SurfaceBlend::builder().surfaces(surface_refs).build()),
        )
        .await?;

    let solid = Solid {
        id,
        artifact_id: id.into(),
        value: vec![],
        creator: SolidCreator::Procedural,
        start_cap_id: None,
        end_cap_id: None,
        edge_cuts: vec![],
        units: exec_state.length_unit(),
        sectional: false,
        meta: vec![crate::execution::Metadata {
            source_range: args.source_range,
        }],
    };
    //TODO: How do we pass back the two new edge ids that were created?
    Ok(solid)
}

/// Stitch multiple surfaces together into one polysurface
pub async fn join(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let selection: Vec<Solid> = args.get_unlabeled_kw_arg("selection", &RuntimeType::solids(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;

    inner_join(selection, tolerance, exec_state, args)
        .await
        .map(Box::new)
        .map(|value| KclValue::Solid { value })
}

async fn inner_join(
    selection: Vec<Solid>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Solid, KclError> {
    if selection.len() == 1 {
        let cmd = mcmd::Solid3dJoin::builder().object_id(selection[0].id).build();

        exec_state
            .batch_modeling_cmd(ModelingCmdMeta::from_args(exec_state, &args), ModelingCmd::from(cmd))
            .await?;

        Ok(selection[0].clone())
    } else {
        let body_out_id = exec_state.next_uuid();

        let body_ids = selection.iter().map(|body| body.id).collect();
        let tolerance = tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM);
        let cmd = mcmd::Solid3dMultiJoin::builder()
            .object_ids(body_ids)
            .tolerance(LengthUnit(tolerance))
            .build();

        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, body_out_id),
                ModelingCmd::from(cmd),
            )
            .await?;

        let solid = Solid {
            id: body_out_id,
            artifact_id: body_out_id.into(),
            value: vec![],
            creator: SolidCreator::Procedural,
            start_cap_id: None,
            end_cap_id: None,
            edge_cuts: vec![],
            units: exec_state.length_unit(),
            sectional: false,
            meta: vec![args.source_range.into()],
        };
        Ok(solid)
    }
}
