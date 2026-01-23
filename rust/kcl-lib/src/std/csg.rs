//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit};
use kittycad_modeling_cmds::{
    self as kcmc,
    ok_response::OkModelingCmdResponse,
    output::{self as mout, BooleanIntersection, BooleanSubtract, BooleanUnion},
    websocket::OkWebSocketResponseData,
};

use super::{DEFAULT_TOLERANCE_MM, args::TyF64};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, ModelingCmdMeta, Solid, types::RuntimeType},
    std::{Args, patterns::GeometryTrait},
};

/// Union two or more solids into a single solid.
pub async fn union(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> =
        args.get_unlabeled_kw_arg("solids", &RuntimeType::Union(vec![RuntimeType::solids()]), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids are required for a union operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_union(solids, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

pub(crate) async fn inner_union(
    solids: Vec<Solid>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let solid_out_id = exec_state.next_uuid();

    let mut solid = solids[0].clone();
    solid.set_id(solid_out_id);
    let mut new_solids = vec![solid.clone()];

    if args.ctx.no_engine_commands().await {
        return Ok(new_solids);
    }

    // Flush the fillets for the solids.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &solids)
        .await?;

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanUnion::builder()
                    .solid_ids(solids.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanUnion(BooleanUnion { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the union operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in extra_solid_ids {
        if extra_solid_id == solid_out_id {
            continue;
        }
        let mut new_solid = solid.clone();
        new_solid.set_id(extra_solid_id);
        new_solids.push(new_solid);
    }

    Ok(new_solids)
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
pub async fn intersect(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids are required for an intersect operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_intersect(solids, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

pub(crate) async fn inner_intersect(
    solids: Vec<Solid>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let solid_out_id = exec_state.next_uuid();

    let mut solid = solids[0].clone();
    solid.set_id(solid_out_id);
    let mut new_solids = vec![solid.clone()];

    if args.ctx.no_engine_commands().await {
        return Ok(new_solids);
    }

    // Flush the fillets for the solids.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &solids)
        .await?;

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanIntersection::builder()
                    .solid_ids(solids.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanIntersection(BooleanIntersection { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the intersection operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in extra_solid_ids {
        if extra_solid_id == solid_out_id {
            continue;
        }
        let mut new_solid = solid.clone();
        new_solid.set_id(extra_solid_id);
        new_solids.push(new_solid);
    }

    Ok(new_solids)
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
pub async fn subtract(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    let tools: Vec<Solid> = args.get_kw_arg("tools", &RuntimeType::solids(), exec_state)?;

    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;

    let solids = inner_subtract(solids, tools, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

pub(crate) async fn inner_subtract(
    solids: Vec<Solid>,
    tools: Vec<Solid>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let solid_out_id = exec_state.next_uuid();

    let mut solid = solids[0].clone();
    solid.set_id(solid_out_id);
    let mut new_solids = vec![solid.clone()];

    if args.ctx.no_engine_commands().await {
        return Ok(new_solids);
    }

    // Flush the fillets for the solids and the tools.
    let combined_solids = solids.iter().chain(tools.iter()).cloned().collect::<Vec<Solid>>();
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &combined_solids)
        .await?;

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanSubtract::builder()
                    .target_ids(solids.iter().map(|s| s.id).collect())
                    .tool_ids(tools.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanSubtract(BooleanSubtract { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the subtract operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in extra_solid_ids {
        if extra_solid_id == solid_out_id {
            continue;
        }
        let mut new_solid = solid.clone();
        new_solid.set_id(extra_solid_id);
        new_solids.push(new_solid);
    }

    Ok(new_solids)
}

/// Split a target body into two parts: the part that overlaps with the tool, and the part that doesn't.
pub async fn split(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let targets: Vec<Solid> = args.get_unlabeled_kw_arg("targets", &RuntimeType::solids(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tools: Option<Vec<Solid>> = args.get_kw_arg_opt("tools", &RuntimeType::solids(), exec_state)?;
    let tools = tools.unwrap_or_default();
    let merge: bool = args.get_kw_arg("merge", &RuntimeType::bool(), exec_state)?;

    if !merge {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Zoo currently only supports merge = true for split".to_string(),
            vec![args.source_range],
        )));
    }

    let mut bodies = Vec::with_capacity(targets.len() + tools.len());
    bodies.extend(targets);
    bodies.extend(tools);
    if bodies.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two bodies are required for an Imprint operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let body = inner_imprint(bodies, tolerance, exec_state, args).await?;
    Ok(body.into())
}

pub(crate) async fn inner_imprint(
    bodies: Vec<Solid>,
    tolerance: Option<TyF64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let body_out_id = exec_state.next_uuid();

    let mut body = bodies[0].clone();
    body.set_id(body_out_id);
    let mut new_solids = vec![body.clone()];

    if args.ctx.no_engine_commands().await {
        return Ok(new_solids);
    }

    // Flush the fillets for the solids.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &bodies)
        .await?;

    let body_ids = bodies.iter().map(|body| body.id).collect();
    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, body_out_id),
            ModelingCmd::from(
                mcmd::BooleanImprint::builder()
                    .body_ids(body_ids)
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanImprint(mout::BooleanImprint { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the Imprint operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in extra_solid_ids {
        if extra_solid_id == body_out_id {
            continue;
        }
        let mut new_solid = body.clone();
        new_solid.set_id(extra_solid_id);
        new_solids.push(new_solid);
    }

    Ok(new_solids)
}
