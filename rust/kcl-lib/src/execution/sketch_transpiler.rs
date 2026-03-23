//!
//! Transpiler for converting old sketch syntax to new sketch block syntax.

use std::collections::HashMap;

use kcl_error::SourceRange;

use crate::{
    Program,
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecOutcome, ExecutorContext, KclValue, SKETCH_BLOCK_PARAM_ON,
        geometry::{Path, Sketch},
    },
    fmt::format_number_literal,
    frontend::{
        api::{Expr, Number},
        ast_name_expr, create_arc_ast, create_coincident_ast, create_equal_length_ast, create_horizontal_ast,
        create_line_ast, create_member_expression, create_tangent_ast, create_vertical_ast,
        sketch::Point2d,
        to_ast_point2d,
    },
    parsing::ast::types as ast,
};

mod intermediate_var;
mod region;

/// Constraint types that can be applied to segments
#[derive(Debug, Clone)]
enum SegmentConstraint {
    Horizontal,
    Vertical,
    EqualLength { other_segment_index: usize },
    Tangent { other_segment_index: usize },
    Radius { r: Number },
    Diameter { d: Number },
}

#[derive(Debug, Clone, Copy)]
enum SegmentEndpoint {
    Start,
    End,
}

#[derive(Debug, Clone, Copy)]
enum SegmentConnectionSide {
    Entry,
    Exit,
}

#[derive(Debug, Clone, Copy)]
enum ArcSizeKind {
    Radius,
    Diameter,
}

// Internal data structs for transpiler.
// Extract information for segments relevant to transpile.
#[derive(Debug, Clone)]
enum TranspilerSegment {
    Line(TranspilerLineSegment),
    Arc(TranspilerArcSegment),
    Circle {
        name: String,
        center: [f64; 2],
        radius: f64,
    },
}

#[derive(Debug, Clone)]
struct TranspilerLineSegment {
    name: String,
    start: [f64; 2],
    end: [f64; 2],
}

#[derive(Debug, Clone)]
struct TranspilerArcSegment {
    name: String,
    start: [f64; 2],
    end: [f64; 2],
    center: [f64; 2],
    entry_endpoint: SegmentEndpoint,
    exit_endpoint: SegmentEndpoint,
}

pub fn pre_execute_transpile(program: &mut Program) -> Result<(), KclError> {
    // First, extract pipelines before extrudes into their own variable. This
    // must happen before executing so that execution can see the new variables.
    intermediate_var::transpile(&mut program.ast)
}

pub fn transpile_all_old_sketches_to_new(
    exec_outcome: &ExecOutcome,
    program: &mut Program,
    fail_fast: bool,
) -> Result<(), KclError> {
    // Convert sketches in variables.
    let mut sketch_blocks = HashMap::with_capacity(exec_outcome.variables.len());
    for variable in &exec_outcome.variables {
        if let KclValue::Sketch { .. } = &variable.1 {
            // This variable contains a sketch that needs to be transpiled
            let sketch_block = transpile_old_sketch_to_new_ast(exec_outcome, program, variable.0, fail_fast)?;
            sketch_blocks.insert(variable.0.clone(), sketch_block);
        }
    }
    // Substitute back into program.
    for item in &mut program.ast.body {
        if let ast::BodyItem::VariableDeclaration(var_decl) = item
            && let Some(sketch_block) = sketch_blocks.get(&var_decl.declaration.id.name)
        {
            var_decl.declaration.init = ast::Expr::SketchBlock(Box::new(ast::Node::no_src(sketch_block.clone())));
        }
    }
    if !sketch_blocks.is_empty() {
        // If we have any sketch blocks, allow experimental features.
        program
            .ast
            .set_experimental_features(Some(crate::exec::WarningLevel::Allow));
        // Create regions before extruding.
        region::insert(&mut program.ast)?;
    }
    Ok(())
}

/// Transpile an old-style sketch to new sketch block syntax.
///
/// This function takes a variable name that should contain a Sketch value in
/// the ExecOutcome's variables, and generates new sketch block code.
///
/// # Arguments
/// * `exec_outcome` - The execution outcome containing the executed sketch
/// * `program` - The parsed AST program
/// * `variable_name` - The name of the variable containing the sketch
///
/// # Returns
/// The transpiled code as a string, or an error if the sketch cannot be found
/// or transpiled.
pub fn transpile_old_sketch_to_new(
    exec_outcome: &ExecOutcome,
    program: &Program,
    variable_name: &str,
) -> Result<String, KclError> {
    // Build the sketch block AST
    let sketch_block = transpile_old_sketch_to_new_ast(exec_outcome, program, variable_name, true)?;

    // Create a program with just the sketch block
    let program = ast::Program {
        body: vec![ast::BodyItem::ExpressionStatement(ast::Node::no_src(
            ast::ExpressionStatement {
                expression: ast::Expr::SketchBlock(Box::new(ast::Node::no_src(sketch_block))),
                digest: None,
            },
        ))],
        shebang: None,
        non_code_meta: Default::default(),
        inner_attrs: Default::default(),
        digest: None,
    };

    let program_node = ast::Node::no_src(program);

    // Convert AST to string
    Ok(program_node.recast_top(&Default::default(), 0))
}

pub fn transpile_old_sketch_to_new_ast(
    exec_outcome: &ExecOutcome,
    program: &Program,
    variable_name: &str,
    fail_fast: bool,
) -> Result<ast::SketchBlock, KclError> {
    // Get the sketch from execution outcome
    let sketch = get_sketch_from_exec_outcome(exec_outcome, variable_name)?;

    let on_expr = extract_sketch_block_on_expr(program, variable_name)?;

    // Build the sketch block AST
    build_sketch_block_ast(&sketch, on_expr, program, variable_name, fail_fast)
}

