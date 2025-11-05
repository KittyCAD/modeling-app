use std::{cell::Cell, collections::HashSet, ops::ControlFlow};

use anyhow::{anyhow, bail};
use kcl_error::SourceRange;

use crate::{
    ExecOutcome, ExecutorContext, Program,
    exec::WarningLevel,
    fmt::format_number_literal,
    front::{Line, LinesEqualLength, PointCtor},
    frontend::{
        api::{
            Error, Expr, FileId, Number, ObjectId, ObjectKind, ProjectId, SceneGraph, SceneGraphDelta, SourceDelta,
            SourceRef, Version,
        },
        modify::{find_defined_names, next_free_name},
        sketch::{
            Coincident, Constraint, ExistingSegmentCtor, Horizontal, LineCtor, Point2d, Segment, SegmentCtor,
            SketchApi, SketchArgs, Vertical,
        },
        traverse::{TraversalReturn, Visitor, dfs_mut},
    },
    parsing::ast::types as ast,
    walk::{NodeMut, Visitable},
};

pub(crate) mod api;
mod modify;
pub(crate) mod sketch;
mod traverse;

const POINT_FN: &str = "point";
const POINT_AT_PARAM: &str = "at";
const LINE_FN: &str = "line";
const LINE_START_PARAM: &str = "start";
const LINE_END_PARAM: &str = "end";
const COINCIDENT_FN: &str = "coincident";
const EQUAL_LENGTH_FN: &str = "equalLength";
const HORIZONTAL_FN: &str = "horizontal";
const VERTICAL_FN: &str = "vertical";

const LINE_PROPERTY_START: &str = "start";
const LINE_PROPERTY_END: &str = "end";

#[derive(Debug, Clone)]
pub struct FrontendState {
    program: Program,
    scene_graph: SceneGraph,
}

impl Default for FrontendState {
    fn default() -> Self {
        Self::new()
    }
}

impl FrontendState {
    pub fn new() -> Self {
        Self {
            program: Program::empty(),
            scene_graph: SceneGraph {
                project: ProjectId(0),
                file: FileId(0),
                version: Version(0),
                objects: Default::default(),
                settings: Default::default(),
                sketch_mode: Default::default(),
            },
        }
    }
}

impl SketchApi for FrontendState {
    async fn new_sketch(
        &mut self,
        ctx: &ExecutorContext,
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        args: SketchArgs,
    ) -> api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // TODO: Check version.

        // Create updated KCL source from args.
        let plane_ast = match &args.on {
            // TODO: sketch-api: implement ObjectId to source.
            api::Plane::Object(_) => todo!(),
            api::Plane::Default(plane) => ast_name_expr(plane.to_string()),
        };
        let sketch_ast = ast::SketchBlock {
            arguments: vec![ast::LabeledArg {
                label: Some(ast::Identifier::new("on")),
                arg: plane_ast,
            }],
            body: Default::default(),
            non_code_meta: Default::default(),
            digest: None,
        };
        let mut new_ast = self.program.ast.clone();
        // Ensure that we allow experimental features since the sketch block
        // won't work without it.
        new_ast.set_experimental_features(Some(WarningLevel::Allow));
        // Add a sketch block.
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
        let new_source = source_from_ast(&new_ast);
        // Parse the new source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding sketch: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding sketch".to_owned(),
            });
        };

        let sketch_source_range = new_program
            .ast
            .body
            .last()
            .map(SourceRange::from)
            .ok_or_else(|| Error {
                msg: "No AST body items after adding sketch".to_owned(),
            })?;
        #[cfg(not(feature = "artifact-graph"))]
        let _ = sketch_source_range;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        #[cfg(not(feature = "artifact-graph"))]
        let sketch_id = ObjectId(0);
        #[cfg(feature = "artifact-graph")]
        let sketch_id = outcome
            .source_range_to_object
            .get(&sketch_source_range)
            .copied()
            .ok_or_else(|| Error {
                msg: format!("Source range of sketch not found: {sketch_source_range:?}"),
            })?;
        let src_delta = SourceDelta { text: new_source };
        // Store the object in the scene.
        self.scene_graph.sketch_mode = Some(sketch_id);
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: vec![sketch_id],
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta, sketch_id))
    }

    async fn edit_sketch(
        &mut self,
        _ctx: &ExecutorContext,
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        _sketch: ObjectId,
    ) -> api::Result<SceneGraphDelta> {
        todo!()
    }

    async fn exit_sketch(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
    ) -> api::Result<SceneGraph> {
        // TODO: Check version.
        #[cfg(not(target_arch = "wasm32"))]
        let _ = sketch;
        #[cfg(target_arch = "wasm32")]
        if self.scene_graph.sketch_mode != Some(sketch) {
            web_sys::console::warn_1(
                &format!(
                    "WARNING: exit_sketch: current state's sketch mode ID doesn't match the given sketch ID; state={:#?}, given={sketch:?}",
                    &self.scene_graph.sketch_mode
                )
                .into(),
            );
        }
        self.scene_graph.sketch_mode = None;

        // Execute.
        let outcome = ctx.run_with_caching(self.program.clone()).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        self.update_state_after_exec(outcome);

        Ok(self.scene_graph.clone())
    }

    async fn add_segment(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
        segment: SegmentCtor,
        _label: Option<String>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.
        match segment {
            SegmentCtor::Point(ctor) => self.add_point(ctx, sketch, ctor).await,
            SegmentCtor::Line(ctor) => self.add_line(ctx, sketch, ctor).await,
            _ => Err(Error {
                msg: format!("segment ctor not implemented yet: {segment:?}"),
            }),
        }
    }

    async fn edit_segments(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
        segments: Vec<ExistingSegmentCtor>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.
        let mut new_ast = self.program.ast.clone();
        for segment in segments {
            match segment.ctor {
                SegmentCtor::Point(ctor) => self.edit_point(&mut new_ast, sketch, segment.id, ctor)?,
                SegmentCtor::Line(ctor) => self.edit_line(&mut new_ast, sketch, segment.id, ctor)?,
                _ => {
                    return Err(Error {
                        msg: format!("segment ctor not implemented yet: {segment:?}"),
                    });
                }
            }
        }
        self.execute_after_edit(ctx, sketch, &mut new_ast).await
    }

    async fn delete_segment(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _segment_id: ObjectId,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        todo!()
    }

    async fn add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
        constraint: Constraint,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.

        let mut new_ast = self.program.ast.clone();
        let sketch_block_range = match constraint {
            Constraint::Coincident(coincident) => self.add_coincident(sketch, coincident, &mut new_ast).await?,
            Constraint::Horizontal(horizontal) => self.add_horizontal(sketch, horizontal, &mut new_ast).await?,
            Constraint::LinesEqualLength(lines_equal_length) => {
                self.add_lines_equal_length(sketch, lines_equal_length, &mut new_ast)
                    .await?
            }
            Constraint::Vertical(vertical) => self.add_vertical(sketch, vertical, &mut new_ast).await?,
            _ => {
                return Err(Error {
                    msg: format!("constraint not implemented yet: {constraint:?}"),
                });
            }
        };
        self.execute_after_add_constraint(ctx, sketch, sketch_block_range, &mut new_ast)
            .await
    }

    async fn edit_constraint(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint_id: ObjectId,
        _constraint: Constraint,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        todo!()
    }

    async fn delete_constraint(
        &mut self,
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint_id: ObjectId,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        todo!()
    }
}

