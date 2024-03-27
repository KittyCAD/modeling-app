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
pub async fn cos(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_cos(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the sine of a number (in radians).
///
/// ```no_run
/// const anotherVar = cos(2*pi())
/// ```
#[stdlib {
    name = "cos",
    tags = ["math"],
}]
fn inner_cos(num: f64) -> Result<f64, KclError> {
    Ok(num.cos())
}

/// Computes the sine of a number (in radians).
pub async fn sin(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_sin(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the sine of a number (in radians).
///
/// ```no_run
/// const myVar = sin(2*pi())
/// ```
#[stdlib {
    name = "sin",
    tags = ["math"],
}]
fn inner_sin(num: f64) -> Result<f64, KclError> {
    Ok(num.sin())
}

/// Computes the tangent of a number (in radians).
pub async fn tan(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_tan(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the tangent of a number (in radians).
///
/// ```no_run
/// const myVar = tan(2*pi())
/// ```
#[stdlib {
    name = "tan",
    tags = ["math"],
}]
fn inner_tan(num: f64) -> Result<f64, KclError> {
    Ok(num.tan())
}

/// Return the value of `pi`. Archimedes’ constant (π).
pub async fn pi(args: Args) -> Result<MemoryItem, KclError> {
    let result = inner_pi()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of `pi`. Archimedes’ constant (π).
///
/// ```no_run
/// const myVar = pi() * 3.0
/// ```
#[stdlib {
    name = "pi",
    tags = ["math"],
}]
fn inner_pi() -> Result<f64, KclError> {
    Ok(std::f64::consts::PI)
}

/// Computes the square root of a number.
pub async fn sqrt(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_sqrt(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the square root of a number.
///
/// ```no_run
/// const myVar = sqrt(4)
/// ```
#[stdlib {
    name = "sqrt",
    tags = ["math"],
}]
fn inner_sqrt(num: f64) -> Result<f64, KclError> {
    Ok(num.sqrt())
}

/// Computes the absolute value of a number.
pub async fn abs(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_abs(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the absolute value of a number.
///
/// ```no_run
/// const myVar = abs(-4)
/// ```
#[stdlib {
    name = "abs",
    tags = ["math"],
}]
fn inner_abs(num: f64) -> Result<f64, KclError> {
    Ok(num.abs())
}

/// Computes the largest integer less than or equal to a number.
pub async fn floor(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_floor(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the largest integer less than or equal to a number.
///
/// ```no_run
/// const myVar = floor(4.5)
/// ```
#[stdlib {
    name = "floor",
    tags = ["math"],
}]
fn inner_floor(num: f64) -> Result<f64, KclError> {
    Ok(num.floor())
}

/// Computes the smallest integer greater than or equal to a number.
pub async fn ceil(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_ceil(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the smallest integer greater than or equal to a number.
///
/// ```no_run
/// const myVar = ceil(4.5)
/// ```
#[stdlib {
    name = "ceil",
    tags = ["math"],
}]
fn inner_ceil(num: f64) -> Result<f64, KclError> {
    Ok(num.ceil())
}

/// Computes the minimum of the given arguments.
pub async fn min(args: Args) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    let result = inner_min(nums);

    args.make_user_val_from_f64(result)
}

/// Computes the minimum of the given arguments.
///
/// ```no_run
/// const myVar = min(4, 5, 6)
/// ```
#[stdlib {
    name = "min",
    tags = ["math"],
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
pub async fn max(args: Args) -> Result<MemoryItem, KclError> {
    let nums = args.get_number_array()?;
    let result = inner_max(nums);

    args.make_user_val_from_f64(result)
}

/// Computes the maximum of the given arguments.
///
/// ```no_run
/// const myVar = max(4, 5, 6)
/// ```
#[stdlib {
    name = "max",
    tags = ["math"],
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
pub async fn pow(args: Args) -> Result<MemoryItem, KclError> {
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
///
/// ```no_run
/// const myVar = pow(4, 2)
/// ```
#[stdlib {
    name = "pow",
    tags = ["math"],
}]
fn inner_pow(num: f64, pow: f64) -> Result<f64, KclError> {
    Ok(num.powf(pow))
}

