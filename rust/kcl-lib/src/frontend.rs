use std::{cell::Cell, collections::HashSet, ops::ControlFlow};

use kcl_error::SourceRange;

use crate::{
    ExecOutcome, ExecutorContext, Program,
    collections::AhashIndexSet,
    exec::WarningLevel,
    execution::MockConfig,
    fmt::format_number_literal,
    front::{ArcCtor, Distance, LinesEqualLength, Parallel, Perpendicular, PointCtor},
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
        traverse::{MutateBodyItem, TraversalReturn, Visitor, dfs_mut},
    },
    parsing::ast::types as ast,
    std::constraints::LinesAtAngleKind,
    walk::{NodeMut, Visitable},
};

pub(crate) mod api;
pub(crate) mod modify;
pub(crate) mod sketch;
mod traverse;

const POINT_FN: &str = "point";
const POINT_AT_PARAM: &str = "at";
const LINE_FN: &str = "line";
const LINE_START_PARAM: &str = "start";
const LINE_END_PARAM: &str = "end";
const ARC_FN: &str = "arc";
const ARC_START_PARAM: &str = "start";
const ARC_END_PARAM: &str = "end";
const ARC_CENTER_PARAM: &str = "center";

const COINCIDENT_FN: &str = "coincident";
const DISTANCE_FN: &str = "distance";
const EQUAL_LENGTH_FN: &str = "equalLength";
const HORIZONTAL_FN: &str = "horizontal";
const VERTICAL_FN: &str = "vertical";

const LINE_PROPERTY_START: &str = "start";
const LINE_PROPERTY_END: &str = "end";

const ARC_PROPERTY_START: &str = "start";
const ARC_PROPERTY_END: &str = "end";
const ARC_PROPERTY_CENTER: &str = "center";

#[derive(Debug, Clone, Copy)]
enum EditDeleteKind {
    Edit,
    DeleteSketch,
    DeleteNonSketch,
}

impl EditDeleteKind {
    /// Returns true if this edit is any type of deletion.
    fn is_delete(&self) -> bool {
        match self {
            EditDeleteKind::Edit => false,
            EditDeleteKind::DeleteSketch | EditDeleteKind::DeleteNonSketch => true,
        }
    }

    fn to_change_kind(self) -> ChangeKind {
        match self {
            EditDeleteKind::Edit => ChangeKind::Edit,
            EditDeleteKind::DeleteSketch | EditDeleteKind::DeleteNonSketch => ChangeKind::Delete,
        }
    }
}

#[derive(Debug, Clone, Copy)]
enum ChangeKind {
    Add,
    Edit,
    Delete,
    None,
}

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
    async fn execute_mock(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        let mut truncated_program = self.program.clone();
        self.exit_after_sketch_block(sketch, ChangeKind::None, &mut truncated_program.ast)?;

        // Execute.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default())
            .await
            .map_err(|err| Error {
                msg: err.error.message().to_owned(),
            })?;
        let new_source = source_from_ast(&self.program.ast);
        let src_delta = SourceDelta { text: new_source };
        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            new_objects: Default::default(),
            invalidates_ids: false,
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

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
            is_being_edited: false,
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

        // Since we just added the sketch block to the end, we don't need to
        // truncate it.

        // Execute.
        let outcome = ctx
            .run_mock(&new_program, &MockConfig::default().no_freedom_analysis())
            .await
            .map_err(|err| {
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
        ctx: &ExecutorContext,
        _project: ProjectId,
        _file: FileId,
        _version: Version,
        sketch: ObjectId,
    ) -> api::Result<SceneGraphDelta> {
        // TODO: Check version.

        // Look up existing sketch.
        let sketch_object = self.scene_graph.objects.get(sketch.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch:?}"),
        })?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };

        // Enter sketch mode by setting the sketch_mode.
        self.scene_graph.sketch_mode = Some(sketch);

        // Truncate after the sketch block for mock execution.
        let mut truncated_program = self.program.clone();
        self.exit_after_sketch_block(sketch, ChangeKind::None, &mut truncated_program.ast)?;

        // Execute in mock mode to ensure state is up to date. The caller will
        // want freedom analysis to display segments correctly.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default())
            .await
            .map_err(|err| {
                // TODO: sketch-api: Yeah, this needs to change. We need to
                // return the full error.
                Error {
                    msg: err.error.message().to_owned(),
                }
            })?;

        let outcome = self.update_state_after_exec(outcome);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: Vec::new(),
            exec_outcome: outcome,
        };
        Ok(scene_graph_delta)
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

    async fn delete_sketch(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.

        let mut new_ast = self.program.ast.clone();

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

        // Modify the AST to remove the sketch.
        self.mutate_ast(&mut new_ast, sketch_id, AstMutateCommand::DeleteNode)?;

        self.execute_after_edit(
            ctx,
            sketch,
            Default::default(),
            EditDeleteKind::DeleteSketch,
            &mut new_ast,
        )
        .await
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
            SegmentCtor::Arc(ctor) => self.add_arc(ctx, sketch, ctor).await,
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
        let mut segment_ids_edited = AhashIndexSet::with_capacity_and_hasher(segments.len(), Default::default());
        for segment in segments {
            segment_ids_edited.insert(segment.id);
            match segment.ctor {
                SegmentCtor::Point(ctor) => self.edit_point(&mut new_ast, sketch, segment.id, ctor)?,
                SegmentCtor::Line(ctor) => self.edit_line(&mut new_ast, sketch, segment.id, ctor)?,
                SegmentCtor::Arc(ctor) => self.edit_arc(&mut new_ast, sketch, segment.id, ctor)?,
                _ => {
                    return Err(Error {
                        msg: format!("segment ctor not implemented yet: {segment:?}"),
                    });
                }
            }
        }
        self.execute_after_edit(ctx, sketch, segment_ids_edited, EditDeleteKind::Edit, &mut new_ast)
            .await
    }

    async fn delete_objects(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
        constraint_ids: Vec<ObjectId>,
        segment_ids: Vec<ObjectId>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.

        // Deduplicate IDs.
        let mut constraint_ids_set = constraint_ids.into_iter().collect::<AhashIndexSet<_>>();
        let segment_ids_set = segment_ids.into_iter().collect::<AhashIndexSet<_>>();
        // Find constraints that reference the segments to be deleted, and add
        // those to the set to be deleted.
        self.add_dependent_constraints_to_delete(sketch, &segment_ids_set, &mut constraint_ids_set)?;

        let mut new_ast = self.program.ast.clone();
        for constraint_id in constraint_ids_set {
            self.delete_constraint(&mut new_ast, sketch, constraint_id)?;
        }
        for segment_id in segment_ids_set {
            self.delete_segment(&mut new_ast, sketch, segment_id)?;
        }
        self.execute_after_edit(
            ctx,
            sketch,
            Default::default(),
            EditDeleteKind::DeleteNonSketch,
            &mut new_ast,
        )
        .await
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
            Constraint::Distance(distance) => self.add_distance(sketch, distance, &mut new_ast).await?,
            Constraint::Horizontal(horizontal) => self.add_horizontal(sketch, horizontal, &mut new_ast).await?,
            Constraint::LinesEqualLength(lines_equal_length) => {
                self.add_lines_equal_length(sketch, lines_equal_length, &mut new_ast)
                    .await?
            }
            Constraint::Parallel(parallel) => self.add_parallel(sketch, parallel, &mut new_ast).await?,
            Constraint::Perpendicular(perpendicular) => {
                self.add_perpendicular(sketch, perpendicular, &mut new_ast).await?
            }
            Constraint::Vertical(vertical) => self.add_vertical(sketch, vertical, &mut new_ast).await?,
        };
        self.execute_after_add_constraint(ctx, sketch, sketch_block_range, &mut new_ast)
            .await
    }

    async fn chain_segment(
        &mut self,
        ctx: &ExecutorContext,
        version: Version,
        sketch: ObjectId,
        previous_segment_end_point_id: ObjectId,
        segment: SegmentCtor,
        _label: Option<String>,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.

        // First, add the segment (line) to get its start point ID
        let SegmentCtor::Line(line_ctor) = segment else {
            return Err(Error {
                msg: format!("chain_segment currently only supports Line segments, got: {segment:?}"),
            });
        };

        // Add the line segment first - this updates self.program and self.scene_graph
        let (_first_src_delta, first_scene_delta) = self.add_line(ctx, sketch, line_ctor).await?;

        // Find the new line's start point ID from the updated scene graph
        // add_line updates self.scene_graph, so we can use that
        let new_line_id = first_scene_delta
            .new_objects
            .iter()
            .find(|&obj_id| {
                let obj = self.scene_graph.objects.get(obj_id.0);
                if let Some(obj) = obj {
                    matches!(
                        &obj.kind,
                        ObjectKind::Segment {
                            segment: Segment::Line(_)
                        }
                    )
                } else {
                    false
                }
            })
            .ok_or_else(|| Error {
                msg: "Failed to find new line segment in scene graph".to_string(),
            })?;

        let new_line_obj = self.scene_graph.objects.get(new_line_id.0).ok_or_else(|| Error {
            msg: format!("New line object not found: {new_line_id:?}"),
        })?;

        let ObjectKind::Segment {
            segment: new_line_segment,
        } = &new_line_obj.kind
        else {
            return Err(Error {
                msg: format!("Object is not a segment: {new_line_obj:?}"),
            });
        };

        let Segment::Line(new_line) = new_line_segment else {
            return Err(Error {
                msg: format!("Segment is not a line: {new_line_segment:?}"),
            });
        };

        let new_line_start_point_id = new_line.start;

        // Now add the coincident constraint between the previous end point and the new line's start point.
        let coincident = Coincident {
            segments: vec![previous_segment_end_point_id, new_line_start_point_id],
        };

        let (final_src_delta, final_scene_delta) = self
            .add_constraint(ctx, version, sketch, Constraint::Coincident(coincident))
            .await?;

        // Combine new objects from the line addition and the constraint addition.
        // Both add_line and add_constraint now populate new_objects correctly.
        let mut combined_new_objects = first_scene_delta.new_objects.clone();
        combined_new_objects.extend(final_scene_delta.new_objects);

        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: combined_new_objects,
            exec_outcome: final_scene_delta.exec_outcome,
        };

        Ok((final_src_delta, scene_graph_delta))
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
}

