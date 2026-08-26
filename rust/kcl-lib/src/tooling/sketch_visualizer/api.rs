use super::extract::Extraction;
use super::types::SketchVisualizationError;
use crate::front::Object;
use crate::front::Sketch;

pub(crate) fn render_sketch_png(
    scene_objects: &[Object],
    sketch: &Sketch,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let mut extraction = Extraction::new(scene_objects);
    extraction.collect_points_and_segments(sketch)?;
    extraction.finish()
}
