//! Standard library shells.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::length_unit::LengthUnit;
use kittycad_modeling_cmds as kcmc;
use kittycad_modeling_cmds::shared::BodyType;

use super::args::TyF64;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::types::ArrayLen;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::sketch::FaceTag;
use crate::std::surfaces::query_body_type;

/// Give a surface body a uniform thickness using the existing shell command.
pub async fn thicken(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let mut surface: Box<Solid> = args.get_unlabeled_kw_arg("surface", &RuntimeType::solid(), exec_state)?;
    let thickness: TyF64 = args.get_kw_arg("thickness", &RuntimeType::length(), exec_state)?;
    let distance = thickness.unwrap_to_mm();
    let flip: Option<bool> = args.get_kw_arg_opt("flip", &RuntimeType::bool(), exec_state)?;
    let center: Option<bool> = args.get_kw_arg_opt("center", &RuntimeType::bool(), exec_state)?;
    if !distance.is_finite() || distance <= 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Thickness must be a finite, positive length; use flip to reverse its direction".to_owned(),
            vec![args.source_range],
        )));
    }

    exec_state
        .flush_batch_for_solids(
            ModelingCmdMeta::from_args(exec_state, &args),
            std::slice::from_ref(surface.as_ref()),
        )
        .await?;
    let body_type = if args.ctx.no_engine_commands().await {
        surface.best_guess_body_type
    } else {
        Some(query_body_type(&surface, exec_state, &args).await?)
    };
    if body_type.is_some_and(|body_type| body_type != BodyType::Surface) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Thicken requires a surface body".to_owned(),
            vec![args.source_range],
        )));
    }

    if center.unwrap_or(false) {
        // Reuse cloning and union so centering needs no additional wire/API fields.
        let mut copies = super::clone::inner_clone(
            vec![GeometryWithImportedGeometry::Solid(surface.as_ref().clone())],
            exec_state,
            args.clone(),
        )
        .await?;
        let Some(GeometryWithImportedGeometry::Solid(mut opposite)) = copies.pop() else {
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Could not copy the surface for centered thickening".to_owned(),
                vec![args.source_range],
            )));
        };
        thicken_one_side(&mut surface, distance * 0.5, exec_state, &args).await?;
        thicken_one_side(&mut opposite, -distance * 0.5, exec_state, &args).await?;
        let mut bodies = super::csg::inner_union(
            vec![*surface, opposite],
            None,
            super::csg::CsgAlgorithm::Latest,
            exec_state,
            args.clone(),
        )
        .await?;
        if bodies.len() != 1 {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Centered thickening could not join its two halves into one body".to_owned(),
                vec![args.source_range],
            )));
        }
        return Ok(KclValue::Solid {
            value: Box::new(bodies.remove(0)),
        });
    }
    thicken_one_side(
        &mut surface,
        if flip.unwrap_or(false) { -distance } else { distance },
        exec_state,
        &args,
    )
    .await?;
    Ok(KclValue::Solid { value: surface })
}

async fn thicken_one_side(
    surface: &mut Solid,
    distance: f64,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<(), KclError> {
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::Solid3dShellFace::builder()
                    .hollow(true)
                    .face_ids(Vec::new())
                    .object_id(surface.id)
                    // Shell offsets inward; positive thickness follows the surface normal.
                    .shell_thickness(LengthUnit(-distance))
                    .build(),
            ),
        )
        .await?;
    surface.best_guess_body_type = Some(BodyType::Solid);
    Ok(())
}

/// Create a shell.
pub async fn shell(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solids = args.get_unlabeled_kw_arg("solids", &RuntimeType::solids(), exec_state)?;
    let thickness: TyF64 = args.get_kw_arg("thickness", &RuntimeType::length(), exec_state)?;
    let faces = args.get_kw_arg(
        "faces",
        &RuntimeType::Array(Box::new(RuntimeType::tagged_face()), ArrayLen::Minimum(1)),
        exec_state,
    )?;

    let result = inner_shell(solids, thickness, faces, exec_state, args).await?;
    Ok(result.into())
}

async fn inner_shell(
    solids: Vec<Solid>,
    thickness: TyF64,
    faces: Vec<FaceTag>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Vec<Solid>, KclError> {
    if faces.is_empty() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You must shell at least one face".to_owned(),
            vec![args.source_range],
        )));
    }

    if solids.is_empty() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "You must shell at least one solid".to_owned(),
            vec![args.source_range],
        )));
    }

    let mut face_ids = Vec::new();
    for solid in &solids {
        // Flush the batch for our fillets/chamfers if there are any.
        // If we do not do these for sketch on face, things will fail with face does not exist.
        exec_state
            .flush_batch_for_solids(
                ModelingCmdMeta::from_args(exec_state, &args),
                std::slice::from_ref(solid),
            )
            .await?;

        for tag in &faces {
            let extrude_plane_id = tag.get_face_id(solid, exec_state, &args, false).await?;

            face_ids.push(extrude_plane_id);
        }
    }

    if face_ids.is_empty() {
        return Err(KclError::new_type(KclErrorDetails::new(
            "Expected at least one valid face".to_owned(),
            vec![args.source_range],
        )));
    }

    // Make sure all the solids have the same id, as we are going to shell them all at
    // once.
    if !solids.iter().all(|eg| eg.id == solids[0].id) {
        return Err(KclError::new_type(KclErrorDetails::new(
            "All solids stem from the same root object, like multiple sketch on face extrusions, etc.".to_owned(),
            vec![args.source_range],
        )));
    }

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dShellFace::builder()
                    .hollow(false)
                    .face_ids(face_ids)
                    .object_id(solids[0].id)
                    .shell_thickness(LengthUnit(thickness.unwrap_to_mm()))
                    .build(),
            ),
        )
        .await?;

    Ok(solids)
}

