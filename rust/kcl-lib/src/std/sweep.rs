//! Standard library sweep.

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::BodyType};
use kittycad_modeling_cmds::{self as kcmc, shared::RelativeTo};
use serde::Serialize;

use super::{DEFAULT_TOLERANCE_MM, args::TyF64};
use crate::{
    errors::KclError,
    execution::{ExecState, Helix, KclValue, ModelingCmdMeta, Sketch, Solid, types::RuntimeType},
    parsing::ast::types::TagNode,
    std::{Args, extrude::do_post_extrude},
};

/// A path to sweep along.
#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum SweepPath {
    Sketch(Sketch),
    Helix(Box<Helix>),
}

/// Extrude a sketch along a path.
pub async fn sweep(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let path: SweepPath = args.get_kw_arg(
        "path",
        &RuntimeType::Union(vec![RuntimeType::sketch(), RuntimeType::helix()]),
        exec_state,
    )?;
    let sectional = args.get_kw_arg_opt("sectional", &RuntimeType::bool(), exec_state)?;
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let relative_to: Option<String> = args.get_kw_arg_opt("relativeTo", &RuntimeType::string(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;

    let value = inner_sweep(
        sketches,
        path,
        sectional,
        tolerance,
        relative_to,
        tag_start,
        tag_end,
        exec_state,
        args,
    )
    .await?;
    Ok(value.into())
}

#[allow(clippy::too_many_arguments)]
async fn inner_sweep(
    sketches: Vec<Sketch>,
    path: SweepPath,
    sectional: Option<bool>,
    tolerance: Option<TyF64>,
    relative_to: Option<String>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    let trajectory = match path {
        SweepPath::Sketch(sketch) => sketch.id.into(),
        SweepPath::Helix(helix) => helix.value.into(),
    };
    let relative_to = match relative_to.as_deref() {
        Some("sketchPlane") => RelativeTo::SketchPlane,
        Some("trajectoryCurve") | None => RelativeTo::TrajectoryCurve,
        Some(_) => {
            return Err(KclError::new_syntax(crate::errors::KclErrorDetails::new(
                "If you provide relativeTo, it must either be 'sketchPlane' or 'trajectoryCurve'".to_owned(),
                vec![args.source_range],
            )));
        }
    };

    let mut solids = Vec::new();
    for sketch in &sketches {
        let id = exec_state.next_uuid();
        exec_state
            .batch_modeling_cmd(
                ModelingCmdMeta::from_args_id(exec_state, &args, id),
                ModelingCmd::from(
                    mcmd::Sweep::builder()
                        .target(sketch.id.into())
                        .trajectory(trajectory)
                        .sectional(sectional.unwrap_or(false))
                        .tolerance(LengthUnit(
                            tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                        ))
                        .relative_to(relative_to)
                        .build(),
                ),
            )
            .await?;

        solids.push(
            do_post_extrude(
                sketch,
                id.into(),
                sectional.unwrap_or(false),
                &super::extrude::NamedCapTags {
                    start: tag_start.as_ref(),
                    end: tag_end.as_ref(),
                },
                kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
                exec_state,
                &args,
                None,
                None,
                BodyType::Solid, // TODO: Support surface sweep
                crate::std::extrude::BeingExtruded::Sketch,
            )
            .await?,
        );
    }

    // Hide the artifact from the sketch or helix.
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::ObjectVisible::builder()
                    .object_id(trajectory.into())
                    .hidden(true)
                    .build(),
            ),
        )
        .await?;

    Ok(solids)
}
