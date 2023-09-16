use kittycad::types::ModelingCmd;

use crate::{
    ast::types::{FormatOptions, Program},
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
    executor::SourceRange,
};

/// Update the AST to reflect the new state of the program after something like
/// a move or a new line.
pub async fn modify_ast_for_sketch(
    engine: &mut EngineConnection,
    program: &Program,
    // The ID of the parent sketch.
    sketch_id: uuid::Uuid,
) -> Result<(Program, String), KclError> {
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
    let mut handles = vec![];
    for segment in &path_info.segments {
        if let Some(command_id) = &segment.command_id {
            let h = engine.send_modeling_cmd_get_response(
                uuid::Uuid::new_v4(),
                SourceRange::default(),
                ModelingCmd::CurveGetControlPoints { curve_id: *command_id },
            );
            handles.push(h.await?);
        }
    }

    /*let mut control_points = vec![];
    for handle in handles {
        control_points.push(handle.await?);
    }*/
    // TODO await all these.

    let control_points = handles;

    println!("control_points: {:?}", control_points);

    // Okay now let's recalculate the sketch from the control points.

    Ok((program.clone(), program.recast(&FormatOptions::default(), 0)))
}