/// Transpile an old-style sketch to new sketch block syntax by re-executing the program.
///
/// This function re-executes the program using the execution cache (which should be very fast
/// if the program hasn't changed), then extracts the sketch and transpiles it.
///
/// # Arguments
/// * `ctx` - The executor context (must not be mock mode)
/// * `program` - The parsed AST program
/// * `variable_name` - The name of the variable containing the sketch
///
/// # Returns
/// The transpiled code as a string, or an error if execution or transpilation fails.
pub async fn transpile_old_sketch_to_new_with_execution(
    ctx: &ExecutorContext,
    program: Program,
    variable_name: &str,
) -> Result<String, KclError> {
    // Re-execute using cache (should be very fast if program hasn't changed)
    // Both run_mock and run_with_caching use caching, but different types:
    // - run_mock: uses memory cache (cached variables/state), always re-executes full program
    // - run_with_caching: uses AST cache, can do incremental execution of changed parts only
    let exec_outcome = if ctx.is_mock() {
        // For mock contexts, use run_mock (uses memory cache via read_old_memory/write_old_memory)
        ctx.run_mock(&program, &crate::execution::MockConfig::default())
            .await
            .map_err(|e| {
                KclError::new_internal(KclErrorDetails::new(
                    format!("Failed to execute program for transpilation (mock): {:?}", e),
                    vec![],
                ))
            })?
    } else {
        ctx.run_with_caching(program.clone()).await.map_err(|e| {
            KclError::new_internal(KclErrorDetails::new(
                format!("Failed to execute program for transpilation: {:?}", e),
                vec![],
            ))
        })?
    };

    // Now transpile using the execution outcome
    transpile_old_sketch_to_new(&exec_outcome, &program, variable_name)
}

/// Build the AST for a sketch block from the executed sketch
fn build_sketch_block_ast(
    sketch: &Sketch,
    on_expr: ast::Expr,
    program: &Program,
    variable_name: &str,
    fail_fast: bool,
) -> Result<ast::SketchBlock, KclError> {
    // Find the original old-sketch initializer expression.
    let pipe_expr = find_old_sketch_init_expr(program, variable_name)?;

    // Map segments to their AST calls using source ranges
    let segment_ast_calls = map_segments_to_ast_calls(sketch, pipe_expr)?;

    // Detect constraints from AST
    let constraints = detect_constraints_from_ast(&segment_ast_calls, sketch)?;

    // Build sketch block body items
    let mut body_items = Vec::new();
    let mut transpiler_segment_names: Vec<Option<String>> = vec![None; sketch.paths.len()];
    let mut transpiler_segments: Vec<Option<TranspilerSegment>> = vec![None; sketch.paths.len()];
    let mut previous_transpiler_segment_index: Option<usize> = None;

    // Process each path segment
    for (i, path_segment) in sketch.paths.iter().enumerate() {
        let transpiler_segment = match transpiler_build_segment(path_segment, i, fail_fast)? {
            Some(segment) => segment,
            None => {
                previous_transpiler_segment_index = None;
                continue;
            }
        };
        let transpiler_segment_name = transpiler_segment_name(&transpiler_segment).to_owned();

        body_items.push(transpiler_create_segment_declaration(
            &transpiler_segment,
            sketch.units,
        )?);

        // Add coincident constraint between this segment and the previous one.
        if let Some(previous_segment_index) = previous_transpiler_segment_index
            && let Some(previous_segment) = transpiler_segments
                .get(previous_segment_index)
                .and_then(|segment| segment.as_ref())
            && transpiler_segment_supports_auto_connection(previous_segment)
            && transpiler_segment_supports_auto_connection(&transpiler_segment)
        {
            body_items.push(transpiler_create_segment_coincident_constraint(
                previous_segment,
                &transpiler_segment,
            ));
        }

        previous_transpiler_segment_index = Some(i);
        transpiler_segment_names[i] = Some(transpiler_segment_name);
        transpiler_segments[i] = Some(transpiler_segment);
    }

    // Add constraints from AST detection
    for (i, segment_name) in transpiler_segment_names.iter().enumerate() {
        let Some(segment_name) = segment_name.as_deref() else {
            continue;
        };
        if let Some(segment_constraints) = constraints.get(i) {
            for constraint in segment_constraints {
                match constraint {
                    SegmentConstraint::Horizontal => {
                        let horizontal_ast = create_horizontal_ast_from_name(segment_name);
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: horizontal_ast,
                                digest: None,
                            },
                        )));
                    }
                    SegmentConstraint::Vertical => {
                        let vertical_ast = create_vertical_ast_from_name(segment_name);
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: vertical_ast,
                                digest: None,
                            },
                        )));
                    }
                    SegmentConstraint::EqualLength { other_segment_index } => {
                        let Some(other_line_name) = transpiler_segment_names
                            .get(*other_segment_index)
                            .and_then(|name| name.as_deref())
                        else {
                            continue;
                        };
                        let equal_length_ast = create_equal_length_ast_from_names(segment_name, other_line_name);
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: equal_length_ast,
                                digest: None,
                            },
                        )));
                    }
                    SegmentConstraint::Tangent { other_segment_index } => {
                        let Some(other_segment_name) = transpiler_segment_names
                            .get(*other_segment_index)
                            .and_then(|name| name.as_deref())
                        else {
                            continue;
                        };
                        let tangent_ast = create_tangent_ast_from_names(other_segment_name, segment_name);
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: tangent_ast,
                                digest: None,
                            },
                        )));
                    }
                    SegmentConstraint::Radius { r } => {
                        let radius_ast = create_arc_size_constraint_ast_from_name("radius", segment_name, *r)?;
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: radius_ast,
                                digest: None,
                            },
                        )));
                    }
                    SegmentConstraint::Diameter { d } => {
                        let diameter_ast = create_arc_size_constraint_ast_from_name("diameter", segment_name, *d)?;
                        body_items.push(ast::BodyItem::ExpressionStatement(ast::Node::no_src(
                            ast::ExpressionStatement {
                                expression: diameter_ast,
                                digest: None,
                            },
                        )));
                    }
                }
            }
        }
    }

    // Create the sketch block body (Block)
    let block = ast::Block {
        items: body_items,
        non_code_meta: Default::default(),
        inner_attrs: Default::default(),
        digest: None,
    };

    // Create the sketch block
    Ok(ast::SketchBlock {
        arguments: vec![ast::LabeledArg {
            label: Some(ast::Identifier::new(SKETCH_BLOCK_PARAM_ON)),
            arg: on_expr,
        }],
        body: ast::Node::no_src(block),
        is_being_edited: false,
        non_code_meta: Default::default(),
        digest: None,
    })
}

