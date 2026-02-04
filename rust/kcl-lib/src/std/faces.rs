//! Standard library face helpers.

use uuid::Uuid;

use super::sketch::FaceTag;
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, Face, KclValue, Segment, Solid, types::RuntimeType},
    std::Args,
};

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
    let face = args.get_kw_arg("face", &RuntimeType::tagged_face_or_segment(), exec_state)?;

    let face = make_face(solid, face, exec_state, &args).await?;

    Ok(KclValue::Face { value: face })
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
    let extrude_plane_id = face.face_id(&solid, exec_state, args, true).await?;

    let object_id = exec_state.next_object_id();
    #[cfg(feature = "artifact-graph")]
    {
        let face_object = crate::front::Object {
            id: object_id,
            kind: crate::front::ObjectKind::Face(crate::front::Face { id: object_id }),
            label: Default::default(),
            comments: Default::default(),
            artifact_id: extrude_plane_id.into(),
            source: args.source_range.into(),
        };
        exec_state.add_scene_object(face_object, args.source_range);
    }

    Ok(Box::new(Face {
        id: extrude_plane_id,
        artifact_id: extrude_plane_id.into(),
        object_id,
        value: tag_name,
        // TODO: get this from the extrude plane data.
        x_axis: solid.sketch.on.x_axis(),
        y_axis: solid.sketch.on.y_axis(),
        units: solid.units,
        solid,
        meta: vec![args.source_range.into()],
    }))
}
