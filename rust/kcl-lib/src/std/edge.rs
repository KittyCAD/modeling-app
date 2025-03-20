//! Edge helper functions.

use anyhow::Result;
use kcl_derive_docs::stdlib;
use kcmc::{each_cmd as mcmd, ok_response::OkModelingCmdResponse, websocket::OkWebSocketResponseData, ModelingCmd};
use kittycad_modeling_cmds as kcmc;
use uuid::Uuid;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, ExtrudeSurface, KclValue, TagIdentifier},
    std::Args,
};

/// Get the opposite edge to the edge given.
pub async fn get_opposite_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_opposite_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the opposite edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getOppositeEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getOppositeEdge",
}]
async fn inner_get_opposite_edge(tag: TagIdentifier, exec_state: &mut ExecState, args: Args) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetOppositeEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetOppositeEdge(opposite_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("mcmd::Solid3dGetOppositeEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(opposite_edge.edge)
}

/// Get the next adjacent edge to the edge given.
pub async fn get_next_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_next_adjacent_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the next adjacent edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getNextAdjacentEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getNextAdjacentEdge",
}]
async fn inner_get_next_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetNextAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetNextAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!(
                "mcmd::Solid3dGetNextAdjacentEdge response was not as expected: {:?}",
                resp
            ),
            source_ranges: vec![args.source_range],
        }));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found next adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}

/// Get the previous adjacent edge to the edge given.
pub async fn get_previous_adjacent_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let tag: TagIdentifier = args.get_data()?;

    let edge = inner_get_previous_adjacent_edge(tag, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the previous adjacent edge to the edge given.
///
/// ```no_run
/// exampleSketch = startSketchOn('XZ')
///   |> startProfileAt([0, 0], %)
///   |> line(end = [10, 0])
///   |> angledLine({
///     angle = 60,
///     length = 10,
///   }, %)
///   |> angledLine({
///     angle = 120,
///     length = 10,
///   }, %)
///   |> line(end = [-10, 0])
///   |> angledLine({
///     angle = 240,
///     length = 10,
///   }, %, $referenceEdge)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
///   |> fillet(
///     radius = 3,
///     tags = [getPreviousAdjacentEdge(referenceEdge)],
///   )
/// ```
#[stdlib {
    name = "getPreviousAdjacentEdge",
}]
async fn inner_get_previous_adjacent_edge(
    tag: TagIdentifier,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    if args.ctx.no_engine_commands().await {
        return Ok(exec_state.next_uuid());
    }
    let face_id = args.get_adjacent_face_to_tag(exec_state, &tag, false).await?;

    let id = exec_state.next_uuid();
    let tagged_path = args.get_tag_engine_info(exec_state, &tag)?;

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetPrevAdjacentEdge {
                edge_id: tagged_path.id,
                object_id: tagged_path.sketch,
                face_id,
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetPrevAdjacentEdge(adjacent_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!(
                "mcmd::Solid3dGetPrevAdjacentEdge response was not as expected: {:?}",
                resp
            ),
            source_ranges: vec![args.source_range],
        }));
    };

    adjacent_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!("No edge found previous adjacent to tag: `{}`", tag.value),
            source_ranges: vec![args.source_range],
        })
    })
}

/// Get the shared edge between two faces.
pub async fn get_common_edge(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let faces: Vec<TagIdentifier> = args.get_kw_arg("faces")?;

    let edge = inner_get_common_edge(faces, exec_state, args.clone()).await?;
    Ok(KclValue::Uuid {
        value: edge,
        meta: vec![args.source_range.into()],
    })
}

/// Get the shared edge between two faces.
///
/// ```no_run
/// // Get an edge shared between two faces, created after a chamfer.
///
/// scale = 20
/// part001 = startSketchOn('XY')
///     |> startProfileAt([0, 0], %)
///     |> line(end = [0, scale])
///     |> line(end = [scale, 0])
///     |> line(end = [0, -scale])
///     |> close(tag = $line0)
///     |> extrude(length = 20, tagEnd = $end0)
///     // We tag the chamfer to reference it later.
///     |> chamfer(length = 10, tags = [getOppositeEdge(line0)], tag = $chamfer0)
///
/// // Get the shared edge between the chamfer and the extrusion.
/// commonEdge = getCommonEdge(faces = [chamfer0, end0])
///
/// // Chamfer the shared edge.
/// // TODO: uncomment this when ssi for fillets lands
/// // chamfer(part001, length = 5, tags = [commonEdge])
/// ```
#[stdlib {
    name = "getCommonEdge",
    feature_tree_operation = false,
    keywords = true,
    unlabeled_first = false,
    args = {
        faces = { docs = "The tags of the faces you want to find the common edge between" },
    },
}]
async fn inner_get_common_edge(
    faces: Vec<TagIdentifier>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Uuid, KclError> {
    let id = exec_state.next_uuid();
    if args.ctx.no_engine_commands().await {
        return Ok(id);
    }

    if faces.len() != 2 {
        return Err(KclError::Type(KclErrorDetails {
            message: "getCommonEdge requires exactly two tags for faces".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }
    let first_face_id = args.get_adjacent_face_to_tag(exec_state, &faces[0], false).await?;
    let second_face_id = args.get_adjacent_face_to_tag(exec_state, &faces[1], false).await?;

    let first_tagged_path = args.get_tag_engine_info(exec_state, &faces[0])?.clone();
    let second_tagged_path = args.get_tag_engine_info(exec_state, &faces[1])?;

    if first_tagged_path.sketch != second_tagged_path.sketch {
        return Err(KclError::Type(KclErrorDetails {
            message: "getCommonEdge requires the faces to be in the same original sketch".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    // Flush the batch for our fillets/chamfers if there are any.
    // If we have a chamfer/fillet, flush the batch.
    // TODO: we likely want to be a lot more persnickety _which_ fillets we are flushing
    // but for now, we'll just flush everything.
    if let Some(ExtrudeSurface::Chamfer { .. } | ExtrudeSurface::Fillet { .. }) = first_tagged_path.surface {
        args.ctx.engine.flush_batch(true, args.source_range).await?;
    } else if let Some(ExtrudeSurface::Chamfer { .. } | ExtrudeSurface::Fillet { .. }) = second_tagged_path.surface {
        args.ctx.engine.flush_batch(true, args.source_range).await?;
    }

    let resp = args
        .send_modeling_cmd(
            id,
            ModelingCmd::from(mcmd::Solid3dGetCommonEdge {
                object_id: first_tagged_path.sketch,
                face_ids: [first_face_id, second_face_id],
            }),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::Solid3dGetCommonEdge(common_edge),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("mcmd::Solid3dGetCommonEdge response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    common_edge.edge.ok_or_else(|| {
        KclError::Type(KclErrorDetails {
            message: format!(
                "No common edge was found between `{}` and `{}`",
                faces[0].value, faces[1].value
            ),
            source_ranges: vec![args.source_range],
        })
    })
}
