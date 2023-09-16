use kittycad::types::{ModelingCmd, Point3D};

use crate::{
    ast::types::{ArrayExpression, CallExpression, FormatOptions, Literal, Program},
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
};

use super::types::{PipeExpression, PipeSubstitution, VariableDeclarator};

#[derive(Debug)]
/// The control point data for a curve or line.
pub struct ControlPointData {
    /// The control points for the curve or line.
    pub points: Vec<kittycad::types::Point3D>,
    /// The command that created this curve or line.
    pub command: kittycad::types::PathCommand,
    /// The id of the curve or line.
    pub id: uuid::Uuid,
}

/// Update the AST to reflect the new state of the program after something like
/// a move or a new line.
pub async fn modify_ast_for_sketch(
    engine: &mut EngineConnection,
    program: &mut Program,
    // The name of the sketch.
    sketch_name: &str,
    // The ID of the parent sketch.
    sketch_id: uuid::Uuid,
) -> Result<String, KclError> {
    // Let's start by getting the path info.

    // Let's get the path info.
    let resp = engine
        .send_modeling_cmd_get_response(
            uuid::Uuid::new_v4(),
            SourceRange::default(),
            ModelingCmd::PathGetInfo { path_id: sketch_id },
        )
        .await?;

    let kittycad::types::OkWebSocketResponseData::Modeling {
        modeling_response: kittycad::types::OkModelingCmdResponse::PathGetInfo { data: path_info },
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
            let h = engine.send_modeling_cmd_get_response(
                uuid::Uuid::new_v4(),
                SourceRange::default(),
                ModelingCmd::CurveGetControlPoints { curve_id: *command_id },
            );

            let kittycad::types::OkWebSocketResponseData::Modeling {
                modeling_response: kittycad::types::OkModelingCmdResponse::CurveGetControlPoints { data },
            } = h.await?
            else {
                return Err(KclError::Engine(KclErrorDetails {
                    message: format!("Curve get control points response was not as expected: {:?}", resp),
                    source_ranges: vec![SourceRange::default()],
                }));
            };

            control_points.push(ControlPointData {
                points: data.control_points.clone(),
                command: segment.command.clone(),
                id: *command_id,
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
    let mut last_point = first_control_points.points[1].clone();
    for control_point in control_points[1..].iter() {
        additional_lines.push([
            round_to_2_places(control_point.points[1].x - last_point.x),
            round_to_2_places(control_point.points[1].y - last_point.y),
        ]);
        last_point = Point3D {
            x: control_point.points[1].x,
            y: control_point.points[1].y,
            z: control_point.points[1].z,
        };
    }

    // Okay now let's recalculate the sketch from the control points.
    let start_sketch_at_end = Point3D {
        x: round_to_2_places(first_control_points.points[1].x - first_control_points.points[0].x),
        y: round_to_2_places(first_control_points.points[1].y - first_control_points.points[0].y),
        z: round_to_2_places(first_control_points.points[1].z - first_control_points.points[0].z),
    };
    let sketch = create_start_sketch_at(
        sketch_name,
        [first_control_points.points[0].x, first_control_points.points[0].y],
        [start_sketch_at_end.x, start_sketch_at_end.y],
        additional_lines,
    )?;

    // Add the sketch back to the program.
    program.replace_variable(sketch_name, sketch);

    let recasted = program.recast(&FormatOptions::default(), 0);

    // Re-parse the ast so we get the correct source ranges.
    let tokens = crate::tokeniser::lexer(&recasted);
    let parser = crate::parser::Parser::new(tokens);
    *program = parser.ast()?;

    Ok(recasted)
}

/// Create a pipe expression that starts a sketch at the given point and draws a line to the given point.
fn create_start_sketch_at(
    name: &str,
    start: [f64; 2],
    end: [f64; 2],
    additional_lines: Vec<[f64; 2]>,
) -> Result<VariableDeclarator, KclError> {
    let start_sketch_at = CallExpression::new(
        "startSketchAt",
        vec![ArrayExpression::new(vec![
            Literal::new(start[0].into()).into(),
            Literal::new(start[1].into()).into(),
        ])
        .into()],
    )?;

    let initial_line = CallExpression::new(
        "line",
        vec![
            ArrayExpression::new(vec![
                Literal::new(end[0].into()).into(),
                Literal::new(end[1].into()).into(),
            ])
            .into(),
            PipeSubstitution::new().into(),
        ],
    )?;

    let mut pipe_body = vec![start_sketch_at.into(), initial_line.into()];

    for line in additional_lines {
        // TODO: we should check if we should close the sketch.
        let line = CallExpression::new(
            "line",
            vec![
                ArrayExpression::new(vec![
                    Literal::new(line[0].into()).into(),
                    Literal::new(line[1].into()).into(),
                ])
                .into(),
                PipeSubstitution::new().into(),
            ],
        )?;
        pipe_body.push(line.into());
    }

    Ok(VariableDeclarator::new(name, PipeExpression::new(pipe_body).into()))
}

fn round_to_2_places(num: f64) -> f64 {
    (num * 100.0).round() / 100.0
}