/// Make the inside of a 3D object hollow.
pub async fn hollow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let thickness: TyF64 = args.get_kw_arg("thickness", &RuntimeType::length(), exec_state)?;

    let value = inner_hollow(solid, thickness, exec_state, args).await?;
    Ok(KclValue::Solid { value })
}

async fn inner_hollow(
    solid: Box<Solid>,
    thickness: TyF64,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<Box<Solid>, KclError> {
    // Flush the batch for our fillets/chamfers if there are any.
    // If we do not do these for sketch on face, things will fail with face does not exist.
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, &args), &[(*solid).clone()])
        .await?;

    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, &args),
            ModelingCmd::from(
                mcmd::Solid3dShellFace::builder()
                    .hollow(true)
                    .face_ids(Vec::new()) // This is empty because we want to hollow the entire object.
                    .object_id(solid.id)
                    .shell_thickness(LengthUnit(thickness.unwrap_to_mm()))
                    .build(),
            ),
        )
        .await?;

    Ok(solid)
}

#[cfg(test)]
mod tests {
    use crate::execution::MockConfig;

    #[tokio::test(flavor = "multi_thread")]
    async fn thicken_mock_validates_inputs_and_marks_result_as_solid() {
        let setup = r#"
@settings(defaultLengthUnit = mm, kclVersion = 3.0, experimentalFeatures = allow)
profile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
  arc1 = arc(start = [var 20mm, var 0mm], end = [var 30mm, var 10mm], center = [var 20mm, var 10mm])
  line2 = line(start = [var 30mm, var 10mm], end = [var 30mm, var 25mm])
  line3 = line(start = [var 30mm, var 25mm], end = [var 45mm, var 25mm])
}
surface = extrude([profile.line1, profile.arc1, profile.line2, profile.line3], length = 10mm, bodyType = SURFACE)
"#;
        for options in [
            "",
            ", flip = false",
            ", flip = true",
            ", center = true",
            ", center = true, flip = true",
        ] {
            for thickness in ["2mm", "0.1in"] {
                let code = format!(
                    "{setup}\nbody = thicken(surface, thickness = {thickness}{options})\nassertIs(isSolid(body))\nassertIs(!isSurface(body))"
                );
                let program = crate::Program::parse_no_errs(&code).unwrap();
                let ctx = crate::ExecutorContext::new_mock(None).await;
                let result = ctx.run_mock(&program, &MockConfig::default()).await;
                ctx.close().await;
                result.unwrap();
            }
        }
        for (operation, message) in [
            ("thicken(surface, thickness = 0mm)", "finite, positive"),
            ("thicken(surface, thickness = -2mm)", "finite, positive"),
            (
                "body = thicken(surface, thickness = 2mm)\nthicken(body, thickness = 1mm)",
                "requires a surface body",
            ),
        ] {
            let program = crate::Program::parse_no_errs(&format!("{setup}\n{operation}")).unwrap();
            let ctx = crate::ExecutorContext::new_mock(None).await;
            let result = ctx.run_mock(&program, &MockConfig::default()).await;
            ctx.close().await;
            assert!(result.unwrap_err().to_string().contains(message));
        }
    }
    #[tokio::test(flavor = "multi_thread")]
    async fn thicken_samples_execute_in_mock() {
        for code in [
            include_str!("../../examples/thicken/01-side-comparison.kcl"),
            include_str!("../../examples/thicken/02-centered-rounded-guard.kcl"),
            include_str!("../../examples/thicken/03-sharp-z-bracket.kcl"),
            include_str!("../../examples/thicken/04-overlap-experiment.kcl"),
            include_str!("../../examples/thicken/06-aurora-turbine.kcl"),
            include_str!("../../examples/thicken/07-lotus-ribbon-lamp.kcl"),
            include_str!("../../examples/thicken/08-wave-roof-pavilion.kcl"),
        ] {
            let program = crate::Program::parse_no_errs(code).unwrap();
            let ctx = crate::ExecutorContext::new_mock(None).await;
            let result = ctx.run_mock(&program, &MockConfig::default()).await;
            ctx.close().await;
            result.unwrap();
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn thicken_tight_tangent_return_regression() {
        let code = include_str!("../../examples/thicken/05-tight-tangent-return.kcl");
        for thickness in ["2mm", "3mm"] {
            let code = code.replace("thickness = 3mm", &format!("thickness = {thickness}"));
            let program = crate::Program::parse_no_errs(&code).unwrap();
            let ctx = crate::ExecutorContext::new_mock(None).await;
            let result = ctx.run_mock(&program, &MockConfig::default()).await;
            ctx.close().await;
            result.unwrap();
        }
    }
}
