//! Functions for calling into the engine-utils library (a set of C++ utilities containing various logic for client-side CAD processing)
//! Note that this binary may not be available to all builds of kcl, so fallbacks that call the engine API should be implemented

use crate::{
    errors::{KclError, KclErrorDetails},
    std::Args,
};
use anyhow::Result;
use std::ffi::{CString, CStr};
use kittycad_modeling_cmds::{length_unit::LengthUnit, shared::Point3d};

mod cpp {
    use std::os::raw::c_char;

    extern "C" {
        pub fn kcEngineUtilsEvaluatePath(sketch: *const c_char, t: f64) -> *const c_char;
    }
}


pub fn is_available() -> bool {
    true
}

pub async fn get_true_path_end_pos(sketch: String, args: &Args) -> Result<Point3d<LengthUnit>, KclError> {
    let c_string = CString::new(sketch).map_err(|e| {
        KclError::Internal(KclErrorDetails {
            message: format!("{:?}", e),
            source_ranges: vec![args.source_range],
        })
    })?;
    let arg = c_string.into_raw();
    let result_string: String;

    unsafe {
        let result = cpp::kcEngineUtilsEvaluatePath(arg, 1.0);
        let result_cstr = CStr::from_ptr(result);
        let str_slice: &str = result_cstr.to_str().map_err(|e| {
            KclError::Internal(KclErrorDetails {
                message: format!("{:?}", e),
                source_ranges: vec![args.source_range],
            })
        })?;
        let str_buf: String = str_slice.to_owned();    
        result_string = str_buf.clone();
        let _ = CString::from_raw(arg);
    }

    let point: Point3d<f64> = serde_json::from_str(&result_string).map_err(|e| {
        KclError::Type(KclErrorDetails {
            message: format!("Failed to path position from json: {}", e),
            source_ranges: vec![args.source_range],
        })
    })?;
    
    Ok(Point3d::<f64>::from(point).map(LengthUnit))
}