/// Convert f64 + UnitLength to Number (rounding to 2 decimal places)
fn f64_to_number(value: f64, units: kittycad_modeling_cmds::units::UnitLength) -> Number {
    // Round to 2 decimal places, then convert using From trait
    let rounded = (value * 100.0).round() / 100.0;
    (rounded, units).into()
}

fn transpiler_build_segment(
    path_segment: &Path,
    segment_index: usize,
    fail_fast: bool,
) -> Result<Option<TranspilerSegment>, KclError> {
    let base = path_segment.get_base();

    match path_segment {
        Path::ToPoint { .. } => Ok(Some(TranspilerSegment::Line(TranspilerLineSegment {
            name: transpiler_segment_name_for_path(path_segment, segment_index),
            start: base.from,
            end: base.to,
        }))),
        Path::TangentialArcTo { center, ccw, .. } | Path::TangentialArc { center, ccw, .. } => {
            let (start, end, entry_endpoint, exit_endpoint) = if *ccw {
                (base.from, base.to, SegmentEndpoint::Start, SegmentEndpoint::End)
            } else {
                (base.to, base.from, SegmentEndpoint::End, SegmentEndpoint::Start)
            };

            Ok(Some(TranspilerSegment::Arc(TranspilerArcSegment {
                name: transpiler_segment_name_for_path(path_segment, segment_index),
                start,
                end,
                center: *center,
                entry_endpoint,
                exit_endpoint,
            })))
        }
        Path::Circle { center, radius, .. } => Ok(Some(TranspilerSegment::Circle {
            name: transpiler_segment_name_for_path(path_segment, segment_index),
            center: *center,
            radius: *radius,
        })),
        Path::CircleThreePoint { .. }
        | Path::ArcThreePoint { .. }
        | Path::Horizontal { .. }
        | Path::AngledLineTo { .. }
        | Path::Base { .. }
        | Path::Arc { .. }
        | Path::Ellipse { .. }
        | Path::Conic { .. }
        | Path::Bezier { .. } => {
            if fail_fast {
                Err(transpiler_create_unsupported_segment_error(segment_index, path_segment))
            } else {
                std::eprintln!(
                    "Transpilation not supported: segment {} has unsupported type {}. Only line segments, tangential arcs, and circles are currently supported.",
                    segment_index + 1,
                    transpiler_path_type_name(path_segment),
                );
                Ok(None)
            }
        }
    }
}

fn transpiler_path_type_name(path_segment: &Path) -> &'static str {
    match path_segment {
        Path::ToPoint { .. } => "ToPoint",
        Path::TangentialArcTo { .. } => "TangentialArcTo",
        Path::TangentialArc { .. } => "TangentialArc",
        Path::Circle { .. } => "Circle",
        Path::CircleThreePoint { .. } => "CircleThreePoint",
        Path::ArcThreePoint { .. } => "ArcThreePoint",
        Path::Horizontal { .. } => "Horizontal",
        Path::AngledLineTo { .. } => "AngledLineTo",
        Path::Base { .. } => "Base",
        Path::Arc { .. } => "Arc",
        Path::Ellipse { .. } => "Ellipse",
        Path::Conic { .. } => "Conic",
        Path::Bezier { .. } => "Bezier",
    }
}

fn transpiler_segment_name_for_path(path_segment: &Path, segment_index: usize) -> String {
    match path_segment {
        Path::ToPoint { .. } => format!("line{}", segment_index + 1),
        Path::TangentialArcTo { .. } | Path::TangentialArc { .. } => format!("arc{}", segment_index + 1),
        Path::Circle { .. } => format!("circle{}", segment_index + 1),
        _ => format!("segment{}", segment_index + 1),
    }
}

fn transpiler_segment_name(segment: &TranspilerSegment) -> &str {
    match segment {
        TranspilerSegment::Line(segment) => &segment.name,
        TranspilerSegment::Arc(segment) => &segment.name,
        TranspilerSegment::Circle { name, .. } => name,
    }
}

fn transpiler_create_segment_declaration(
    segment: &TranspilerSegment,
    units: kittycad_modeling_cmds::units::UnitLength,
) -> Result<ast::BodyItem, KclError> {
    let (segment_name, segment_ast) = match segment {
        TranspilerSegment::Line(segment) => (
            segment.name.as_str(),
            create_line_ast_from_coords(
                segment.start[0],
                segment.start[1],
                segment.end[0],
                segment.end[1],
                units,
            )?,
        ),
        TranspilerSegment::Arc(segment) => (
            segment.name.as_str(),
            create_arc_ast_from_coords(
                segment.start[0],
                segment.start[1],
                segment.end[0],
                segment.end[1],
                segment.center[0],
                segment.center[1],
                units,
            )?,
        ),
        TranspilerSegment::Circle { name, center, radius } => (
            name.as_str(),
            create_arc_ast_from_coords(
                center[0] + radius,
                center[1],
                center[0] + radius,
                center[1],
                center[0],
                center[1],
                units,
            )?,
        ),
    };

    Ok(ast::BodyItem::VariableDeclaration(Box::new(ast::Node::no_src(
        ast::VariableDeclaration {
            kind: ast::VariableKind::Const,
            declaration: ast::Node::no_src(ast::VariableDeclarator {
                id: ast::Node::no_src(ast::Identifier {
                    name: segment_name.to_string(),
                    digest: None,
                }),
                init: segment_ast,
                digest: None,
            }),
            visibility: ast::ItemVisibility::Default,
            digest: None,
        },
    ))))
}

fn transpiler_create_segment_coincident_constraint(
    previous_segment: &TranspilerSegment,
    segment: &TranspilerSegment,
) -> ast::BodyItem {
    let coincident_ast = create_coincident_ast_from_segments(previous_segment, segment);
    ast::BodyItem::ExpressionStatement(ast::Node::no_src(ast::ExpressionStatement {
        expression: coincident_ast,
        digest: None,
    }))
}

fn transpiler_create_unsupported_segment_error(segment_index: usize, _path_segment: &Path) -> KclError {
    KclError::new_internal(KclErrorDetails::new(
        format!(
            "Transpilation not supported: segment {} has unsupported type {}. Only line segments, tangential arcs, and circles are currently supported.",
            segment_index + 1,
            transpiler_path_type_name(_path_segment),
        ),
        vec![],
    ))
}

