//! Standard library lofts.

use std::num::NonZeroU32;

use anyhow::Result;
use kcmc::{ModelingCmd, each_cmd as mcmd, length_unit::LengthUnit, shared::BodyType};
use kittycad_modeling_cmds as kcmc;

use super::{DEFAULT_TOLERANCE_MM, args::TyF64};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue, ModelingCmdMeta, ProfileClosed, Sketch, Solid, types::RuntimeType},
    parsing::ast::types::TagNode,
    std::{Args, extrude::do_post_extrude},
};

const DEFAULT_V_DEGREE: u32 = 2;

/// Create a 3D surface or solid by interpolating between two or more sketches.
pub async fn loft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let sketches = args.get_unlabeled_kw_arg("sketches", &RuntimeType::sketches(), exec_state)?;
    let v_degree: NonZeroU32 = args
        .get_kw_arg_opt("vDegree", &RuntimeType::count(), exec_state)?
        .unwrap_or(NonZeroU32::new(DEFAULT_V_DEGREE).unwrap());
    // Attempt to approximate rational curves (such as arcs) using a bezier.
    // This will remove banding around interpolations between arcs and non-arcs.  It may produce errors in other scenarios
    // Over time, this field won't be necessary.
    let bez_approximate_rational = args
        .get_kw_arg_opt("bezApproximateRational", &RuntimeType::bool(), exec_state)?
        .unwrap_or(false);
    // This can be set to override the automatically determined topological base curve, which is usually the first section encountered.
    let base_curve_index: Option<u32> = args.get_kw_arg_opt("baseCurveIndex", &RuntimeType::count(), exec_state)?;
    // Tolerance for the loft operation.
    let tolerance: Option<TyF64> = args.get_kw_arg_opt("tolerance", &RuntimeType::length(), exec_state)?;
    let tag_start = args.get_kw_arg_opt("tagStart", &RuntimeType::tag_decl(), exec_state)?;
    let tag_end = args.get_kw_arg_opt("tagEnd", &RuntimeType::tag_decl(), exec_state)?;
    let body_type: Option<BodyType> = args.get_kw_arg_opt("bodyType", &RuntimeType::string(), exec_state)?;

    let value = inner_loft(
        sketches,
        v_degree,
        bez_approximate_rational,
        base_curve_index,
        tolerance,
        tag_start,
        tag_end,
        body_type,
        exec_state,
        args,
    )
    .await?;
    Ok(KclValue::Solid { value })
}

#[allow(clippy::too_many_arguments)]
async fn inner_loft(
    sketches: Vec<Sketch>,
    v_degree: NonZeroU32,
    bez_approximate_rational: bool,
    base_curve_index: Option<u32>,
    tolerance: Option<TyF64>,
    tag_start: Option<TagNode>,
    tag_end: Option<TagNode>,
    body_type: Option<BodyType>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    let body_type = body_type.unwrap_or_default();
    if matches!(body_type, BodyType::Solid) && sketches.iter().any(|sk| matches!(sk.is_closed, ProfileClosed::No)) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot solid loft an open profile. Either close the profile, or use a surface loft.".to_owned(),
            vec![args.source_range],
        )));
    }

    // Make sure we have at least two sketches.
    if sketches.len() < 2 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Loft requires at least two sketches, but only {} were provided.",
                sketches.len()
            ),
            vec![args.source_range],
        )));
    }

    let id = exec_state.next_uuid();
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args_id(exec_state, &args, id),
            ModelingCmd::from(if let Some(base_curve_index) = base_curve_index {
                mcmd::Loft::builder()
                    .section_ids(sketches.iter().map(|group| group.id).collect())
                    .bez_approximate_rational(bez_approximate_rational)
                    .tolerance(LengthUnit(
                        tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .v_degree(v_degree)
                    .body_type(body_type)
                    .base_curve_index(base_curve_index)
                    .build()
            } else {
                mcmd::Loft::builder()
                    .section_ids(sketches.iter().map(|group| group.id).collect())
                    .bez_approximate_rational(bez_approximate_rational)
                    .tolerance(LengthUnit(
                        tolerance.as_ref().map(|t| t.to_mm()).unwrap_or(DEFAULT_TOLERANCE_MM),
                    ))
                    .v_degree(v_degree)
                    .body_type(body_type)
                    .build()
            }),
        )
        .await?;

    // Using the first sketch as the base curve, idk we might want to change this later.
    let mut sketch = sketches[0].clone();
    // Override its id with the loft id so we can get its faces later
    sketch.id = id;
    Ok(Box::new(
        do_post_extrude(
            &sketch,
            id.into(),
            false,
            &super::extrude::NamedCapTags {
                start: tag_start.as_ref(),
                end: tag_end.as_ref(),
            },
            kittycad_modeling_cmds::shared::ExtrudeMethod::Merge,
            exec_state,
            &args,
            None,
            None,
            body_type,
            crate::std::extrude::BeingExtruded::Sketch,
        )
        .await?,
    ))
}
