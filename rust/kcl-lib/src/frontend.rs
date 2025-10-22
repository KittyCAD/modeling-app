use std::ops::ControlFlow;

use anyhow::{anyhow, bail};
use kcl_error::SourceRange;

use crate::{
    ExecutorContext, Program,
    fmt::format_number_literal,
    frontend::{
        api::{
            Error, Expr, FileId, Number, ObjectId, ObjectKind, ProjectId, SceneGraph, SceneGraphDelta, SourceDelta,
            SourceRef, Version,
        },
        sketch::{Constraint, LineCtor, Point2d, Segment, SegmentCtor, SketchApi, SketchArgs},
        traverse::dfs_mut,
    },
    parsing::ast::types as ast,
    walk::NodeMut,
};

pub(crate) mod api;
pub(crate) mod sketch;
mod traverse;

const LINE_FN: &str = "line";
const LINE_START_PARAM: &str = "start";
const LINE_END_PARAM: &str = "end";

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
            .map(|item| SourceRange::new(item.start(), item.end(), item.module_id()))
            .ok_or_else(|| Error {
                msg: "No AST body items after adding sketch".to_owned(),
            })?;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let mut outcome = ctx.run_with_caching(new_program).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

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
        self.scene_graph.objects = std::mem::take(&mut outcome.scene_objects);
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
        if self.scene_graph.sketch_mode != Some(sketch) {
            return Err(Error {
                msg: format!(
                    "Not currently in sketch mode editing the given sketch: current={:?}, given={sketch:?}",
                    self.scene_graph.sketch_mode
                ),
            });
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

        self.scene_graph.objects = outcome.scene_objects;

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
            SegmentCtor::Line(ctor) => self.add_line(ctx, sketch, ctor).await,
            _ => Err(Error {
                msg: format!("segment ctor not implemented yet: {segment:?}"),
            }),
        }
    }

    async fn edit_segment(
        &mut self,
        ctx: &ExecutorContext,
        _version: Version,
        sketch: ObjectId,
        segment_id: ObjectId,
        segment: SegmentCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // TODO: Check version.
        match segment {
            SegmentCtor::Line(ctor) => self.edit_line(ctx, sketch, segment_id, ctor).await,
            _ => Err(Error {
                msg: format!("segment ctor not implemented yet: {segment:?}"),
            }),
        }
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
        _ctx: &ExecutorContext,
        _version: Version,
        _sketch: ObjectId,
        _constraint: Constraint,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        todo!()
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
    async fn add_line(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        ctor: LineCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
        // Create updated KCL source from args.
        let start_ast = to_ast_point2d(&ctor.start).map_err(|err| Error { msg: err.to_string() })?;
        let end_ast = to_ast_point2d(&ctor.end).map_err(|err| Error { msg: err.to_string() })?;
        let line_ast = ast::Expr::CallExpressionKw(Box::new(ast::CallExpressionKw::new(
            LINE_FN,
            None,
            vec![
                ast::LabeledArg {
                    label: Some(ast::Identifier::new(LINE_START_PARAM)),
                    arg: start_ast,
                },
                ast::LabeledArg {
                    label: Some(ast::Identifier::new(LINE_END_PARAM)),
                    arg: end_ast,
                },
            ],
        )));

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
        let sketch_block_range = self
            .ast_from_object_id_mut(&mut new_ast, sketch_id, AstMutateCommand::AddLine { line: line_ast })
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

        let line_source_range = new_program
            .ast
            .body
            .iter()
            .find_map(|item| {
                if let ast::BodyItem::ExpressionStatement(expr_stmt) = item
                    && expr_stmt.module_id == sketch_block_range.module_id()
                    && expr_stmt.start == sketch_block_range.start()
                    // End shouldn't match since we added a line.
                    && expr_stmt.end >= sketch_block_range.end()
                    && let ast::Expr::SketchBlock(sketch_block) = &expr_stmt.expression
                {
                    return sketch_block.body.items.last().map(SourceRange::from);
                }
                None
            })
            .ok_or_else(|| Error {
                msg: format!("Source range of line not found in sketch block: {sketch_block_range:?}"),
            })?;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let mut outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        let segment_id = outcome
            .source_range_to_object
            .get(&line_source_range)
            .copied()
            .ok_or_else(|| Error {
                msg: format!("Source range of line not found: {line_source_range:?}"),
            })?;
        let segment_object = self.scene_graph.objects.get(segment_id.0).ok_or_else(|| Error {
            msg: format!("Segment not found: {segment_id:?}"),
        })?;
        let ObjectKind::Segment(segment) = &segment_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {segment_object:?}"),
            });
        };
        let Segment::Line(line) = segment else {
            return Err(Error {
                msg: format!("Segment is not a line: {segment:?}"),
            });
        };
        let new_object_ids = vec![segment_id, line.start, line.end];

        let src_delta = SourceDelta { text: new_source };
        self.scene_graph.objects = std::mem::take(&mut outcome.scene_objects);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: new_object_ids,
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    async fn edit_line(
        &mut self,
        ctx: &ExecutorContext,
        sketch: ObjectId,
        line: ObjectId,
        ctor: LineCtor,
    ) -> api::Result<(SourceDelta, SceneGraphDelta)> {
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
        let ObjectKind::Segment(_) = &line_object.kind else {
            return Err(Error {
                msg: format!("Object is not a segment: {line_object:?}"),
            });
        };

        // Modify the line AST.
        let mut new_ast = self.program.ast.clone();
        self.ast_from_object_id_mut(
            &mut new_ast,
            line_id,
            AstMutateCommand::EditLine {
                start: new_start_ast,
                end: new_end_ast,
            },
        )
        .map_err(|err| Error { msg: err.to_string() })?;
        // Convert to string source to create real source ranges.
        let new_source = source_from_ast(&new_ast);
        // Parse the new KCL source.
        let (new_program, errors) = Program::parse(&new_source).map_err(|err| Error { msg: err.to_string() })?;
        if !errors.is_empty() {
            return Err(Error {
                msg: format!("Error parsing KCL source after modifying line: {errors:?}"),
            });
        }
        let Some(new_program) = new_program else {
            return Err(Error {
                msg: "No AST produced after modifying line".to_string(),
            });
        };

        // TODO: sketch-api: make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let mut outcome = ctx.run_mock(&new_program, true).await.map_err(|err| {
            // TODO: sketch-api: Yeah, this needs to change. We need to
            // return the full error.
            Error {
                msg: err.error.message().to_owned(),
            }
        })?;

        let src_delta = SourceDelta { text: new_source };
        self.scene_graph.objects = std::mem::take(&mut outcome.scene_objects);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: Vec::new(),
            exec_outcome: outcome,
        };
        Ok((src_delta, scene_graph_delta))
    }

    fn ast_from_object_id_mut(
        &mut self,
        ast: &mut ast::Node<ast::Program>,
        object_id: ObjectId,
        command: AstMutateCommand,
    ) -> anyhow::Result<SourceRange> {
        let sketch_object = self
            .scene_graph
            .objects
            .get(object_id.0)
            .ok_or_else(|| anyhow!("Object not found: {object_id:?}"))?;
        match &sketch_object.source {
            SourceRef::Simple(range) => ast_node_from_source_range_mut(ast, *range, command),
            SourceRef::BackTrace(_) => bail!("BackTrace source refs not supported yet"),
        }
    }
}

