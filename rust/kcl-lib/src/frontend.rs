use anyhow::bail;
use kcl_api::{
    Error, Expr, FileId, Number, NumericSuffix, Object, ObjectId, ObjectKind, ProjectId, SceneGraph, SceneGraphDelta,
    Settings, SourceDelta, SourceRef, Version,
    sketch::{Freedom, Line, LineCtor, Point, Point2d, Segment, SegmentCtor, Sketch, SketchArgs},
};
use kcl_error::SourceRange;

use crate::{Program, fmt::format_number_literal, id::IncIdGenerator, parsing::ast::types as ast};

#[derive(Debug, Clone)]
pub(crate) struct FrontendState {
    id_generator: IncIdGenerator<usize>,
    program: Program,
    scene_graph: SceneGraph,
}

impl FrontendState {
    fn new() -> Self {
        Self {
            id_generator: IncIdGenerator::new(),
            program: Program::empty(),
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
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        args: SketchArgs,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // Create updated KCL source from args.
        let plane_ast = match &args.on {
            // TODO: sketch-api: implement ObjectId to source.
            kcl_api::Plane::Object(_) => todo!(),
            kcl_api::Plane::Default(plane) => ast_name(plane.to_string()),
        };
        let sketch_ast = ast::SketchBlock {
            arguments: vec![ast::LabeledArg {
                label: Some(ast::Node {
                    inner: ast::Identifier {
                        name: "on".to_string(),
                        digest: None,
                    },
                    start: Default::default(),
                    end: Default::default(),
                    module_id: Default::default(),
                    outer_attrs: Default::default(),
                    pre_comments: Default::default(),
                    comment_start: Default::default(),
                }),
                arg: plane_ast,
            }],
            body: Default::default(),
            non_code_meta: Default::default(),
            digest: None,
        };
        let mut new_ast = self.program.ast.clone();
        new_ast.body.push(ast::BodyItem::ExpressionStatement(ast::Node {
            inner: ast::ExpressionStatement {
                expression: ast::Expr::SketchBlock(Box::new(ast::Node {
                    inner: sketch_ast,
                    start: Default::default(),
                    end: Default::default(),
                    module_id: Default::default(),
                    outer_attrs: Default::default(),
                    pre_comments: Default::default(),
                    comment_start: Default::default(),
                })),
                digest: None,
            },
            start: Default::default(),
            end: Default::default(),
            module_id: Default::default(),
            outer_attrs: Default::default(),
            pre_comments: Default::default(),
            comment_start: Default::default(),
        }));
        // Convert to string source to create real source ranges.
        //
        // TODO: Don't duplicate this from lib.rs Program.
        let new_source = new_ast.recast_top(&Default::default(), 0);
        // Parse the new source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding sketch: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding sketch".to_string(),
            });
        };

        // Make sure to only set this if there are no errors.
        self.program = new_program;

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
        // Create updated KCL source from args.
        let start_ast = to_ast_point2d(&start).map_err(|err| Error { msg: err.to_string() })?;
        let end_ast = to_ast_point2d(&end).map_err(|err| Error { msg: err.to_string() })?;
        // Look up existing sketch.
        let sketch_object = self.scene_graph.objects.get(sketch.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(sketch) = &mut sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        let new_source = format!("{}\n\n{sketch_source}", self.program.original_file_contents);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding sketch: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding sketch".to_string(),
            });
        };
        // TODO: sketch-api: make sure to only set this if there are no errors.
        self.program = new_program;

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

    fn sketch_ast_from_id(&self, sketch_id: ObjectId) -> kcl_api::Result<ast::Expr> {
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch_id:?}"),
        })?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        self.ast_node_from_source_ref(&sketch_object.source)
    }

    fn ast_node_from_source_ref<F>(&self, source_ref: &SourceRef, f: F) -> anyhow::Result<bool>
    where
        F: Fn(&crate::walk::Node) -> anyhow::Result<()>,
    {
        match source_ref {
            SourceRef::Simple(range) => self.ast_node_from_source_range(*range, f),
            SourceRef::BackTrace(_) => bail!("BackTrace source refs not supported yet"),
        }
    }

    fn ast_node_from_source_range<F>(&self, source_range: SourceRange, f: F) -> anyhow::Result<bool>
    where
        F: Fn(&crate::walk::Node) -> anyhow::Result<()>,
    {
        crate::walk::walk(&self.program.ast, |node: crate::walk::Node| -> anyhow::Result<bool> {
            let Ok(node_range) = SourceRange::try_from(&node) else {
                return Ok(true);
            };
            if node_range != source_range {
                return Ok(true);
            }
            f(&node)?;
            Ok(false)
        })
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

fn to_ast_point2d(start: &Point2d<Expr>) -> anyhow::Result<ast::Expr> {
    Ok(ast::Expr::ArrayExpression(Box::new(ast::Node {
        inner: ast::ArrayExpression {
            elements: vec![to_source_expr(&start.x)?, to_source_expr(&start.y)?],
            non_code_meta: Default::default(),
            digest: None,
        },
        start: Default::default(),
        end: Default::default(),
        module_id: Default::default(),
        outer_attrs: Default::default(),
        pre_comments: Default::default(),
        comment_start: Default::default(),
    })))
}

fn to_source_expr(expr: &Expr) -> anyhow::Result<ast::Expr> {
    match expr {
        Expr::Number(number) => Ok(ast::Expr::Literal(Box::new(ast::Node {
            inner: ast::Literal::from(to_source_number(*number)?),
            start: Default::default(),
            end: Default::default(),
            module_id: Default::default(),
            outer_attrs: Default::default(),
            pre_comments: Default::default(),
            comment_start: Default::default(),
        }))),
        Expr::Var(number) => Ok(ast::Expr::SketchVar(Box::new(ast::Node {
            inner: ast::SketchVar {
                initial: Some(Box::new(ast::Node {
                    inner: to_source_number(*number)?,
                    start: Default::default(),
                    end: Default::default(),
                    module_id: Default::default(),
                    outer_attrs: Default::default(),
                    pre_comments: Default::default(),
                    comment_start: Default::default(),
                })),
                digest: None,
            },
            start: Default::default(),
            end: Default::default(),
            module_id: Default::default(),
            outer_attrs: Default::default(),
            pre_comments: Default::default(),
            comment_start: Default::default(),
        }))),
        Expr::Variable(variable) => Ok(ast_name(variable.clone())),
    }
}

fn to_source_number(number: Number) -> anyhow::Result<ast::NumericLiteral> {
    Ok(ast::NumericLiteral {
        value: number.value,
        suffix: number.units,
        raw: format_number_literal(number.value, number.units)?,
        digest: None,
    })
}

fn ast_name(name: String) -> ast::Expr {
    ast::Expr::Name(Box::new(ast::Node {
        inner: ast::Name {
            name: ast::Node {
                inner: ast::Identifier { name, digest: None },
                start: Default::default(),
                end: Default::default(),
                module_id: Default::default(),
                outer_attrs: Default::default(),
                pre_comments: Default::default(),
                comment_start: Default::default(),
            },
            path: Vec::new(),
            abs_path: false,
            digest: None,
        },
        start: Default::default(),
        end: Default::default(),
        module_id: Default::default(),
        outer_attrs: Default::default(),
        pre_comments: Default::default(),
        comment_start: Default::default(),
    }))
}