impl FrontendState {
    pub async fn hack_set_program(&mut self, ctx: &ExecutorContext, program: Program) -> api::Result<()> {
        self.program = program.clone();

        // Execute so that the objects are updated and available for the next
        // API call.
        let outcome = ctx.run_with_caching(program).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        self.update_state_after_exec(outcome);

        Ok(())
    }

    async fn add_point(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        ctor: PointCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Create updated KCL source from args.
        let at_ast = to_ast_point2d(&ctor.position).map_err(|err| Error { msg: err.to_string() })?;
        let point_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(POINT_FN)),
            unlabeled: None,
            arguments: vec![ast::LabeledArg {
                label: Some(ast::Identifier::new(POINT_AT_PARAM)),
                arg: at_ast,
            }],
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Look up existing sketch.
        let sketch_id = sketch;
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| {
            #[cfg(target_arch = "wasm32")]
            web_sys::console::error_1(
                &format!(
                    "Sketch not found; sketch_id={sketch_id:?}, self.scene_graph.objects={:#?}",
                    &self.scene_graph.objects
                )
                .into(),
            );
            Error {
                msg: format!("Sketch not found: {sketch:?}"),
            }
        })?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        // Add the point to the AST of the sketch block.
        let mut new_ast = self.program.ast.clone();
        let (sketch_block_range, _) = self
            .mutate_ast(
                &mut new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: point_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(&new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding point: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding point".to_string(),
            });
        };

        let point_source_range =
            find_sketch_block_added_item(&new_program.ast, sketch_block_range).map_err(|err| Error {
                msg: format!("Source range of point not found in sketch block: {sketch_block_range:?}; {err:?}"),
            })?;
        #[cfg(not(feature = "artifact-graph"))]
        let _ = point_source_range;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        #[cfg(not(feature = "artifact-graph"))]
        let new_object_ids = Vec::new();
        #[cfg(feature = "artifact-graph")]
        let new_object_ids = {
            let segment_id = outcome
                .source_range_to_object
                .get(&point_source_range)
                .copied()
                .ok_or_else(|| Error {
                    msg: format!("Source range of point not found: {point_source_range:?}"),
                })?;
            let segment_object = outcome.scene_objects.get(segment_id.0).ok_or_else(|| Error {
                msg: format!("Segment not found: {segment_id:?}"),
            })?;
            let ObjectKind::Segment { segment } = &segment_object.kind else {
                return Err(Error {
                    msg: format!("Object is not a segment: {segment_object:?}"),
                });
            };
            let Segment::Point(_) = segment else {
                return Err(Error {
                    msg: format!("Segment is not a point: {segment:?}"),
                });
            };
            vec![segment_id]
        };
        let src_delta = SourceDelta { text: new_source };
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: new_object_ids,
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    async fn add_line(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        ctor: LineCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Create updated KCL source from args.
        let start_ast = to_ast_point2d(&ctor.start).map_err(|err| Error { msg: err.to_string() })?;
        let end_ast = to_ast_point2d(&ctor.end).map_err(|err| Error { msg: err.to_string() })?;
        let line_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(LINE_FN)),
            unlabeled: None,
            arguments: vec![
                ast::LabeledArg {
                    label: Some(ast::Identifier::new(LINE_START_PARAM)),
                    arg: start_ast,
                },
                ast::LabeledArg {
                    label: Some(ast::Identifier::new(LINE_END_PARAM)),
                    arg: end_ast,
                },
            ],
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Look up existing sketch.
        let sketch_id = sketch;
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        // Add the line to the AST of the sketch block.
        let mut new_ast = self.program.ast.clone();
        let (sketch_block_range, _) = self
            .mutate_ast(
                &mut new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: line_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(&new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding line: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding line".to_string(),
            });
        };
        let line_source_range =
            find_sketch_block_added_item(&new_program.ast, sketch_block_range).map_err(|err| Error {
                msg: format!("Source range of line not found in sketch block: {sketch_block_range:?}; {err:?}"),
            })?;
        #[cfg(not(feature = "artifact-graph"))]
        let _ = line_source_range;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        #[cfg(not(feature = "artifact-graph"))]
        let new_object_ids = Vec::new();
        #[cfg(feature = "artifact-graph")]
        let new_object_ids = {
            let segment_id = outcome
                .source_range_to_object
                .get(&line_source_range)
                .copied()
                .ok_or_else(|| Error {
                    msg: format!("Source range of line not found: {line_source_range:?}"),
                })?;
            let segment_object = outcome.scene_objects.get(segment_id.0).ok_or_else(|| Error {
                msg: format!("Segment not found: {segment_id:?}"),
            })?;
            let ObjectKind::Segment { segment } = &segment_object.kind else {
                return Err(Error {
                    msg: format!("Object is not a segment: {segment_object:?}"),
                });
            };
            let Segment::Line(line) = segment else {
                return Err(Error {
                    msg: format!("Segment is not a line: {segment:?}"),
                });
            };
            vec![line.start, line.end, segment_id]
        };
        let src_delta = SourceDelta { text: new_source };
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: new_object_ids,
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    fn edit_point(
        &mut self,
        new_ast: &mut ast::Node<ast::Program>,
        sketch: ObjectId,
        point: ObjectId,
        ctor: PointCtor,
    ) -> api::Result<()> {
        // Create updated KCL source from args.
        let new_at_ast = to_ast_point2d(&ctor.position).map_err(|err| Error { msg: err.to_string() })?;

        // Look up existing sketch.
        let sketch_id = sketch;
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        sketch.segments.iter().find(|o| **o == point).ok_or_else(|| Error {
            msg: format!("Point not found in sketch: point={point:?}, sketch={sketch:?}"),
        })?;
        // Look up existing point.
        let point_id = point;
        let point_object = self.scene_graph.objects.get(point_id.0).ok_or_else(|| Error {
            msg: format!("Point not found in scene graph: point={point:?}"),
        })?;
        let ObjectKind::Segment {
            segment: Segment::Point(point),
        } = &point_object.kind
        else {
            return Err(Error {
                msg: format!("Object is not a point segment: {point_object:?}"),
            });
        };

        // If the point is part of a line, edit the line instead.
        if let Some(line_id) = point.owner {
            let line_object = self.scene_graph.objects.get(line_id.0).ok_or_else(|| Error {
                msg: format!("Internal: Line owner of point not found in scene graph: line={line_id:?}",),
            })?;
            let ObjectKind::Segment {
                segment: Segment::Line(line),
            } = &line_object.kind
            else {
                return Err(Error {
                    msg: format!("Internal: Owner of point is not actually a line segment: {line_object:?}"),
                });
            };
            let SegmentCtor::Line(line_ctor) = &line.ctor else {
                return Err(Error {
                    msg: format!("Internal: Owner of point does not have line ctor: {line_object:?}"),
                });
            };
            let mut line_ctor = line_ctor.clone();
            // Which end of the line is this point?
            if line.start == point_id {
                line_ctor.start = ctor.position;
            } else if line.end == point_id {
                line_ctor.end = ctor.position;
            } else {
                return Err(Error {
                    msg: format!(
                        "Internal: Point is not part of owner's line segment: point={point_id:?}, line={line_id:?}"
                    ),
                });
            }
            return self.edit_line(new_ast, sketch_id, line_id, line_ctor);
        }

        // Modify the point AST.
        self.mutate_ast(new_ast, point_id, AstMutateCommand::EditPoint { at: new_at_ast })
            .map_err(|err| Error { msg: err.to_string() })?;
        Ok(())
    }

    fn edit_line(
        &mut self,
        new_ast: &mut ast::Node<ast::Program>,
        sketch: ObjectId,
        line: ObjectId,
        ctor: LineCtor,
    ) -> api::Result<()> {
        // Create updated KCL source from args.
        let new_start_ast = to_ast_point2d(&ctor.start).map_err(|err| Error { msg: err.to_string() })?;
        let new_end_ast = to_ast_point2d(&ctor.end).map_err(|err| Error { msg: err.to_string() })?;

        // Look up existing sketch.
        let sketch_id = sketch;
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
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
        let line_id = line;
        let line_object = self.scene_graph.objects.get(line_id.0).ok_or_else(|| Error {
            msg: format!("Line not found in scene graph: line={line:?}"),
        })?;
        let ObjectKind::Segment { .. } = &line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };

        // Modify the line AST.
        self.mutate_ast(
            new_ast,
            line_id,
            AstMutateCommand::EditLine {
                start: new_start_ast,
                end: new_end_ast,
            },
        )
        .map_err(|err| Error { msg: err.to_string() })?;
        Ok(())
    }

    async fn execute_after_edit(
        &mut self,
        ctx: &ExecutorContext,
        _sketch_id: ObjectId,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after editing: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after editing".to_string(),
            });
        };

        // TODO: sketch-api: make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        let src_delta = SourceDelta { text: new_source };
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: Vec::new(),
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    async fn add_coincident(
        &mut self,
        sketch: ObjectId,
        coincident: Coincident,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        if coincident.points.len() != 2 {
            return Err(Error {
                msg: format!(
                    "Coincident constraint must have exactly 2 points, got {}",
                    coincident.points.len()
                ),
            });
        }
        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
        let pt0_id = coincident.points[0];
        let pt0_object = self.scene_graph.objects.get(pt0_id.0).ok_or_else(|| Error {
            msg: format!("Point not found: {pt0_id:?}"),
        })?;
        let ObjectKind::Segment { segment: pt0_segment } = &pt0_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {pt0_object:?}"),
            });
        };
        let Segment::Point(pt0) = pt0_segment else {
            return Err(Error {
                msg: format!("Only points are currently supported: {pt0_object:?}"),
            });
        };
        // If the point is part of a line, refer to the line instead.
        let pt0_ast = if let Some(line_id) = pt0.owner {
            let line = self.expect_line(line_id)?;
            let line_source = &self.scene_graph.objects.get(line_id.0).unwrap().source;
            let property = if line.start == pt0_id {
                LINE_PROPERTY_START
            } else if line.end == pt0_id {
                LINE_PROPERTY_END
            } else {
                return Err(Error {
                    msg: format!(
                        "Internal: Point is not part of owner's line segment: point={pt0_id:?}, line={line_id:?}"
                    ),
                });
            };
            get_or_insert_ast_reference(new_ast, line_source, "line", Some(property))?
        } else {
            get_or_insert_ast_reference(new_ast, &pt0_object.source, "point", None)?
        };

        let pt1_id = coincident.points[1];
        let pt1_object = self.scene_graph.objects.get(pt1_id.0).ok_or_else(|| Error {
            msg: format!("Point not found: {pt1_id:?}"),
        })?;
        let ObjectKind::Segment { segment: pt1_segment } = &pt1_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {pt1_object:?}"),
            });
        };
        let Segment::Point(pt1) = pt1_segment else {
            return Err(Error {
                msg: format!("Only points are currently supported: {pt1_object:?}"),
            });
        };
        // If the point is part of a line, refer to the line instead.
        let pt1_ast = if let Some(line_id) = pt1.owner {
            let line = self.expect_line(line_id)?;
            let line_source = &self.scene_graph.objects.get(line_id.0).unwrap().source;
            let property = if line.start == pt1_id {
                LINE_PROPERTY_START
            } else if line.end == pt1_id {
                LINE_PROPERTY_END
            } else {
                return Err(Error {
                    msg: format!(
                        "Internal: Point is not part of owner's line segment: point={pt1_id:?}, line={line_id:?}"
                    ),
                });
            };
            get_or_insert_ast_reference(new_ast, line_source, "line", Some(property))?
        } else {
            get_or_insert_ast_reference(new_ast, &pt1_object.source, "point", None)?
        };

        // Create the coincident() call.
        let coincident_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(COINCIDENT_FN)),
            unlabeled: Some(ast::Expr::ArrayExpression(Box::new(ast::Node::no_src(
                ast::ArrayExpression {
                    elements: vec![pt0_ast, pt1_ast],
                    digest: None,
                    non_code_meta: Default::default(),
                },
            )))),
            arguments: Default::default(),
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Add the line to the AST of the sketch block.
        let (sketch_block_range, _) = self
            .mutate_ast(
                new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: coincident_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        Ok(sketch_block_range)
    }

    async fn add_horizontal(
        &mut self,
        sketch: ObjectId,
        horizontal: Horizontal,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
        let line_id = horizontal.line;
        let line_object = self.scene_graph.objects.get(line_id.0).ok_or_else(|| Error {
            msg: format!("Line not found: {line_id:?}"),
        })?;
        let ObjectKind::Segment { segment: line_segment } = &line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };
        let Segment::Line(_) = line_segment else {
            return Err(Error {
                msg: format!("Only lines can be made horizontal: {line_object:?}"),
            });
        };
        let line_ast = get_or_insert_ast_reference(new_ast, &line_object.source.clone(), "line", None)?;

        // Create the horizontal() call.
        let horizontal_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(HORIZONTAL_FN)),
            unlabeled: Some(line_ast),
            arguments: Default::default(),
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Add the line to the AST of the sketch block.
        let (sketch_block_range, _) = self
            .mutate_ast(
                new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: horizontal_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        Ok(sketch_block_range)
    }

    async fn add_lines_equal_length(
        &mut self,
        sketch: ObjectId,
        lines_equal_length: LinesEqualLength,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        if lines_equal_length.lines.len() != 2 {
            return Err(Error {
                msg: format!(
                    "Lines equal length constraint must have exactly 2 lines, got {}",
                    lines_equal_length.lines.len()
                ),
            });
        }

        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
        let line0_id = lines_equal_length.lines[0];
        let line0_object = self.scene_graph.objects.get(line0_id.0).ok_or_else(|| Error {
            msg: format!("Line not found: {line0_id:?}"),
        })?;
        let ObjectKind::Segment { segment: line0_segment } = &line0_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line0_object:?}"),
            });
        };
        let Segment::Line(_) = line0_segment else {
            return Err(Error {
                msg: format!("Only lines can be made equal length: {line0_object:?}"),
            });
        };
        let line0_ast = get_or_insert_ast_reference(new_ast, &line0_object.source.clone(), "line", None)?;

        let line1_id = lines_equal_length.lines[1];
        let line1_object = self.scene_graph.objects.get(line1_id.0).ok_or_else(|| Error {
            msg: format!("Line not found: {line1_id:?}"),
        })?;
        let ObjectKind::Segment { segment: line1_segment } = &line1_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line1_object:?}"),
            });
        };
        let Segment::Line(_) = line1_segment else {
            return Err(Error {
                msg: format!("Only lines can be made equal length: {line1_object:?}"),
            });
        };
        let line1_ast = get_or_insert_ast_reference(new_ast, &line1_object.source.clone(), "line", None)?;

        // Create the equalLength() call.
        let equal_length_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(EQUAL_LENGTH_FN)),
            unlabeled: Some(ast::Expr::ArrayExpression(Box::new(ast::Node::no_src(
                ast::ArrayExpression {
                    elements: vec![line0_ast, line1_ast],
                    digest: None,
                    non_code_meta: Default::default(),
                },
            )))),
            arguments: Default::default(),
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Add the constraint to the AST of the sketch block.
        let (sketch_block_range, _) = self
            .mutate_ast(
                new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: equal_length_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        Ok(sketch_block_range)
    }

    async fn add_vertical(
        &mut self,
        sketch: ObjectId,
        vertical: Vertical,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
        let line_id = vertical.line;
        let line_object = self.scene_graph.objects.get(line_id.0).ok_or_else(|| Error {
            msg: format!("Line not found: {line_id:?}"),
        })?;
        let ObjectKind::Segment { segment: line_segment } = &line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };
        let Segment::Line(_) = line_segment else {
            return Err(Error {
                msg: format!("Only lines can be made vertical: {line_object:?}"),
            });
        };
        let line_ast = get_or_insert_ast_reference(new_ast, &line_object.source.clone(), "line", None)?;

        // Create the vertical() call.
        let vertical_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(VERTICAL_FN)),
            unlabeled: Some(line_ast),
            arguments: Default::default(),
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Add the line to the AST of the sketch block.
        let (sketch_block_range, _) = self
            .mutate_ast(
                new_ast,
                sketch_id,
                AstMutateCommand::AddSketchBlockExprStmt { expr: vertical_ast },
            )
            .map_err(|err| Error { msg: err.to_string() })?;
        Ok(sketch_block_range)
    }

    async fn execute_after_add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        _sketch_id: ObjectId,
        sketch_block_range: SourceRange,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding constraint: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding constraint".to_string(),
            });
        };
        let _constraint_source_range =
            find_sketch_block_added_item(&new_program.ast, sketch_block_range).map_err(|err| Error {
                msg: format!(
                    "Source range of new constraint not found in sketch block: {sketch_block_range:?}; {err:?}"
                ),
            })?;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        let src_delta = SourceDelta { text: new_source };
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: Vec::new(),
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    fn expect_line(&self, object_id: ObjectId) -> api::Result<&Line> {
        let object = self.scene_graph.objects.get(object_id.0).ok_or_else(|| Error {
            msg: format!("Object not found: {object_id:?}"),
        })?;
        let ObjectKind::Segment { segment } = &object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {object:?}"),
            });
        };
        let Segment::Line(line) = segment else {
            return Err(Error {
                msg: format!("Segment is not a line: {segment:?}"),
            });
        };
        Ok(line)
    }

    fn update_state_after_exec(&mut self, outcome: ExecOutcome) -> ExecOutcome {
        #[cfg(not(feature = "artifact-graph"))]
        return outcome;
        #[cfg(feature = "artifact-graph")]
        {
            let mut outcome = outcome;
            self.scene_graph.objects = std::mem::take(&mut outcome.scene_objects);
            outcome
        }
    }

    fn mutate_ast(
        &mut self,
        ast: &mut ast::Node<ast::Program>,
        object_id: ObjectId,
        command: AstMutateCommand,
    ) -> anyhow::Result<(SourceRange, AstMutateCommandReturn)> {
        let sketch_object = self
            .scene_graph
            .objects
            .get(object_id.0)
            .ok_or_else(|| anyhow!("Object not found: {object_id:?}"))?;
        match &sketch_object.source {
            SourceRef::Simple { range } => mutate_ast_node_by_source_range(ast, *range, command),
            SourceRef::BackTrace { .. } => bail!("BackTrace source refs not supported yet"),
        }
    }
}