struct AstMutateContext {
    source_range: SourceRange,
    command: AstMutateCommand,
}

#[allow(clippy::large_enum_variant)]
enum AstMutateCommand {
    AddLine { line: ast::Expr },
    EditLine { start: ast::Expr, end: ast::Expr },
}

fn filter_and_process(ctx: &AstMutateContext, node: NodeMut) -> ControlFlow<SourceRange> {
    // Make sure the node matches the source range.
    let Ok(node_range) = SourceRange::try_from(&node) else {
        return ControlFlow::Continue(());
    };
    if node_range != ctx.source_range {
        return ControlFlow::Continue(());
    }
    process(&ctx.command, node).map_break(|_| ctx.source_range)
}

fn process(command: &AstMutateCommand, node: NodeMut) -> ControlFlow<()> {
    match command {
        AstMutateCommand::AddLine { line } => {
            if let NodeMut::SketchBlock(sketch_block) = node {
                sketch_block
                    .body
                    .items
                    .push(ast::BodyItem::ExpressionStatement(ast::Node {
                        inner: ast::ExpressionStatement {
                            expression: line.clone(),
                            digest: None,
                        },
                        start: Default::default(),
                        end: Default::default(),
                        module_id: Default::default(),
                        outer_attrs: Default::default(),
                        pre_comments: Default::default(),
                        comment_start: Default::default(),
                    }));
                return ControlFlow::Break(());
            }
        }
        AstMutateCommand::EditLine { start, end } => {
            if let NodeMut::CallExpressionKw(call) = node {
                if call.callee.name.name != LINE_FN {
                    return ControlFlow::Continue(());
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
                return ControlFlow::Break(());
            }
        }
    }
    ControlFlow::Continue(())
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

fn ast_node_from_source_range_mut(
    ast: &mut ast::Node<ast::Program>,
    source_range: SourceRange,
    command: AstMutateCommand,
) -> anyhow::Result<SourceRange> {
    let context = AstMutateContext { source_range, command };
    let control = dfs_mut(ast, &context, filter_and_process);
    match control {
        ControlFlow::Continue(_) => Err(anyhow!("Source range not found: {source_range:?}")),
        ControlFlow::Break(break_value) => Ok(break_value),
    }
}
