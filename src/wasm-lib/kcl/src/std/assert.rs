//! Standard library assert functions.

use anyhow::Result;
use derive_docs::stdlib;
use schemars::JsonSchema;

use crate::{
    errors::{KclError, KclErrorDetails},
    executor::MemoryItem,
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
pub async fn assert(args: Args) -> Result<MemoryItem, KclError> {
    let (data, description): (bool, String) = args.get_data()?;
    inner_assert(data, &description, &args).await?;
    args.make_null_user_val()
}

/// Check a value at runtime, and raise an error if the argument provided
/// is false.
///
/// ```no_run
/// const myVar = true
/// assert(myVar, "should always be true")
/// ```
#[stdlib {
    name = "assert",
}]
async fn inner_assert(data: bool, message: &str, args: &Args) -> Result<(), KclError> {
    _assert(data, message, args).await
}

pub async fn assert_lt(args: Args) -> Result<MemoryItem, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_lt(left, right, &description, &args).await?;
    args.make_null_user_val()
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

pub async fn assert_gt(args: Args) -> Result<MemoryItem, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_gt(left, right, &description, &args).await?;
    args.make_null_user_val()
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

pub async fn assert_lte(args: Args) -> Result<MemoryItem, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_lte(left, right, &description, &args).await?;
    args.make_null_user_val()
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

pub async fn assert_gte(args: Args) -> Result<MemoryItem, KclError> {
    let (left, right, description): (f64, f64, String) = args.get_data()?;
    inner_assert_gte(left, right, &description, &args).await?;
    args.make_null_user_val()
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