fn expect_single_source_range(source_ref: &SourceRef) -> api::Result<SourceRange> {
    match source_ref {
        SourceRef::Simple { range } => Ok(*range),
        SourceRef::BackTrace { ranges } => {
            if ranges.len() != 1 {
                return Err(Error {
                    msg: format!(
                        "Expected single source range in SourceRef, got {}; ranges={ranges:#?}",
                        ranges.len(),
                    ),
                });
            }
            Ok(ranges[0])
        }
    }
}

/// Return the AST expression referencing the variable at the given source ref.
/// If no such variable exists, insert a new variable declaration with the given
/// prefix.
///
/// This may return a complex expression referencing properties of the variable
/// (e.g., `line1.start`).
fn get_or_insert_ast_reference(
    ast: &mut ast::Node<ast::Program>,
    source_ref: &SourceRef,
    prefix: &str,
    property: Option<&str>,
) -> api::Result<ast::Expr> {
    let range = expect_single_source_range(source_ref)?;
    let command = AstMutateCommand::AddVariableDeclaration {
        prefix: prefix.to_owned(),
    };
    let (_, ret) =
        mutate_ast_node_by_source_range(ast, range, command).map_err(|err| Error { msg: err.to_string() })?;
    let AstMutateCommandReturn::Name(var_name) = ret else {
        return Err(Error {
            msg: "Expected variable name returned from AddVariableDeclaration".to_owned(),
        });
    };
    let var_expr = ast::Expr::Name(Box::new(ast::Name::new(&var_name)));
    let Some(property) = property else {
        // No property; just return the variable name.
        return Ok(var_expr);
    };

    Ok(ast::Expr::MemberExpression(Box::new(ast::Node::no_src(
        ast::MemberExpression {
            object: var_expr,
            property: ast::Expr::Name(Box::new(ast::Name::new(property))),
            computed: false,
            digest: None,
        },
    ))))
}

