//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcmc::{each_cmd as mcmd, length_unit::LengthUnit, ModelingCmd};
use kittycad_modeling_cmds::{
    self as kcmc,
    ok_response::OkModelingCmdResponse,
    output::{BooleanIntersection, BooleanSubtract, BooleanUnion},
    websocket::OkWebSocketResponseData,
};

use super::{args::TyF64, DEFAULT_TOLERANCE};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, ExecState, KclValue, Solid},
    std::{patterns::GeometryTrait, Args},
};

/// Union two or more solids into a single solid.
pub async fn union(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> =
        args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::Union(vec![RuntimeType::solids()]), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::UndefinedValue(KclErrorDetails::new(
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
    args.flush_batch_for_solids(exec_state, &solids).await?;

    let result = args
        .send_modeling_cmd(
            solid_out_id,
            ModelingCmd::from(mcmd::BooleanUnion {
                solid_ids: solids.iter().map(|s| s.id).collect(),
                tolerance: LengthUnit(tolerance.map(|t| t.n).unwrap_or(DEFAULT_TOLERANCE)),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanUnion(BooleanUnion { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::Internal(KclErrorDetails::new(
            "Failed to get the result of the union operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    if !extra_solid_ids.is_empty() {
        solid.set_id(extra_solid_ids[0]);
        new_solids.push(solid.clone());
    }

    Ok(new_solids)
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
pub async fn intersect(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::solids(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;

    if solids.len() < 2 {
        return Err(KclError::UndefinedValue(KclErrorDetails::new(
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
    args.flush_batch_for_solids(exec_state, &solids).await?;

    let result = args
        .send_modeling_cmd(
            solid_out_id,
            ModelingCmd::from(mcmd::BooleanIntersection {
                solid_ids: solids.iter().map(|s| s.id).collect(),
                tolerance: LengthUnit(tolerance.map(|t| t.n).unwrap_or(DEFAULT_TOLERANCE)),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanIntersection(BooleanIntersection { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::Internal(KclErrorDetails::new(
            "Failed to get the result of the intersection operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    if !extra_solid_ids.is_empty() {
        solid.set_id(extra_solid_ids[0]);
        new_solids.push(solid.clone());
    }

    Ok(new_solids)
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
pub async fn subtract(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> = args.get_unlabeled_kw_arg_typed("solids", &RuntimeType::solids(), exec_state)?;
    let tools: Vec<Solid> = args.get_kw_arg_typed("tools", &RuntimeType::solids(), exec_state)?;

    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;

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
    args.flush_batch_for_solids(exec_state, &combined_solids).await?;

    let result = args
        .send_modeling_cmd(
            solid_out_id,
            ModelingCmd::from(mcmd::BooleanSubtract {
                target_ids: solids.iter().map(|s| s.id).collect(),
                tool_ids: tools.iter().map(|s| s.id).collect(),
                tolerance: LengthUnit(tolerance.map(|t| t.n).unwrap_or(DEFAULT_TOLERANCE)),
            }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanSubtract(BooleanSubtract { extra_solid_ids }),
    } = result
    else {
        return Err(KclError::Internal(KclErrorDetails::new(
            "Failed to get the result of the subtract operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    if !extra_solid_ids.is_empty() {
        solid.set_id(extra_solid_ids[0]);
        new_solids.push(solid.clone());
    }

    Ok(new_solids)
}