/// Create an AST node for a line call
/// Uses shared helper from frontend.rs
fn create_line_ast_from_coords(
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    units: kittycad_modeling_cmds::units::UnitLength,
) -> Result<ast::Expr, KclError> {
    // Create Point2d<Expr> with var expressions for start and end points
    let start_point = Point2d {
        x: Expr::Var(f64_to_number(start_x, units)),
        y: Expr::Var(f64_to_number(start_y, units)),
    };

    let end_point = Point2d {
        x: Expr::Var(f64_to_number(end_x, units)),
        y: Expr::Var(f64_to_number(end_y, units)),
    };

    // Convert to AST using the same function as frontend
    let start_ast = to_ast_point2d(&start_point).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to convert start point to AST: {}", e),
            vec![],
        ))
    })?;

    let end_ast = to_ast_point2d(&end_point).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to convert end point to AST: {}", e),
            vec![],
        ))
    })?;

    // Use shared helper to create the line AST
    Ok(create_line_ast(start_ast, end_ast))
}

/// Create an AST node for an arc call.
fn create_arc_ast_from_coords(
    start_x: f64,
    start_y: f64,
    end_x: f64,
    end_y: f64,
    center_x: f64,
    center_y: f64,
    units: kittycad_modeling_cmds::units::UnitLength,
) -> Result<ast::Expr, KclError> {
    let start_point = Point2d {
        x: Expr::Var(f64_to_number(start_x, units)),
        y: Expr::Var(f64_to_number(start_y, units)),
    };
    let end_point = Point2d {
        x: Expr::Var(f64_to_number(end_x, units)),
        y: Expr::Var(f64_to_number(end_y, units)),
    };
    let center_point = Point2d {
        x: Expr::Var(f64_to_number(center_x, units)),
        y: Expr::Var(f64_to_number(center_y, units)),
    };

    let start_ast = to_ast_point2d(&start_point).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to convert arc start point to AST: {}", e),
            vec![],
        ))
    })?;
    let end_ast = to_ast_point2d(&end_point).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to convert arc end point to AST: {}", e),
            vec![],
        ))
    })?;
    let center_ast = to_ast_point2d(&center_point).map_err(|e| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to convert arc center point to AST: {}", e),
            vec![],
        ))
    })?;

    Ok(create_arc_ast(start_ast, end_ast, center_ast))
}

// Helper functions below use shared AST creation functions from frontend.rs
// to ensure consistency between transpiler and frontend code generation.

/// Create an AST node for coincident([prev.exit, current.entry]).
fn create_coincident_ast_from_segments(previous_segment: &TranspilerSegment, segment: &TranspilerSegment) -> ast::Expr {
    let previous_exit = transpiler_segment_connection_expr(previous_segment, SegmentConnectionSide::Exit);
    let current_entry = transpiler_segment_connection_expr(segment, SegmentConnectionSide::Entry);
    create_coincident_ast(previous_exit, current_entry)
}

/// Create an AST node for horizontal(line)
fn create_horizontal_ast_from_name(line_name: &str) -> ast::Expr {
    let line_expr = ast_name_expr(line_name.to_string());
    create_horizontal_ast(line_expr)
}

/// Create an AST node for vertical(line)
fn create_vertical_ast_from_name(line_name: &str) -> ast::Expr {
    let line_expr = ast_name_expr(line_name.to_string());
    create_vertical_ast(line_expr)
}

/// Create an AST node for equalLength([line1, line2])
fn create_equal_length_ast_from_names(line1_name: &str, line2_name: &str) -> ast::Expr {
    let line1_expr = ast_name_expr(line1_name.to_string());
    let line2_expr = ast_name_expr(line2_name.to_string());
    create_equal_length_ast(vec![line1_expr, line2_expr])
}

fn create_tangent_ast_from_names(segment1_name: &str, segment2_name: &str) -> ast::Expr {
    let segment1_expr = ast_name_expr(segment1_name.to_string());
    let segment2_expr = ast_name_expr(segment2_name.to_string());
    create_tangent_ast(segment1_expr, segment2_expr)
}

fn create_arc_size_constraint_ast_from_name(
    function_name: &str,
    segment_name: &str,
    num: Number,
) -> Result<ast::Expr, KclError> {
    let segment_expr = ast_name_expr(segment_name.to_string());
    let call_ast = ast::BinaryPart::CallExpressionKw(Box::new(ast::Node::no_src(ast::CallExpressionKw {
        callee: ast::Node::no_src(ast::Name {
            name: ast::Node::no_src(ast::Identifier {
                name: function_name.to_owned(),
                digest: None,
            }),
            path: Vec::new(),
            abs_path: false,
            digest: None,
        }),
        unlabeled: Some(segment_expr),
        arguments: Default::default(),
        digest: None,
        non_code_meta: Default::default(),
    })));
    let raw = format_number_literal(num.value, num.units).map_err(|err| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to format numeric constraint literal: {err}"),
            vec![],
        ))
    })?;

    Ok(ast::Expr::BinaryExpression(Box::new(ast::Node::no_src(
        ast::BinaryExpression {
            left: call_ast,
            operator: ast::BinaryOperator::Eq,
            right: ast::BinaryPart::Literal(Box::new(ast::Node::no_src(ast::Literal {
                value: ast::LiteralValue::Number {
                    value: num.value,
                    suffix: num.units,
                },
                raw,
                digest: None,
            }))),
            digest: None,
        },
    ))))
}

// Exclude circles for now.
fn transpiler_segment_supports_auto_connection(segment: &TranspilerSegment) -> bool {
    !matches!(segment, TranspilerSegment::Circle { .. })
}

fn transpiler_segment_connection_expr(segment: &TranspilerSegment, side: SegmentConnectionSide) -> ast::Expr {
    let segment_expr = ast_name_expr(transpiler_segment_name(segment).to_string());
    let endpoint = match (segment, side) {
        (TranspilerSegment::Line(_), SegmentConnectionSide::Entry) => SegmentEndpoint::Start,
        (TranspilerSegment::Line(_), SegmentConnectionSide::Exit) => SegmentEndpoint::End,
        (TranspilerSegment::Arc(segment), SegmentConnectionSide::Entry) => segment.entry_endpoint,
        (TranspilerSegment::Arc(segment), SegmentConnectionSide::Exit) => segment.exit_endpoint,
        (TranspilerSegment::Circle { .. }, _) => {
            // Exclude circles for now
            unreachable!("Circle segments do not participate in auto-generated coincident constraints")
        }
    };

    create_member_expression(
        segment_expr,
        match endpoint {
            SegmentEndpoint::Start => "start",
            SegmentEndpoint::End => "end",
        },
    )
}

