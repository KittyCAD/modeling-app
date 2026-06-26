//! Constructive Solid Geometry (CSG) operations.

use anyhow::Result;
use kcl_error::CompilationIssue;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use super::DEFAULT_TOLERANCE_MM;
use super::args::TyF64;
use super::solid_consumption::record_consumed_solids;
use super::solid_consumption::validate_solids_not_consumed;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ConsumedSolidOperation;
use crate::execution::ExecState;
use crate::execution::ExecutorContext;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::annotations;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::patterns::GeometryTrait;

/// Union two or more solids into a single solid.
pub async fn union(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<GeometryWithImportedGeometry> =
        args.get_unlabeled_kw_arg("solids", &solid_or_imported_array_type(2), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids or imported geometries are required for a union operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_union(solids, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(csg_geometries_to_kcl_value(solids))
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

fn solid_or_imported_array_type(min_len: usize) -> RuntimeType {
    RuntimeType::Array(
        Box::new(RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::imported()])),
        ArrayLen::Minimum(min_len),
    )
}

fn solid_inputs(geometries: &[GeometryWithImportedGeometry]) -> Vec<Solid> {
    geometries
        .iter()
        .filter_map(|geometry| match geometry {
            GeometryWithImportedGeometry::Solid(solid) => Some(solid.clone()),
            GeometryWithImportedGeometry::Sketch(_) | GeometryWithImportedGeometry::ImportedGeometry(_) => None,
        })
        .collect()
}

async fn geometry_ids(
    geometries: &mut [GeometryWithImportedGeometry],
    ctx: &ExecutorContext,
) -> Result<Vec<uuid::Uuid>, KclError> {
    // Imported geometry is resolved to the engine object id before CSG. After
    // this point overlap detection is engine-owned, so keep Boolean* no-overlap
    // warnings visible instead of special-casing imported bodies here.
    let mut ids = Vec::with_capacity(geometries.len());
    for geometry in geometries {
        ids.push(geometry.id(ctx).await?);
    }
    Ok(ids)
}

fn csg_output_geometry(
    template: &GeometryWithImportedGeometry,
    output_id: uuid::Uuid,
    value_id: uuid::Uuid,
    args: &Args,
) -> Result<GeometryWithImportedGeometry, KclError> {
    match template {
        GeometryWithImportedGeometry::Solid(solid) => {
            let mut new_solid = solid.clone();
            new_solid.set_id(output_id);
            new_solid.value_id = value_id;
            new_solid.artifact_id = output_id.into();
            Ok(GeometryWithImportedGeometry::Solid(new_solid))
        }
        GeometryWithImportedGeometry::ImportedGeometry(imported) => {
            let mut new_imported = imported.as_ref().clone();
            new_imported.id = output_id;
            Ok(GeometryWithImportedGeometry::ImportedGeometry(Box::new(new_imported)))
        }
        GeometryWithImportedGeometry::Sketch(_) => Err(KclError::new_internal(KclErrorDetails::new(
            "CSG operations cannot output sketches.".to_string(),
            vec![args.source_range],
        ))),
    }
}

pub(crate) fn csg_geometries_to_kcl_value(geometries: Vec<GeometryWithImportedGeometry>) -> KclValue {
    if geometries
        .iter()
        .all(|geometry| matches!(geometry, GeometryWithImportedGeometry::Solid(_)))
    {
        geometries
            .into_iter()
            .filter_map(GeometryWithImportedGeometry::into_solid)
            .collect::<Vec<_>>()
            .into()
    } else {
        geometries.into()
    }
}

fn is_single_target_self_subtract(target_ids: &[uuid::Uuid], tool_ids: &[uuid::Uuid]) -> bool {
    target_ids.len() == 1 && tool_ids.len() == 1 && target_ids[0] == tool_ids[0]
}

fn subtract_output_ids(
    solid_out_id: uuid::Uuid,
    target_ids: &[uuid::Uuid],
    tool_ids: &[uuid::Uuid],
    extra_solid_ids: &[uuid::Uuid],
) -> Vec<uuid::Uuid> {
    if is_single_target_self_subtract(target_ids, tool_ids) {
        return Vec::new();
    }

    let mut output_ids = if target_ids.len() == 1 {
        vec![solid_out_id]
    } else {
        Vec::new()
    };

    for extra_solid_id in extra_solid_ids {
        if !output_ids.contains(extra_solid_id) {
            output_ids.push(*extra_solid_id);
        }
    }

    output_ids
}

pub(crate) async fn inner_union(
    solids: Vec<GeometryWithImportedGeometry>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<GeometryWithImportedGeometry>, KclError> {
    let input_solids = solid_inputs(&solids);
    validate_solids_not_consumed(&input_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        let new_geometries = vec![csg_output_geometry(&solids[0], solid_out_id, solid_out_id, &args)?];
        let new_solids = solid_inputs(&new_geometries);
        record_consumed_solids(exec_state, &input_solids, ConsumedSolidOperation::Union, &new_solids);
        return Ok(new_geometries);
    }

    // Flush the fillets for the solids.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &input_solids)
        .await?;

    let mut solids_for_command = solids.clone();
    let solid_ids = geometry_ids(&mut solids_for_command, &args.ctx).await?;
    let mut new_geometries = vec![csg_output_geometry(
        &solids_for_command[0],
        solid_out_id,
        solid_out_id,
        &args,
    )?];

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanUnion::builder()
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solid_ids)
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

    if !boolean_resp.any_intersections {
        exec_state.warn(
            CompilationIssue::err(
                args.source_range,
                "The bodies in this union had no overlap. This usually indicates a problem in your model, these bodies were probably intended to intersect somewhere.".to_string(),
            ),
            annotations::WARN_CSG_NO_INTERSECTION,
        );
    }

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
        if extra_solid_id == solid_out_id {
            continue;
        }
        new_geometries.push(csg_output_geometry(
            &solids_for_command[0],
            extra_solid_id,
            solid_out_id,
            &args,
        )?);
    }

    let new_solids = solid_inputs(&new_geometries);
    record_consumed_solids(exec_state, &input_solids, ConsumedSolidOperation::Union, &new_solids);

    Ok(new_geometries)
}

