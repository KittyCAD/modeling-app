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

fn native_solids(geometries: &[GeometryWithImportedGeometry]) -> Vec<Solid> {
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
    inherited_solids: &[Solid],
    args: &Args,
) -> Result<GeometryWithImportedGeometry, KclError> {
    match template {
        GeometryWithImportedGeometry::Solid(solid) => {
            let mut new_solid = solid.clone();
            inherit_face_tags(&mut new_solid, inherited_solids.iter());
            new_solid.set_id(output_id);
            new_solid.value_id = value_id;
            new_solid.become_new_body(output_id, output_id.into());
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

fn inherit_face_tags<'item, I>(output: &mut Solid, inputs: I)
where
    I: Iterator<Item = &'item Solid>,
{
    for input in inputs {
        for (name, tag) in &input.faces {
            // Preserve the first input's tag when multiple bodies use the same name.
            output.faces.entry(name.clone()).or_insert_with(|| tag.clone());
        }
    }
}

pub(crate) async fn inner_union(
    solids: Vec<GeometryWithImportedGeometry>,
    tolerance: Option<TyF64>,
    csg_algorithm: CsgAlgorithm,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<GeometryWithImportedGeometry>, KclError> {
    let input_solids = native_solids(&solids);
    validate_solids_not_consumed(&input_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        let new_geometries = vec![csg_output_geometry(
            &solids[0],
            solid_out_id,
            solid_out_id,
            &input_solids,
            &args,
        )?];
        let new_solids = native_solids(&new_geometries);
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
        &input_solids,
        &args,
    )?];

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanUnion::builder()
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solid_ids)
                    .tolerance(LengthUnit(
                        tolerance.map(|t| t.unwrap_to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
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
            &input_solids,
            &args,
        )?);
    }

    let new_solids = native_solids(&new_geometries);
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
    let input_solids = native_solids(&solids);
    validate_solids_not_consumed(&input_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        let new_geometries = vec![csg_output_geometry(
            &solids[0],
            solid_out_id,
            solid_out_id,
            &input_solids,
            &args,
        )?];
        let new_solids = native_solids(&new_geometries);
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
        &input_solids,
        &args,
    )?];

    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, solid_out_id),
            ModelingCmd::from(
                mcmd::BooleanIntersection::builder()
                    .use_legacy(csg_algorithm.is_legacy())
                    .solid_ids(solid_ids)
                    .tolerance(LengthUnit(
                        tolerance.map(|t| t.unwrap_to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
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
            &input_solids,
            &args,
        )?);
    }

    let new_solids = native_solids(&new_geometries);
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
    let input_solids = native_solids(&solids);
    let tool_solids = native_solids(&tools);
    let combined_solids = input_solids
        .iter()
        .chain(tool_solids.iter())
        .cloned()
        .collect::<Vec<Solid>>();
    validate_solids_not_consumed(&combined_solids, exec_state, args.source_range)?;

    let solid_out_id = exec_state.next_uuid();

    if args.ctx.no_engine_commands().await {
        // Output one new body per input target, matching the normal execution path.
        let new_geometries = solids
            .iter()
            .enumerate()
            .map(|(index, solid)| {
                let output_id = if index == 0 {
                    solid_out_id
                } else {
                    exec_state.next_uuid()
                };
                let mut inherited_solids = native_solids(std::slice::from_ref(solid));
                inherited_solids.extend(tool_solids.iter().cloned());
                csg_output_geometry(solid, output_id, output_id, &inherited_solids, &args)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let new_solids = native_solids(&new_geometries);
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
                    .tolerance(LengthUnit(
                        tolerance.map(|t| t.unwrap_to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
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
    let mut inherited_solids = native_solids(&targets_for_command[..1]);
    inherited_solids.extend(tool_solids.iter().cloned());
    let new_geometries = output_ids
        .into_iter()
        .map(|output_id| {
            csg_output_geometry(
                &targets_for_command[0],
                output_id,
                solid_out_id,
                &inherited_solids,
                &args,
            )
        })
        .collect::<Result<Vec<_>, _>>()?;

    let new_solids = native_solids(&new_geometries);
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
    body.become_new_body(body_out_id, body_out_id.into());
    let mut new_solids = vec![body.clone()];
    let separate_bodies = !merge;

    if args.ctx.no_engine_commands().await {
        if separate_bodies {
            let extra_solid_id = exec_state.next_uuid();
            let mut new_solid = body.clone();
            new_solid.set_id(extra_solid_id);
            new_solid.value_id = body_out_id;
            new_solid.become_new_body(extra_solid_id, extra_solid_id.into());
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
    let tolerance = LengthUnit(tolerance.map(|t| t.unwrap_to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM));
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
        new_solid.become_new_body(extra_solid_id, extra_solid_id.into());
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

    use super::intersect;
    use super::subtract;
    use super::subtract_output_ids;
    use super::union;
    use crate::SourceRange;
    use crate::errors::KclError;
    use crate::execution::ExecState;
    use crate::execution::ImportedGeometry;
    use crate::execution::KclValue;
    use crate::execution::MockConfig;
    use crate::execution::fn_call::Arg;
    use crate::execution::fn_call::Args;
    use crate::execution::parse_execute;
    use crate::execution::types::RuntimeType;

    const FACE_TAG_INPUTS: &str = r#"@settings(kclVersion = 2.0)
fn profile(@plane) {
  return sketch(on = plane) {
    bottom = line(start = [-10mm, -10mm], end = [10mm, -10mm])
    right = line(start = [10mm, -10mm], end = [10mm, 10mm])
    top = line(start = [10mm, 10mm], end = [-10mm, 10mm])
    left = line(start = [-10mm, 10mm], end = [-10mm, -10mm])
  }
}
firstProfile = profile(XY)
secondProfile = profile(YZ)
thirdProfile = profile(XZ)
firstRegion = region(segments = [firstProfile.bottom])
secondRegion = region(segments = [secondProfile.bottom])
thirdRegion = region(segments = [thirdProfile.bottom])
first = extrude(firstRegion, length = 5mm, symmetric = true, tagEnd = $firstEnd)
second = extrude(secondRegion, length = 5mm, symmetric = true, tagEnd = $secondEnd)
third = extrude(thirdRegion, length = 5mm, symmetric = true, tagEnd = $thirdEnd)
untagged = extrude(region(segments = [firstProfile.bottom]), length = 5mm, symmetric = true)
"#;

    async fn assert_csg_inherits_face_tags(operation: &str) {
        for (input_names, tag_names) in [
            ("first, second", &["first", "second"][..]),
            ("first, second, third", &["first", "second", "third"]),
            ("third, second, first", &["third", "second", "first"]),
            ("untagged, second", &["second"]),
        ] {
            let mut code = FACE_TAG_INPUTS.to_owned();
            for name in tag_names {
                code.push_str(&format!("{name}Original = {name}.faces.{name}End\n"));
            }
            if operation == "subtract" {
                let (target, tools) = input_names.split_once(", ").unwrap();
                code.push_str(&format!("body = subtract({target}, tools = [{tools}])\n"));
            } else {
                code.push_str(&format!("body = {operation}([{input_names}])\n"));
            }
            for name in tag_names {
                code.push_str(&format!("{name}FromBody = body.faces.{name}End\n"));
            }
            let result = parse_execute(&code).await.unwrap();
            for name in tag_names {
                let output_tag = result.variable(&format!("{name}FromBody"));
                assert!(matches!(&output_tag, KclValue::TagIdentifier(_)));
                assert_eq!(
                    output_tag,
                    result.variable(&format!("{name}Original")),
                    "{operation}: {name}"
                );
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn union_inherits_face_tags_from_all_inputs() {
        assert_csg_inherits_face_tags("union").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn intersect_inherits_face_tags_from_all_inputs() {
        assert_csg_inherits_face_tags("intersect").await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_inherits_face_tags_from_target_and_tools() {
        let tag_names = ["first", "second", "third"];
        let mut code = FACE_TAG_INPUTS.to_owned();
        for name in tag_names {
            code.push_str(&format!("{name}Original = {name}.faces.{name}End\n"));
        }
        code.push_str("bodies = subtract([first, second], tools = [third, untagged])\n");
        let output_tag_names = [["first", "third"], ["second", "third"]];
        for (index, names) in output_tag_names.iter().enumerate() {
            for name in names {
                code.push_str(&format!("{name}FromBody{index} = bodies[{index}].faces.{name}End\n"));
            }
        }
        let result = parse_execute(&code).await.unwrap();
        let KclValue::HomArray { value: bodies, .. } = result.variable("bodies") else {
            panic!("Expected subtract to return an array of solids");
        };
        assert_eq!(bodies.len(), output_tag_names.len());
        for (index, names) in output_tag_names.iter().enumerate() {
            let KclValue::Solid { value: body } = &bodies[index] else {
                panic!("Expected subtract output {index} to be a solid");
            };
            assert_eq!(body.faces.len(), names.len(), "subtract: output {index}");
            for name in names {
                assert_eq!(
                    result.variable(&format!("{name}FromBody{index}")),
                    result.variable(&format!("{name}Original")),
                    "subtract: output {index}, tag {name}"
                );
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn csg_keeps_first_input_for_duplicate_face_tag_names() {
        let inputs = r#"@settings(kclVersion = 2.0)
fn body(@plane) {
  profile = sketch(on = plane) {
    circle1 = circle(center = [0mm, 0mm], start = [10mm, 0mm])
  }
  return extrude(region(segments = [profile.circle1]), length = 5mm, tagEnd = $cap)
}
first = body(XY)
second = body(YZ)
firstCap = first.faces.cap
secondCap = second.faces.cap
"#;
        for operation in ["union", "intersect", "subtract"] {
            for (inputs_order, expected, other) in [
                ("first, second", "firstCap", "secondCap"),
                ("second, first", "secondCap", "firstCap"),
            ] {
                let expression = if operation == "subtract" {
                    let (target, tool) = inputs_order.split_once(", ").unwrap();
                    format!("subtract({target}, tools = {tool})")
                } else {
                    format!("{operation}([{inputs_order}])")
                };
                let code = format!("{inputs}\ncombined = {expression}\nselected = combined.faces.cap\n");
                let result = parse_execute(&code).await.unwrap();
                assert_eq!(result.variable("selected"), result.variable(expected));
                assert_ne!(result.variable("selected"), result.variable(other));
            }
        }
    }

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

    fn imported_geometry_array(geometries: impl IntoIterator<Item = (Uuid, &'static str)>) -> KclValue {
        KclValue::HomArray {
            value: geometries
                .into_iter()
                .map(|(id, path)| imported_geometry(id, path))
                .collect(),
            ty: RuntimeType::imported(),
        }
    }

    fn csg_args(ctx: crate::ExecutorContext, function_name: &str, inputs: KclValue, tools: Option<KclValue>) -> Args {
        let source_range = SourceRange::default();
        let mut args = Args::new_no_args(source_range, None, ctx, Some(function_name.to_owned()));
        args.unlabeled.push((None, Arg::new(inputs, source_range)));
        if let Some(tools) = tools {
            args.labeled = IndexMap::from([("tools".to_owned(), Arg::new(tools, source_range))]);
        }
        args
    }

    fn assert_imported_result(result: KclValue, expected_path: &str, input_ids: &[Uuid]) {
        let KclValue::ImportedGeometry(result) = result else {
            panic!("expected imported geometry result, got {result:?}");
        };
        assert_eq!(result.value, vec![expected_path.to_owned()]);
        assert!(!input_ids.contains(&result.id));
    }

    async fn assert_imported_csg_kcl_executes(code: &str) {
        let current_file = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests")
            .join("inputs")
            .join("main.kcl");
        let mut settings = crate::execution::ExecutorSettings::default();
        settings.with_current_file(crate::TypedPath(current_file));
        let ctx = crate::ExecutorContext::new_mock(Some(settings)).await;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let result = ctx.run_mock(&program, &MockConfig::default()).await.unwrap();

        assert!(
            matches!(
                result.variables.get("result"),
                Some(crate::execution::KclValueView::ImportedGeometry(_))
            ),
            "expected CSG on an imported target to return imported geometry"
        );

        ctx.close().await;
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
    async fn union_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let input_ids = [test_uuid(1), test_uuid(2)];
        let args = csg_args(
            ctx.clone(),
            "union",
            imported_geometry_array([(input_ids[0], "left.step"), (input_ids[1], "right.step")]),
            None,
        );

        let result = union(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        assert_imported_result(result, "left.step", &input_ids);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn intersect_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let input_ids = [test_uuid(1), test_uuid(2)];
        let args = csg_args(
            ctx.clone(),
            "intersect",
            imported_geometry_array([(input_ids[0], "left.step"), (input_ids[1], "right.step")]),
            None,
        );

        let result = intersect(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        assert_imported_result(result, "left.step", &input_ids);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let input_ids = [test_uuid(1), test_uuid(2)];
        let args = csg_args(
            ctx.clone(),
            "subtract",
            imported_geometry_array([(input_ids[0], "target.step")]),
            Some(imported_geometry_array([(input_ids[1], "tool.step")])),
        );

        let result = subtract(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        assert_imported_result(result, "target.step", &input_ids);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn union_imported_geometry_from_kcl() {
        assert_imported_csg_kcl_executes(
            r#"import "cube.step" as cube

cylinder = startSketchOn(XY)
  |> circle(center = [400, 500], radius = 300)
  |> extrude(length = 1000, symmetric = true)

result = union([cube, cylinder])
"#,
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn intersect_imported_geometry_from_kcl() {
        assert_imported_csg_kcl_executes(
            r#"import "cube.step" as cube

cylinder = startSketchOn(XY)
  |> circle(center = [0, 500], radius = 600)
  |> extrude(length = 800, symmetric = true)

result = intersect([cube, cylinder])
"#,
        )
        .await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn subtract_imported_geometry_from_kcl() {
        assert_imported_csg_kcl_executes(
            r#"import "cube.step" as cube

hole = startSketchOn(XY)
  |> circle(center = [0, 500], radius = 250)
  |> extrude(length = 1200, symmetric = true)

result = subtract([cube], tools = [hole])
"#,
        )
        .await;
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