fn extract_sketch_block_on_expr(program: &Program, variable_name: &str) -> Result<ast::Expr, KclError> {
    let init_expr = find_old_sketch_init_expr(program, variable_name)?;
    extract_sketch_surface_expr(init_expr)
}

fn extract_sketch_surface_expr(expr: &ast::Expr) -> Result<ast::Expr, KclError> {
    match expr {
        ast::Expr::PipeExpression(pipe_expr) => {
            let Some(first_expr) = pipe_expr.body.first() else {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "Expected old sketch pipe expression to contain at least one call".to_owned(),
                    vec![],
                )));
            };
            extract_sketch_surface_expr(first_expr)
        }
        ast::Expr::CallExpressionKw(call) => extract_sketch_surface_expr_from_call(call),
        _ => Err(KclError::new_internal(KclErrorDetails::new(
            "Expected old sketch syntax to start from a call expression".to_owned(),
            vec![],
        ))),
    }
}

fn extract_sketch_surface_expr_from_call(call: &ast::Node<ast::CallExpressionKw>) -> Result<ast::Expr, KclError> {
    let call_name = &call.callee.name.name;
    if call_name == "startSketchOn" {
        return extract_sketch_surface_expr_from_start_sketch_on(call);
    }

    if !is_str_profile_function(call_name) {
        return Err(KclError::new_internal(KclErrorDetails::new(
            format!("Expected sketch-generating call, found '{call_name}'"),
            vec![],
        )));
    }

    let Some(surface_expr) = call.unlabeled.as_ref() else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            format!("Expected '{call_name}' to have an unlabeled sketch or surface argument"),
            vec![],
        )));
    };

    match surface_expr {
        ast::Expr::CallExpressionKw(surface_call) if surface_call.callee.name.name == "startSketchOn" => {
            extract_sketch_surface_expr_from_start_sketch_on(surface_call)
        }
        _ => Ok(surface_expr.clone()),
    }
}

fn extract_sketch_surface_expr_from_start_sketch_on(
    call: &ast::Node<ast::CallExpressionKw>,
) -> Result<ast::Expr, KclError> {
    if call.arguments.is_empty()
        && let Some(surface_expr) = call.unlabeled.as_ref()
    {
        return Ok(surface_expr.clone());
    }

    Ok(ast::Expr::CallExpressionKw(Box::new(call.clone())))
}

/// Get a Sketch value from ExecOutcome's variables.
fn get_sketch_from_exec_outcome(exec_outcome: &ExecOutcome, variable_name: &str) -> Result<Sketch, KclError> {
    let value = exec_outcome.variables.get(variable_name).ok_or_else(|| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Variable '{}' not found in execution outcome", variable_name),
            vec![],
        ))
    })?;

    match value {
        KclValue::Sketch { value } => Ok(*value.clone()),
        _ => Err(KclError::new_internal(KclErrorDetails::new(
            format!("Variable '{}' is not a Sketch", variable_name),
            vec![],
        ))),
    }
}

/// Find the original initializer expression for a supported old-sketch variable.
fn find_old_sketch_init_expr<'a>(program: &'a Program, variable_name: &str) -> Result<&'a ast::Expr, KclError> {
    // Find the variable declaration
    for item in &program.ast.body {
        if let ast::BodyItem::VariableDeclaration(var_decl) = item
            && var_decl.declaration.id.name == variable_name
        {
            if let ast::Expr::PipeExpression(pipe) = &var_decl.declaration.init
                && let Some(ast::Expr::CallExpressionKw(call)) = pipe.body.first()
                && (call.callee.name.name == "startSketchOn" || is_str_profile_function(&call.callee.name.name))
            {
                return Ok(&var_decl.declaration.init);
            }
            if let ast::Expr::CallExpressionKw(call) = &var_decl.declaration.init
                && is_str_profile_function(&call.callee.name.name)
            {
                return Ok(&var_decl.declaration.init);
            }
        }
    }

    Err(KclError::new_internal(KclErrorDetails::new(
        format!(
            "Could not find supported old sketch initializer for variable '{}'",
            variable_name
        ),
        vec![],
    )))
}

fn is_str_profile_function(name: &str) -> bool {
    // Conics are omitted since we don't support migrating them.
    matches!(name, "startProfile" | "circle" | "rectangle" | "polygon")
}

/// Map segments to their AST calls using source ranges
/// Returns a vector of (segment_index, AST call expression)
fn map_segments_to_ast_calls<'a>(
    sketch: &Sketch,
    pipe_expr: &'a ast::Expr,
) -> Result<Vec<(usize, &'a ast::CallExpressionKw)>, KclError> {
    match pipe_expr {
        ast::Expr::CallExpressionKw(call) => Ok(vec![(0, &call.inner)]),
        ast::Expr::PipeExpression(pipe_expr) => {
            let mut result = Vec::new();

            // Get source ranges from segments (skip startProfile, start from first segment)
            // The pipe body should have: [startProfile, line1, line2, ...]
            // So segments start at index 1 in the pipe body (skip startProfile)
            let pipe_segment_calls: Vec<&ast::CallExpressionKw> = pipe_expr
                .body
                .iter()
                .skip(1) // Skip startProfile
                .filter_map(|expr| {
                    if let ast::Expr::CallExpressionKw(call) = expr {
                        Some(&call.inner)
                    } else {
                        None
                    }
                })
                .collect();

            // Match segments to pipe calls by index (they should be in the same order)
            // Only match if we have the same number of segments and calls
            for i in 0..sketch.paths.len().min(pipe_segment_calls.len()) {
                if let Some(call) = pipe_segment_calls.get(i) {
                    result.push((i, *call));
                }
            }

            Ok(result)
        }
        _ => Err(KclError::new_internal(KclErrorDetails::new(
            "Could not map unknown expression type to pipe segment calls".to_owned(),
            sketch.meta.iter().map(SourceRange::from).collect(),
        ))),
    }
}

