//! Functions for handling and converting IDs.

use anyhow::Result;
use kcmc::ModelingCmd;
use kcmc::each_cmd as mcmd;
use kcmc::units::UnitLength;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::shared::Point3d;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use kittycad_modeling_cmds::{self as kcmc};

use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::exec::KclValue;
use crate::execution::ArtifactId;
use crate::execution::ExecState;
use crate::execution::ExtrudeSurface;
use crate::execution::GeoMeta;
use crate::execution::Geometry;
use crate::execution::GeometryWithImportedGeometry;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::Solid;
use crate::execution::SolidCreator;
use crate::execution::TagEngineInfo;
use crate::execution::TagIdentifier;
use crate::execution::types::RuntimeType;
use crate::parsing::ast::types::TagDeclarator;
use crate::std::Args;
use crate::std::args::TyF64;

fn solid_or_imported_type() -> RuntimeType {
    RuntimeType::Union(vec![RuntimeType::solid(), RuntimeType::imported()])
}

async fn lookup_body_id(body: &mut GeometryWithImportedGeometry, args: &Args) -> Result<(uuid::Uuid, bool), KclError> {
    let no_engine_commands = args.ctx.no_engine_commands().await;
    let body_id = match body {
        GeometryWithImportedGeometry::Solid(solid) => solid.id,
        GeometryWithImportedGeometry::ImportedGeometry(imported) if no_engine_commands => imported.id,
        GeometryWithImportedGeometry::ImportedGeometry(imported) => imported.id(&args.ctx).await?,
        GeometryWithImportedGeometry::Sketch(_) => {
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Expected a solid or imported geometry for ID lookup.".to_string(),
                vec![args.source_range],
            )));
        }
    };
    Ok((body_id, no_engine_commands))
}

fn tracked_face(body: &GeometryWithImportedGeometry, face_id: uuid::Uuid) -> Option<ExtrudeSurface> {
    match body {
        GeometryWithImportedGeometry::Solid(solid) => {
            solid.value.iter().find(|surface| surface.face_id() == face_id).cloned()
        }
        GeometryWithImportedGeometry::Sketch(_) | GeometryWithImportedGeometry::ImportedGeometry(_) => None,
    }
}

fn solid_for_face_tag(
    body: &GeometryWithImportedGeometry,
    body_id: uuid::Uuid,
    args: &Args,
) -> Result<Solid, KclError> {
    match body {
        GeometryWithImportedGeometry::Solid(solid) => Ok(solid.clone()),
        GeometryWithImportedGeometry::ImportedGeometry(_) => {
            // TagEngineInfo currently stores face tags under Geometry::Solid, so
            // imported bodies use a minimal solid shell with the imported body ID.
            Ok(Solid {
                id: body_id,
                value_id: body_id,
                artifact_id: ArtifactId::new(body_id),
                value: Vec::new(),
                faces: Default::default(),
                creator: SolidCreator::Procedural,
                start_cap_id: None,
                end_cap_id: None,
                edge_cuts: Vec::new(),
                pending_edge_cut_ids: Vec::new(),
                units: UnitLength::Millimeters,
                sectional: false,
                meta: vec![args.source_range.into()],
            })
        }
        GeometryWithImportedGeometry::Sketch(_) => Err(KclError::new_internal(KclErrorDetails::new(
            "Expected a solid or imported geometry for face ID lookup.".to_string(),
            vec![args.source_range],
        ))),
    }
}

/// Translates face indices to face IDs.
pub async fn face_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &solid_or_imported_type(), exec_state)?;
    let face_index: u32 = args.get_kw_arg("index", &RuntimeType::count(), exec_state)?;

    inner_face_id(body, face_index, exec_state, args).await
}

