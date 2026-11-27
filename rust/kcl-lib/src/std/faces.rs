//! Standard library face helpers.

use kcl_api::SourceRef;
use kittycad_modeling_cmds::each_cmd;
use kittycad_modeling_cmds::ok_response::OkModelingCmdResponse;
use kittycad_modeling_cmds::websocket::OkWebSocketResponseData;
use uuid::Uuid;

use super::sketch::FaceTag;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ExecState;
use crate::execution::Face;
use crate::execution::FaceParentSolid;
use crate::execution::KclValue;
use crate::execution::ModelingCmdMeta;
use crate::execution::Point3d;
use crate::execution::Segment;
use crate::execution::Solid;
use crate::execution::types::RuntimeType;
use crate::std::Args;

const SEGMENT_MUST_HAVE_TAG_ERROR: &str =
    "Face specifier must have a tag. For sketch block segments, assign the segment to a variable.";

/// Specifies a face of a `Solid` either by a tag or by a segment.
pub(crate) enum FaceSpecifier {
    FaceTag(FaceTag),
    Segment(Box<Segment>),
}

impl FaceSpecifier {
    /// Gets the tag name of the face specifier, if it has one. This may return
    /// the fake tag names "start" or "end" when the face specifier is `START`
    /// or `END`.
    fn tag_name(&self) -> Option<String> {
        match self {
            FaceSpecifier::FaceTag(face_tag) => Some(face_tag.to_string()),
            FaceSpecifier::Segment(segment) => segment.tag.as_ref().map(|tag| tag.to_string()),
        }
    }

    pub(super) async fn face_id(
        &self,
        solid: &Solid,
        exec_state: &mut ExecState,
        args: &Args,
        must_be_planar: bool,
    ) -> Result<Uuid, KclError> {
        match self {
            FaceSpecifier::FaceTag(face_tag) => face_tag.get_face_id(solid, exec_state, args, must_be_planar).await,
            FaceSpecifier::Segment(segment) => {
                let tag_id = segment.tag.as_ref().ok_or_else(|| {
                    KclError::new_semantic(KclErrorDetails::new(
                        SEGMENT_MUST_HAVE_TAG_ERROR.to_owned(),
                        vec![args.source_range],
                    ))
                })?;
                args.get_adjacent_face_to_tag(exec_state, tag_id, must_be_planar).await
            }
        }
    }
}

/// Face of a given solid.
pub async fn face_of(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let face = args.get_kw_arg_opt("face", &RuntimeType::tagged_face_or_segment(), exec_state)?;
    let chamfer_face: Option<u32> = args.get_kw_arg_opt("chamferFace", &RuntimeType::count(), exec_state)?;
    let from_faces: Option<Vec<KclValue>> = args.get_kw_arg_opt("fromFaces", &RuntimeType::any_array(), exec_state)?;
    let value = match (face, chamfer_face, from_faces) {
        (Some(face), None, None) => make_face(solid, face, exec_state, &args).await?,
        (None, Some(occurrence), groups) =>
            make_chamfer_face(solid, occurrence, groups.as_deref(), exec_state, &args).await?,
        _ => {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Provide either face or chamferFace. Use fromFaces only with chamferFace.".to_owned(),
                vec![args.source_range],
            )));
        }
    };
    Ok(KclValue::Face { value })
}