/// Detect constraints from AST calls
fn detect_constraints_from_ast(
    segment_ast_calls: &[(usize, &ast::CallExpressionKw)],
    sketch: &Sketch,
) -> Result<Vec<Vec<SegmentConstraint>>, KclError> {
    let mut constraints: Vec<Vec<SegmentConstraint>> = vec![Vec::new(); sketch.paths.len()];

    for (segment_index, call) in segment_ast_calls {
        // Check if it's xLine or yLine
        // call is &CallExpressionKw, callee is Node<Name>, name is Node<Identifier>
        let function_name = &call.callee.name.name;

        if function_name == "xLine" {
            constraints[*segment_index].push(SegmentConstraint::Horizontal);
        } else if function_name == "yLine" {
            constraints[*segment_index].push(SegmentConstraint::Vertical);
        } else if function_name == "angledLine" {
            // Check for segLen() in the length argument
            for arg in &call.arguments {
                if let Some(label) = &arg.label
                    && label.name == "length"
                    && let Some(seg_index) = find_seg_len_reference(&arg.arg, segment_ast_calls, sketch)?
                {
                    // Check if the arg contains segLen()
                    constraints[*segment_index].push(SegmentConstraint::EqualLength {
                        other_segment_index: seg_index,
                    });
                }
            }
        } else if function_name == "tangentialArc" {
            if *segment_index > 0 && path_supports_tangent_constraint_at_entry(&sketch.paths[*segment_index]) {
                constraints[*segment_index].push(SegmentConstraint::Tangent {
                    other_segment_index: segment_index - 1,
                });
            }

            if call_has_labeled_arg(call, "radius")
                && let Some(r) =
                    get_arc_size_constraint_value(&sketch.paths[*segment_index], sketch.units, ArcSizeKind::Radius)
            {
                constraints[*segment_index].push(SegmentConstraint::Radius { r });
            }

            if call_has_labeled_arg(call, "diameter")
                && let Some(d) =
                    get_arc_size_constraint_value(&sketch.paths[*segment_index], sketch.units, ArcSizeKind::Diameter)
            {
                constraints[*segment_index].push(SegmentConstraint::Diameter { d });
            }
        }
    }

    Ok(constraints)
}

fn call_has_labeled_arg(call: &ast::CallExpressionKw, label_name: &str) -> bool {
    call.arguments
        .iter()
        .any(|arg| arg.label.as_ref().is_some_and(|label| label.name == label_name))
}

fn path_supports_tangent_constraint_at_entry(path_segment: &Path) -> bool {
    match path_segment {
        Path::TangentialArc { ccw, .. } | Path::TangentialArcTo { ccw, .. } => *ccw,
        _ => false,
    }
}

fn get_arc_size_constraint_value(
    path_segment: &Path,
    units: kittycad_modeling_cmds::units::UnitLength,
    kind: ArcSizeKind,
) -> Option<Number> {
    let (center, from) = match path_segment {
        Path::TangentialArc { center, base, .. } | Path::TangentialArcTo { center, base, .. } => (*center, base.from),
        _ => return None,
    };

    let dx = center[0] - from[0];
    let dy = center[1] - from[1];
    let radius = (dx * dx + dy * dy).sqrt();
    let value = match kind {
        ArcSizeKind::Radius => radius,
        ArcSizeKind::Diameter => radius * 2.0,
    };

    Some(f64_to_number(value, units))
}

/// Find segLen() reference in an expression and return the segment index it refers to
fn find_seg_len_reference(
    expr: &ast::Expr,
    _segment_ast_calls: &[(usize, &ast::CallExpressionKw)],
    sketch: &Sketch,
) -> Result<Option<usize>, KclError> {
    if let ast::Expr::CallExpressionKw(call) = expr
        && call.callee.name.name == "segLen"
    {
        // Check if it's segLen()
        // Get the argument (should be a tag name like "seg01")
        // segLen takes the tag name as an unlabeled argument (Name expression)
        let tag_name_opt = if let Some(unlabeled) = &call.unlabeled {
            // Check if unlabeled is a Name (tag reference like "seg01")
            if let ast::Expr::Name(name) = unlabeled {
                Some(name.name.name.as_str())
            } else if let ast::Expr::TagDeclarator(tag) = unlabeled {
                // Also support TagDeclarator for completeness
                Some(tag.inner.name.as_str())
            } else {
                None
            }
        } else {
            // Check labeled arguments for a tag
            call.arguments.iter().find_map(|arg| {
                if let Some(label) = &arg.label
                    && (label.name == "tag" || label.name == "segment")
                {
                    if let ast::Expr::Name(name) = &arg.arg {
                        Some(name.name.name.as_str())
                    } else if let ast::Expr::TagDeclarator(tag) = &arg.arg {
                        Some(tag.inner.name.as_str())
                    } else {
                        None
                    }
                } else {
                    None
                }
            })
        };

        if let Some(tag_name) = tag_name_opt {
            // Find the segment with this tag
            // Tag format in AST is usually "seg01" (without $)
            // Tag format in sketch is usually "$seg01" (with $)
            for (i, path_segment) in sketch.paths.iter().enumerate() {
                let base = path_segment.get_base();
                if let Some(segment_tag) = &base.tag {
                    // Compare tag names - remove $ prefix if present
                    let segment_tag_name = segment_tag
                        .inner
                        .name
                        .strip_prefix('$')
                        .unwrap_or(&segment_tag.inner.name);
                    if segment_tag_name == tag_name {
                        return Ok(Some(i));
                    }
                }
            }
        }
    }

    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        Program,
        test_server::{execute_and_snapshot_ast, new_context},
    };

    async fn transpile_test_sketch(code: &str, variable_name: &str) -> Result<String, KclError> {
        let program = Program::parse_no_errs(code).unwrap();

        let _ctx = new_context(true, None).await.unwrap();
        let snapshot = execute_and_snapshot_ast(program.clone(), None, false).await.unwrap();
        let exec_state = snapshot.0;
        let ctx = snapshot.1;
        let env_ref = snapshot.2;

        let exec_outcome = exec_state.into_exec_outcome(env_ref, &ctx).await;
        let transpiled = transpile_old_sketch_to_new(&exec_outcome, &program, variable_name);

        ctx.close().await;
        transpiled
    }

    async fn assert_transpiled_matches(code: &str, variable_name: &str, expected_output: &str) {
        let transpiled = transpile_test_sketch(code, variable_name)
            .await
            .expect("Transpiler should succeed");

        let normalized_transpiled = normalize_transpiled_sketch_output(&transpiled);
        let normalized_expected = normalize_transpiled_sketch_output(expected_output);

        assert_eq!(
            normalized_transpiled,
            normalized_expected,
            "Transpiled output does not match expected output\n\nGot:\n{}\n\nExpected:\n{}",
            transpiled.trim().replace("\r\n", "\n"),
            expected_output.trim().replace("\r\n", "\n")
        );
    }

    fn normalize_transpiled_sketch_output(output: &str) -> String {
        let normalized = output.trim().replace("\r\n", "\n");
        let mut lines = normalized.lines();

        let Some(header) = lines.next() else {
            return normalized;
        };
        let Some(footer) = normalized.lines().last() else {
            return normalized;
        };

        let mut declarations = Vec::new();
        let mut constraints = Vec::new();

        for line in normalized.lines().skip(1).take_while(|line| *line != footer) {
            if line.contains(" = line(") || line.contains(" = arc(") {
                declarations.push(line.to_string());
            } else {
                constraints.push(line.to_string());
            }
        }

        constraints.sort();

        let mut rebuilt = Vec::with_capacity(2 + declarations.len() + constraints.len());
        rebuilt.push(header.to_string());
        rebuilt.extend(declarations);
        rebuilt.extend(constraints);
        rebuilt.push(footer.to_string());
        rebuilt.join("\n")
    }

    #[tokio::test]
    async fn test_transpile_simple_sketch() {
        // This test will fail until the transpiler is implemented
        // It executes the old sketch syntax and then tries to transpile it

        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-3.71, 5.81])
  |> line(end = [-3.8, -4.92])
  |> line(end = [3.47, -5.75])
  |> xLine(length = 7.68)
  |> yLine(length = 6.29)