fn mutate_ast_node_by_source_range(
    ast: &mut ast::Node<ast::Program>,
    source_range: SourceRange,
    command: AstMutateCommand,
) -> anyhow::Result<(SourceRange, AstMutateCommandReturn)> {
    let mut context = AstMutateContext {
        source_range,
        command,
        defined_names_stack: Default::default(),
    };
    let control = dfs_mut(ast, &mut context);
    match control {
        ControlFlow::Continue(_) => Err(anyhow!("Source range not found: {source_range:?}")),
        ControlFlow::Break(break_value) => Ok(break_value),
    }
}

#[derive(Debug)]
struct AstMutateContext {
    source_range: SourceRange,
    command: AstMutateCommand,
    defined_names_stack: Vec<HashSet<String>>,
}

#[derive(Debug)]
#[allow(clippy::large_enum_variant)]
enum AstMutateCommand {
    /// Add an expression statement to the sketch block.
    AddSketchBlockExprStmt {
        expr: ast::Expr,
    },
    AddVariableDeclaration {
        prefix: String,
    },
    EditPoint {
        at: ast::Expr,
    },
    EditLine {
        start: ast::Expr,
        end: ast::Expr,
    },
}

#[derive(Debug)]
enum AstMutateCommandReturn {
    None,
    Name(String),
}

