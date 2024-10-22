//! Functions for calling into the engine-utils library (a set of C++ utilities containing various logic for client-side CAD processing)
//! Note that this binary may not be available to all builds of kcl, so fallbacks that call the engine API should be implemented

use crate::{
    errors::{KclError, KclErrorDetails},
    std::Args,
};
use crate::engine::kcmc::{each_cmd as mcmd, ModelingCmd};
use anyhow::Result;
use kittycad_modeling_cmds::{length_unit::LengthUnit, ok_response::OkModelingCmdResponse, shared::Point3d, websocket::OkWebSocketResponseData};

pub fn is_available() -> bool {
    true
}

pub async fn get_true_path_end_pos(sketch: String, args: &Args) -> Result<Point3d<LengthUnit>, KclError> {
    let id = uuid::Uuid::new_v4();
    
    let resp = args.send_modeling_cmd(id, ModelingCmd::from(mcmd::EngineUtilEvaluatePath {
        path_json: sketch,
        t: 1.0,
    })).await?;

    let OkWebSocketResponseData::Modeling {
        modeling_response: OkModelingCmdResponse::EngineUtilEvaluatePath(point),
    } = &resp 
    else {
        return Err(KclError::Engine(KclErrorDetails {
            message: format!("mcmd::EngineUtilEvaluatePath response was not as expected: {:?}", resp),
            source_ranges: vec![args.source_range],
        }));
    };

    Ok(point.pos)
}
