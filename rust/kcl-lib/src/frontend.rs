use kcl_api::{
    Error, FileId, Object, ObjectId, ObjectKind, Point2d, ProjectId, SceneGraph, SceneGraphDelta, Segment, Settings,
    Sketch, SketchArgs, SourceDelta, SourceRef, Version,
};
use kcl_error::SourceRange;

use crate::id::IncIdGenerator;

#[derive(Debug, Clone)]
pub(crate) struct FrontendState {
    id_generator: IncIdGenerator<usize>,
    scene_graph: SceneGraph,
}

impl FrontendState {
    fn new() -> Self {
        Self {
            id_generator: IncIdGenerator::new(),
            scene_graph: SceneGraph {
                project: ProjectId(0),
                file: FileId(0),
                version: Version(0),
                objects: Default::default(),
                settings: Settings {},
                sketch_mode: Default::default(),
            },
        }
    }

    fn new_sketch(
        &mut self,
        project: ProjectId,
        file: FileId,
        version: Version,
        args: SketchArgs,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // Create a new sketch.
        let sketch_id = ObjectId(self.id_generator.next_id());
        let sketch = Sketch {
            args,
            items: Vec::new(),
        };
        let src_delta = SourceDelta {};
        // TODO: sketch-api: implement
        let artifact_id = 0;
        // TODO: sketch-api: implement
        let source_range = SourceRange::default();
        let object = Object {
            id: sketch_id,
            kind: ObjectKind::Sketch(sketch),
            artifact_id,
            source: SourceRef::Simple(source_range),
        };
        // Store the object in the scene.
        self.scene_graph.objects.push(object);
        self.scene_graph.sketch_mode = Some(sketch_id);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
        };
        Ok((src_delta, scene_graph_delta, sketch_id))
    }

    fn add_line(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        from: Point2d,
        to: Point2d,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // Look up existing sketch.
        let sketch_object = self
            .scene_graph
            .objects
            .iter_mut()
            .find(|o| o.id == sketch)
            .ok_or_else(|| Error {
                msg: format!("Sketch not found: {sketch:?}"),
            })?;
        let ObjectKind::Sketch(sketch) = &mut sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        let segment = Segment { from, to };
        // TODO: sketch-api: implement
        let artifact_id = 0;
        // TODO: sketch-api: implement
        let source_range = SourceRange::default();
        // Create a new line segment.
        let segment_id = ObjectId(self.id_generator.next_id());
        let segment_object = Object {
            id: segment_id,
            kind: ObjectKind::Segment(segment),
            artifact_id,
            source: SourceRef::Simple(source_range),
        };
        // Add the line segment to the scene.
        sketch.items.push(segment_id);
        self.scene_graph.objects.push(segment_object);
        let src_delta = SourceDelta {};
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
        };
        Ok((src_delta, scene_graph_delta, segment_id))
    }

    fn move_line_start(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        line: ObjectId,
        from: Point2d,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta)> {
        // Look up existing sketch.
        let sketch_object = self
            .scene_graph
            .objects
            .iter()
            .find(|o| o.id == sketch)
            .ok_or_else(|| Error {
                msg: format!("Sketch not found: {sketch:?}"),
            })?;
        let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        sketch.items.iter().find(|o| **o == line).ok_or_else(|| Error {
            msg: format!("Line not found in sketch: line={line:?}, sketch={sketch:?}"),
        })?;
        // Look up existing line.
        let line_object = self
            .scene_graph
            .objects
            .iter_mut()
            .find(|o| o.id == line)
            .ok_or_else(|| Error {
                msg: format!("Line not found in scene graph: line={line:?}"),
            })?;
        let ObjectKind::Segment(segment) = &mut line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };

        // Modify the line segment.
        segment.from = from;
        // TODO: sketch-api: implement
        let source_range = SourceRange::default();
        line_object.source = SourceRef::Simple(source_range);
        let src_delta = SourceDelta {};
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
        };
        Ok((src_delta, scene_graph_delta))
    }

    fn add_equal_length_constraint(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        segments: Vec<ObjectId>,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta)> {
        todo!()
    }

    fn exit_sketch(&mut self, sketch: ObjectId) -> kcl_api::Result<SceneGraph> {
        todo!()
    }
}