impl Visitor for AstMutateContext {
    type Break = (SourceRange, AstMutateCommandReturn);
    type Continue = ();

    fn visit(&mut self, node: NodeMut<'_>) -> TraversalReturn<Self::Break, Self::Continue> {
        filter_and_process(self, node)
    }

    fn finish(&mut self, node: NodeMut<'_>) {
        match &node {
            NodeMut::Program(_) | NodeMut::SketchBlock(_) => {
                self.defined_names_stack.pop();
            }
            _ => {}
        }
    }
}
fn filter_and_process(
    ctx: &mut AstMutateContext,
    node: NodeMut,
) -> TraversalReturn<(SourceRange, AstMutateCommandReturn)> {
    let Ok(node_range) = SourceRange::try_from(&node) else {
        // Nodes that can't be converted to a range aren't interesting.
        return TraversalReturn::new_continue(());
    };
    // If we're adding a variable declaration, we need to look at variable
    // declaration expressions to see if it already has a variable, before
    // continuing. The variable declaration's source range won't match the
    // target; its init expression will.
    if let AstMutateCommand::AddVariableDeclaration { .. } = &ctx.command
        && let NodeMut::VariableDeclaration(var_decl) = &node
    {
        let expr_range = SourceRange::from(&var_decl.declaration.init);
        if expr_range == ctx.source_range {
            // We found the variable declaration expression. It doesn't need
            // to be added.
            return TraversalReturn::new_break((node_range, AstMutateCommandReturn::Name(var_decl.name().to_owned())));
        }
    }

    if let NodeMut::Program(program) = &node {
        ctx.defined_names_stack.push(find_defined_names(*program));
    } else if let NodeMut::SketchBlock(block) = &node {
        ctx.defined_names_stack.push(find_defined_names(&block.body));
    }

    // Make sure the node matches the source range.
    if node_range != ctx.source_range {
        return TraversalReturn::new_continue(());
    }
    process(ctx, node).map_break(|cmd_return| (ctx.source_range, cmd_return))
}

