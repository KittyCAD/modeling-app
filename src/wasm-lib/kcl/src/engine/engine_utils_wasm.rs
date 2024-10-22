//! Functions for calling into the engine-utils library (a set of C++ utilities containing various logic for client-side CAD processing)
//! Note that this binary may not be available to all builds of kcl, so fallbacks that call the engine API should be implemented

use crate::{
    errors::{KclError, KclErrorDetails},
    std::Args,
};
use anyhow::Result;
use kittycad_modeling_cmds::{length_unit::LengthUnit, shared::Point3d};
mod cpp {
    use wasm_bindgen::prelude::wasm_bindgen;

    #[wasm_bindgen(module = "/../../lib/engineUtils.ts")]
    extern "C" {
        #[wasm_bindgen(js_name = getTruePathEndPos, catch)]
        pub fn get_true_path_end_pos(sketch: String) -> Result<js_sys::Promise, js_sys::Error>;
    }
}

pub fn is_available() -> bool {
    true
}

async fn call_cpp<F>(args: &Args, f: F) -> Result<String, KclError>
where
    F: FnOnce() -> Result<js_sys::Promise, js_sys::Error>,
{
    let promise = f().map_err(|e| {
        KclError::Internal(KclErrorDetails {
            message: format!("{:?}", e),
            source_ranges: vec![args.source_range],
        })
    })?;

    let result = crate::wasm::JsFuture::from(promise).await.map_err(|e| {
        KclError::Internal(KclErrorDetails {
            message: format!("{:?}", e),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(result.as_string().unwrap_or_default())
}

pub async fn get_true_path_end_pos(sketch: String, args: &Args) -> Result<Point3d<LengthUnit>, KclError> {
    let result_str = call_cpp(args, || cpp::get_true_path_end_pos(sketch.into())).await?;

    let point: Point3d<f64> = serde_json::from_str(&result_str).map_err(|e| {
        KclError::Type(KclErrorDetails {
            message: format!("Failed to path position from json: {}", e),
            source_ranges: vec![args.source_range],
        })
    })?;

    Ok(Point3d::<f64>::from(point).map(LengthUnit))
}
