use super::extract::Extraction;
use super::types::SketchVisualizationError;
use crate::front::Object;
use crate::front::ObjectKind;
use crate::front::Sketch;

pub(crate) fn select_sketch<'a>(
    scene_objects: &'a [Object],
    sketch_name: &str,
    instance_index: Option<usize>,
) -> Result<&'a Sketch, SketchVisualizationError> {
    let sketches = scene_objects
        .iter()
        .filter_map(|object| match &object.kind {
            ObjectKind::Sketch(sketch) if object.label == sketch_name => Some(sketch),
            _ => None,
        })
        .collect::<Vec<_>>();
    match (sketches.as_slice(), instance_index) {
        ([], _) => Err(SketchVisualizationError::SketchNotFound {
            name: sketch_name.to_owned(),
        }),
        (_, Some(index)) => sketches
            .get(index)
            .copied()
            .ok_or_else(|| SketchVisualizationError::InstanceNotFound {
                name: sketch_name.to_owned(),
                index,
                count: sketches.len(),
            }),
        ([sketch], None) => Ok(*sketch),
        (_, None) => Err(SketchVisualizationError::AmbiguousSketchName {
            name: sketch_name.to_owned(),
            count: sketches.len(),
        }),
    }
}

pub(crate) fn render_sketch_png(
    scene_objects: &[Object],
    sketch: &Sketch,
) -> Result<Vec<u8>, SketchVisualizationError> {
    let mut extraction = Extraction::new(scene_objects);
    extraction.collect_points_and_segments(sketch)?;
    extraction.finish()
}
