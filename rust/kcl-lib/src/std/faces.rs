//! Standard library face helpers.

use super::sketch::FaceTag;
use crate::{
    errors::KclError,
    execution::{ExecState, Face, KclValue, Solid, types::RuntimeType},
    std::Args,
};

/// Face of a given solid.
pub async fn face_of(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let solid = args.get_unlabeled_kw_arg("solid", &RuntimeType::solid(), exec_state)?;
    let face = args.get_kw_arg("face", &RuntimeType::tagged_face(), exec_state)?;

    let face = make_face(solid, face, exec_state, &args).await?;

    Ok(KclValue::Face { value: face })
}

pub(super) async fn make_face(
    solid: Box<Solid>,
    tag: FaceTag,
    exec_state: &mut ExecState,
    args: &Args,
) -> Result<Box<Face>, KclError> {
    let extrude_plane_id = tag.get_face_id(&solid, exec_state, args, true).await?;

    Ok(Box::new(Face {
        id: extrude_plane_id,
        artifact_id: extrude_plane_id.into(),
        value: tag.to_string(),
        // TODO: get this from the extrude plane data.
        x_axis: solid.sketch.on.x_axis(),
        y_axis: solid.sketch.on.y_axis(),
        units: solid.units,
        solid,
        meta: vec![args.source_range.into()],
    }))
}