async fn make_chamfer_face(
    solid: Box<Solid>,
    occurrence: u32,
    source_groups: Option<&[KclValue]>,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Box<Face>, KclError> {
    let invalid_face = || {
        KclError::new_semantic(KclErrorDetails::new(
            "The chamfer occurrence has no reported planar face on this body.".to_owned(),
            vec![args.source_range],
        ))
    };
    let mock = args.ctx.no_engine_commands().await;
    let source_sides = source_groups
        .map(|groups| chamfer_source_sides(groups, &solid, mock, args))
        .transpose()?;
    let (face_id, x_axis, y_axis) = if mock {
        let sketch = solid.sketch().ok_or_else(invalid_face)?;
        (exec_state.next_uuid(), sketch.on.x_axis(), sketch.on.y_axis())
    } else {
        let operation = solid
            .primary_chamfer_faces
            .get(occurrence as usize)
            .and_then(|id| *id)
            .ok_or_else(invalid_face)?;
        exec_state
            .flush_batch_for_solids(
                ModelingCmdMeta::from_args(exec_state, args),
                std::slice::from_ref(&solid),
            )
            .await?;
        let face_id = if let Some(sides) = source_sides {
            let sources = args.ctx.engine.cut_face_sources(operation).await
                .unwrap_or_else(|| exec_state.cached_cut_face_sources(operation));
            let mut matches = sources.iter().filter(|source| {
                source.side_faces == sides || source.side_faces == [sides[1], sides[0]]
            });
            match (matches.next(), matches.next()) {
                (Some(source), None) => source.face_id,
                (None, _) => return Err(KclError::new_semantic(KclErrorDetails::new(
                    "This chamfer no longer reports a face from the selected source edge.".to_owned(),
                    vec![args.source_range],
                ))),
                _ => return Err(KclError::new_semantic(KclErrorDetails::new(
                    "The selected source edge matches more than one chamfer face.".to_owned(),
                    vec![args.source_range],
                ))),
            }
        } else {
            operation
        };
        let (x, y) = query_planar_axes(face_id, exec_state, &args.ctx, args.source_range).await?;
        (face_id, x, y)
    };
    Ok(register_face(
        FaceParentSolid::from(solid.as_ref()),
        solid.units,
        face_id,
        format!("chamferFace {occurrence}"),
        x_axis,
        y_axis,
        exec_state,
        args.source_range,
        args.node_path.clone(),
    ))
}

fn chamfer_source_sides(
    groups: &[KclValue],
    solid: &Solid,
    mock: bool,
    args: &Args,
) -> Result<[Uuid; 2], KclError> {
    use crate::execution::kcl_value::KclObjectKind;

    let error = |message: &str| KclError::new_semantic(KclErrorDetails::new(message.to_owned(), vec![args.source_range]));
    let [a, b] = groups else {
        return Err(error("A chamfer source edge needs two construction face groups."));
    };
    let resolve = |group: &KclValue| {
        let KclValue::Object { object_kind: KclObjectKind::HistoryFaceGroup { owner, value_id, faces }, .. } = group else {
            return Err(error("Use construction face groups for the chamfer source edge."));
        };
        if *owner != solid.id || *value_id != solid.value_id {
            return Err(error("Chamfer source groups must belong to the selected solid."));
        }
        match faces.as_slice() {
            [id] => Ok(*id),
            _ if mock => Ok(Uuid::nil()),
            [] => Err(error("A chamfer source face no longer exists on this body.")),
            _ => Err(error("A chamfer source face is ambiguous on this body.")),
        }
    };
    Ok([resolve(a)?, resolve(b)?])
}

pub(super) async fn make_face(
    solid: Box<Solid>,
    face: FaceSpecifier,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Box<Face>, KclError> {
    let Some(tag_name) = face.tag_name() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            SEGMENT_MUST_HAVE_TAG_ERROR.to_owned(),
            vec![args.source_range],
        )));
    };
    let source_face_id = face.face_id(&solid, exec_state, args, true).await?;
    let mut descendants = solid
        .subtraction_face_reassignments
        .iter()
        .filter(|entry| entry.source_id == source_face_id)
        .peekable();
    let extrude_plane_id = if descendants.peek().is_some() {
        let mut on_this_body = descendants.filter(|entry| entry.owner_id == solid.id);
        let first = on_this_body.next();
        if let (Some(entry), None) = (first, on_this_body.next()) {
            entry.replacement_id
        } else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Sketching requires a face reference that resolves to exactly one face on the selected body."
                    .to_owned(),
                vec![args.source_range],
            )));
        }
    } else {
        source_face_id
    };
    let sketch = solid.sketch().ok_or_else(|| {
        KclError::new_type(crate::errors::KclErrorDetails::new(
            "This solid was created without a sketch, so its face axes are unavailable.".to_owned(),
            vec![args.source_range],
        ))
    })?;

    Ok(register_face(
        FaceParentSolid::from(solid.as_ref()),
        solid.units,
        extrude_plane_id,
        tag_name,
        sketch.on.x_axis(),
        sketch.on.y_axis(),
        exec_state,
        args.source_range,
        args.node_path.clone(),
    ))
}

pub(super) async fn query_planar_axes(
    face_id: Uuid,
    exec_state: &mut ExecState,
    ctx: &crate::ExecutorContext,
    range: crate::SourceRange,
) -> Result<(Point3d, Point3d), KclError> {
    let result = exec_state
        .send_modeling_cmd(
            ModelingCmdMeta::new(exec_state, ctx, range),
            each_cmd::FaceIsPlanar::builder().object_id(face_id).build().into(),
        )
        .await?;
    if let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::FaceIsPlanar(plane),
    } = result
        && let (Some(x), Some(y)) = (plane.x_axis, plane.y_axis)
    {
        let point = |p: kittycad_modeling_cmds::shared::Point3d<f64>| Point3d {
            x: p.x,
            y: p.y,
            z: p.z,
            units: None,
        };
        return Ok((point(x), point(y)));
    }
    Err(KclError::new_semantic(KclErrorDetails::new(
        "Expected a live planar face.".to_owned(),
        vec![range],
    )))
}

pub(super) fn register_face(
    parent_solid: FaceParentSolid,
    units: kcl_api::UnitLength,
    face_id: Uuid,
    name: String,
    x_axis: Point3d,
    y_axis: Point3d,
    exec_state: &mut ExecState,
    range: crate::SourceRange,
    node_path: Option<kcl_api::NodePath>,
) -> Box<Face> {
    let object_id = exec_state.next_object_id();
    let face_object = kcl_api::Object {
        id: object_id,
        kind: kcl_api::ObjectKind::Face(kcl_api::Face { id: object_id }),
        label: Default::default(),
        comments: Default::default(),
        artifact_id: face_id.into(),
        source: SourceRef::new(range, node_path),
    };
    exec_state.add_scene_object(face_object, range);

    Box::new(Face {
        id: face_id,
        artifact_id: face_id.into(),
        object_id,
        value: name,
        x_axis,
        y_axis,
        units,
        parent_solid,
        meta: vec![range.into()],
    })
}