/// Intersect returns the shared volume between multiple solids, preserving only
/// overlapping regions.
pub async fn intersect(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<GeometryWithImportedGeometry> =
        args.get_unlabeled_kw_arg("solids", &solid_or_imported_array_type(2), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    if solids.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "At least two solids or imported geometries are required for an intersect operation.".to_string(),
            vec![args.source_range],
        )));
    }

    let solids = inner_intersect(solids, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(csg_geometries_to_kcl_value(solids))
}

pub(crate) async fn inner_intersect(
    solids: Vec<GeometryWithImportedGeometry>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<GeometryWithImportedGeometry>, KclError> {
    let input_solids = solid_inputs(&solids);
    validate_solids_not_consumed(&input_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        let new_geometries = vec![csg_output_geometry(&solids[0], solid_out_id, solid_out_id, &args)?];
        let new_solids = solid_inputs(&new_geometries);
        record_consumed_solids(
            exec_state,
            &input_solids,
            ConsumedSolidOperation::Intersect,
            &new_solids,
        );
        return Ok(new_geometries);
    }

    // Flush the fillets for the solids.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &input_solids)
        .await?;

    let mut solids_for_command = solids.clone();
    let solid_ids = geometry_ids(&mut solids_for_command, &args.ctx).await?;
    let mut new_geometries = vec![csg_output_geometry(
        &solids_for_command[0],
        solid_out_id,
        solid_out_id,
        &args,
    )?];

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanIntersection::builder()
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solid_ids)
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
    if !boolean_resp.any_intersections {
        exec_state.warn(
            CompilationIssue::err(
                args.source_range,
                "The bodies in this intersection had no overlap. This usually indicates a problem in your model, these bodies were probably intended to intersect somewhere.".to_string(),
            ),
            annotations::WARN_CSG_NO_INTERSECTION,
        );
    }

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
        if extra_solid_id == solid_out_id {
            continue;
        }
        new_geometries.push(csg_output_geometry(
            &solids_for_command[0],
            extra_solid_id,
            solid_out_id,
            &args,
        )?);
    }

    let new_solids = solid_inputs(&new_geometries);
    record_consumed_solids(
        exec_state,
        &input_solids,
        ConsumedSolidOperation::Intersect,
        &new_solids,
    );

    Ok(new_geometries)
}

