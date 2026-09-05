use std::collections::BTreeSet;

use super::extract::Extraction;
use super::region::ResolvedSketchRegion;
use super::types::SketchVisualizationError;
use crate::front::Object;
use crate::front::Sketch;

pub(crate) fn render_sketch_png(
    scene_objects: &[Object],
    sketch: &Sketch,
    highlighted_segment_ids: &BTreeSet<usize>,
    resolved_region: Option<&ResolvedSketchRegion>,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let mut extraction = Extraction::new(scene_objects, highlighted_segment_ids);
    extraction.collect_points_and_segments(sketch)?;
    extraction.finish(resolved_region)
}
