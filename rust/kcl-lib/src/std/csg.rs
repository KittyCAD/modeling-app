//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::patterns::GeometryTrait;

/// Union two or more solids into a single solid.
pub async fn union(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<Solid> =
        args.get_unlabeled_kw_arg("solids", &RuntimeType::Union(vec![RuntimeType::solids()]), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids are required for a union operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_union(solids, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(solids.into())
}

pub enum CsgAlgorithm {
    Latest,
    Legacy,
}

impl CsgAlgorithm {
    pub fn legacy(is_legacy: bool) -> Self {
        if is_legacy { Self::Legacy } else { Self::Latest }
    }
    pub fn is_legacy(&self) -> bool {
        match self {
            CsgAlgorithm::Latest => false,
            CsgAlgorithm::Legacy => true,
        }
    }
}

pub(crate) async fn inner_union(
    solids: Vec<Solid>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
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
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solids.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanUnion(boolean_resp),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the union operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
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
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids are required for an intersect operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_intersect(solids, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(solids.into())
}

pub(crate) async fn inner_intersect(
    solids: Vec<Solid>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
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
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solids.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanIntersection(boolean_resp),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the intersection operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
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
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    let solids = inner_subtract(solids, tools, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(solids.into())
}

pub(crate) async fn inner_subtract(
    solids: Vec<Solid>,
    tools: Vec<Solid>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
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
                    .use_legacy(csg_algorithm.is_legacy())
                    .target_ids(solids.iter().map(|s| s.id).collect())
                    .tool_ids(tools.iter().map(|s| s.id).collect())
                    .tolerance(LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM)))
                    .build(),
            ),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanSubtract(boolean_resp),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the subtract operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
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
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());
    let tools: Option<Vec<Solid>> = args.get_kw_arg_opt("tools", &RuntimeType::solids(), exec_state)?;
    let keep_tools = args
        .get_kw_arg_opt("keepTools", &RuntimeType::bool(), exec_state)?
        .unwrap_or_default();
    let merge = args
        .get_kw_arg_opt("merge", &RuntimeType::bool(), exec_state)?
        .unwrap_or_default();

    if targets.is_empty() {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least one target body is required.".to_string(),
            vec![args.source_range],
        )));
    }

    let body = inner_imprint(
        targets,
        tools,
        keep_tools,
        merge,
        tolerance,
        csg_algorithm,
        exec_state,
        args,
    )
    .await?;
    Ok(body.into())
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn inner_imprint(
    targets: Vec<Solid>,
    tools: Option<Vec<Solid>>,
    keep_tools: bool,
    merge: bool,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let body_out_id = exec_state.next_uuid();

    let mut body = targets[0].clone();
    body.set_id(body_out_id);
    let mut new_solids = vec![body.clone()];

    if args.ctx.no_engine_commands().await {
        return Ok(new_solids);
    }

    let separate_bodies = !merge;

    // Flush pending edge-cut operations for any solids consumed by imprint.
    let mut imprint_solids = targets.clone();
    if let Some(tool_solids) = tools.as_ref() {
        imprint_solids.extend_from_slice(tool_solids);
    }
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &imprint_solids)
        .await?;

    let body_ids = targets.iter().map(|body| body.id).collect();
    let tool_ids = tools.as_ref().map(|tools| tools.iter().map(|tool| tool.id).collect());
    let tolerance = LengthUnit(tolerance.map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM));
    let imprint_cmd = mcmd::BooleanImprint::builder()
        .use_legacy(csg_algorithm.is_legacy())
        .body_ids(body_ids)
        .tolerance(tolerance)
        .separate_bodies(separate_bodies)
        .keep_tools(keep_tools)
        .maybe_tool_ids(tool_ids)
        .build();
    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, body_out_id),
            ModelingCmd::from(imprint_cmd),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BooleanImprint(boolean_resp),
    } = result
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Failed to get the result of the Imprint operation.".to_string(),
            vec![args.source_range],
        )));
    };

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
        if extra_solid_id == body_out_id {
            continue;
        }
        let mut new_solid = body.clone();
        new_solid.set_id(extra_solid_id);
        new_solids.push(new_solid);
    }

    Ok(new_solids)
}