impl FrontendState {
    pub async fn hack_set_program(
        &mut self,
        ctx: &ExecutorContext,
        program: Program,
    ) -> api::Result<(SceneGraph, ExecOutcome)> {
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

        let outcome = self.update_state_after_exec(outcome);

        Ok((self.scene_graph.clone(), outcome))
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
        let (sketch_block_range, _) = self.mutate_ast(
            &mut new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: point_ast },
        )?;
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

        // Truncate after the sketch block for mock execution.
        let mut truncated_program = new_program;
        self.exit_after_sketch_block(sketch, ChangeKind::Add, &mut truncated_program.ast)?;

        // Execute.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default().no_freedom_analysis())
            .await
            .map_err(|err| {
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
        let (sketch_block_range, _) = self.mutate_ast(
            &mut new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: line_ast },
        )?;
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

        // Truncate after the sketch block for mock execution.
        let mut truncated_program = new_program;
        self.exit_after_sketch_block(sketch, ChangeKind::Add, &mut truncated_program.ast)?;

        // Execute.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default().no_freedom_analysis())
            .await
            .map_err(|err| {
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

    async fn add_arc(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        ctor: ArcCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Create updated KCL source from args.
        let start_ast = to_ast_point2d(&ctor.start).map_err(|err| Error { msg: err.to_string() })?;
        let end_ast = to_ast_point2d(&ctor.end).map_err(|err| Error { msg: err.to_string() })?;
        let center_ast = to_ast_point2d(&ctor.center).map_err(|err| Error { msg: err.to_string() })?;
        let arguments = vec![
            ast::LabeledArg {
                label: Some(ast::Identifier::new(ARC_START_PARAM)),
                arg: start_ast,
            },
            ast::LabeledArg {
                label: Some(ast::Identifier::new(ARC_END_PARAM)),
                arg: end_ast,
            },
            ast::LabeledArg {
                label: Some(ast::Identifier::new(ARC_CENTER_PARAM)),
                arg: center_ast,
            },
        ];
        let arc_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(ARC_FN)),
            unlabeled: None,
            arguments,
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
        // Add the arc to the AST of the sketch block.
        let mut new_ast = self.program.ast.clone();
        let (sketch_block_range, _) = self.mutate_ast(
            &mut new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: arc_ast },
        )?;
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(&new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after adding arc: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after adding arc".to_string(),
            });
        };
        let arc_source_range =
            find_sketch_block_added_item(&new_program.ast, sketch_block_range).map_err(|err| Error {
                msg: format!("Source range of arc not found in sketch block: {sketch_block_range:?}; {err:?}"),
            })?;
        #[cfg(not(feature = "artifact-graph"))]
        let _ = arc_source_range;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Truncate after the sketch block for mock execution.
        let mut truncated_program = new_program;
        self.exit_after_sketch_block(sketch, ChangeKind::Add, &mut truncated_program.ast)?;

