use super::extract::Extraction;
use super::scene::object_kind_name;
use super::scene::validate_canvas;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;
use crate::front::Object;
use crate::front::ObjectKind;

pub(crate) fn render_sketch_png(
    scene_objects: &[Object],
    sketch_object: &Object,
) -> Result<Vec<u8>, SketchVisualizationError> {
    render_sketch_png_with_options(scene_objects, sketch_object, SketchVisualizationOptions::default())
}

pub(super) fn render_sketch_png_with_options(
    scene_objects: &[Object],
    sketch_object: &Object,
    options: SketchVisualizationOptions,
) -> Result<Vec<u8>, SketchVisualizationError> {
    validate_canvas(&options)?;
    let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
        return Err(SketchVisualizationError::UnexpectedObjectKind {
            id: sketch_object.id.0,
            expected: "sketch",
            actual: object_kind_name(&sketch_object.kind),
        });
    };

    let mut extraction = Extraction::new(scene_objects, options);
    extraction.collect_points_and_segments(sketch)?;
    extraction.finish()
}
