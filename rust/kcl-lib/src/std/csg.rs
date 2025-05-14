//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcl_derive_docs::stdlib;
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
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "At least two solids are required for a union operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_union(solids, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

/// Union two or more solids into a single solid.
///
/// ```no_run
/// // Union two cubes using the stdlib functions.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// unionedPart = union([part001, part002])
/// ```
///
/// ```no_run
/// // Union two cubes using operators.
/// // NOTE: This will not work when using codemods through the UI.
/// // Codemods will generate the stdlib function call instead.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// // This is the equivalent of: union([part001, part002])
/// unionedPart = part001 + part002
/// ```
///
/// ```no_run
/// // Union two cubes using the more programmer-friendly operator.
/// // NOTE: This will not work when using codemods through the UI.
/// // Codemods will generate the stdlib function call instead.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// // This is the equivalent of: union([part001, part002])
/// // Programmers will understand `|` as a union operation, but mechanical engineers
/// // will understand `+`, we made both work.
/// unionedPart = part001 | part002
/// ```
#[stdlib {
    name = "union",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solids = {docs = "The solids to union."},
        tolerance = {docs = "The tolerance to use for the union operation."},
    },
    tags = ["solid"]
}]
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
        return Err(KclError::Internal(KclErrorDetails {
            message: "Failed to get the result of the union operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
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
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "At least two solids are required for an intersect operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let solids = inner_intersect(solids, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
///
/// Intersect computes the geometric intersection of multiple solid bodies,
/// returning a new solid representing the volume that is common to all input
/// solids. This operation is useful for determining shared material regions,
/// verifying fit, and analyzing overlapping geometries in assemblies.
///
/// ```no_run
/// // Intersect two cubes using the stdlib functions.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// intersectedPart = intersect([part001, part002])
/// ```
///
/// ```no_run
/// // Intersect two cubes using operators.
/// // NOTE: This will not work when using codemods through the UI.
/// // Codemods will generate the stdlib function call instead.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// // This is the equivalent of: intersect([part001, part002])
/// intersectedPart = part001 & part002
/// ```
#[stdlib {
    name = "intersect",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solids = {docs = "The solids to intersect."},
        tolerance = {docs = "The tolerance to use for the intersection operation."},
    },
    tags = ["solid"]
}]
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
        return Err(KclError::Internal(KclErrorDetails {
            message: "Failed to get the result of the intersection operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
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

    if solids.len() > 1 {
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "Only one solid is allowed for a subtract operation, currently.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    if tools.len() > 1 {
        return Err(KclError::UndefinedValue(KclErrorDetails {
            message: "Only one tool is allowed for a subtract operation, currently.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    }

    let tolerance: Option<TyF64> = args.get_kw_arg_opt_typed("tolerance", &RuntimeType::length(), exec_state)?;

    let solids = inner_subtract(solids, tools, tolerance, exec_state, args).await?;
    Ok(solids.into())
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
///
/// Performs a boolean subtraction operation, removing the volume of one or more
/// tool solids from one or more base solids. The result is a new solid
/// representing the material that remains after all tool solids have been cut
/// away. This function is essential for machining simulations, cavity creation,
/// and complex multi-body part modeling.
///
/// ```no_run
/// // Subtract a cylinder from a cube using the stdlib functions.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// subtractedPart = subtract([part001], tools=[part002])
/// ```
///
/// ```no_run
/// // Subtract a cylinder from a cube using operators.
/// // NOTE: This will not work when using codemods through the UI.
/// // Codemods will generate the stdlib function call instead.
///
/// fn cube(center, size) {
///     return startSketchOn(XY)
///         |> startProfile(at = [center[0] - size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] - size])
///         |> line(endAbsolute = [center[0] + size, center[1] + size])
///         |> line(endAbsolute = [center[0] - size, center[1] + size])
///         |> close()
///         |> extrude(length = 10)
/// }
///
/// part001 = cube(center = [0, 0], size = 10)
/// part002 = cube(center = [7, 3], size = 5)
///     |> translate(z = 1)
///
/// // This is the equivalent of: subtract([part001], tools=[part002])
/// subtractedPart = part001 - part002
/// ```
#[stdlib {
    name = "subtract",
    feature_tree_operation = true,
    keywords = true,
    unlabeled_first = true,
    args = {
        solids = {docs = "The solids to use as the base to subtract from."},
        tools = {docs = "The solids to subtract."},
        tolerance = {docs = "The tolerance to use for the subtraction operation."},
    },
    tags = ["solid"]
}]
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
        return Err(KclError::Internal(KclErrorDetails {
            message: "Failed to get the result of the subtract operation.".to_string(),
            source_ranges: vec![args.source_range],
        }));
    };

    // If we have more solids, set those as well.
    if !extra_solid_ids.is_empty() {
        solid.set_id(extra_solid_ids[0]);
        new_solids.push(solid.clone());
    }

    Ok(new_solids)
}