fn process(ctx: &AstMutateContext, node: NodeMut) -> TraversalReturn<AstMutateCommandReturn> {
    match &ctx.command {
        AstMutateCommand::AddSketchBlockExprStmt { expr } => {
            if let NodeMut::SketchBlock(sketch_block) = node {
                sketch_block
                    .body
                    .items
                    .push(ast::BodyItem::ExpressionStatement(ast::Node {
                        inner: ast::ExpressionStatement {
                            expression: expr.clone(),
                            digest: None,
                        },
                        start: Default::default(),
                        end: Default::default(),
                        module_id: Default::default(),
                        outer_attrs: Default::default(),
                        pre_comments: Default::default(),
                        comment_start: Default::default(),
                    }));
                return TraversalReturn::new_break(AstMutateCommandReturn::None);
            }
        }
        AstMutateCommand::AddVariableDeclaration { prefix } => {
            if let NodeMut::VariableDeclaration(inner) = node {
                return TraversalReturn::new_break(AstMutateCommandReturn::Name(inner.name().to_owned()));
            }
            if let NodeMut::ExpressionStatement(expr_stmt) = node {
                let empty_defined_names = HashSet::new();
                let defined_names = ctx.defined_names_stack.last().unwrap_or(&empty_defined_names);
                let Ok(name) = next_free_name(prefix, defined_names) else {
                    // TODO: Return an error instead?
                    return TraversalReturn::new_break(AstMutateCommandReturn::None);
                };
                let mutate_node =
                    ast::BodyItem::VariableDeclaration(Box::new(ast::Node::no_src(ast::VariableDeclaration::new(
                        ast::VariableDeclarator::new(&name, expr_stmt.expression.clone()),
                        ast::ItemVisibility::Default,
                        ast::VariableKind::Const,
                    ))));
                return TraversalReturn {
                    mutate_body_item: Some(mutate_node),
                    control_flow: ControlFlow::Break(AstMutateCommandReturn::Name(name)),
                };
            }
        }
        AstMutateCommand::EditPoint { at } => {
            if let NodeMut::CallExpressionKw(call) = node {
                if call.callee.name.name != POINT_FN {
                    return TraversalReturn::new_continue(());
                }
                // Update the arguments.
                for labeled_arg in &mut call.arguments {
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(POINT_AT_PARAM) {
                        labeled_arg.arg = at.clone();
                    }
                }
                return TraversalReturn::new_break(AstMutateCommandReturn::None);
            }
        }
        AstMutateCommand::EditLine { start, end } => {
            if let NodeMut::CallExpressionKw(call) = node {
                if call.callee.name.name != LINE_FN {
                    return TraversalReturn::new_continue(());
                }
                // Update the arguments.
                for labeled_arg in &mut call.arguments {
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(LINE_START_PARAM) {
                        labeled_arg.arg = start.clone();
                    }
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(LINE_END_PARAM) {
                        labeled_arg.arg = end.clone();
                    }
                }
                return TraversalReturn::new_break(AstMutateCommandReturn::None);
            }
        }
    }
    TraversalReturn::new_continue(())
}

struct FindSketchBlockSourceRange {
    /// The source range of the sketch block before mutation.
    target_before_mutation: SourceRange,
    /// The source range of the sketch block's last body item after mutation. We
    /// need to use a [Cell] since the [crate::walk::Visitor] trait requires a
    /// shared reference.
    found: Cell<Option<SourceRange>>,
}

impl<'a> crate::walk::Visitor<'a> for &FindSketchBlockSourceRange {
    type Error = crate::front::Error;

