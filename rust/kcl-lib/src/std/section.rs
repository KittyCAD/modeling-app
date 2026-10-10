//! Section a model using existing plane, circle, extrusion and Boolean commands.

use kittycad_modeling_cmds::ModelingCmd;
use kittycad_modeling_cmds::each_cmd as mcmd;
use kittycad_modeling_cmds::length_unit::LengthUnit;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::BodyType;
use kittycad_modeling_cmds::shared::Point3d as EnginePoint;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ConsumedSolidOperation;
use crate::execution::ExecState;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Point3d;
use crate::execution::SketchSurface;
use crate::execution::Solid;
use crate::execution::types::NumericType;
use crate::execution::types::NumericTypeExt;
use crate::execution::types::RuntimeType;
use crate::std::Args;
use crate::std::args::TyF64;
use crate::std::csg::CsgAlgorithm;
use crate::std::csg::inner_subtract;
use crate::std::shapes::SketchOrSurface;

#[derive(Debug, Clone, Copy)]
struct Bounds {
    center: [f64; 3],
    dimensions: [f64; 3],
}

impl Bounds {
    fn reach(self, origin: [f64; 3], padding: f64) -> f64 {
        let distance = self
            .center
            .iter()
            .zip(origin)
            .map(|(c, o)| (c - o).powi(2))
            .sum::<f64>()
            .sqrt();
        distance + self.dimensions.iter().map(|d| d * d).sum::<f64>().sqrt() / 2.0 + padding
    }

    fn signed_interval(self, origin: [f64; 3], normal: [f64; 3]) -> (f64, f64) {
        let center = (0..3).map(|i| (self.center[i] - origin[i]) * normal[i]).sum::<f64>();
        let radius = (0..3).map(|i| self.dimensions[i] * normal[i].abs() / 2.0).sum::<f64>();
        (center - radius, center + radius)
    }
}

fn mm(value: f64) -> TyF64 {
    TyF64::new(value, NumericType::length(kcl_api::UnitLength::Millimeters))
}

async fn bounds(solids: &[Solid], exec_state: &mut ExecState, args: &Args) -> Result<Bounds, KclError> {
    exec_state
        .flush_batch_for_solids(ModelingCmdMeta::from_args(exec_state, args), solids)
        .await?;
    let response = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(
                mcmd::BoundingBox::builder()
                    .entity_ids(solids.iter().map(|s| s.id).collect())
                    .output_unit(kittycad_modeling_cmds::units::UnitLength::Millimeters)
                    .build(),
            ),
        )
        .await?;
    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::BoundingBox(bounds),
    } = response
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Could not obtain model bounds for sectionView.".to_owned(),
            vec![args.source_range],
        )));
    };
    let result = Bounds {
        center: [bounds.center.x, bounds.center.y, bounds.center.z],
        dimensions: [bounds.dimensions.x, bounds.dimensions.y, bounds.dimensions.z],
    };
    if result.center.iter().chain(&result.dimensions).any(|x| !x.is_finite())
        || result.dimensions.iter().any(|x| *x < 0.0)
    {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "sectionView requires finite model bounds.".to_owned(),
            vec![args.source_range],
        )));
    }
    Ok(result)
}

