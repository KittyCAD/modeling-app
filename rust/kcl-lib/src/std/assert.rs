//! Standard library assert functions.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{ExecState, KclValue},
    std::Args,
};

async fn _assert(value: bool, message: &str, args: &Args) -> Result<(), KclError> {
    if !value {
        return Err(KclError::Type(KclErrorDetails {
            message: format!("assert failed: {}", message),
            source_ranges: vec![args.source_range],
        }));
    }
    Ok(())
}

/// Check that the provided value is true, or raise a [KclError]
/// with the provided description.
pub async fn assert(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (data, description): (bool, String) = args.get_data()?;
    inner_assert(data, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check a value at runtime, and raise an error if the argument provided
/// is false.
///
/// ```no_run
/// myVar = true
/// assert(myVar, "should always be true")
/// ```
#[stdlib {
    name = "assert",
}]
async fn inner_assert(data: bool, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(data, message, args).await
}

pub async fn assert_lt(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_lt(left, right, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value is less than to another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// assertLessThan(1, 2, "1 is less than 2")
/// ```
#[stdlib {
    name = "assertLessThan",
}]
async fn inner_assert_lt(left: f64, right: f64, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(left < right, message, args).await
}

pub async fn assert_gt(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_gt(left, right, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value equals another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// n = 1.0285
/// o = 1.0286
/// assertEqual(n, o, 0.01, "n is within the given tolerance for o")
/// ```
#[stdlib {
    name = "assertEqual",
}]
async fn inner_assert_equal(left: f64, right: f64, epsilon: f64, message: &str, args: &Args) -> Result<(), KclError> {
    if epsilon <= 0.0 {
        Err(KclError::Type(KclErrorDetails {
            message: "assertEqual epsilon must be greater than zero".to_owned(),
            source_ranges: vec![args.source_range],
        }))
    } else if (right - left).abs() < epsilon {
        Ok(())
    } else {
        Err(KclError::Type(KclErrorDetails {
            message: format!("assert failed because {left} != {right}: {message}"),
            source_ranges: vec![args.source_range],
        }))
    }
}

pub async fn assert_equal(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, right, epsilon, description): (f64, f64, f64, String) = args.get_data()?;
    inner_assert_equal(left, right, epsilon, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value is greater than another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// assertGreaterThan(2, 1, "2 is greater than 1")
/// ```
#[stdlib {
    name = "assertGreaterThan",
}]
async fn inner_assert_gt(left: f64, right: f64, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(left > right, message, args).await
}

pub async fn assert_lte(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_lte(left, right, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value is less than or equal to another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// assertLessThanOrEq(1, 2, "1 is less than 2")
/// assertLessThanOrEq(1, 1, "1 is equal to 1")
/// ```
#[stdlib {
    name = "assertLessThanOrEq",
}]
async fn inner_assert_lte(left: f64, right: f64, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(left <= right, message, args).await
}

pub async fn assert_gte(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_gte(left, right, &description, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value is greater than or equal to another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// assertGreaterThanOrEq(2, 1, "2 is greater than 1")
/// assertGreaterThanOrEq(1, 1, "1 is equal to 1")
/// ```
#[stdlib {
    name = "assertGreaterThanOrEq",
}]
async fn inner_assert_gte(left: f64, right: f64, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(left >= right, message, args).await
}