    fn visit_node(&self, node: crate::walk::Node<'a>) -> anyhow::Result<bool, Self::Error> {
        let Ok(node_range) = SourceRange::try_from(&node) else {
            return Ok(true);
        };

        if let crate::walk::Node::SketchBlock(sketch_block) = node {
            if node_range.module_id() == self.target_before_mutation.module_id()
                && node_range.start() == self.target_before_mutation.start()
                // End shouldn't match since we added something.
                && node_range.end() >= self.target_before_mutation.end()
            {
                self.found.set(sketch_block.body.items.last().map(SourceRange::from));
                return Ok(false);
            } else {
                // We found a different sketch block. No need to descend into
                // its children since sketch blocks cannot be nested.
                return Ok(true);
            }
        }

        for child in node.children().iter() {
            if !child.visit(*self)? {
                return Ok(false);
            }
        }

        Ok(true)
    }
}

/// After adding an item to a sketch block, find the sketch block, and get the
/// source range of the added item. We assume that the added item is the last
/// item in the sketch block and that the sketch block's source range has grown,
/// but not moved from its starting offset.
///
/// TODO: Do we need to format *before* mutation in case formatting moves the
/// sketch block forward?
fn find_sketch_block_added_item(
    ast: &ast::Node<ast::Program>,
    range_before_mutation: SourceRange,
) -> api::Result<SourceRange> {
    let find = FindSketchBlockSourceRange {
        target_before_mutation: range_before_mutation,
        found: Cell::new(None),
    };
    let node = crate::walk::Node::from(ast);
    node.visit(&find)?;
    find.found.into_inner().ok_or_else(|| api::Error {
        msg: format!("Source range after mutation not found for range before mutation: {range_before_mutation:?}; Did you try formatting (i.e. call recast) before calling this?"),
    })
}

fn source_from_ast(ast: &ast::Node<ast::Program>) -> String {
    // TODO: Don't duplicate this from lib.rs Program.
    ast.recast_top(&Default::default(), 0)
}