pub async fn section_view(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let surface: SketchOrSurface = args.get_kw_arg("plane", &RuntimeType::plane(), exec_state)?;
    let padding: TyF64 = args
        .get_kw_arg_opt("padding", &RuntimeType::length(), exec_state)?
        .unwrap_or_else(|| mm(1.0));
    let reverse: bool = args
        .get_kw_arg_opt("reverse", &RuntimeType::bool(), exec_state)?
        .unwrap_or(false);
    let padding = padding.unwrap_to_mm();
    if !padding.is_finite() || padding <= 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "sectionView padding must be finite and greater than zero.".to_owned(),
            vec![args.source_range],
        )));
    }
    let SketchOrSurface::SketchSurface(SketchSurface::Plane(mut plane)) = surface else {
        return Err(KclError::new_type(KclErrorDetails::new(
            "sectionView requires a plane.".to_owned(),
            vec![args.source_range],
        )));
    };
    if reverse {
        plane.info.x_axis = plane.info.x_axis.negated();
        plane.info.z_axis = plane.info.z_axis.negated();
        // The opposite orientation needs its own engine plane.
        plane = super::sketch::make_sketch_plane_from_orientation(
            super::sketch::PlaneData::Plane(plane.info.clone()),
            exec_state,
            &args,
        )
        .await?;
    }

    // Snapshot before creating any cutter: includes unassigned bodies and nested module results.
    let mut targets = Vec::new();
    for body in exec_state.section_bodies() {
        if body.best_guess_body_type == Some(BodyType::Solid)
            || args.ctx.no_engine_commands().await
            || super::surfaces::query_body_type(&body, exec_state, &args).await? == BodyType::Solid
        {
            targets.push(body);
        }
    }
    if targets.is_empty() {
        return Ok(Vec::<Solid>::new().into());
    }

    let origin: EnginePoint<LengthUnit> = plane.info.origin.into();
    let origin = [origin.x.0, origin.y.0, origin.z.0];
    let Point3d { x, y, z, .. } = plane.info.x_axis.axes_cross_product(&plane.info.y_axis).normalize();
    let normal = [x, y, z];
    let mock = args.ctx.no_engine_commands().await;
    let reach = if mock {
        padding
    } else {
        bounds(&targets, exec_state, &args).await?.reach(origin, padding)
    };
    if !(2.0 * reach).is_finite() || !origin.iter().chain(&normal).all(|v| v.is_finite()) {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "sectionView requires a finite plane and cutter size.".to_owned(),
            vec![args.source_range],
        )));
    }
    super::sketch::ensure_sketch_plane_in_engine(
        &mut plane,
        exec_state,
        &args.ctx,
        args.source_range,
        args.node_path.clone(),
    )
    .await?;

    let mut result = Vec::new();
    for target in targets {
        if !mock {
            let (min, max) = bounds(std::slice::from_ref(&target), exec_state, &args)
                .await?
                .signed_interval(origin, normal);
            if max <= 0.0 {
                result.push(target);
                continue;
            }
            if min >= 0.0 {
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args(exec_state, &args),
                        ModelingCmd::from(
                            mcmd::RemoveSceneObjects::builder()
                                .object_ids([target.id].into())
                                .build(),
                        ),
                    )
                    .await?;
                super::solid_consumption::record_consumed_solids(
                    exec_state,
                    &[target],
                    ConsumedSolidOperation::Subtract,
                    &[],
                );
                continue;
            }
        }
        let material = exec_state.section_material(target.id);
        // One disposable tool per target keeps body/result and material association unambiguous.
        let sketch = super::shapes::inner_circle(
            SketchOrSurface::SketchSurface(SketchSurface::Plane(plane.clone())),
            None,
            Some(mm(reach)),
            None,
            None,
            exec_state,
            args.clone(),
        )
        .await?;
        // Keep the disposable profile out of the viewport before extruding it.
        hide_cutter(sketch.id, exec_state, &args).await?;
        let cutters = super::extrude::inner_extrude(
            vec![sketch.into()],
            Some(mm(2.0 * reach)),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(BodyType::Solid),
            false,
            exec_state,
            args.clone(),
        )
        .await?;
        for cutter in &cutters {
            hide_cutter(cutter.id, exec_state, &args).await?;
        }
        let outputs = inner_subtract(
            vec![target],
            cutters,
            None,
            CsgAlgorithm::Latest,
            exec_state,
            args.clone(),
        )
        .await?;
        for output in &outputs {
            if let Some(mut material) = material.clone() {
                material.object_id = output.id;
                exec_state
                    .batch_modeling_cmd(
                        ModelingCmdMeta::from_args(exec_state, &args),
                        ModelingCmd::from(material),
                    )
                    .await?;
            }
        }
        result.extend(outputs);
    }
    Ok(result.into())
}