        // Execute.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default().no_freedom_analysis())
            .await
            .map_err(|err| {
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
                .get(&arc_source_range)
                .copied()
                .ok_or_else(|| Error {
                    msg: format!("Source range of arc not found: {arc_source_range:?}"),
                })?;
            let segment_object = outcome.scene_objects.get(segment_id.0).ok_or_else(|| Error {
                msg: format!("Segment not found: {segment_id:?}"),
            })?;
            let ObjectKind::Segment { segment } = &segment_object.kind else {
                return Err(Error {
                    msg: format!("Object is not a segment: {segment_object:?}"),
                });
            };
            let Segment::Arc(arc) = segment else {
                return Err(Error {
                    msg: format!("Segment is not an arc: {segment:?}"),
                });
            };
            vec![arc.start, arc.end, arc.center, segment_id]
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

        // If the point is part of a line or arc, edit the line/arc instead.
        if let Some(owner_id) = point.owner {
            let owner_object = self.scene_graph.objects.get(owner_id.0).ok_or_else(|| Error {
                msg: format!("Internal: Owner of point not found in scene graph: owner={owner_id:?}",),
            })?;
            let ObjectKind::Segment { segment } = &owner_object.kind else {
                return Err(Error {
                    msg: format!("Internal: Owner of point is not a segment: {owner_object:?}"),
                });
            };

            // Handle Line owner
            if let Segment::Line(line) = segment {
                let SegmentCtor::Line(line_ctor) = &line.ctor else {
                    return Err(Error {
                        msg: format!("Internal: Owner of point does not have line ctor: {owner_object:?}"),
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
                            "Internal: Point is not part of owner's line segment: point={point_id:?}, line={owner_id:?}"
                        ),
                    });
                }
                return self.edit_line(new_ast, sketch_id, owner_id, line_ctor);
            }

            // Handle Arc owner
            if let Segment::Arc(arc) = segment {
                let SegmentCtor::Arc(arc_ctor) = &arc.ctor else {
                    return Err(Error {
                        msg: format!("Internal: Owner of point does not have arc ctor: {owner_object:?}"),
                    });
                };
                let mut arc_ctor = arc_ctor.clone();
                // Which point of the arc is this? (center, start, or end)
                if arc.center == point_id {
                    arc_ctor.center = ctor.position;
                } else if arc.start == point_id {
                    arc_ctor.start = ctor.position;
                } else if arc.end == point_id {
                    arc_ctor.end = ctor.position;
                } else {
                    return Err(Error {
                        msg: format!(
                            "Internal: Point is not part of owner's arc segment: point={point_id:?}, arc={owner_id:?}"
                        ),
                    });
                }
                return self.edit_arc(new_ast, sketch_id, owner_id, arc_ctor);
            }

            // If owner is neither Line nor Arc, allow editing the point directly
            // (fall through to the point editing logic below)
        }

        // Modify the point AST.
        self.mutate_ast(new_ast, point_id, AstMutateCommand::EditPoint { at: new_at_ast })?;
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
        )?;
        Ok(())
    }

    fn edit_arc(
        &mut self,
        new_ast: &mut ast::Node<ast::Program>,
        sketch: ObjectId,
        arc: ObjectId,
        ctor: ArcCtor,
    ) -> api::Result<()> {
        // Create updated KCL source from args.
        let new_start_ast = to_ast_point2d(&ctor.start).map_err(|err| Error { msg: err.to_string() })?;
        let new_end_ast = to_ast_point2d(&ctor.end).map_err(|err| Error { msg: err.to_string() })?;
        let new_center_ast = to_ast_point2d(&ctor.center).map_err(|err| Error { msg: err.to_string() })?;

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
        sketch.segments.iter().find(|o| **o == arc).ok_or_else(|| Error {
            msg: format!("Arc not found in sketch: arc={arc:?}, sketch={sketch:?}"),
        })?;
        // Look up existing arc.
        let arc_id = arc;
        let arc_object = self.scene_graph.objects.get(arc_id.0).ok_or_else(|| Error {
            msg: format!("Arc not found in scene graph: arc={arc:?}"),
        })?;
        let ObjectKind::Segment { .. } = &arc_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {arc_object:?}"),
            });
        };

        // Modify the arc AST.
        self.mutate_ast(
            new_ast,
            arc_id,
            AstMutateCommand::EditArc {
                start: new_start_ast,
                end: new_end_ast,
                center: new_center_ast,
            },
        )?;
        Ok(())
    }

    fn delete_segment(
        &mut self,
        new_ast: &mut ast::Node<ast::Program>,
        sketch: ObjectId,
        segment_id: ObjectId,
    ) -> api::Result<()> {
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
        sketch
            .segments
            .iter()
            .find(|o| **o == segment_id)
            .ok_or_else(|| Error {
                msg: format!("Segment not found in sketch: segment={segment_id:?}, sketch={sketch:?}"),
            })?;
        // Look up existing segment.
        let segment_object = self.scene_graph.objects.get(segment_id.0).ok_or_else(|| Error {
            msg: format!("Segment not found in scene graph: segment={segment_id:?}"),
        })?;
        let ObjectKind::Segment { .. } = &segment_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {segment_object:?}"),
            });
        };

        // Modify the AST to remove the segment.
        self.mutate_ast(new_ast, segment_id, AstMutateCommand::DeleteNode)?;
        Ok(())
    }

    fn delete_constraint(
        &mut self,
        new_ast: &mut ast::Node<ast::Program>,
        sketch: ObjectId,
        constraint_id: ObjectId,
    ) -> api::Result<()> {
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
        sketch
            .constraints
            .iter()
            .find(|o| **o == constraint_id)
            .ok_or_else(|| Error {
                msg: format!("Constraint not found in sketch: constraint={constraint_id:?}, sketch={sketch:?}"),
            })?;
        // Look up existing constraint.
        let constraint_object = self.scene_graph.objects.get(constraint_id.0).ok_or_else(|| Error {
            msg: format!("Constraint not found in scene graph: constraint={constraint_id:?}"),
        })?;
        let ObjectKind::Constraint { .. } = &constraint_object.kind else {
            return Err(Error {
                msg: format!("Object is not a constraint: {constraint_object:?}"),
            });
        };

        // Modify the AST to remove the constraint.
        self.mutate_ast(new_ast, constraint_id, AstMutateCommand::DeleteNode)?;
        Ok(())
    }

    async fn execute_after_edit(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        segment_ids_edited: AhashIndexSet<ObjectId>,
        edit_kind: EditDeleteKind,
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

        // Truncate after the sketch block for mock execution.
        let is_delete = edit_kind.is_delete();
        let truncated_program = match edit_kind {
            EditDeleteKind::DeleteSketch => new_program,
            EditDeleteKind::Edit | EditDeleteKind::DeleteNonSketch => {
                let mut truncated_program = new_program;
                self.exit_after_sketch_block(sketch, edit_kind.to_change_kind(), &mut truncated_program.ast)?;
                truncated_program
            }
        };

        #[cfg(not(feature = "artifact-graph"))]
        drop(segment_ids_edited);

        // Execute.
        let mock_config = MockConfig {
            freedom_analysis: is_delete,
            #[cfg(feature = "artifact-graph")]
            segment_ids_edited,
            ..Default::default()
        };
        let outcome = ctx.run_mock(&truncated_program, &mock_config).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        let outcome = self.update_state_after_exec(outcome);

        #[cfg(feature = "artifact-graph")]
        let new_source = {
            // Feed back sketch var solutions into the source.
            //
            // The interpreter is returning all var solutions from the sketch
            // block we're editing.
            let mut new_ast = self.program.ast.clone();
            for (var_range, value) in &outcome.var_solutions {
                let rounded = value.round(3);
                mutate_ast_node_by_source_range(
                    &mut new_ast,
                    *var_range,
                    AstMutateCommand::EditVarInitialValue { value: rounded },
                )?;
            }
            source_from_ast(&new_ast)
        };

        let src_delta = SourceDelta { text: new_source };
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: is_delete,
            new_objects: Vec::new(),
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    /// Map a point object id into an AST reference expression for use in
    /// constraints. If the point is owned by a segment (line or arc), we
    /// reference the appropriate property on that segment (e.g. `line1.start`,
    /// `arc1.center`). Otherwise we reference the point directly.
    fn point_id_to_ast_reference(
        &self,
        point_id: ObjectId,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<ast::Expr> {
        let point_object = self.scene_graph.objects.get(point_id.0).ok_or_else(|| Error {
            msg: format!("Point not found: {point_id:?}"),
        })?;
        let ObjectKind::Segment { segment: point_segment } = &point_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {point_object:?}"),
            });
        };
        let Segment::Point(point) = point_segment else {
            return Err(Error {
                msg: format!("Only points are currently supported: {point_object:?}"),
            });
        };

        if let Some(owner_id) = point.owner {
            let owner_object = self.scene_graph.objects.get(owner_id.0).ok_or_else(|| Error {
                msg: format!("Owner of point not found in scene graph: point={point_id:?}, owner={owner_id:?}"),
            })?;
            let ObjectKind::Segment { segment: owner_segment } = &owner_object.kind else {
                return Err(Error {
                    msg: format!("Owner of point is not a segment: {owner_object:?}"),
                });
            };

            match owner_segment {
                Segment::Line(line) => {
                    let property = if line.start == point_id {
                        LINE_PROPERTY_START
                    } else if line.end == point_id {
                        LINE_PROPERTY_END
                    } else {
                        return Err(Error {
                            msg: format!(
                                "Internal: Point is not part of owner's line segment: point={point_id:?}, line={owner_id:?}"
                            ),
                        });
                    };
                    get_or_insert_ast_reference(new_ast, &owner_object.source, "line", Some(property))
                }
                Segment::Arc(arc) => {
                    let property = if arc.start == point_id {
                        ARC_PROPERTY_START
                    } else if arc.end == point_id {
                        ARC_PROPERTY_END
                    } else if arc.center == point_id {
                        ARC_PROPERTY_CENTER
                    } else {
                        return Err(Error {
                            msg: format!(
                                "Internal: Point is not part of owner's arc segment: point={point_id:?}, arc={owner_id:?}"
                            ),
                        });
                    };
                    get_or_insert_ast_reference(new_ast, &owner_object.source, "arc", Some(property))
                }
                _ => Err(Error {
                    msg: format!(
                        "Internal: Owner of point is not a supported segment type for constraints: {owner_segment:?}"
                    ),
                }),
            }
        } else {
            // Standalone point.
            get_or_insert_ast_reference(new_ast, &point_object.source, "point", None)
        }
    }

    async fn add_coincident(
        &mut self,
        sketch: ObjectId,
        coincident: Coincident,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let &[seg0_id, seg1_id] = coincident.segments.as_slice() else {
            return Err(Error {
                msg: format!(
                    "Coincident constraint must have exactly 2 segments, got {}",
                    coincident.segments.len()
                ),
            });
        };
        let sketch_id = sketch;

        // Get AST reference for first object (point or segment)
        let seg0_object = self.scene_graph.objects.get(seg0_id.0).ok_or_else(|| Error {
            msg: format!("Object not found: {seg0_id:?}"),
        })?;
        let ObjectKind::Segment { segment: seg0_segment } = &seg0_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {seg0_object:?}"),
            });
        };
        let seg0_ast = match seg0_segment {
            Segment::Point(_) => {
                // Use the helper function which supports both Line and Arc owners
                self.point_id_to_ast_reference(seg0_id, new_ast)?
            }
            Segment::Line(_) => {
                // Reference the segment directly (for point-segment coincident)
                get_or_insert_ast_reference(new_ast, &seg0_object.source, "line", None)?
            }
            Segment::Arc(_) | Segment::Circle(_) => {
                // Reference the segment directly (for point-arc coincident)
                get_or_insert_ast_reference(new_ast, &seg0_object.source, "arc", None)?
            }
        };

        // Get AST reference for second object (point or segment)
        let seg1_object = self.scene_graph.objects.get(seg1_id.0).ok_or_else(|| Error {
            msg: format!("Object not found: {seg1_id:?}"),
        })?;
        let ObjectKind::Segment { segment: seg1_segment } = &seg1_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {seg1_object:?}"),
            });
        };
        let seg1_ast = match seg1_segment {
            Segment::Point(_) => {
                // Use the helper function which supports both Line and Arc owners
                self.point_id_to_ast_reference(seg1_id, new_ast)?
            }
            Segment::Line(_) => {
                // Reference the segment directly (for point-segment coincident)
                get_or_insert_ast_reference(new_ast, &seg1_object.source, "line", None)?
            }
            Segment::Arc(_) | Segment::Circle(_) => {
                // Reference the segment directly (for point-arc coincident)
                get_or_insert_ast_reference(new_ast, &seg1_object.source, "arc", None)?
            }
        };

        // Create the coincident() call.
        let coincident_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(COINCIDENT_FN)),
            unlabeled: Some(ast::Expr::ArrayExpression(Box::new(ast::Node::no_src(
                ast::ArrayExpression {
                    elements: vec![seg0_ast, seg1_ast],
                    digest: None,
                    non_code_meta: Default::default(),
                },
            )))),
            arguments: Default::default(),
            digest: None,
            non_code_meta: Default::default(),
        })));

        // Add the line to the AST of the sketch block.
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: coincident_ast },
        )?;
        Ok(sketch_block_range)
    }

    async fn add_distance(
        &mut self,
        sketch: ObjectId,
        distance: Distance,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let &[pt0_id, pt1_id] = distance.points.as_slice() else {
            return Err(Error {
                msg: format!(
                    "Distance constraint must have exactly 2 points, got {}",
                    distance.points.len()
                ),
            });
        };
        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
        let pt0_ast = self.point_id_to_ast_reference(pt0_id, new_ast)?;
        let pt1_ast = self.point_id_to_ast_reference(pt1_id, new_ast)?;

        // Create the distance() call.
        let distance_call_ast = ast::BinaryPart::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(DISTANCE_FN)),
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
        let distance_ast = ast::Expr::BinaryExpression(Box::new(ast::Node::no_src(ast::BinaryExpression {
            left: distance_call_ast,
            operator: ast::BinaryOperator::Eq,
            right: ast::BinaryPart::Literal(Box::new(ast::Node::no_src(ast::Literal {
                value: ast::LiteralValue::Number {
                    value: distance.distance.value,
                    suffix: distance.distance.units,
                },
                raw: format_number_literal(distance.distance.value, distance.distance.units).map_err(|_| Error {
                    msg: format!("Could not format numeric suffix: {:?}", distance.distance.units),
                })?,
                digest: None,
            }))),
            digest: None,
        })));

        // Add the line to the AST of the sketch block.
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: distance_ast },
        )?;
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
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: horizontal_ast },
        )?;
        Ok(sketch_block_range)
    }

    async fn add_lines_equal_length(
        &mut self,
        sketch: ObjectId,
        lines_equal_length: LinesEqualLength,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let &[line0_id, line1_id] = lines_equal_length.lines.as_slice() else {
            return Err(Error {
                msg: format!(
                    "Lines equal length constraint must have exactly 2 lines, got {}",
                    lines_equal_length.lines.len()
                ),
            });
        };

        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
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
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: equal_length_ast },
        )?;
        Ok(sketch_block_range)
    }

    async fn add_parallel(
        &mut self,
        sketch: ObjectId,
        parallel: Parallel,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        self.add_lines_at_angle_constraint(sketch, LinesAtAngleKind::Parallel, parallel.lines, new_ast)
            .await
    }

    async fn add_perpendicular(
        &mut self,
        sketch: ObjectId,
        perpendicular: Perpendicular,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        self.add_lines_at_angle_constraint(sketch, LinesAtAngleKind::Perpendicular, perpendicular.lines, new_ast)
            .await
    }

    async fn add_lines_at_angle_constraint(
        &mut self,
        sketch: ObjectId,
        angle_kind: LinesAtAngleKind,
        lines: Vec<ObjectId>,
        new_ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<SourceRange> {
        let &[line0_id, line1_id] = lines.as_slice() else {
            return Err(Error {
                msg: format!(
                    "{} constraint must have exactly 2 lines, got {}",
                    angle_kind.to_function_name(),
                    lines.len()
                ),
            });
        };

        let sketch_id = sketch;

        // Map the runtime objects back to variable names.
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
                msg: format!(
                    "Only lines can be made {}: {line0_object:?}",
                    angle_kind.to_function_name()
                ),
            });
        };
        let line0_ast = get_or_insert_ast_reference(new_ast, &line0_object.source.clone(), "line", None)?;

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
                msg: format!(
                    "Only lines can be made {}: {line1_object:?}",
                    angle_kind.to_function_name()
                ),
            });
        };
        let line1_ast = get_or_insert_ast_reference(new_ast, &line1_object.source.clone(), "line", None)?;

        // Create the parallel() or perpendicular() call.
        let call_ast = ast::Expr::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
            callee: ast::Node::no_src(ast_sketch2_name(angle_kind.to_function_name())),
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
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: call_ast },
        )?;
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
        let (sketch_block_range, _) = self.mutate_ast(
            new_ast,
            sketch_id,
            AstMutateCommand::AddSketchBlockExprStmt { expr: vertical_ast },
        )?;
        Ok(sketch_block_range)
    }

    async fn execute_after_add_constraint(
        &mut self,
        ctx: &ExecutorContext,
        sketch_id: ObjectId,
        #[cfg_attr(not(feature = "artifact-graph"), allow(unused_variables))] sketch_block_range: SourceRange,
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
        #[cfg(feature = "artifact-graph")]
        let constraint_source_range =
            find_sketch_block_added_item(&new_program.ast, sketch_block_range).map_err(|err| Error {
                msg: format!(
                    "Source range of new constraint not found in sketch block: {sketch_block_range:?}; {err:?}"
                ),
            })?;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Truncate after the sketch block for mock execution.
        let mut truncated_program = new_program;
        self.exit_after_sketch_block(sketch_id, ChangeKind::Add, &mut truncated_program.ast)?;

        // Execute.
        let outcome = ctx
            .run_mock(&truncated_program, &MockConfig::default())
            .await
            .map_err(|err| {
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
            // Extract the constraint ID from the execution outcome using source_range_to_object
            let constraint_id = outcome
                .source_range_to_object
                .get(&constraint_source_range)
                .copied()
                .ok_or_else(|| Error {
                    msg: format!("Source range of constraint not found: {constraint_source_range:?}"),
                })?;
            vec![constraint_id]
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

    // Find constraints that reference the given segments to be deleted, and add
    // those to the constraint set to be deleted for cascading delete.
    fn add_dependent_constraints_to_delete(
        &self,
        sketch_id: ObjectId,
        segment_ids_set: &AhashIndexSet<ObjectId>,
        constraint_ids_set: &mut AhashIndexSet<ObjectId>,
    ) -> api::Result<()> {
        // Look up the sketch.
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch_id:?}"),
        })?;
        let ObjectKind::Sketch(sketch) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        for constraint_id in &sketch.constraints {
            let constraint_object = self.scene_graph.objects.get(constraint_id.0).ok_or_else(|| Error {
                msg: format!("Constraint not found: {constraint_id:?}"),
            })?;
            let ObjectKind::Constraint { constraint } = &constraint_object.kind else {
                return Err(Error {
                    msg: format!("Object is not a constraint: {constraint_object:?}"),
                });
            };
            let depends_on_segment = match constraint {
                Constraint::Coincident(c) => c.segments.iter().any(|pt_id| {
                    if segment_ids_set.contains(pt_id) {
                        return true;
                    }
                    let pt_object = self.scene_graph.objects.get(pt_id.0);
                    if let Some(obj) = pt_object
                        && let ObjectKind::Segment { segment } = &obj.kind
                        && let Segment::Point(pt) = segment
                        && let Some(owner_line_id) = pt.owner
                    {
                        return segment_ids_set.contains(&owner_line_id);
                    }
                    false
                }),
                Constraint::Distance(d) => d.points.iter().any(|pt_id| {
                    let pt_object = self.scene_graph.objects.get(pt_id.0);
                    if let Some(obj) = pt_object
                        && let ObjectKind::Segment { segment } = &obj.kind
                        && let Segment::Point(pt) = segment
                        && let Some(owner_line_id) = pt.owner
                    {
                        return segment_ids_set.contains(&owner_line_id);
                    }
                    false
                }),
                Constraint::Horizontal(h) => segment_ids_set.contains(&h.line),
                Constraint::Vertical(v) => segment_ids_set.contains(&v.line),
                Constraint::LinesEqualLength(lines_equal_length) => lines_equal_length
                    .lines
                    .iter()
                    .any(|line_id| segment_ids_set.contains(line_id)),
                Constraint::Parallel(parallel) => {
                    parallel.lines.iter().any(|line_id| segment_ids_set.contains(line_id))
                }
                Constraint::Perpendicular(perpendicular) => perpendicular
                    .lines
                    .iter()
                    .any(|line_id| segment_ids_set.contains(line_id)),
            };
            if depends_on_segment {
                constraint_ids_set.insert(*constraint_id);
            }
        }
        Ok(())
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

    fn exit_after_sketch_block(
        &self,
        sketch_id: ObjectId,
        edit_kind: ChangeKind,
        ast: &mut ast::Node<ast::Program>,
    ) -> api::Result<()> {
        let sketch_object = self.scene_graph.objects.get(sketch_id.0).ok_or_else(|| Error {
            msg: format!("Sketch not found: {sketch_id:?}"),
        })?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            return Err(Error {
                msg: format!("Object is not a sketch: {sketch_object:?}"),
            });
        };
        let sketch_block_range = expect_single_source_range(&sketch_object.source)?;
        exit_after_sketch_block(ast, sketch_block_range, edit_kind)
    }

    fn mutate_ast(
        &mut self,
        ast: &mut ast::Node<ast::Program>,
        object_id: ObjectId,
        command: AstMutateCommand,
    ) -> api::Result<(SourceRange, AstMutateCommandReturn)> {
        let sketch_object = self.scene_graph.objects.get(object_id.0).ok_or_else(|| Error {
            msg: format!("Object not found: {object_id:?}"),
        })?;
        match &sketch_object.source {
            SourceRef::Simple { range } => mutate_ast_node_by_source_range(ast, *range, command),
            SourceRef::BackTrace { .. } => Err(Error {
                msg: "BackTrace source refs not supported yet".to_owned(),
            }),
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

fn exit_after_sketch_block(
    ast: &mut ast::Node<ast::Program>,
    sketch_block_range: SourceRange,
    edit_kind: ChangeKind,
) -> api::Result<()> {
    let r1 = sketch_block_range;
    let matches_range = |r2: SourceRange| -> bool {
        // We may have added items to the sketch block, so the end may not be an
        // exact match.
        match edit_kind {
            ChangeKind::Add => r1.module_id() == r2.module_id() && r1.start() == r2.start() && r1.end() <= r2.end(),
            // For edit, we don't know whether it grew or shrank.
            ChangeKind::Edit => r1.module_id() == r2.module_id() && r1.start() == r2.start(),
            ChangeKind::Delete => r1.module_id() == r2.module_id() && r1.start() == r2.start() && r1.end() >= r2.end(),
            // No edit should be an exact match.
            ChangeKind::None => r1.module_id() == r2.module_id() && r1.start() == r2.start() && r1.end() == r2.end(),
        }
    };
    let mut found = false;
    for item in ast.body.iter_mut() {
        match item {
            ast::BodyItem::ImportStatement(_) => {}
            ast::BodyItem::ExpressionStatement(node) => {
                if matches_range(SourceRange::from(&*node))
                    && let ast::Expr::SketchBlock(sketch_block) = &mut node.expression
                {
                    sketch_block.is_being_edited = true;
                    found = true;
                    break;
                }
            }
            ast::BodyItem::VariableDeclaration(node) => {
                if matches_range(SourceRange::from(&node.declaration.init))
                    && let ast::Expr::SketchBlock(sketch_block) = &mut node.declaration.init
                {
                    sketch_block.is_being_edited = true;
                    found = true;
                    break;
                }
            }
            ast::BodyItem::TypeDeclaration(_) => {}
            ast::BodyItem::ReturnStatement(node) => {
                if matches_range(SourceRange::from(&node.argument))
                    && let ast::Expr::SketchBlock(sketch_block) = &mut node.argument
                {
                    sketch_block.is_being_edited = true;
                    found = true;
                    break;
                }
            }
        }
    }
    if !found {
        return Err(Error {
            msg: format!("Sketch block source range not found in AST: {sketch_block_range:?}, edit_kind={edit_kind:?}"),
        });
    }

    Ok(())
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
    let (_, ret) = mutate_ast_node_by_source_range(ast, range, command)?;
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
) -> Result<(SourceRange, AstMutateCommandReturn), Error> {
    let mut context = AstMutateContext {
        source_range,
        command,
        defined_names_stack: Default::default(),
    };
    let control = dfs_mut(ast, &mut context);
    match control {
        ControlFlow::Continue(_) => Err(Error {
            msg: format!("Source range not found: {source_range:?}"),
        }),
        ControlFlow::Break(break_value) => break_value,
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
    EditArc {
        start: ast::Expr,
        end: ast::Expr,
        center: ast::Expr,
    },
    #[cfg(feature = "artifact-graph")]
    EditVarInitialValue {
        value: Number,
    },
    DeleteNode,
}

#[derive(Debug)]
enum AstMutateCommandReturn {
    None,
    Name(String),
}

impl Visitor for AstMutateContext {
    type Break = Result<(SourceRange, AstMutateCommandReturn), Error>;
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
) -> TraversalReturn<Result<(SourceRange, AstMutateCommandReturn), Error>> {
    let Ok(node_range) = SourceRange::try_from(&node) else {
        // Nodes that can't be converted to a range aren't interesting.
        return TraversalReturn::new_continue(());
    };
    // If we're adding a variable declaration, we need to look at variable
    // declaration expressions to see if it already has a variable, before
    // continuing. The variable declaration's source range won't match the
    // target; its init expression will.
    if let NodeMut::VariableDeclaration(var_decl) = &node {
        let expr_range = SourceRange::from(&var_decl.declaration.init);
        if expr_range == ctx.source_range {
            if let AstMutateCommand::AddVariableDeclaration { .. } = &ctx.command {
                // We found the variable declaration expression. It doesn't need
                // to be added.
                return TraversalReturn::new_break(Ok((
                    node_range,
                    AstMutateCommandReturn::Name(var_decl.name().to_owned()),
                )));
            }
            if let AstMutateCommand::DeleteNode = &ctx.command {
                // We found the variable declaration. Delete the variable along
                // with the segment.
                return TraversalReturn {
                    mutate_body_item: MutateBodyItem::Delete,
                    control_flow: ControlFlow::Break(Ok((ctx.source_range, AstMutateCommandReturn::None))),
                };
            }
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
    process(ctx, node).map_break(|result| result.map(|cmd_return| (ctx.source_range, cmd_return)))
}

fn process(ctx: &AstMutateContext, node: NodeMut) -> TraversalReturn<Result<AstMutateCommandReturn, Error>> {
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
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
            }
        }
        AstMutateCommand::AddVariableDeclaration { prefix } => {
            if let NodeMut::VariableDeclaration(inner) = node {
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::Name(inner.name().to_owned())));
            }
            if let NodeMut::ExpressionStatement(expr_stmt) = node {
                let empty_defined_names = HashSet::new();
                let defined_names = ctx.defined_names_stack.last().unwrap_or(&empty_defined_names);
                let Ok(name) = next_free_name(prefix, defined_names) else {
                    // TODO: Return an error instead?
                    return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
                };
                let mutate_node =
                    ast::BodyItem::VariableDeclaration(Box::new(ast::Node::no_src(ast::VariableDeclaration::new(
                        ast::VariableDeclarator::new(&name, expr_stmt.expression.clone()),
                        ast::ItemVisibility::Default,
                        ast::VariableKind::Const,
                    ))));
                return TraversalReturn {
                    mutate_body_item: MutateBodyItem::Mutate(Box::new(mutate_node)),
                    control_flow: ControlFlow::Break(Ok(AstMutateCommandReturn::Name(name))),
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
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
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
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
            }
        }
        AstMutateCommand::EditArc { start, end, center } => {
            if let NodeMut::CallExpressionKw(call) = node {
                if call.callee.name.name != ARC_FN {
                    return TraversalReturn::new_continue(());
                }
                // Update the arguments.
                for labeled_arg in &mut call.arguments {
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(ARC_START_PARAM) {
                        labeled_arg.arg = start.clone();
                    }
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(ARC_END_PARAM) {
                        labeled_arg.arg = end.clone();
                    }
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(ARC_CENTER_PARAM) {
                        labeled_arg.arg = center.clone();
                    }
                }
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
            }
        }
        #[cfg(feature = "artifact-graph")]
        AstMutateCommand::EditVarInitialValue { value } => {
            if let NodeMut::NumericLiteral(numeric_literal) = node {
                // Update the initial value.
                let Ok(literal) = to_source_number(*value) else {
                    return TraversalReturn::new_break(Err(Error {
                        msg: format!("Could not convert number to AST literal: {:?}", *value),
                    }));
                };
                *numeric_literal = ast::Node::no_src(literal);
                return TraversalReturn::new_break(Ok(AstMutateCommandReturn::None));
            }
        }
        AstMutateCommand::DeleteNode => {
            return TraversalReturn {
                mutate_body_item: MutateBodyItem::Delete,
                control_flow: ControlFlow::Break(Ok(AstMutateCommandReturn::None)),
            };
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
        front::{Distance, Plane, Sketch},
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

        mock_ctx.close().await;
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

        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_new_sketch_add_arc_edit_arc() {
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

        let arc_ctor = ArcCtor {
            start: Point2d {
                x: Expr::Var(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
            },
            end: Point2d {
                x: Expr::Var(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
            },
            center: Point2d {
                x: Expr::Var(Number {
                    value: 10.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 0.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segment = SegmentCtor::Arc(arc_ctor);
        let (src_delta, scene_delta) = frontend
            .add_segment(&mock_ctx, version, sketch_id, segment, None)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::arc(start = [var 0mm, var 0mm], end = [var 10mm, var 10mm], center = [var 10mm, var 0mm])
}
"
        );
        assert_eq!(
            scene_delta.new_objects,
            vec![ObjectId(1), ObjectId(2), ObjectId(3), ObjectId(4)]
        );
        for (i, scene_object) in scene_delta.new_graph.objects.iter().enumerate() {
            assert_eq!(scene_object.id.0, i);
        }
        assert_eq!(scene_delta.new_graph.objects.len(), 5);

        // The new objects are the end points, the center, and then the arc.
        let arc = *scene_delta.new_objects.last().unwrap();

        let arc_ctor = ArcCtor {
            start: Point2d {
                x: Expr::Var(Number {
                    value: 1.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 2.0,
                    units: NumericSuffix::Mm,
                }),
            },
            end: Point2d {
                x: Expr::Var(Number {
                    value: 13.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 14.0,
                    units: NumericSuffix::Mm,
                }),
            },
            center: Point2d {
                x: Expr::Var(Number {
                    value: 13.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 2.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: arc,
            ctor: SegmentCtor::Arc(arc_ctor),
        }];
        let (src_delta, scene_delta) = frontend
            .edit_segments(&mock_ctx, version, sketch_id, segments)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::arc(start = [var 1mm, var 2mm], end = [var 13mm, var 14mm], center = [var 13mm, var 2mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 5);

        mock_ctx.close().await;
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

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_new_sketch_add_line_delete_sketch() {
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
        assert_eq!(scene_delta.new_graph.objects.len(), 4);

        let (src_delta, scene_delta) = frontend.delete_sketch(&mock_ctx, version, sketch_id).await.unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)
"
        );
        assert_eq!(scene_delta.new_graph.objects.len(), 0);

        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_sketch_when_sketch_block_uses_variable() {
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

        let (src_delta, scene_delta) = frontend.delete_sketch(&mock_ctx, version, sketch_id).await.unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "@settings(experimentalFeatures = allow)
"
        );
        assert_eq!(scene_delta.new_graph.objects.len(), 0);

        ctx.close().await;
        mock_ctx.close().await;
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
  sketch2::line(start = [var 127mm, var 152.4mm], end = [var 3mm, var 4mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);

        ctx.close().await;
        mock_ctx.close().await;
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
  sketch2::line(start = [var 1mm, var 2mm], end = [var 127mm, var 152.4mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_edit_line_with_coincident_feedback() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 1, var 2])
  line2 = sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
  line1.start.at[0] == 0
  line1.start.at[1] == 0
  sketch2::coincident([line1.end, line2.start])
  sketch2::equalLength([line1, line2])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line2_end_id = frontend.scene_graph.objects.get(5).unwrap().id;

        let segments = vec![ExistingSegmentCtor {
            id: line2_end_id,
            ctor: SegmentCtor::Point(PointCtor {
                position: Point2d {
                    x: Expr::Var(Number {
                        value: 9.0,
                        units: NumericSuffix::None,
                    }),
                    y: Expr::Var(Number {
                        value: 10.0,
                        units: NumericSuffix::None,
                    }),
                },
            }),
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
  line1 = sketch2::line(start = [var -0mm, var -0mm], end = [var 4.145mm, var 5.32mm])
  line2 = sketch2::line(start = [var 4.145mm, var 5.32mm], end = [var 9mm, var 10mm])
line1.start.at[0] == 0
line1.start.at[1] == 0
  sketch2::coincident([line1.end, line2.start])
  sketch2::equalLength([line1, line2])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            9,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_point_without_var() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1, var 2])
  sketch2::point(at = [var 3, var 4])
  sketch2::point(at = [var 5, var 6])
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

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, Vec::new(), vec![point_id])
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1mm, var 2mm])
  sketch2::point(at = [var 5mm, var 6mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 3);

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_point_with_var() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1, var 2])
  point1 = sketch2::point(at = [var 3, var 4])
  sketch2::point(at = [var 5, var 6])
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

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, Vec::new(), vec![point_id])
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1mm, var 2mm])
  sketch2::point(at = [var 5mm, var 6mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 3);

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_multiple_points() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1, var 2])
  point1 = sketch2::point(at = [var 3, var 4])
  sketch2::point(at = [var 5, var 6])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;

        let point1_id = frontend.scene_graph.objects.get(1).unwrap().id;
        let point2_id = frontend.scene_graph.objects.get(2).unwrap().id;

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, Vec::new(), vec![point1_id, point2_id])
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 5mm, var 6mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 2);

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_coincident_constraint() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1, var 2])
  point2 = sketch2::point(at = [var 3, var 4])
  sketch2::coincident([point1, point2])
  sketch2::point(at = [var 5, var 6])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;

        let coincident_id = frontend.scene_graph.objects.get(3).unwrap().id;

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, vec![coincident_id], Vec::new())
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1mm, var 2mm])
  point2 = sketch2::point(at = [var 3mm, var 4mm])
  sketch2::point(at = [var 5mm, var 6mm])
}
"
        );
        assert_eq!(scene_delta.new_objects, vec![]);
        assert_eq!(scene_delta.new_graph.objects.len(), 4);

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_line_cascades_to_coincident_constraint() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  line2 = sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
  sketch2::coincident([line1.end, line2.start])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line_id = frontend.scene_graph.objects.get(6).unwrap().id;

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, Vec::new(), vec![line_id])
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 3mm, var 4mm])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            4,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_delete_line_cascades_to_distance_constraint() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1, var 2], end = [var 3, var 4])
  line2 = sketch2::line(start = [var 5, var 6], end = [var 7, var 8])
  sketch2::distance([line1.end, line2.start]) == 10mm
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let line_id = frontend.scene_graph.objects.get(6).unwrap().id;

        let (src_delta, scene_delta) = frontend
            .delete_objects(&mock_ctx, version, sketch_id, Vec::new(), vec![line_id])
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 3mm, var 4mm])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            4,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_two_points_coincident() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1, var 2])
  sketch2::point(at = [3, 4])
}
";

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
            segments: vec![point0_id, point1_id],
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
  point1 = sketch2::point(at = [var 1, var 2])
  point2 = sketch2::point(at = [3, 4])
  sketch2::coincident([point1, point2])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            4,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
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
            segments: vec![point0_id, point1_id],
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

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_distance_two_points() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  sketch2::point(at = [var 1, var 2])
  sketch2::point(at = [var 3, var 4])
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_id = frontend.scene_graph.objects.first().unwrap().id;
        let point0_id = frontend.scene_graph.objects.get(1).unwrap().id;
        let point1_id = frontend.scene_graph.objects.get(2).unwrap().id;

        let constraint = Constraint::Distance(Distance {
            points: vec![point0_id, point1_id],
            distance: Number {
                value: 2.0,
                units: NumericSuffix::Mm,
            },
        });
        let (src_delta, scene_delta) = frontend
            .add_constraint(&mock_ctx, version, sketch_id, constraint)
            .await
            .unwrap();
        assert_eq!(
            src_delta.text.as_str(),
            // The lack indentation is a formatter bug.
            "\
@settings(experimentalFeatures = allow)

sketch(on = XY) {
  point1 = sketch2::point(at = [var 1, var 2])
  point2 = sketch2::point(at = [var 3, var 4])
sketch2::distance([point1, point2]) == 2mm
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            4,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
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

        ctx.close().await;
        mock_ctx.close().await;
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

        ctx.close().await;
        mock_ctx.close().await;
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

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_lines_parallel() {
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

        let constraint = Constraint::Parallel(Parallel {
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
  sketch2::parallel([line1, line2])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            8,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_lines_perpendicular() {
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

        let constraint = Constraint::Perpendicular(Perpendicular {
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
  sketch2::perpendicular([line1, line2])
}
"
        );
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            8,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        ctx.close().await;
        mock_ctx.close().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_multiple_sketch_blocks() {
        let initial_source = "\
@settings(experimentalFeatures = allow)

// Cube that requires the engine.
width = 2
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = width, tag = $seg1)
  |> xLine(length = width)
  |> yLine(length = -width)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = width)

// Get a value that requires the engine.
x = segLen(seg1)

// Triangle with side length 2*x.
sketch(on = XY) {
  line1 = sketch2::line(start = [var 0.14mm, var 0.86mm], end = [var 1.283mm, var -0.781mm])
  line2 = sketch2::line(start = [var 1.283mm, var -0.781mm], end = [var -0.71mm, var -0.95mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -0.71mm, var -0.95mm], end = [var 0.14mm, var 0.86mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::coincident([line3.end, line1.start])
  sketch2::equalLength([line3, line1])
  sketch2::equalLength([line1, line2])
sketch2::distance([line1.start, line1.end]) == 2*x
}

// Line segment with length x.
sketch2 = sketch(on = XY) {
  line1 = sketch2::line(start = [var 0.14mm, var 0.86mm], end = [var 1.283mm, var -0.781mm])
sketch2::distance([line1.start, line1.end]) == x
}
";

        let program = Program::parse(initial_source).unwrap().0.unwrap();

        let mut frontend = FrontendState::new();

        let ctx = ExecutorContext::new_with_default_client().await.unwrap();
        let mock_ctx = ExecutorContext::new_mock(None).await;
        let version = Version(0);
        let project_id = ProjectId(0);
        let file_id = FileId(0);

        frontend.hack_set_program(&ctx, program).await.unwrap();
        let sketch_objects = frontend
            .scene_graph
            .objects
            .iter()
            .filter(|obj| matches!(obj.kind, ObjectKind::Sketch(_)))
            .collect::<Vec<_>>();
        let sketch1_id = sketch_objects.first().unwrap().id;
        let sketch2_id = sketch_objects.get(1).unwrap().id;
        // First point in sketch1.
        let point1_id = ObjectId(sketch1_id.0 + 1);
        // First point in sketch2.
        let point2_id = ObjectId(sketch2_id.0 + 1);

        // Edit the first sketch. Objects from the second sketch should not be
        // present since the program exits early after the first sketch block.
        //
        // - Plane 1
        // - Sketch block 16
        let scene_delta = frontend
            .edit_sketch(&mock_ctx, project_id, file_id, version, sketch1_id)
            .await
            .unwrap();
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            17,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        // Edit a point in the first sketch.
        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Var(Number {
                    value: 1.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 2.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: point1_id,
            ctor: SegmentCtor::Point(point_ctor),
        }];
        let (src_delta, _) = frontend
            .edit_segments(&mock_ctx, version, sketch1_id, segments)
            .await
            .unwrap();
        // Only the first sketch block changes.
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

// Cube that requires the engine.
width = 2
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = width, tag = $seg1)
  |> xLine(length = width)
  |> yLine(length = -width)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = width)

// Get a value that requires the engine.
x = segLen(seg1)

// Triangle with side length 2*x.
sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 2.317mm, var -1.777mm])
  line2 = sketch2::line(start = [var 2.317mm, var -1.777mm], end = [var -1.613mm, var -1.029mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -1.613mm, var -1.029mm], end = [var 1mm, var 2mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::coincident([line3.end, line1.start])
  sketch2::equalLength([line3, line1])
  sketch2::equalLength([line1, line2])
sketch2::distance([line1.start, line1.end]) == 2 * x
}

// Line segment with length x.
sketch2 = sketch(on = XY) {
  line1 = sketch2::line(start = [var 0.14mm, var 0.86mm], end = [var 1.283mm, var -0.781mm])
sketch2::distance([line1.start, line1.end]) == x
}
"
        );

        // Execute mock to simulate drag end.
        let (src_delta, _) = frontend.execute_mock(&mock_ctx, version, sketch1_id).await.unwrap();
        // Only the first sketch block changes.
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

// Cube that requires the engine.
width = 2
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = width, tag = $seg1)
  |> xLine(length = width)
  |> yLine(length = -width)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = width)

// Get a value that requires the engine.
x = segLen(seg1)

// Triangle with side length 2*x.
sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 1.283mm, var -0.781mm])
  line2 = sketch2::line(start = [var 1.283mm, var -0.781mm], end = [var -0.71mm, var -0.95mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -0.71mm, var -0.95mm], end = [var 0.14mm, var 0.86mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::coincident([line3.end, line1.start])
  sketch2::equalLength([line3, line1])
  sketch2::equalLength([line1, line2])
sketch2::distance([line1.start, line1.end]) == 2 * x
}

// Line segment with length x.
sketch2 = sketch(on = XY) {
  line1 = sketch2::line(start = [var 0.14mm, var 0.86mm], end = [var 1.283mm, var -0.781mm])
sketch2::distance([line1.start, line1.end]) == x
}
"
        );
        // Exit sketch. Objects from the entire program should be present.
        //
        // - Plane 1
        // - Sketch block 16
        // - Sketch block 5
        let scene = frontend.exit_sketch(&ctx, version, sketch1_id).await.unwrap();
        assert_eq!(scene.objects.len(), 22, "{:#?}", scene.objects);

        // Edit the second sketch. Objects from the entire program should be
        // present.
        //
        // - Plane 1
        // - Sketch block 16
        // - Sketch block 5
        let scene_delta = frontend
            .edit_sketch(&mock_ctx, project_id, file_id, version, sketch2_id)
            .await
            .unwrap();
        assert_eq!(
            scene_delta.new_graph.objects.len(),
            22,
            "{:#?}",
            scene_delta.new_graph.objects
        );

        // Edit a point in the second sketch.
        let point_ctor = PointCtor {
            position: Point2d {
                x: Expr::Var(Number {
                    value: 3.0,
                    units: NumericSuffix::Mm,
                }),
                y: Expr::Var(Number {
                    value: 4.0,
                    units: NumericSuffix::Mm,
                }),
            },
        };
        let segments = vec![ExistingSegmentCtor {
            id: point2_id,
            ctor: SegmentCtor::Point(point_ctor),
        }];
        let (src_delta, _) = frontend
            .edit_segments(&mock_ctx, version, sketch2_id, segments)
            .await
            .unwrap();
        // Only the second sketch block changes.
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

