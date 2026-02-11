//! Functions for handling and converting IDs.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd};
use kittycad_modeling_cmds::{self as kcmc, ok_response::OkModelingCmdResponse, websocket::OkWebSocketResponseData};

use crate::{
    errors::{KclError, KclErrorDetails},
    exec::KclValue,
    execution::{
        ExecState, ExtrudeSurface, GeoMeta, Geometry, Metadata, ModelingCmdMeta, Solid, TagEngineInfo, TagIdentifier,
        types::RuntimeType,
    },
    parsing::ast::types::{TagDeclarator, TagNode},
    std::Args,
};

/// Translates face indices to face IDs.
pub async fn face_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let face_index: u32 = args.get_kw_arg("index", &RuntimeType::count(), exec_state)?;

    inner_face_id(body, face_index, exec_state, args).await
}

/// Translates face indices to face IDs.
async fn inner_face_id(
    body: Solid,
    face_index: u32,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let no_engine_commands = args.ctx.no_engine_commands().await;
    // Handle mock execution
    let face_id = if no_engine_commands {
        exec_state.next_uuid()
    } else {
        // Query engine, unpack response.
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
        inner_resp.face_id
    };

    let new_tag_name = format!("face_id_{}", face_id.to_string().replace('-', "_"));
    let new_tag_node = TagDeclarator::new(&new_tag_name);

    let mut tagged_surface = body.value.iter().find(|surface| surface.face_id() == face_id).cloned();
    if tagged_surface.is_none() && (body.start_cap_id == Some(face_id) || body.end_cap_id == Some(face_id)) {
        tagged_surface = Some(ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
            face_id,
            tag: None,
            geo_meta: GeoMeta {
                id: face_id,
                metadata: args.source_range.into(),
            },
        }));
    }

    let Some(mut tagged_surface) = tagged_surface else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Could not find face `{face_id}` on the given solid"),
            vec![args.source_range],
        )));
    };
    set_surface_tag(&mut tagged_surface, &new_tag_node);

    let new_tag = TagIdentifier {
        value: new_tag_name,
        info: vec![(
            exec_state.stack().current_epoch(),
            TagEngineInfo {
                id: tagged_surface.get_id(),
                geometry: Geometry::Solid(body),
                path: None,
                surface: Some(tagged_surface),
            },
        )],
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    };

    Ok(KclValue::TagIdentifier(Box::new(new_tag)))
}

fn set_surface_tag(surface: &mut ExtrudeSurface, tag: &TagNode) {
    match surface {
        ExtrudeSurface::ExtrudePlane(extrude_plane) => extrude_plane.tag = Some(tag.clone()),
        ExtrudeSurface::ExtrudeArc(extrude_arc) => extrude_arc.tag = Some(tag.clone()),
        ExtrudeSurface::Chamfer(chamfer) => chamfer.tag = Some(tag.clone()),
        ExtrudeSurface::Fillet(fillet) => fillet.tag = Some(tag.clone()),
    }
}

/// Translates edge indices to edge IDs.
pub async fn edge_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &RuntimeType::solid(), exec_state)?;
    let edge_index: u32 = args.get_kw_arg("index", &RuntimeType::count(), exec_state)?;

    inner_edge_id(body, edge_index, exec_state, args).await
}

/// Translates edge indices to edge IDs.
async fn inner_edge_id(
    body: Solid,
    edge_index: u32,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    // Handle mock execution
    let no_engine_commands = args.ctx.no_engine_commands().await;
    let edge_id = if no_engine_commands {
        exec_state.next_uuid()
    } else {
        let edge_uuid_response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::Solid3dGetEdgeUuid::builder()
                        .object_id(body.id)
                        .edge_index(edge_index)
                        .build(),
                ),
            )
            .await?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Solid3dGetEdgeUuid(inner_resp),
        } = edge_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned Solid3dGetEdgeUuid but it returned {edge_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        inner_resp.edge_id
    };
    Ok(KclValue::Uuid {
        value: edge_id,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    })
}
