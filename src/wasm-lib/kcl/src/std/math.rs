//! Functions related to mathematics.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::MemoryItem,
    std::Args,
};

/// Computes the cosine of a number (in radians).
pub async fn cos(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
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
pub async fn sin(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
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
pub async fn tan(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
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

/// Return the value of `pi`. Archimedes’ constant (π).
pub async fn pi(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let result = inner_pi()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of `pi`. Archimedes’ constant (π).
#[stdlib {
    name = "pi",
}]
fn inner_pi() -> Result<f64, KclError> {
    Ok(std::f64::consts::PI)
}

/// Computes the square root of a number.
pub async fn sqrt(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_sqrt(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the square root of a number.
#[stdlib {
    name = "sqrt",
}]
fn inner_sqrt(num: f64) -> Result<f64, KclError> {
    Ok(num.sqrt())
}

/// Computes the absolute value of a number.
pub async fn abs(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_abs(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the absolute value of a number.
#[stdlib {
    name = "abs",
}]
fn inner_abs(num: f64) -> Result<f64, KclError> {
    Ok(num.abs())
}

/// Computes the largest integer less than or equal to a number.
pub async fn floor(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_floor(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the largest integer less than or equal to a number.
#[stdlib {
    name = "floor",
}]
fn inner_floor(num: f64) -> Result<f64, KclError> {
    Ok(num.floor())
}

/// Computes the smallest integer greater than or equal to a number.
pub async fn ceil(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_ceil(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the smallest integer greater than or equal to a number.
#[stdlib {
    name = "ceil",
}]
fn inner_ceil(num: f64) -> Result<f64, KclError> {
    Ok(num.ceil())
}

/// Computes the minimum of the given arguments.
pub async fn min(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    let result = inner_min(nums);

    args.make_user_val_from_f64(result)
}

/// Computes the minimum of the given arguments.
#[stdlib {
    name = "min",
}]
fn inner_min(args: Vec<f64>) -> f64 {
    let mut min = std::f64::MAX;
    for arg in args.iter() {
        if *arg < min {
            min = *arg;
        }
    }

    min
}

/// Computes the maximum of the given arguments.
pub async fn max(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    let result = inner_max(nums);

    args.make_user_val_from_f64(result)
}

/// Computes the maximum of the given arguments.
#[stdlib {
    name = "max",
}]
fn inner_max(args: Vec<f64>) -> f64 {
    let mut max = std::f64::MAX;
    for arg in args.iter() {
        if *arg > max {
            max = *arg;
        }
    }

    max
}

/// Computes the number to a power.
pub async fn pow(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    if nums.len() > 2 {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("expected 2 arguments, got {}", nums.len()),
            source_ranges: vec![args.source_range],
        }));
    }

    if nums.len() <= 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("expected 2 arguments, got {}", nums.len()),
            source_ranges: vec![args.source_range],
        }));
    }

    let result = inner_pow(nums[0], nums[1])?;

    args.make_user_val_from_f64(result)
}

/// Computes the number to a power.
#[stdlib {
    name = "pow",
}]
fn inner_pow(num: f64, pow: f64) -> Result<f64, KclError> {
    Ok(num.powf(pow))
}

/// Computes the arccosine of a number (in radians).
pub async fn acos(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_acos(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arccosine of a number (in radians).
#[stdlib {
    name = "acos",
}]
fn inner_acos(num: f64) -> Result<f64, KclError> {
    Ok(num.acos())
}

/// Computes the arcsine of a number (in radians).
pub async fn asin(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_asin(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arcsine of a number (in radians).
#[stdlib {
    name = "asin",
}]
fn inner_asin(num: f64) -> Result<f64, KclError> {
    Ok(num.asin())
}

/// Computes the arctangent of a number (in radians).
pub async fn atan(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_atan(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arctangent of a number (in radians).
#[stdlib {
    name = "atan",
}]
fn inner_atan(num: f64) -> Result<f64, KclError> {
    Ok(num.atan())
}

/// Computes the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
pub async fn log(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    if nums.len() > 2 {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("expected 2 arguments, got {}", nums.len()),
            source_ranges: vec![args.source_range],
        }));
    }

    if nums.len() <= 1 {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("expected 2 arguments, got {}", nums.len()),
            source_ranges: vec![args.source_range],
        }));
    }
    let result = inner_log(nums[0], nums[1])?;

    args.make_user_val_from_f64(result)
}

/// Computes the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
#[stdlib {
    name = "log",
}]
fn inner_log(num: f64, base: f64) -> Result<f64, KclError> {
    Ok(num.log(base))
}

/// Computes the base 2 logarithm of the number.
pub async fn log2(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_log2(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the base 2 logarithm of the number.
#[stdlib {
    name = "log2",
}]
fn inner_log2(num: f64) -> Result<f64, KclError> {
    Ok(num.log2())
}

/// Computes the base 10 logarithm of the number.
pub async fn log10(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_log10(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the base 10 logarithm of the number.
#[stdlib {
    name = "log10",
}]
fn inner_log10(num: f64) -> Result<f64, KclError> {
    Ok(num.log10())
}

/// Computes the natural logarithm of the number.
pub async fn ln(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_ln(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the natural logarithm of the number.
#[stdlib {
    name = "ln",
}]
fn inner_ln(num: f64) -> Result<f64, KclError> {
    Ok(num.ln())
}

/// Return the value of Euler’s number `e`.
pub async fn e(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let result = inner_e()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of Euler’s number `e`.
#[stdlib {
    name = "e",
}]
fn inner_e() -> Result<f64, KclError> {
    Ok(std::f64::consts::E)
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
pub async fn tau(args: &mut Args<'_>) -> Result<MemoryItem, KclError> {
    let result = inner_tau()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
#[stdlib {
    name = "tau",
}]
fn inner_tau() -> Result<f64, KclError> {
    Ok(std::f64::consts::TAU)
}
