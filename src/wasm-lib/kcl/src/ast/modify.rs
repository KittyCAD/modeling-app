use std::collections::HashMap;

use kittycad::types::ModelingCmd;

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
    let mut handles = HashMap::new();
    for segment in &path_info.segments {
        if let Some(command_id) = &segment.command_id {
            let h = engine.send_modeling_cmd_get_response(
                uuid::Uuid::new_v4(),
                SourceRange::default(),
                ModelingCmd::CurveGetControlPoints { curve_id: *command_id },
            );
            handles.insert(command_id, (h.await?, segment.command.clone()));
        }
    }

    // TODO await all these.
    let mut control_points = Vec::new();
    for (id, (handle, command)) in handles {
        let kittycad::types::OkWebSocketResponseData::Modeling {
            modeling_response: kittycad::types::OkModelingCmdResponse::CurveGetControlPoints { data },
        } = handle
        else {
            return Err(KclError::Engine(KclErrorDetails {
                message: format!("Curve get control points response was not as expected: {:?}", resp),
                source_ranges: vec![SourceRange::default()],
            }));
        };
        control_points.push(ControlPointData {
            points: data.control_points,
            command,
            id: *id,
        });
    }

    println!("control_points: {:#?}", control_points);

    if control_points.is_empty() {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("No control points found for sketch {}", sketch_name),
            source_ranges: vec![SourceRange::default()],
        }));
    }

    let first_control_points = &control_points[0];

    let mut additional_lines = Vec::new();
    for control_point in &control_points[1..] {
        additional_lines.push([control_point.points[0].x, control_point.points[0].y]);
    }

    // Okay now let's recalculate the sketch from the control points.
    let sketch = create_start_sketch_at(
        sketch_name,
        [first_control_points.points[0].x, first_control_points.points[0].y],
        [first_control_points.points[1].x, first_control_points.points[1].y],
        additional_lines,
    )?;

    println!("sketch: {:#?}", sketch);

    // Add the sketch back to the program.
    program.replace_variable(sketch_name, sketch);

    Ok(program.recast(&FormatOptions::default(), 0))
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
