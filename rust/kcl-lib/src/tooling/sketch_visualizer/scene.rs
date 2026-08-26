use super::types::SketchVisualizationError;
use super::types::SketchVisualizationPoint;
use crate::front::Number;
use crate::front::Object;
use crate::front::ObjectId;
use crate::front::Point2d;

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