// Cube that requires the engine.
width = 2
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = width, tag = $seg1)
  |> xLine(length = width)
  |> yLine(length = -width)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = width)

// Get a value that requires the engine.
x = segLen(seg1)

// Triangle with side length 2*x.
sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 1.283mm, var -0.781mm])
  line2 = sketch2::line(start = [var 1.283mm, var -0.781mm], end = [var -0.71mm, var -0.95mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -0.71mm, var -0.95mm], end = [var 0.14mm, var 0.86mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::coincident([line3.end, line1.start])
  sketch2::equalLength([line3, line1])
  sketch2::equalLength([line1, line2])
sketch2::distance([line1.start, line1.end]) == 2 * x
}

// Line segment with length x.
sketch2 = sketch(on = XY) {
  line1 = sketch2::line(start = [var 3mm, var 4mm], end = [var 2.324mm, var 2.118mm])
sketch2::distance([line1.start, line1.end]) == x
}
"
        );

        // Execute mock to simulate drag end.
        let (src_delta, _) = frontend.execute_mock(&mock_ctx, version, sketch2_id).await.unwrap();
        // Only the second sketch block changes.
        assert_eq!(
            src_delta.text.as_str(),
            "\
@settings(experimentalFeatures = allow)

// Cube that requires the engine.
width = 2
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = width, tag = $seg1)
  |> xLine(length = width)
  |> yLine(length = -width)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = width)

// Get a value that requires the engine.
x = segLen(seg1)

// Triangle with side length 2*x.
sketch(on = XY) {
  line1 = sketch2::line(start = [var 1mm, var 2mm], end = [var 1.283mm, var -0.781mm])
  line2 = sketch2::line(start = [var 1.283mm, var -0.781mm], end = [var -0.71mm, var -0.95mm])
  sketch2::coincident([line1.end, line2.start])
  line3 = sketch2::line(start = [var -0.71mm, var -0.95mm], end = [var 0.14mm, var 0.86mm])
  sketch2::coincident([line2.end, line3.start])
  sketch2::coincident([line3.end, line1.start])
  sketch2::equalLength([line3, line1])
  sketch2::equalLength([line1, line2])
sketch2::distance([line1.start, line1.end]) == 2 * x
}

// Line segment with length x.
sketch2 = sketch(on = XY) {
  line1 = sketch2::line(start = [var 3mm, var 4mm], end = [var 1.283mm, var -0.781mm])
sketch2::distance([line1.start, line1.end]) == x
}
"
        );

        ctx.close().await;
        mock_ctx.close().await;
    }
}