async fn hide_cutter(object_id: uuid::Uuid, exec_state: &mut ExecState, args: &Args) -> Result<(), KclError> {
    exec_state
        .batch_modeling_cmd(
            ModelingCmdMeta::from_args(exec_state, args),
            ModelingCmd::from(mcmd::ObjectVisible::builder().object_id(object_id).hidden(true).build()),
        )
        .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::parse_execute;

    const MODEL: &str = r##"
@settings(kclVersion = 2.0)
fn part() {
  profile = sketch(on = XY) {
    outline = circle(center = [0mm, 0mm], start = [10mm, 0mm])
  }
  return extrude(region(segments = [profile.outline]), length = 20mm)
}
a = part()
appearance(a, color = "#cc7733", metalness = 80, roughness = 30, opacity = 60)
b = part()
appearance(b, color = "#3366cc", metalness = 10, roughness = 70)
cutPlane = offsetPlane(XY, offset = 10mm)
"##;

    fn count_solids(value: KclValue) -> usize {
        match value {
            KclValue::Solid { .. } => 1,
            KclValue::HomArray { value, .. } => value.into_iter().map(count_solids).sum(),
            _ => 0,
        }
    }

    #[test]
    fn section_view_cutter_covers_every_corner_for_offset_oblique_plane() {
        let bounds = Bounds {
            center: [80.0, -40.0, 10.0],
            dimensions: [100.0, 20.0, 30.0],
        };
        let origin = [-300.0, 10.0, -8.0];
        let normal = [1.0 / 3.0_f64.sqrt(); 3];
        let reach = bounds.reach(origin, 1.0);
        let (min, max) = bounds.signed_interval(origin, normal);
        for x in [-1.0, 1.0] {
            for y in [-1.0, 1.0] {
                for z in [-1.0, 1.0] {
                    let signs = [x, y, z];
                    let p = std::array::from_fn::<_, 3, _>(|i| {
                        bounds.center[i] + signs[i] * bounds.dimensions[i] / 2.0 - origin[i]
                    });
                    let distance = p.iter().map(|v| v * v).sum::<f64>().sqrt();
                    let signed = (0..3).map(|i| p[i] * normal[i]).sum::<f64>();
                    assert!(distance < reach);
                    assert!(signed >= min - 1e-9 && signed <= max + 1e-9);
                }
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_discovers_bodies_and_reapplies_each_material() {
        let result = parse_execute(&format!("{MODEL}\ncut = sectionView(plane = cutPlane)"))
            .await
            .unwrap();
        assert_eq!(count_solids(result.variable("cut")), 2);
        let materials = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ObjectSetMaterialParamsPbr(m) => Some(m),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(materials.len(), 4);
        for (source, output) in materials[..2].iter().zip(&materials[2..]) {
            let mut expected = (*source).clone();
            expected.object_id = output.object_id;
            assert_eq!(&expected, *output);
            assert_ne!(source.object_id, output.object_id);
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_hides_cutter_profile_and_body_before_subtraction() {
        let result = parse_execute(&format!("{MODEL}\ncut = sectionView(plane = cutPlane)"))
            .await
            .unwrap();
        let commands = result.root_module_artifact_commands();
        let profiles = commands
            .iter()
            .enumerate()
            .filter_map(|(index, c)| match &c.command {
                ModelingCmd::ClosePath(path) => Some((index, path.path_id)),
                _ => None,
            })
            .collect::<Vec<_>>();
        // The internal circle uses ClosePath; the model's v2 sketches do not.
        assert_eq!(profiles.len(), 2);
        for &(created, profile_id) in &profiles {
            let hidden = commands
                .iter()
                .enumerate()
                .filter_map(|(index, c)| match &c.command {
                    ModelingCmd::ObjectVisible(visibility) if visibility.object_id == profile_id => {
                        assert!(visibility.hidden);
                        Some(index)
                    }
                    _ => None,
                })
                .collect::<Vec<_>>();
            assert_eq!(hidden.len(), 2, "hide both the sketch and its extruded body");
            assert_eq!(hidden[0], created + 1, "hide the sketch immediately after creation");
            assert!(
                commands[hidden[0] + 1..hidden[1]]
                    .iter()
                    .any(|c| matches!(c.command, ModelingCmd::Extrude(_)))
            );
            assert!(matches!(
                commands[hidden[1] + 1].command,
                ModelingCmd::ObjectSetMaterialParamsPbr(_)
            ));
        }
        assert_eq!(count_solids(result.variable("cut")), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_deduplicates_aliases_and_excludes_consumed_deleted_bodies() {
        let result = parse_execute(&format!(
            r#"{MODEL}
alias = a
joined = union([a, b])
unused = part()
delete(unused)
cut = sectionView(plane = cutPlane)
second = sectionView(plane = cutPlane, reverse = true)
"#
        ))
        .await
        .unwrap();
        assert_eq!(count_solids(result.variable("cut")), 1);
        assert_eq!(count_solids(result.variable("second")), 1);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_includes_unassigned_bodies_created_inside_functions() {
        let result = parse_execute(&format!("{MODEL}\npart()\ncut = sectionView(plane = cutPlane)"))
            .await
            .unwrap();
        assert_eq!(count_solids(result.variable("cut")), 3);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_discovers_imported_kcl_modules() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("part.kcl"), format!("{MODEL}\nexport bodies = [a, b]")).unwrap();
        let result = crate::execution::parse_execute_with_project_dir(
            "@settings(kclVersion = 2.0)\nimport \"part.kcl\" as parts\ncut = sectionView(plane = offsetPlane(XY, offset = 10mm))",
            Some(crate::TypedPath(dir.path().to_path_buf())),
        ).await.unwrap();
        assert_eq!(count_solids(result.variable("cut")), 2);
        let materials = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ObjectSetMaterialParamsPbr(m) => Some(m),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(materials.len(), 2);
        assert_ne!(materials[0].color, materials[1].color);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_preserves_clone_and_pattern_materials() {
        let result = parse_execute(&format!(
            r#"{MODEL}
copies = clone(a)
patterned = patternLinear3d(b, instances = 3, distance = 30mm, axis = [1, 0, 0])
cut = sectionView(plane = cutPlane)
"#
        ))
        .await
        .unwrap();
        assert_eq!(count_solids(result.variable("cut")), 5);
        let materials = result
            .root_module_artifact_commands()
            .iter()
            .filter_map(|c| match &c.command {
                ModelingCmd::ObjectSetMaterialParamsPbr(m) => Some(m),
                _ => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(materials.len(), 7);
        assert_eq!(materials[2].color, materials[0].color);
        assert_eq!(materials[3].color, materials[1].color);
        assert_eq!(materials[4].color, materials[0].color);
        assert_eq!(materials[5].color, materials[1].color);
        assert_eq!(materials[6].color, materials[1].color);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn section_view_empty_scene_and_invalid_padding() {
        let result = parse_execute("@settings(kclVersion = 2.0)\ncut = sectionView(plane = XY)")
            .await
            .unwrap();
        assert_eq!(count_solids(result.variable("cut")), 0);
        for padding in ["0mm", "-1mm"] {
            let err = parse_execute(&format!("sectionView(plane = XY, padding = {padding})"))
                .await
                .unwrap_err();
            assert!(err.to_string().contains("padding must be finite and greater than zero"));
        }
    }
}
