//! Standard library assert functions.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{types::RuntimeType, ExecState, KclValue},
    std::Args,
};

use super::args::TyF64;

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
pub async fn assert(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let condition = args.get_unlabeled_kw_arg_typed("condition", &RuntimeType::bool(), exec_state)?;
    let error: String = args.get_kw_arg("error")?;
    inner_assert(condition, &error, &args).await?;
    Ok(KclValue::none())
}

/// Check a value at runtime, and raise an error if the argument provided
/// is false.
///
/// ```no_run
/// isTenEven = mod(10, 2) == 0
/// assert(isTenEven, error = "10 is actually even")
/// ```
#[stdlib {
    name = "assert",
    keywords = true,
    unlabeled_first = true,
    args = {
        condition = { docs = "Value to check. If this is true, the assert function does nothing. If it's false, the program will emit the error." },
        error = { docs = "If the value was false, the program will terminate with this error message" },
    }
}]
async fn inner_assert(condition: bool, error: &str, args: &Args) -> Result<(), KclError> {
    _assert(condition, error, args).await
}

pub async fn assert_order(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let small: TyF64 = args.get_kw_arg("small")?;
    let big: TyF64 = args.get_kw_arg("big")?;
    let or_equal = args.get_kw_arg("orEqual")?;
    let error: String = args.get_kw_arg("error")?;
    inner_assert_order(small.n, big.n, or_equal, &error, &args).await?;
    Ok(KclValue::none())
}

/// Check that a numerical value is less than to another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// assertOrder(small = 1, big = 2, error = "1 is < 2")
/// assertOrder(small = 1, big = 1, orEqual = true, error = "1 is <= 1")
/// ```
#[stdlib {
    name = "assertOrder",
    keywords = true,
    unlabeled_first = true,
    args = {
        small = { docs = "This value should be smaller" },
        big = { docs = "This value should be larger" },
        or_equal = { docs = "If true, this assert passes if smaller equals larger" },
        error = { docs = "If smaller is not less than larger, the program will terminate with this error message" },
    }
}]
async fn inner_assert_order(small: f64, big: f64, or_equal: bool, error: &str, args: &Args) -> Result<(), KclError> {
    if or_equal {
        _assert(small <= big, error, args).await
    } else {
        _assert(small < big, error, args).await
    }
}

/// Check that a numerical value equals another at runtime,
/// otherwise raise an error.
///
/// ```no_run
/// n = 1.0285
/// o = 1.0286
/// assertEqual(actual = expected=n, expected = actual=o, epsilon = epsilon=0.01, error = error="n is within the given tolerance for o")
/// ```
#[stdlib {
    name = "assertEqual",
    keywords = true,
    unlabeled_first = false,
    args = {
        expected = { docs = "The value you expect" },
        actual = { docs = "The value you actually found" },
        epsilon = { docs = "Permissible difference between expected and found" },
        error = { docs = "If expected and actual aren't within the given epsilon, the program will terminate with this error" },
    }
}]
async fn inner_assert_equal(
    expected: f64,
    actual: f64,
    epsilon: f64,
    error: &str,
    args: &Args,
) -> Result<(), KclError> {
    if epsilon <= 0.0 {
        Err(KclError::Type(KclErrorDetails {
            message: "assertEqual epsilon must be greater than zero".to_owned(),
            source_ranges: vec![args.source_range],
        }))
    } else if (actual - expected).abs() < epsilon {
        Ok(())
    } else {
        Err(KclError::Type(KclErrorDetails {
            message: format!("assert failed because expected {expected} but actually got {actual}: {error}"),
            source_ranges: vec![args.source_range],
        }))
    }
}

pub async fn assert_equal(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let expected: TyF64 = args.get_kw_arg("expected")?;
    let actual: TyF64 = args.get_kw_arg("actual")?;
    let epsilon: TyF64 = args.get_kw_arg("epsilon")?;
    let error: String = args.get_kw_arg("error")?;

    inner_assert_equal(expected.n, actual.n, epsilon.n, &error, &args).await?;
    Ok(KclValue::none())
}