"#;

        // Parse the code
        let program = Program::parse_no_errs(code).unwrap();

        // Execute it using the test server
        let _ctx = new_context(true, None).await.unwrap();
        let snapshot = execute_and_snapshot_ast(program.clone(), None, false).await.unwrap();
        let exec_state = snapshot.0;
        let ctx = snapshot.1;
        let env_ref = snapshot.2;

        // Convert to ExecOutcome
        let exec_outcome = exec_state.into_exec_outcome(env_ref, &ctx).await;

        // Expected transpiled output
        // Note: Coordinates are from actual execution, may have small rounding differences
        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var -3.71mm, var 5.81mm], end = [var -7.51mm, var 0.89mm])
  line2 = line(start = [var -7.51mm, var 0.89mm], end = [var -4.04mm, var -4.86mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -4.04mm, var -4.86mm], end = [var 3.64mm, var -4.86mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 3.64mm, var -4.86mm], end = [var 3.64mm, var 1.43mm])
  coincident([line3.end, line4.start])
  horizontal(line3)
  vertical(line4)
}"#;

        // Try to transpile - this should succeed and match the expected output
        let transpiled =
            transpile_old_sketch_to_new(&exec_outcome, &program, "profile001").expect("Transpiler should succeed");

        // Normalize whitespace for comparison (trim and normalize line endings)
        let normalized_transpiled = transpiled.trim().replace("\r\n", "\n");
        let normalized_expected = expected_output.trim().replace("\r\n", "\n");

        assert_eq!(
            normalized_transpiled, normalized_expected,
            "Transpiled output does not match expected output\n\nGot:\n{}\n\nExpected:\n{}",
            normalized_transpiled, normalized_expected
        );

        // Clean up
        ctx.close().await;
    }

    #[tokio::test]
    async fn test_transpile_arc_only_end_absolute_to_arc_segment() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> tangentialArc(endAbsolute = [10, 10])
"#;

        let expected_output = r#"sketch(on = sketch001) {
  arc1 = arc(start = [var 0mm, var 0mm], end = [var 10mm, var 10mm], center = [var 10mm, var 0mm])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_then_tangential_arc_end_absolute_adds_coincident_endpoint() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(endAbsolute = [20, 10])
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 10mm, var 0mm], end = [var 20mm, var 10mm], center = [var 10mm, var 10mm])
  coincident([line1.end, arc2.start])
  tangent([line1, arc2])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_then_tangential_arc_end_relative_adds_coincident_endpoint() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(end = [10, 10])
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 10mm, var 0mm], end = [var 20mm, var 10mm], center = [var 10mm, var 10mm])
  coincident([line1.end, arc2.start])
  tangent([line1, arc2])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_then_tangential_arc_radius_angle_adds_tangent_and_radius() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(radius = 5, angle = 90deg)
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 10mm, var 0mm], end = [var 15mm, var 5mm], center = [var 10mm, var 5mm])
  coincident([line1.end, arc2.start])
  tangent([line1, arc2])
  radius(arc2) == 5mm
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_then_tangential_arc_diameter_angle_adds_tangent_and_diameter() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(diameter = 10, angle = 90deg)
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 10mm, var 0mm], end = [var 15mm, var 5mm], center = [var 10mm, var 5mm])
  coincident([line1.end, arc2.start])
  tangent([line1, arc2])
  diameter(arc2) == 10mm
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_then_clockwise_tangential_arc_preserves_connectivity_without_tangent_constraint() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(radius = 5, angle = -90deg)
  |> line(end = [0, -10])
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 15mm, var -5mm], end = [var 10mm, var 0mm], center = [var 10mm, var -5mm])
  coincident([line1.end, arc2.end])
  line3 = line(start = [var 15mm, var -5mm], end = [var 15mm, var -15mm])
  coincident([arc2.start, line3.start])
  radius(arc2) == 5mm
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_line_arc_line_adds_coincident_on_both_sides() {
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [10, 0])
  |> tangentialArc(endAbsolute = [20, 10])
  |> line(end = [0, 10])
