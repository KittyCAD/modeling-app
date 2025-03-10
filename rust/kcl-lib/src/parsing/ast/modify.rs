use std::sync::Arc;

use kcmc::{
    each_cmd as mcmd, ok_response::OkModelingCmdResponse, shared::PathCommand, websocket::OkWebSocketResponseData,
    ModelingCmd,
};
use kittycad_modeling_cmds as kcmc;

use super::types::{CallExpressionKw, Identifier, LabeledArg, LiteralValue};
use crate::{
    engine::EngineManager,
    errors::{KclError, KclErrorDetails},
    execution::Point2d,
    parsing::ast::types::{
        ArrayExpression, CallExpression, ConstraintLevel, FormatOptions, Literal, Node, PipeExpression,
        PipeSubstitution, VariableDeclarator,
    },
    source_range::SourceRange,
    ModuleId, Program,
};

type Point3d = kcmc::shared::Point3d<f64>;

#[derive(Debug)]
/// The control point data for a curve or line.
struct ControlPointData {
    /// The control points for the curve or line.
    points: Vec<Point3d>,
    /// The command that created this curve or line.
    _command: PathCommand,
    /// The id of the curve or line.
    _id: uuid::Uuid,
}

const EPSILON: f64 = 0.015625; // or 2^-6

/// Update the AST to reflect the new state of the program after something like
/// a move or a new line.
pub async fn modify_ast_for_sketch(
    engine: &Arc<Box<dyn EngineManager>>,
    program: &mut Program,
    module_id: ModuleId,
    // The name of the sketch.
    sketch_name: &str,
    // The type of plane the sketch is on. `XY` or `XZ`, etc
    plane: crate::execution::PlaneType,
    // The ID of the parent sketch.
    sketch_id: uuid::Uuid,
) -> Result<String, KclError> {
    // First we need to check if this sketch is constrained (even partially).
    // If it is, we cannot modify it.

    // Get the information about the sketch.
    if let Some(ast_sketch) = program.ast.get_variable(sketch_name) {
        let constraint_level = match ast_sketch {
            super::types::Definition::Variable(var) => var.get_constraint_level(),
            super::types::Definition::Import(import) => import.get_constraint_level(),
            super::types::Definition::Type(_) => ConstraintLevel::Ignore {
                source_ranges: Vec::new(),
            },
        };
        match &constraint_level {
            ConstraintLevel::None { source_ranges: _ } => {}
            ConstraintLevel::Ignore { source_ranges: _ } => {}
            ConstraintLevel::Partial {
                source_ranges: _,
                levels,
            } => {
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!(
                        "Sketch {} is constrained `{}` and cannot be modified",
                        sketch_name, constraint_level
                    ),
                    source_ranges: levels.get_all_partial_or_full_source_ranges(),
                }));
            }
            ConstraintLevel::Full { source_ranges } => {
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!(
                        "Sketch {} is constrained `{}` and cannot be modified",
                        sketch_name, constraint_level
                    ),
                    source_ranges: source_ranges.clone(),
                }));
            }
        }
    }

    // Let's start by getting the path info.

    // Let's get the path info.
    let resp = engine
        .send_modeling_cmd(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            &ModelingCmd::PathGetInfo(mcmd::PathGetInfo { path_id: sketch_id }),
        )
        .await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::PathGetInfo(path_info),
    } = &resp
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("Get path info response was not as expected: {:?}", resp),
            source_ranges: vec![SourceRange::default()],
        }));
    };

    // Now let's get the control points for all the segments.
    // TODO: We should probably await all these at once so we aren't going one by one.
    // But I guess this is fine for now.
    // We absolutely have to preserve the order of the control points.
    let mut control_points = Vec::new();
    for segment in &path_info.segments {
        if let Some(command_id) = &segment.command_id {
            let cmd = ModelingCmd::from(mcmd::CurveGetControlPoints {
                curve_id: (*command_id).into(),
            });
            let h = engine.send_modeling_cmd(uuid::Uuid::new_v4(), SourceRange::default(), &cmd);

            let OkWebSocketResponseData::Modeling {
                modeling_response: OkModelingCmdResponse::CurveGetControlPoints(data),
            } = h.await?
            else {
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!("Curve get control points response was not as expected: {:?}", resp),
                    source_ranges: vec![SourceRange::default()],
                }));
            };

            control_points.push(ControlPointData {
                points: data.control_points.clone(),
                _command: segment.command,
                _id: (*command_id).into(),
            });
        }
    }

    if control_points.is_empty() {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("No control points found for sketch {}", sketch_name),
            source_ranges: vec![SourceRange::default()],
        }));
    }

    let first_control_points = control_points.first().ok_or_else(|| {
        KclError::Engine(KclErrorDetails {
            message: format!("No control points found for sketch {}", sketch_name),
            source_ranges: vec![SourceRange::default()],
        })
    })?;

    let mut additional_lines = Vec::new();
    let mut last_point = first_control_points.points[1];
    for control_point in control_points[1..].iter() {
        additional_lines.push([
            (control_point.points[1].x - last_point.x),
            (control_point.points[1].y - last_point.y),
        ]);
        last_point = Point3d {
            x: control_point.points[1].x,
            y: control_point.points[1].y,
            z: control_point.points[1].z,
        };
    }

    // Okay now let's recalculate the sketch from the control points.
    let start_sketch_at_end = Point3d {
        x: (first_control_points.points[1].x - first_control_points.points[0].x),
        y: (first_control_points.points[1].y - first_control_points.points[0].y),
        z: (first_control_points.points[1].z - first_control_points.points[0].z),
    };
    let sketch = create_start_sketch_on(
        sketch_name,
        [first_control_points.points[0].x, first_control_points.points[0].y],
        [start_sketch_at_end.x, start_sketch_at_end.y],
        plane,
        additional_lines,
    )?;

    // Add the sketch back to the program.
    program.ast.replace_variable(sketch_name, sketch);

    let recasted = program.ast.recast(&FormatOptions::default(), 0);

    // Re-parse the ast so we get the correct source ranges.
    program.ast = crate::parsing::parse_str(&recasted, module_id).parse_errs_as_err()?;

    Ok(recasted)
}