/// Translates face indices to face IDs.
async fn inner_face_id(
    mut body: GeometryWithImportedGeometry,
    face_index: u32,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    let (body_id, no_engine_commands) = lookup_body_id(&mut body, &args).await?;

    // Handle mock execution
    let face_id = if no_engine_commands {
        exec_state.next_uuid()
    } else {
        // Query engine, unpack response.
        let face_uuid_response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::Solid3dGetFaceUuid::builder()
                        .object_id(body_id)
                        .face_index(face_index)
                        .build(),
                ),
            )
            .await?;
        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Solid3dGetFaceUuid(inner_resp),
        } = face_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned Solid3dGetFaceUuid but it returned {face_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        inner_resp.face_id
    };

    let new_tag_name = format!("face_id_{}", face_id.to_string().replace('-', "_"));
    let new_tag_node = TagDeclarator::new(&new_tag_name);

    let mut tagged_surface = tracked_face(&body, face_id).unwrap_or_else(|| {
        // Booleans and imported solids can have engine face IDs that we don't track in
        // `body.value`, but `faceId` should still return a usable tagged face.
        ExtrudeSurface::ExtrudePlane(crate::execution::ExtrudePlane {
            face_id,
            tag: None,
            geo_meta: GeoMeta {
                id: face_id,
                metadata: args.source_range.into(),
            },
        })
    });
    tagged_surface.set_surface_tag(&new_tag_node);
    let solid = solid_for_face_tag(&body, body_id, &args)?;

    let new_tag = TagIdentifier {
        value: new_tag_name,
        info: vec![(
            exec_state.stack().current_epoch(),
            TagEngineInfo {
                id: tagged_surface.get_id(),
                geometry: Geometry::Solid(solid),
                path: None,
                surface: Some(tagged_surface),
            },
        )],
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    };

    Ok(KclValue::TagIdentifier(Box::new(new_tag)))
}

/// Translates edge indices to edge IDs.
pub async fn edge_id(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let body = args.get_unlabeled_kw_arg("body", &solid_or_imported_type(), exec_state)?;
    let edge_index: Option<u32> = args.get_kw_arg_opt("index", &RuntimeType::count(), exec_state)?;
    let closest_to: Option<[TyF64; 3]> = args.get_kw_arg_opt("closestTo", &RuntimeType::point3d(), exec_state)?;
    let closest_to = closest_to
        .map(|point| [point[0].to_mm(), point[1].to_mm(), point[2].to_mm()])
        .map(|[x, y, z]| Point3d { x, y, z });
    match (edge_index, closest_to) {
        (None, None) => Err(KclError::new_semantic(KclErrorDetails::new(
            "Must use either `index` or `closestTo`".to_string(),
            vec![args.source_range],
        ))),
        (None, Some(closest_to)) => inner_edge_id_by_point(body, closest_to, exec_state, args).await,
        (Some(edge_index), None) => inner_edge_id(body, edge_index, exec_state, args).await,
        (Some(_), Some(_)) => Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot use both `index` and `closestTo`".to_string(),
            vec![args.source_range],
        ))),
    }
}

/// Translates edge indices to edge IDs.
async fn inner_edge_id(
    mut body: GeometryWithImportedGeometry,
    edge_index: u32,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    // Handle mock execution
    let (body_id, no_engine_commands) = lookup_body_id(&mut body, &args).await?;
    let edge_id = if no_engine_commands {
        exec_state.next_uuid()
    } else {
        let edge_uuid_response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::Solid3dGetEdgeUuid::builder()
                        .object_id(body_id)
                        .edge_index(edge_index)
                        .build(),
                ),
            )
            .await?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::Solid3dGetEdgeUuid(inner_resp),
        } = edge_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned Solid3dGetEdgeUuid but it returned {edge_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        inner_resp.edge_id
    };
    Ok(KclValue::Uuid {
        value: edge_id,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    })
}