fn to_ast_point2d(point: &Point2d<Expr>) -> anyhow::Result<ast::Expr> {
    Ok(ast::Expr::ArrayExpression(Box::new(ast::Node {
        inner: ast::ArrayExpression {
            elements: vec![to_source_expr(&point.x)?, to_source_expr(&point.y)?],
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
        Expr::Variable(variable) => Ok(ast_name_expr(variable.clone())),
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

fn ast_name_expr(name: String) -> ast::Expr {
    ast::Expr::Name(Box::new(ast_name(name)))
}

fn ast_name(name: String) -> ast::Node<ast::Name> {
    ast::Node {
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
    }
}

fn ast_sketch2_name(name: &str) -> ast::Name {
    ast::Name {
        name: ast::Node {
            inner: ast::Identifier {
                name: name.to_owned(),
                digest: None,
            },
            start: Default::default(),
            end: Default::default(),
            module_id: Default::default(),
            outer_attrs: Default::default(),
            pre_comments: Default::default(),
            comment_start: Default::default(),
        },
        path: vec![ast::Node::no_src(ast::Identifier {
            name: "sketch2".to_owned(),
            digest: None,
        })],
        abs_path: false,
        digest: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        engine::PlaneName,
        front::{Plane, Sketch},
        frontend::sketch::Vertical,
        pretty::NumericSuffix,
    };

    #[tokio::test(flavor = "multi_thread")]
    async fn test_new_sketch_add_point_edit_point() {
        let program = Program::empty();

        let mut frontend = FrontendState::new();
        frontend.program = program;

        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        let sketch_args = SketchArgs {
            on: api::Plane::Default(PlaneName::Xy),
        };
        let (_src_delta, scene_delta, sketch_id) = frontend
            .new_sketch(&mock_ctx, ProjectId(0), FileId(0), version, sketch_args)
            .await
            .unwrap();
        assert_eq!(sketch_id, ObjectId(0));
        assert_eq!(scene_delta.new_objects, vec![ObjectId(0)]);
        let sketch_object = &scene_delta.new_graph.objects[0];
        assert_eq!(sketch_object.id, ObjectId(0));
        assert_eq!(
            sketch_object.kind,
            ObjectKind::Sketch(Sketch {
                args: SketchArgs {
                    on: Plane::Default(PlaneName::Xy)
                },
                segments: vec![],
                constraints: vec![],
            })
        );
        assert_eq!(scene_delta.new_graph.objects.len(), 1);

        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Number(Number {
                    value: 1.0,
                    units: NumericSuffix::Inch,
                }),
                y: Expr::Number(Number {
                    value: 2.0,
                    units: NumericSuffix::Inch,
                }),
            },
        };
        let segment = SegmentCtor::Point(point_ctor);
        let (src_delta, scene_delta) = frontend
            .add_segment(&mock_ctx, version, sketch_id, segment, None)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [1in, 2in])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![ObjectId(1)]);
        assert_eq!(scene_delta.new_graph.objects.len(), 2);
        for (i, scene_object) in scene_delta.new_graph.objects.iter().enumerate() {
            assert_eq!(scene_object.id.0, i);
        }
        assert_eq!(scene_delta.new_graph.objects.len(), 2);

        let point_id = *scene_delta.new_objects.last().unwrap();

        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Number(Number {
                    value: 3.0,
                    units: NumericSuffix::Inch,
                }),
                y: Expr::Number(Number {
                    value: 4.0,
                    units: NumericSuffix::Inch,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: point_id,
            ctor: SegmentCtor::Point(point_ctor),
        }];
        let (src_delta, scene_delta) = frontend
            .edit_segments(&mock_ctx, version, sketch_id, segments)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [3in, 4in])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_new_sketch_add_line_edit_line() {
        let program = Program::empty();

        let mut frontend = FrontendState::new();
        frontend.program = program;

        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        let sketch_args = SketchArgs {
            on: api::Plane::Default(PlaneName::Xy),
        };
        let (_src_delta, scene_delta, sketch_id) = frontend
            .new_sketch(&mock_ctx, ProjectId(0), FileId(0), version, sketch_args)
            .await
            .unwrap();
        assert_eq!(sketch_id, ObjectId(0));
        assert_eq!(scene_delta.new_objects, vec![ObjectId(0)]);
        let sketch_object = &scene_delta.new_graph.objects[0];
        assert_eq!(sketch_object.id, ObjectId(0));
        assert_eq!(
            sketch_object.kind,
            ObjectKind::Sketch(Sketch {
                args: SketchArgs {
                    on: Plane::Default(PlaneName::Xy)
                },
                segments: vec![],
                constraints: vec![],
            })
        );
        assert_eq!(scene_delta.new_graph.objects.len(), 1);

        let line_ctor = LineCtor {
            start: Point2d {
                x: Expr::Number(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
            },
            end: Point2d {
                x: Expr::Number(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segment = SegmentCtor::Line(line_ctor);
        let (src_delta, scene_delta) = frontend
            .add_segment(&mock_ctx, version, sketch_id, segment, None)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [0mm, 0mm], end = [10mm, 10mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![ObjectId(1), ObjectId(2), ObjectId(3)]);
        for (i, scene_object) in scene_delta.new_graph.objects.iter().enumerate() {
            assert_eq!(scene_object.id.0, i);
        }
        assert_eq!(scene_delta.new_graph.objects.len(), 4);

        // The new objects are the end points and then the line.
        let line = *scene_delta.new_objects.last().unwrap();

        let line_ctor = LineCtor {
            start: Point2d {
                x: Expr::Number(Number {
                    value: 1.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 2.0,
                    units: NumericSuffix::Mm,
                }),
            },
            end: Point2d {
                x: Expr::Number(Number {
                    value: 13.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 14.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: line,
            ctor: SegmentCtor::Line(line_ctor),
        }];
        let (src_delta, scene_delta) = frontend
            .edit_segments(&mock_ctx, version, sketch_id, segments)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [1mm, 2mm], end = [13mm, 14mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_add_line_when_sketch_block_uses_variable() {
        let initial_source = "@settings(experimentalFeatures = allow)

s = sketch(on = XY) {}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;

        let line_ctor = LineCtor {
            start: Point2d {
                x: Expr::Number(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
            },
            end: Point2d {
                x: Expr::Number(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Number(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segment = SegmentCtor::Line(line_ctor);
        let (src_delta, scene_delta) = frontend
            .add_segment(&mock_ctx, version, sketch_id, segment, None)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

s = sketch(on = XY) {
  sketch2::line(start = [0mm, 0mm], end = [10mm, 10mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![ObjectId(1), ObjectId(2), ObjectId(3)]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_edit_line_when_editing_its_start_point() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;

        let point_id = frontend.scene_graph.objects.get(1).unwrap().id;

        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Var(Number {
                    value: 5.0,
                    units: NumericSuffix::Inch,
                }),
                y: Expr::Var(Number {
                    value: 6.0,
                    units: NumericSuffix::Inch,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: point_id,
            ctor: SegmentCtor::Point(point_ctor),
        }];
        let (src_delta, scene_delta) = frontend
            .edit_segments(&mock_ctx, version, sketch_id, segments)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 5in, var 6in], end = [var 3, var 4])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_edit_line_when_editing_its_end_point() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;

        let point_id = frontend.scene_graph.objects.get(2).unwrap().id;

        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Var(Number {
                    value: 5.0,
                    units: NumericSuffix::Inch,
                }),
                y: Expr::Var(Number {
                    value: 6.0,
                    units: NumericSuffix::Inch,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: point_id,
            ctor: SegmentCtor::Point(point_ctor),
        }];
        let (src_delta, scene_delta) = frontend
            .edit_segments(&mock_ctx, version, sketch_id, segments)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 5in, var 6in])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_two_points_coincident() {
        let initial_source = "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1, var 2])
  sketch2::point(at = [3, 4])
}";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let point0_id = frontend.scene_graph.objects.get(1).unwrap().id;
        let point1_id = frontend.scene_graph.objects.get(2).unwrap().id;

        let constraint = Constraint::Coincident(Coincident {
            points: vec![point0_id, point1_id],
        });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1, var 2])
  point2 = sketch2::point(at = [3, 4])
  sketch2::coincident([point1, point2])
}
"
        );
        // TODO: This is wrong since it's missing the constraint object.
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            3,
            "{:#?}",
            scene_delta.new_graph.objects
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_coincident_of_line_end_points() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let point0_id = frontend.scene_graph.objects.get(2).unwrap().id;
        let point1_id = frontend.scene_graph.objects.get(4).unwrap().id;

        let constraint = Constraint::Coincident(Coincident {
            points: vec![point0_id, point1_id],
        });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  line2 = sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
  sketch2::coincident([line1.end, line2.start])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            8,
            "{:#?}",
            scene_delta.new_graph.objects
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_line_horizontal() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line1_id = frontend.scene_graph.objects.get(3).unwrap().id;

        let constraint = Constraint::Horizontal(Horizontal { line: line1_id });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  sketch2::horizontal(line1)
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            5,
            "{:#?}",
            scene_delta.new_graph.objects
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_line_vertical() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line1_id = frontend.scene_graph.objects.get(3).unwrap().id;

        let constraint = Constraint::Vertical(Vertical { line: line1_id });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  sketch2::vertical(line1)
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            5,
            "{:#?}",
            scene_delta.new_graph.objects
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_lines_equal_length() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line1_id = frontend.scene_graph.objects.get(3).unwrap().id;
        let line2_id = frontend.scene_graph.objects.get(6).unwrap().id;

        let constraint = Constraint::LinesEqualLength(LinesEqualLength {
            lines: vec![line1_id, line2_id],
        });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  line2 = sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
  sketch2::equalLength([line1, line2])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            8,
            "{:#?}",
            scene_delta.new_graph.objects
        );
    }
}