/// Subtract removes tool solids from base solids, leaving the remaining material.
pub async fn subtract(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids: Vec<GeometryWithImportedGeometry> =
        args.get_unlabeled_kw_arg("solids", &solid_or_imported_array_type(1), exec_state)?;
    let tools: Vec<GeometryWithImportedGeometry> =
        args.get_kw_arg("tools", &solid_or_imported_array_type(1), exec_state)?;

    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let legacy_csg: Option<bool> = args.get_kw_arg_opt("legacyMethod", &RuntimeType::bool(), exec_state)?;
    let csg_algorithm = CsgAlgorithm::legacy(legacy_csg.unwrap_or_default());

    let solids = inner_subtract(solids, tools, tolerance, csg_algorithm, exec_state, args).await?;
    Ok(csg_geometries_to_kcl_value(solids))
}

pub(crate) async fn inner_subtract(
    solids: Vec<GeometryWithImportedGeometry>,
    tools: Vec<GeometryWithImportedGeometry>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<GeometryWithImportedGeometry>, KclError> {
    let input_solids = solid_inputs(&solids);
    let tool_solids = solid_inputs(&tools);
    let combined_solids = input_solids
        .iter()
        .chain(tool_solids.iter())
        .cloned()
        .collect::<Vec<Solid>>();
    validate_solids_not_consumed(&combined_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        let new_geometries = vec![csg_output_geometry(&solids[0], solid_out_id, solid_out_id, &args)?];
        let new_solids = solid_inputs(&new_geometries);
        record_consumed_solids(exec_state, &input_solids, ConsumedSolidOperation::Subtract, &new_solids);
        record_consumed_solids(exec_state, &tool_solids, ConsumedSolidOperation::Subtract, &[]);
        return Ok(new_geometries);
    }

    // Flush the fillets for the solids and the tools.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &combined_solids)
        .await?;

    let mut targets_for_command = solids.clone();
    let target_ids = geometry_ids(&mut targets_for_command, &args.ctx).await?;
    let mut tools_for_command = tools.clone();
    let tool_ids = geometry_ids(&mut tools_for_command, &args.ctx).await?;

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanSubtract::builder()
                    .use_legacy(csg_algorithm.is_legacy())
                    .target_ids(target_ids.clone())
                    .tool_ids(tool_ids.clone())
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

    if !boolean_resp.any_intersections {
        exec_state.warn(
            CompilationIssue::err(
                args.source_range,
                "The bodies in this subtraction had no overlap. This usually indicates a problem in your model, these bodies were probably intended to intersect somewhere.".to_string(),
            ),
            annotations::WARN_CSG_NO_INTERSECTION,
        );
    }

    let output_ids = subtract_output_ids(solid_out_id, &target_ids, &tool_ids, &boolean_resp.extra_solid_ids);
    let new_geometries = output_ids
        .into_iter()
        .map(|output_id| csg_output_geometry(&targets_for_command[0], output_id, solid_out_id, &args))
        .collect::<Result<Vec<_>, _>>()?;

    let new_solids = solid_inputs(&new_geometries);
    record_consumed_solids(exec_state, &input_solids, ConsumedSolidOperation::Subtract, &new_solids);
    record_consumed_solids(exec_state, &tool_solids, ConsumedSolidOperation::Subtract, &[]);

    Ok(new_geometries)
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
    validate_solids_not_consumed(&targets, exec_state, args.source_range)?;
    if let Some(tools) = tools.as_ref() {
        validate_solids_not_consumed(tools, exec_state, args.source_range)?;
    }

    let body_out_id = exec_state.next_uuid();

    let mut body = targets[0].clone();
    body.set_id(body_out_id);
    body.artifact_id = body_out_id.into();
    let mut new_solids = vec![body.clone()];
    let separate_bodies = !merge;

    if args.ctx.no_engine_commands().await {
        if separate_bodies {
            let extra_solid_id = exec_state.next_uuid();
            let mut new_solid = body.clone();
            new_solid.set_id(extra_solid_id);
            new_solid.value_id = body_out_id;
            new_solid.artifact_id = extra_solid_id.into();
            new_solids.push(new_solid);
        }
        record_consumed_solids(exec_state, &targets, ConsumedSolidOperation::Split, &new_solids);
        if !keep_tools && let Some(tools) = tools.as_ref() {
            record_consumed_solids(exec_state, tools, ConsumedSolidOperation::Split, &[]);
        }
        return Ok(new_solids);
    }

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
    if !boolean_resp.any_intersections {
        exec_state.warn(
            CompilationIssue::err(
                args.source_range,
                "The bodies in this split had no overlap. This usually indicates a problem in your model, these bodies were probably intended to intersect somewhere.".to_string(),
            ),
            annotations::WARN_CSG_NO_INTERSECTION,
        );
    }

    // If we have more solids, set those as well.
    for extra_solid_id in boolean_resp.extra_solid_ids {
        if extra_solid_id == body_out_id {
            continue;
        }
        let mut new_solid = body.clone();
        new_solid.set_id(extra_solid_id);
        new_solid.value_id = body_out_id;
        new_solid.artifact_id = extra_solid_id.into();
        new_solids.push(new_solid);
    }

    record_consumed_solids(exec_state, &targets, ConsumedSolidOperation::Split, &new_solids);
    if !keep_tools && let Some(tools) = tools.as_ref() {
        record_consumed_solids(exec_state, tools, ConsumedSolidOperation::Split, &[]);
    }

    Ok(new_solids)
}

#[cfg(test)]
mod tests {
    use indexmap::IndexMap;
    use uuid::Uuid;

    use super::subtract;
    use super::subtract_output_ids;
    use crate::SourceRange;
    use crate::errors::KclError;
    use crate::execution::ExecState;
    use crate::execution::ImportedGeometry;
    use crate::execution::KclValue;
    use crate::execution::MockConfig;
    use crate::execution::fn_call::Arg;
    use crate::execution::fn_call::Args;

    fn test_uuid(id: u128) -> Uuid {
        Uuid::from_u128(id)
    }

    fn imported_geometry(id: Uuid, path: &str) -> KclValue {
        KclValue::ImportedGeometry(ImportedGeometry::new(
            id,
            vec![path.to_owned()],
            vec![SourceRange::default().into()],
        ))
    }

    #[test]
    fn subtract_output_ids_single_target_uses_command_id() {
        let output_id = test_uuid(100);
        let target_id = test_uuid(1);
        let tool_id = test_uuid(2);
        let extra_id = test_uuid(3);

        let output_ids = subtract_output_ids(output_id, &[target_id], &[tool_id], &[extra_id]);

        assert_eq!(output_ids, vec![output_id, extra_id]);
    }

    #[test]
    fn subtract_output_ids_multi_target_uses_response_ids_only() {
        let output_id = test_uuid(100);
        let target_ids = [test_uuid(1), test_uuid(2)];
        let tool_id = test_uuid(3);
        let extra_ids = [test_uuid(4), test_uuid(5)];

        let output_ids = subtract_output_ids(output_id, &target_ids, &[tool_id], &extra_ids);

        assert_eq!(output_ids, extra_ids);
    }

    #[test]
    fn subtract_output_ids_self_subtract_returns_no_outputs() {
        let output_id = test_uuid(100);
        let target_id = test_uuid(1);

        let output_ids = subtract_output_ids(output_id, &[target_id], &[target_id], &[]);

        assert!(output_ids.is_empty());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let target_id = test_uuid(1);
        let tool_id = test_uuid(2);

        let mut args = Args::new_no_args(SourceRange::default(), None, ctx.clone(), Some("subtract".to_owned()));
        args.unlabeled.push((
            None,
            Arg::new(imported_geometry(target_id, "angle.sldprt"), SourceRange::default()),
        ));
        args.labeled = IndexMap::from([(
            "tools".to_owned(),
            Arg::new(imported_geometry(tool_id, "tool.sldprt"), SourceRange::default()),
        )]);

        let result = subtract(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        let KclValue::ImportedGeometry(result) = result else {
            panic!("expected imported geometry result, got {result:?}");
        };
        assert_ne!(result.id, target_id);
        assert_ne!(result.id, tool_id);
        assert_eq!(result.value, vec!["angle.sldprt".to_owned()]);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_reusing_consumed_target_reports_kcl_error() {
        let code = r#"
targetSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var 10, var -10])
  line2 = line(start = [var 10, var -10], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -10, var 10])
  line4 = line(start = [var -10, var 10], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

target = extrude(region(point = [0, 0], sketch = targetSketch), length = 20)

tool1Sketch = sketch(on = XY) {
  line1 = line(start = [var -11, var -11], end = [var -7, var -11])
  line2 = line(start = [var -7, var -11], end = [var -7, var -7])
  line3 = line(start = [var -7, var -7], end = [var -11, var -7])
  line4 = line(start = [var -11, var -7], end = [var -11, var -11])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

tool1 = extrude(region(point = [-9, -9], sketch = tool1Sketch), length = 4)

tool2Sketch = sketch(on = XY) {
  line1 = line(start = [var 7, var 7], end = [var 11, var 7])
  line2 = line(start = [var 11, var 7], end = [var 11, var 11])
  line3 = line(start = [var 11, var 11], end = [var 7, var 11])
  line4 = line(start = [var 7, var 11], end = [var 7, var 7])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

tool2 = extrude(region(point = [9, 9], sketch = tool2Sketch), length = 4)

first = subtract(target, tools = [tool1])
second = subtract(target, tools = [tool2])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let err = ctx.run_mock(&program, &MockConfig::default()).await.unwrap_err();
        ctx.close().await;

        assert!(matches!(&err.error, KclError::Semantic { .. }), "{:?}", err.error);
        let message = err.error.message();
        assert!(
            message.contains("`target` was already consumed by a `subtract` operation"),
            "{message}"
        );
        assert!(
            message.contains("The operation result is now in `first`; use that for subsequent operations"),
            "{message}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_reusing_consumed_tool_reports_kcl_error() {
        let code = r#"
targetSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var 10, var -10])
  line2 = line(start = [var 10, var -10], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -10, var 10])
  line4 = line(start = [var -10, var 10], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

target = extrude(region(point = [0, 0], sketch = targetSketch), length = 20)

toolSketch = sketch(on = XY) {
  line1 = line(start = [var -2, var -2], end = [var 2, var -2])
  line2 = line(start = [var 2, var -2], end = [var 2, var 2])
  line3 = line(start = [var 2, var 2], end = [var -2, var 2])
  line4 = line(start = [var -2, var 2], end = [var -2, var -2])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

tool = extrude(region(point = [0, 0], sketch = toolSketch), length = 4)

first = subtract(target, tools = [tool])
second = subtract(first, tools = [tool])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let err = ctx.run_mock(&program, &MockConfig::default()).await.unwrap_err();
        ctx.close().await;

        assert!(matches!(&err.error, KclError::Semantic { .. }), "{:?}", err.error);
        let message = err.error.message();
        assert!(
            message.contains("`tool` was already consumed by a `subtract` operation"),
            "{message}"
        );
        assert!(message.contains("can no longer be used"), "{message}");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn union_reusing_consumed_solid_reports_kcl_error() {
        let code = r#"
leftSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var -2, var -10])
  line2 = line(start = [var -2, var -10], end = [var -2, var -2])
  line3 = line(start = [var -2, var -2], end = [var -10, var -2])
  line4 = line(start = [var -10, var -2], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

left = extrude(region(point = [-6, -6], sketch = leftSketch), length = 8)

rightSketch = sketch(on = XY) {
  line1 = line(start = [var -2, var -2], end = [var 6, var -2])
  line2 = line(start = [var 6, var -2], end = [var 6, var 6])
  line3 = line(start = [var 6, var 6], end = [var -2, var 6])
  line4 = line(start = [var -2, var 6], end = [var -2, var -2])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

right = extrude(region(point = [2, 2], sketch = rightSketch), length = 8)

toolSketch = sketch(on = XY) {
  line1 = line(start = [var -1, var -1], end = [var 1, var -1])
  line2 = line(start = [var 1, var -1], end = [var 1, var 1])
  line3 = line(start = [var 1, var 1], end = [var -1, var 1])
  line4 = line(start = [var -1, var 1], end = [var -1, var -1])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

tool = extrude(region(point = [0, 0], sketch = toolSketch), length = 2)

first = union([left, right])
second = union([first, tool])
third = subtract(left, tools = [tool])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let err = ctx.run_mock(&program, &MockConfig::default()).await.unwrap_err();
        ctx.close().await;

        assert!(matches!(&err.error, KclError::Semantic { .. }), "{:?}", err.error);
        let message = err.error.message();
        assert!(
            message.contains("`left` was already consumed by a `union` operation"),
            "{message}"
        );
        assert!(
            message.contains("The operation result is now in `second`; use that for subsequent operations"),
            "{message}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn intersect_reusing_consumed_solid_reports_kcl_error() {
        let code = r#"
leftSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var 4, var -10])
  line2 = line(start = [var 4, var -10], end = [var 4, var 4])
  line3 = line(start = [var 4, var 4], end = [var -10, var 4])
  line4 = line(start = [var -10, var 4], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

left = extrude(region(point = [-3, -3], sketch = leftSketch), length = 8)

rightSketch = sketch(on = XY) {
  line1 = line(start = [var -4, var -4], end = [var 10, var -4])
  line2 = line(start = [var 10, var -4], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -4, var 10])
  line4 = line(start = [var -4, var 10], end = [var -4, var -4])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

right = extrude(region(point = [3, 3], sketch = rightSketch), length = 8)

toolSketch = sketch(on = XY) {
  line1 = line(start = [var -1, var -1], end = [var 1, var -1])
  line2 = line(start = [var 1, var -1], end = [var 1, var 1])
  line3 = line(start = [var 1, var 1], end = [var -1, var 1])
  line4 = line(start = [var -1, var 1], end = [var -1, var -1])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

tool = extrude(region(point = [0, 0], sketch = toolSketch), length = 2)

first = intersect([left, right])
second = subtract(left, tools = [tool])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let err = ctx.run_mock(&program, &MockConfig::default()).await.unwrap_err();
        ctx.close().await;

        assert!(matches!(&err.error, KclError::Semantic { .. }), "{:?}", err.error);
        let message = err.error.message();
        assert!(
            message.contains("`left` was already consumed by an `intersect` operation"),
            "{message}"
        );
        assert!(
            message.contains("The operation result is now in `first`; use that for subsequent operations"),
            "{message}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn split_keep_tools_does_not_consume_tools() {
        let code = r#"
targetSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var 10, var -10])
  line2 = line(start = [var 10, var -10], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -10, var 10])
  line4 = line(start = [var -10, var 10], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

target = extrude(region(point = [0, 0], sketch = targetSketch), length = 20)

toolSketch = sketch(on = XY) {
  line1 = line(start = [var -2, var -10], end = [var 2, var -10])
  line2 = line(start = [var 2, var -10], end = [var 2, var 10])
  line3 = line(start = [var 2, var 10], end = [var -2, var 10])
  line4 = line(start = [var -2, var 10], end = [var -2, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

tool = extrude(region(point = [0, 0], sketch = toolSketch), length = 20)

first = split(target, tools = [tool], keepTools = true)
second = subtract(first, tools = [tool])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let outcome = ctx.run_mock(&program, &MockConfig::default()).await.unwrap();
        ctx.close().await;

        assert!(outcome.variables.contains_key("second"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn split_without_keep_tools_consumes_tools() {
        let code = r#"
targetSketch = sketch(on = XY) {
  line1 = line(start = [var -10, var -10], end = [var 10, var -10])
  line2 = line(start = [var 10, var -10], end = [var 10, var 10])
  line3 = line(start = [var 10, var 10], end = [var -10, var 10])
  line4 = line(start = [var -10, var 10], end = [var -10, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  equalLength([line1, line2, line3, line4])
}

target = extrude(region(point = [0, 0], sketch = targetSketch), length = 20)

toolSketch = sketch(on = XY) {
  line1 = line(start = [var -2, var -10], end = [var 2, var -10])
  line2 = line(start = [var 2, var -10], end = [var 2, var 10])
  line3 = line(start = [var 2, var 10], end = [var -2, var 10])
  line4 = line(start = [var -2, var 10], end = [var -2, var -10])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

tool = extrude(region(point = [0, 0], sketch = toolSketch), length = 20)

first = split(target, tools = [tool])
second = subtract(first, tools = [tool])
"#;

        let ctx = crate::ExecutorContext::new_mock(None).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let err = ctx.run_mock(&program, &MockConfig::default()).await.unwrap_err();
        ctx.close().await;

        assert!(matches!(&err.error, KclError::Semantic { .. }), "{:?}", err.error);
        let message = err.error.message();
        assert!(
            message.contains("`tool` was already consumed by a `split` operation"),
            "{message}"
        );
        assert!(message.contains("can no longer be used"), "{message}");
    }
}