"#;

        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  arc2 = arc(start = [var 10mm, var 0mm], end = [var 20mm, var 10mm], center = [var 10mm, var 10mm])
  coincident([line1.end, arc2.start])
  tangent([line1, arc2])
  line3 = line(start = [var 20mm, var 10mm], end = [var 20mm, var 20mm])
  coincident([arc2.end, line3.start])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn can_convert_equal_length_constraints() {
        let code = r#"
sketch001 = startSketchOn(YZ)
profile001 = startProfile(sketch001, at = [2.25, 4.48])
  |> line(end = [-7.46, -1.59], tag = $seg01)
  |> yLine(length = -7.46)
  |> angledLine(angle = 15deg, length = segLen(seg01))
"#;

        // Parse the code
        let program = Program::parse_no_errs(code).unwrap();

        // Execute it using the test server
        let _ctx = new_context(true, None).await.unwrap();
        let snapshot = execute_and_snapshot_ast(program.clone(), None, false).await.unwrap();
        let exec_state = snapshot.0;
        let ctx = snapshot.1;
        let env_ref = snapshot.2;

        // Convert to ExecOutcome
        let exec_outcome = exec_state.into_exec_outcome(env_ref, &ctx).await;

        // Expected transpiled output
        // Note: Coordinates are from actual execution, may have small rounding differences
        // Also note: yLine should be vertical on line2, and equalLength should be on line3
        let expected_output = r#"sketch(on = sketch001) {
  line1 = line(start = [var 2.25mm, var 4.48mm], end = [var -5.21mm, var 2.89mm])
  line2 = line(start = [var -5.21mm, var 2.89mm], end = [var -5.21mm, var -4.57mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -5.21mm, var -4.57mm], end = [var 2.16mm, var -2.6mm])
  coincident([line2.end, line3.start])
  vertical(line2)
  equalLength([line3, line1])
}"#;

        // Try to transpile - this should succeed and match the expected output
        let transpiled =
            transpile_old_sketch_to_new(&exec_outcome, &program, "profile001").expect("Transpiler should succeed");

        // Normalize whitespace for comparison (trim and normalize line endings)
        let normalized_transpiled = transpiled.trim().replace("\r\n", "\n");
        let normalized_expected = expected_output.trim().replace("\r\n", "\n");

        assert_eq!(
            normalized_transpiled, normalized_expected,
            "Transpiled output does not match expected output\n\nGot:\n{}\n\nExpected:\n{}",
            normalized_transpiled, normalized_expected
        );

        // Clean up
        ctx.close().await;
    }

    #[tokio::test]
    async fn test_transpile_fails_with_unsupported_segments() {
        // Test that transpilation fails when there are bezier curves
        let code = r#"
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-3.71, 5.81])
  |> line(end = [-3.8, -4.92])
  |> line(end = [3.47, -5.75])
  |> xLine(length = 7.68)
  |> yLine(length = 6.29)
  |> bezierCurve(control1 = [5, 0], control2 = [5, 10], end = [10, 10])
"#;

        // Parse the code
        let program = Program::parse_no_errs(code).unwrap();

        // Execute it using the test server
        let _ctx = new_context(true, None).await.unwrap();
        let snapshot = execute_and_snapshot_ast(program.clone(), None, false).await.unwrap();
        let exec_state = snapshot.0;
        let ctx = snapshot.1;
        let env_ref = snapshot.2;

        // Convert to ExecOutcome
        let exec_outcome = exec_state.into_exec_outcome(env_ref, &ctx).await;

        // Try to transpile - this should fail because bezier curves are not supported
        let result = transpile_old_sketch_to_new(&exec_outcome, &program, "profile001");

        assert!(
            result.is_err(),
            "Transpilation should fail when bezier curves are present"
        );

        // Verify the error message mentions the unsupported segment
        let error_msg = format!("{:?}", result.unwrap_err());
        assert!(
            error_msg.contains("not a line segment") || error_msg.contains("not supported"),
            "Error message should indicate unsupported segment type. Got: {}",
            error_msg
        );

        // Clean up
        ctx.close().await;
    }

    #[tokio::test]
    async fn test_transpile_negative_plane() {
        // Test that transpilation correctly handles negative planes (e.g., -XY)
        let code = r#"
sketch001 = startSketchOn(-XY)
profile001 = startProfile(sketch001, at = [2.0, 3.0])
  |> line(end = [5.0, 3.0])
  |> line(end = [5.0, 6.0])
"#;

        // Parse the code
        let program = Program::parse_no_errs(code).unwrap();

        // Execute it using the test server
        let _ctx = new_context(true, None).await.unwrap();
        let snapshot = execute_and_snapshot_ast(program.clone(), None, false).await.unwrap();
        let exec_state = snapshot.0;
        let ctx = snapshot.1;
        let env_ref = snapshot.2;

        // Convert to ExecOutcome
        let exec_outcome = exec_state.into_exec_outcome(env_ref, &ctx).await;

        // Try to transpile - this should succeed and output "-XY" for the plane
        let transpiled =
            transpile_old_sketch_to_new(&exec_outcome, &program, "profile001").expect("Transpiler should succeed");

        // Verify that the output contains "-XY" (not just "XY")
        assert!(
            transpiled.contains("sketch(on = sketch001)"),
            "Transpiled output should preserve the surface variable name. Got: {}",
            transpiled
        );

        // Clean up
        ctx.close().await;
    }

    #[tokio::test]
    async fn test_transpile_preserves_offset_plane_expression() {
        let code = r#"
profile001 = startSketchOn(offsetPlane(XY, offset = 2))
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
"#;

        let expected_output = r#"sketch(on = offsetPlane(XY, offset = 2)) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_preserves_face_surface_variable() {
        let code = r#"
base = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> close()
  |> extrude(length = 1)

topFace = startSketchOn(base, face = END)
profile001 = startProfile(topFace, at = [0, 0])
  |> line(end = [1, 0])
"#;

        let expected_output = r#"sketch(on = topFace) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }

    #[tokio::test]
    async fn test_transpile_preserves_inline_face_surface_expression() {
        let code = r#"
base = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [1, 0])
  |> line(end = [0, 1])
  |> line(end = [-1, 0])
  |> close()
  |> extrude(length = 1)

profile001 = startProfile(startSketchOn(base, face = END), at = [0, 0])
  |> line(end = [1, 0])
"#;

        let expected_output = r#"sketch(on = startSketchOn(base, face = END)) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 1mm, var 0mm])
}"#;

        assert_transpiled_matches(code, "profile001", expected_output).await;
    }
}