/// Create a pipe expression that starts a sketch at the given point and draws a line to the given point.
fn create_start_sketch_on(
    name: &str,
    start: [f64; 2],
    end: [f64; 2],
    plane: crate::execution::PlaneType,
    additional_lines: Vec<[f64; 2]>,
) -> Result<Node<VariableDeclarator>, KclError> {
    let start_sketch_on = CallExpression::new("startSketchOn", vec![Literal::new(plane.to_string().into()).into()])?;
    let start_profile_at = CallExpression::new(
        "startProfileAt",
        vec![
            ArrayExpression::new(vec![
                Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(start[0]))).into(),
                Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(start[1]))).into(),
            ])
            .into(),
            PipeSubstitution::new().into(),
        ],
    )?;

    // Keep track of where we are so we can close the sketch if we need to.
    let mut current_position = Point2d {
        x: start[0],
        y: start[1],
    };
    current_position.x += end[0];
    current_position.y += end[1];

    let expr = ArrayExpression::new(vec![
        Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(end[0]))).into(),
        Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(end[1]))).into(),
    ])
    .into();
    let initial_line = CallExpressionKw::new(
        "line",
        None,
        vec![LabeledArg {
            label: Node::no_src(super::types::Identifier {
                name: "end".to_owned(),
                digest: None,
            }),
            arg: expr,
        }],
    )?;

    let mut pipe_body = vec![start_sketch_on.into(), start_profile_at.into(), initial_line.into()];

    for (index, line) in additional_lines.iter().enumerate() {
        current_position.x += line[0];
        current_position.y += line[1];

        // If we are on the last line, check if we have to close the sketch.
        if index == additional_lines.len() - 1 {
            let diff_x = (current_position.x - start[0]).abs();
            let diff_y = (current_position.y - start[1]).abs();
            // Compare the end of the last line to the start of the first line.
            // This is a bit more lenient if you look at the value of epsilon.
            if diff_x <= EPSILON && diff_y <= EPSILON {
                // We have to close the sketch.
                let close = CallExpressionKw::new("close", None, vec![])?;
                pipe_body.push(close.into());
                break;
            }
        }

        // TODO: we should check if we should close the sketch.
        let expr = ArrayExpression::new(vec![
            Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(line[0]))).into(),
            Literal::new(LiteralValue::from_f64_no_uom(round_before_recast(line[1]))).into(),
        ])
        .into();
        let line = CallExpressionKw::new(
            "line",
            None,
            vec![LabeledArg {
                arg: expr,
                label: Node::no_src(Identifier {
                    name: "end".to_owned(),
                    digest: None,
                }),
            }],
        )?;
        pipe_body.push(line.into());
    }

    Ok(VariableDeclarator::new(name, PipeExpression::new(pipe_body).into()))
}

fn round_before_recast(num: f64) -> f64 {
    // We use 2 decimal places.
    (num * 100.0).round() / 100.0
}
