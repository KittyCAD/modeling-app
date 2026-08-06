use indexmap::IndexMap;

use crate::ExecOutcome;
use crate::KclValueView;
use crate::front::Object;
use crate::front::ObjectKind;

use super::extract::Extraction;
use super::scene::object_kind_name;
use super::scene::select_sketch;
use super::scene::validate_canvas;
use super::types::SketchSelector;
use super::types::SketchVisualization;
use super::types::SketchVisualizationError;
use super::types::SketchVisualizationOptions;

impl ExecOutcome {
    pub fn visualize_sketch(
        &self,
        selector: SketchSelector,
        options: SketchVisualizationOptions,
    ) -> Result<SketchVisualization, SketchVisualizationError> {
        visualize_scene_objects_with_variables(&self.scene_objects, Some(&self.variables), selector, options)
    }
}

pub fn visualize_scene_objects(
    scene_objects: &[Object],
    selector: SketchSelector,
    options: SketchVisualizationOptions,
) -> Result<SketchVisualization, SketchVisualizationError> {
    visualize_scene_objects_with_variables(scene_objects, None, selector, options)
}

fn visualize_scene_objects_with_variables(
    scene_objects: &[Object],
    variables: Option<&IndexMap<String, KclValueView>>,
    selector: SketchSelector,
    options: SketchVisualizationOptions,
) -> Result<SketchVisualization, SketchVisualizationError> {
    validate_canvas(&options)?;

    let sketch_object = select_sketch(scene_objects, variables, &selector)?;
    let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
        return Err(SketchVisualizationError::UnexpectedObjectKind {
            id: sketch_object.id.0,
            expected: "sketch",
            actual: object_kind_name(&sketch_object.kind),
        });
    };

    let selected_name = match &selector {
        SketchSelector::Name(name) => Some(name.clone()),
        SketchSelector::First | SketchSelector::Id(_) => None,
    };
    let mut extraction = Extraction::new(scene_objects, sketch_object, options, selected_name);
    extraction.collect_points_and_segments(sketch)?;
    extraction.collect_constraints(sketch)?;
    extraction.finish()
}
