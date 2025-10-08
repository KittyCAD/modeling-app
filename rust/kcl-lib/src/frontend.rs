use std::ops::ControlFlow;

use anyhow::{anyhow, bail};
use kcl_api::{
    Error, Expr, FileId, Number, NumericSuffix, ObjectId, ObjectKind, ProjectId, SceneGraph, SceneGraphDelta, Settings,
    SourceDelta, SourceRef, Version,
    sketch::{Freedom, Point2d, Segment, SketchArgs},
};
use kcl_error::SourceRange;

use crate::{
    ExecutorContext, Program, fmt::format_number_literal, frontend::traverse::dfs_mut, id::IncIdGenerator,
    parsing::ast::types as ast, walk::NodeMut,
};

mod traverse;

const LINE_FN: &str = "line";
const LINE_START_PARAM: &str = "start";
const LINE_END_PARAM: &str = "end";

#[derive(Debug, Clone)]
pub(crate) struct FrontendState {
    id_generator: IncIdGenerator<usize>,
    ctx: ExecutorContext,
    program: Program,
    scene_graph: SceneGraph,
}

impl FrontendState {
    fn new(ctx: ExecutorContext) -> Self {
        Self {
            id_generator: IncIdGenerator::new(0),
            ctx,
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

    async fn new_sketch(
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
            kcl_api::Plane::Default(plane) => ast_name_expr(plane.to_string()),
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
        let outcome = self.ctx.run_with_caching(new_program).await.map_err(|err| {
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
        let src_delta = SourceDelta {};
        // Store the object in the scene.
        self.scene_graph.sketch_mode = Some(sketch_id);
        let scene_graph_delta = SceneGraphDelta {
            new_graph: self.scene_graph.clone(),
            invalidates_ids: false,
            new_objects: vec![sketch_id],
        };
        Ok((src_delta, scene_graph_delta, sketch_id))
    }

    async fn add_line(
        &mut self,
        sketch: ObjectId,
        _version: Version,
        start: Point2d<Expr>,
        end: Point2d<Expr>,
    ) -> kcl_api::Result<(SourceDelta, SceneGraphDelta, ObjectId)> {
        // Create updated KCL source from args.
        let start_ast = to_ast_point2d(&start).map_err(|err| Error { msg: err.to_string() })?;
        let end_ast = to_ast_point2d(&end).map_err(|err| Error { msg: err.to_string() })?;
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
            .ast_from_object_id_mut(&mut new_ast, sketch_id, |node| {
                if let NodeMut::SketchBlock(sketch_block) = node {
                    sketch_block
                        .body
                        .items
                        .push(ast::BodyItem::ExpressionStatement(ast::Node {
                            inner: ast::ExpressionStatement {
                                expression: line_ast.clone(),
                                digest: None,
                            },
                            start: Default::default(),
                            end: Default::default(),
                            module_id: Default::default(),
                            outer_attrs: Default::default(),
                            pre_comments: Default::default(),
                            comment_start: Default::default(),
                        }));
                    let sketch_block_range =
                        SourceRange::new(sketch_block.start, sketch_block.end, sketch_block.module_id);
                    return ControlFlow::Break(sketch_block_range);
                }
                ControlFlow::Continue(())
            })
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
                if let ast::BodyItem::ExpressionStatement(expr_stmt) = item {
                    // End shouldn't match since we added a line.
                    if expr_stmt.module_id == sketch_block_range.module_id()
                        && expr_stmt.start == sketch_block_range.start()
                        && expr_stmt.end >= sketch_block_range.end()
                    {
                        if let ast::Expr::SketchBlock(sketch_block) = &expr_stmt.expression {
                            return sketch_block
                                .body
                                .items
                                .last()
                                .map(|last_item| SourceRange::from(last_item));
                        }
                    }
                }
                None
            })
            .ok_or_else(|| Error {
                msg: format!("Source range of line not found in sketch block: {sketch_block_range:?}"),
            })?;

        // Make sure to only set this if there are no errors.
        self.program = new_program.clone();

        // Execute.
        let outcome = self.ctx.run_mock(&new_program, true).await.map_err(|err| {
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
        // Create updated KCL source from args.
        let new_start_ast = to_ast_point2d(&start).map_err(|err| Error { msg: err.to_string() })?;

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
        self.ast_from_object_id_mut(&mut new_ast, line_id, |node| {
            if let NodeMut::CallExpressionKw(call) = node {
                if call.callee.name.name != LINE_FN {
                    return ControlFlow::Continue(());
                }
                for labeled_arg in &mut call.arguments {
                    if labeled_arg.label.as_ref().map(|id| id.name.as_str()) == Some(LINE_START_PARAM) {
                        labeled_arg.arg = new_start_ast.clone();
                        break;
                    }
                }
                return ControlFlow::Break(());
            }
            ControlFlow::Continue(())
        })
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
        // TODO: sketch-api: make sure to only set this if there are no errors.
        self.program = new_program;

        // TODO: sketch-api: execute.

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

    fn sketch_ast_from_id<F>(&self, ast: &ast::Node<ast::Program>, sketch_id: ObjectId, f: F) -> anyhow::Result<bool>
    where
        F: Fn(&crate::walk::Node) -> anyhow::Result<()>,
    {
        let sketch_object = self
            .scene_graph
            .objects
            .get(sketch_id.0)
            .ok_or_else(|| anyhow!("Sketch not found: {sketch_id:?}"))?;
        let ObjectKind::Sketch(_) = &sketch_object.kind else {
            bail!("Object is not a sketch: {sketch_object:?}");
        };
        match &sketch_object.source {
            SourceRef::Simple(range) => ast_node_from_source_range(ast, *range, f),
            SourceRef::BackTrace(_) => bail!("BackTrace source refs not supported yet"),
        }
    }

    fn ast_from_object_id_mut<B, F>(
        &mut self,
        ast: &mut ast::Node<ast::Program>,
        object_id: ObjectId,
        f: F,
    ) -> anyhow::Result<B>
    where
        F: Fn(crate::walk::NodeMut) -> ControlFlow<B>,
    {
        let sketch_object = self
            .scene_graph
            .objects
            .get(object_id.0)
            .ok_or_else(|| anyhow!("Object not found: {object_id:?}"))?;
        match &sketch_object.source {
            SourceRef::Simple(range) => ast_node_from_source_range_mut(ast, *range, f),
            SourceRef::BackTrace(_) => bail!("BackTrace source refs not supported yet"),
        }
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

fn ast_node_from_source_range<F>(ast: &ast::Node<ast::Program>, source_range: SourceRange, f: F) -> anyhow::Result<bool>
where
    F: Fn(&crate::walk::Node) -> anyhow::Result<()>,
{
    crate::walk::walk(ast, |node: crate::walk::Node| -> anyhow::Result<bool> {
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

fn ast_node_from_source_range_mut<B, F>(
    ast: &mut ast::Node<ast::Program>,
    source_range: SourceRange,
    f: F,
) -> anyhow::Result<B>
where
    F: Fn(crate::walk::NodeMut) -> ControlFlow<B>,
{
    let control = dfs_mut(ast, |node| {
        let Ok(node_range) = SourceRange::try_from(&node) else {
            return ControlFlow::Continue(());
        };
        if node_range != source_range {
            return ControlFlow::Continue(());
        }
        f(node)
    });
    match control {
        ControlFlow::Continue(_) => Err(anyhow!("Source range not found: {source_range:?}")),
        ControlFlow::Break(break_value) => Ok(break_value),
    }
}