/// Computes the arccosine of a number (in radians).
pub async fn acos(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_acos(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arccosine of a number (in radians).
///
/// ```no_run
/// const myVar = acos(0.5)
/// ```
#[stdlib {
    name = "acos",
    tags = ["math"],
}]
fn inner_acos(num: f64) -> Result<f64, KclError> {
    Ok(num.acos())
}

/// Computes the arcsine of a number (in radians).
pub async fn asin(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_asin(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arcsine of a number (in radians).
///
/// ```no_run
/// const myVar = asin(0.5)
/// ```
#[stdlib {
    name = "asin",
    tags = ["math"],
}]
fn inner_asin(num: f64) -> Result<f64, KclError> {
    Ok(num.asin())
}

/// Computes the arctangent of a number (in radians).
pub async fn atan(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_atan(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the arctangent of a number (in radians).
///
/// ```no_run
/// const myVar = atan(1.0)
/// ```
#[stdlib {
    name = "atan",
    tags = ["math"],
}]
fn inner_atan(num: f64) -> Result<f64, KclError> {
    Ok(num.atan())
}

/// Computes the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
pub async fn log(args: Args) -> Result<MemoryItem, KclError> {
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
///
/// ```no_run
/// const myVar = log(4, 2)
/// ```
#[stdlib {
    name = "log",
    tags = ["math"],
}]
fn inner_log(num: f64, base: f64) -> Result<f64, KclError> {
    Ok(num.log(base))
}

/// Computes the base 2 logarithm of the number.
pub async fn log2(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_log2(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the base 2 logarithm of the number.
///
/// ```no_run
/// const myVar = log2(4)
/// ```
#[stdlib {
    name = "log2",
    tags = ["math"],
}]
fn inner_log2(num: f64) -> Result<f64, KclError> {
    Ok(num.log2())
}

/// Computes the base 10 logarithm of the number.
pub async fn log10(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_log10(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the base 10 logarithm of the number.
///
/// ```no_run
/// const myVar = log10(4)
/// ```
#[stdlib {
    name = "log10",
    tags = ["math"],
}]
fn inner_log10(num: f64) -> Result<f64, KclError> {
    Ok(num.log10())
}

/// Computes the natural logarithm of the number.
pub async fn ln(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_ln(num)?;

    args.make_user_val_from_f64(result)
}

/// Computes the natural logarithm of the number.
///
/// ```no_run
/// const myVar = ln(4)
/// ```
#[stdlib {
    name = "ln",
    tags = ["math"],
}]
fn inner_ln(num: f64) -> Result<f64, KclError> {
    Ok(num.ln())
}

/// Return the value of Euler’s number `e`.
pub async fn e(args: Args) -> Result<MemoryItem, KclError> {
    let result = inner_e()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of Euler’s number `e`.
///
/// ```no_run
/// const myVar = e()
/// ```
#[stdlib {
    name = "e",
    tags = ["math"],
}]
fn inner_e() -> Result<f64, KclError> {
    Ok(std::f64::consts::E)
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
pub async fn tau(args: Args) -> Result<MemoryItem, KclError> {
    let result = inner_tau()?;

    args.make_user_val_from_f64(result)
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
///
/// ```no_run
/// const myVar = tau()
/// ```
#[stdlib {
    name = "tau",
    tags = ["math"],
}]
fn inner_tau() -> Result<f64, KclError> {
    Ok(std::f64::consts::TAU)
}

/// Converts a number from degrees to radians.
pub async fn to_radians(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_to_radians(num)?;

    args.make_user_val_from_f64(result)
}

/// Converts a number from degrees to radians.
///
/// ```no_run
/// const myVar = toRadians(180)
/// ```
#[stdlib {
    name = "toRadians",
    tags = ["math"],
}]
fn inner_to_radians(num: f64) -> Result<f64, KclError> {
    Ok(num.to_radians())
}

/// Converts a number from radians to degrees.
pub async fn to_degrees(args: Args) -> Result<MemoryItem, KclError> {
    let num = args.get_number()?;
    let result = inner_to_degrees(num)?;

    args.make_user_val_from_f64(result)
}

/// Converts a number from radians to degrees.
///
/// ```no_run
/// const myVar = toDegrees(2 * pi())
/// ```
#[stdlib {
    name = "toDegrees",
    tags = ["math"],
}]
fn inner_to_degrees(num: f64) -> Result<f64, KclError> {
    Ok(num.to_degrees())
}