/// Finds ID of edge closest to this point.
async fn inner_edge_id_by_point(
    mut body: GeometryWithImportedGeometry,
    closest_point: Point3d<f64>,
    exec_state: &mut ExecState,
    args: Args,
) -> Result<KclValue, KclError> {
    // Handle mock execution
    let (body_id, no_engine_commands) = lookup_body_id(&mut body, &args).await?;
    let edge_id = if no_engine_commands {
        exec_state.next_uuid()
    } else {
        let edge_uuid_response = exec_state
            .send_modeling_cmd(
                ModelingCmdMeta::from_args(exec_state, &args),
                ModelingCmd::from(
                    mcmd::ClosestEdge::builder()
                        .object_id(body_id)
                        .closest_to(closest_point)
                        .build(),
                ),
            )
            .await?;

        let OkWebSocketResponseData::Modeling {
            modeling_response: OkModelingCmdResponse::ClosestEdge(inner_resp),
        } = edge_uuid_response
        else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Engine returned invalid response, it should have returned ClosestEdge but it returned {edge_uuid_response:?}"
                ),
                vec![args.source_range],
            )));
        };
        let Some(edge_id) = inner_resp.edge_id else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Engine didn't find any edges near this point".to_string(),
                vec![args.source_range],
            )));
        };
        edge_id
    };
    Ok(KclValue::Uuid {
        value: edge_id,
        meta: vec![Metadata {
            source_range: args.source_range,
        }],
    })
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::edge_id;
    use super::face_id;
    use crate::SourceRange;
    use crate::execution::ExecState;
    use crate::execution::Geometry;
    use crate::execution::ImportedGeometry;
    use crate::execution::KclValue;
    use crate::execution::MockConfig;
    use crate::execution::fn_call::Arg;
    use crate::execution::fn_call::Args;
    use crate::execution::types::NumericType;

    fn imported_geometry(id: Uuid) -> KclValue {
        KclValue::ImportedGeometry(ImportedGeometry::new(
            id,
            vec!["imported.step".to_owned()],
            vec![SourceRange::synthetic().into()],
        ))
    }

    fn count(value: f64) -> KclValue {
        KclValue::Number {
            value,
            ty: NumericType::count(),
            meta: vec![SourceRange::synthetic().into()],
        }
    }

    fn length(value: f64) -> KclValue {
        KclValue::Number {
            value,
            ty: NumericType::mm(),
            meta: vec![SourceRange::synthetic().into()],
        }
    }

    fn point3d([x, y, z]: [f64; 3]) -> KclValue {
        KclValue::Tuple {
            value: vec![length(x), length(y), length(z)],
            meta: Default::default(),
        }
    }

    fn args_with_imported_body(ctx: crate::ExecutorContext, fn_name: &str, body_id: Uuid) -> Args {
        let mut args = Args::new_no_args(SourceRange::synthetic(), None, ctx, Some(fn_name.to_owned()));
        args.unlabeled.push((None, Arg::synthetic(imported_geometry(body_id))));
        args
    }

    fn args_with_imported_index(ctx: crate::ExecutorContext, fn_name: &str, body_id: Uuid) -> Args {
        let mut args = args_with_imported_body(ctx, fn_name, body_id);
        args.labeled.insert("index".to_owned(), Arg::synthetic(count(0.0)));
        args
    }

    fn args_with_imported_closest_to(ctx: crate::ExecutorContext, fn_name: &str, body_id: Uuid) -> Args {
        let mut args = args_with_imported_body(ctx, fn_name, body_id);
        args.labeled
            .insert("closestTo".to_owned(), Arg::synthetic(point3d([0.0, 0.0, 0.0])));
        args
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn face_id_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let body_id = Uuid::from_u128(1);
        let args = args_with_imported_index(ctx.clone(), "faceId", body_id);

        let result = face_id(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        let KclValue::TagIdentifier(tag) = result else {
            panic!("expected tagged face from faceId, got {result:?}");
        };
        let tag_info = tag.get_cur_info().expect("faceId should create tag engine info");
        assert!(tag_info.surface.is_some());
        assert!(matches!(&tag_info.geometry, Geometry::Solid(solid) if solid.id == body_id));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn edge_id_by_index_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let body_id = Uuid::from_u128(1);
        let args = args_with_imported_index(ctx.clone(), "edgeId", body_id);

        let result = edge_id(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        let KclValue::Uuid { value, .. } = result else {
            panic!("expected edge UUID from edgeId, got {result:?}");
        };
        assert_ne!(value, body_id);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn edge_id_by_closest_point_accepts_imported_geometry() {
        let ctx = crate::ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new_mock(&ctx, &MockConfig::default());
        let body_id = Uuid::from_u128(1);
        let args = args_with_imported_closest_to(ctx.clone(), "edgeId", body_id);

        let result = edge_id(&mut exec_state, args).await.unwrap();
        ctx.close().await;

        let KclValue::Uuid { value, .. } = result else {
            panic!("expected edge UUID from edgeId, got {result:?}");
        };
        assert_ne!(value, body_id);
    }
}
