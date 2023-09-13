//! Functions related to mathematics.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{errors::KclError, executor::MemoryItem, std::Args};

/// Computes the cosine of a number (in radians).
pub fn cos(args: &mut Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_cos(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the sine of a number (in radians).
#[stdlib {
    name = "cos",
}]
fn inner_cos(num: f64) -> Result<f64, KclError> {
    Ok(num.cos())
}

/// Computes the sine of a number (in radians).
pub fn sin(args: &mut Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_sin(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the sine of a number (in radians).
#[stdlib {
    name = "sin",
}]
fn inner_sin(num: f64) -> Result<f64, KclError> {
    Ok(num.sin())
}

/// Computes the tangent of a number (in radians).
pub fn tan(args: &mut Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_tan(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the tangent of a number (in radians).
#[stdlib {
    name = "tan",
}]
fn inner_tan(num: f64) -> Result<f64, KclError> {
    Ok(num.tan())
}

/// Return the value of `pi`.
pub fn pi(args: &mut Args) -> Result<MemoryItem, KclError> {
    let result = inner_pi()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of `pi`.
#[stdlib {
    name = "pi",
}]
fn inner_pi() -> Result<f64, KclError> {
    Ok(std::f64::consts::PI)
}
