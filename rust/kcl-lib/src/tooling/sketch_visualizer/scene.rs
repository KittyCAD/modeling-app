use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use super::types::SketchVisualizationPoint;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::ObjectKind;
use crate::front::Point2d;

pub(super) fn validate_canvas(options: &SketchVisualizationOptions) -> Result<(), SketchVisualizationError> {
    let min_width = options.padding.saturating_mul(2).saturating_add(2);
    let min_height = options.padding.saturating_mul(2).saturating_add(2);
    if options.width < min_width || options.height < min_height {
        return Err(SketchVisualizationError::InvalidCanvas {
            width: options.width,
            height: options.height,
            padding: options.padding,
        });
    }
    Ok(())
}

pub(super) fn object_by_id(scene_objects: &[Object], id: ObjectId) -> Result<&Object, SketchVisualizationError> {
    scene_objects
        .get(id.0)
        .filter(|object| object.id == id)
        .or_else(|| scene_objects.iter().find(|object| object.id == id))
        .ok_or(SketchVisualizationError::MissingObject { id: id.0 })
}

pub(super) fn position_to_point(point: &Point2d<Number>) -> SketchVisualizationPoint {
    SketchVisualizationPoint {
        x: point.x.value,
        y: point.y.value,
    }
}

pub(super) fn object_kind_name(kind: &ObjectKind) -> &'static str {
    match kind {
        ObjectKind::Nil => "nil",
        ObjectKind::Plane(_) => "plane",
        ObjectKind::Face(_) => "face",
        ObjectKind::Wall(_) => "wall",
        ObjectKind::Cap(_) => "cap",
        ObjectKind::Sketch(_) => "sketch",
        ObjectKind::Segment { .. } => "segment",
        ObjectKind::Constraint { .. } => "constraint",
    }
}
