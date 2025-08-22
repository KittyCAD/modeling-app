use kcl_api::{
    Error, Expr, FileId, Number, NumericSuffix, Object, ObjectId, ObjectKind, ProjectId, SceneGraph, SceneGraphDelta,
    Settings, SourceDelta, SourceRef, Version,
    sketch::{Freedom, Line, LineCtor, Point, Point2d, Segment, SegmentCtor, Sketch, SketchArgs},
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
            segments: Vec::new(),
            constraints: Vec::new(),
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
            label: Default::default(),
            comments: Default::default(),
        };
        // Store the object in the scene.
        self.scene_graph.objects.push(object);
        self.scene_graph.sketch_mode = Some(sketch_id);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: vec![sketch_id],
        };
        Ok((src_delta, scene_graph_delta, sketch_id))
    }

    fn add_line(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        start: Point2d<Expr>,
        end: Point2d<Expr>,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // Evaluate.
        let new_start_position = self.position_from_expr(&start)?;
        let new_end_position = self.position_from_expr(&end)?;
        let new_start_freedom = self.freedom_from_expr(&start)?;
        let new_end_freedom = self.freedom_from_expr(&end)?;

        // Build points.
        let segment_id = ObjectId(self.id_generator.next_id());
        let start_point = Point {
            position: new_start_position,
            ctor: None,
            owner: Some(segment_id),
            freedom: new_start_freedom,
            // TODO: sketch-api: implement
            constraints: Vec::new(),
        };
        let start_point_object = Object {
            id: ObjectId(self.id_generator.next_id()),
            kind: ObjectKind::Segment(Segment::Point(start_point)),
            label: Default::default(),
            comments: Default::default(),
            // TODO: sketch-api: implement
            artifact_id: 0,
            // TODO: sketch-api: implement
            source: SourceRef::Simple(SourceRange::default()),
        };
        let end_point = Point {
            position: new_end_position,
            ctor: None,
            owner: Some(segment_id),
            freedom: new_end_freedom,
            // TODO: sketch-api: implement
            constraints: Vec::new(),
        };
        let end_point_object = Object {
            id: ObjectId(self.id_generator.next_id()),
            kind: ObjectKind::Segment(Segment::Point(end_point)),
            label: Default::default(),
            comments: Default::default(),
            // TODO: sketch-api: implement
            artifact_id: 0,
            // TODO: sketch-api: implement
            source: SourceRef::Simple(SourceRange::default()),
        };

        // Look up existing sketch.
        let sketch_object = self.scene_graph.objects.get_mut(sketch.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(sketch) = &mut sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };

        let line_ctor = LineCtor { start, end };
        let segment = Segment::Line(Line {
            start: start_point_object.id,
            end: end_point_object.id,
            ctor: SegmentCtor::Line(line_ctor),
            ctor_applicable: true,
        });
        // TODO: sketch-api: implement
        let artifact_id = 0;
        // TODO: sketch-api: implement
        let source_range = SourceRange::default();
        // Create a new line segment.
        let segment_object = Object {
            id: segment_id,
            kind: ObjectKind::Segment(segment),
            artifact_id,
            source: SourceRef::Simple(source_range),
            label: Default::default(),
            comments: Default::default(),
        };
        // Add the line segment to the scene.
        let new_objects = vec![segment_object, start_point_object, end_point_object];
        let new_object_ids = new_objects.iter().map(|o| o.id).collect::<Vec<_>>();
        // Add to the sketch first since we're mutably borrowing it.
        for object_id in &new_object_ids {
            sketch.segments.push(*object_id);
        }
        for object in new_objects {
            self.scene_graph.objects.push(object);
        }
        let src_delta = SourceDelta {};
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: new_object_ids,
        };
        Ok((src_delta, scene_graph_delta, segment_id))
    }

    fn move_line_start(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        line: ObjectId,
        start: Point2d<Expr>,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta)> {
        // Look up existing sketch.
        let sketch_object = self.scene_graph.objects.get_mut(sketch.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        sketch.segments.iter().find(|o| **o == line).ok_or_else(|| Error {
            msg: format!("Line not found in sketch: line={line:?}, sketch={sketch:?}"),
        })?;
        // Look up existing line.
        let line_object = self.scene_graph.objects.get(line.0).ok_or_else(|| Error {
            msg: format!("Line not found in scene graph: line={line:?}"),
        })?;
        let ObjectKind::Segment(segment) = &line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };

        // Get the start point of the line segment.
        let start_point_id = match segment {
            Segment::Line(line) => line.start,
            Segment::Point(_) | Segment::Arc(_) | Segment::Circle(_) => {
                return Err(Error {
                    msg: format!("Segment is not a line: {segment:?}"),
                });
            }
        };

        // Evaluate the new start position.
        let new_start_position = self.position_from_expr(&start)?;

        // Modify the point to be initialized to the new position.
        let start_point_object = self
            .scene_graph
            .objects
            .get_mut(start_point_id.0)
            .ok_or_else(|| Error {
                msg: format!("Start point not found: {start_point_id:?}"),
            })?;
        let ObjectKind::Segment(Segment::Point(start_point)) = &mut start_point_object.kind else {
            return Err(Error {
                msg: format!("Object is not a point: {start_point_object:?}"),
            });
        };
        start_point.position = new_start_position;

        // TODO: sketch-api: do we need to update the source range of the line?
        let src_delta = SourceDelta {};
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: Vec::new(),
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

    fn position_from_expr(&self, _point: &Point2d<Expr>) -> kcl_api::Result<Point2d<Number>> {
        // TODO: sketch-api: implement
        Ok(Point2d {
            x: Number {
                value: 0.0,
                units: NumericSuffix::Mm,
            },
            y: Number {
                value: 0.0,
                units: NumericSuffix::Mm,
            },
        })
    }

    fn freedom_from_expr(&self, _point: &Point2d<Expr>) -> kcl_api::Result<Freedom> {
        // TODO: sketch-api: implement
        Ok(Freedom::Free)
    }
}
