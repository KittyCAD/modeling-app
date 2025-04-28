//! Functions related to mathematics.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::KclError,
    execution::{
        types::{ArrayLen, NumericType, RuntimeType, UnitAngle, UnitType},
        ExecState, KclValue,
    },
    std::args::{Args, TyF64},
    CompilationError,
};

/// Compute the remainder after dividing `num` by `div`.
/// If `num` is negative, the result will be too.
pub async fn rem(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let n: TyF64 = args.get_unlabeled_kw_arg_typed("number to divide", &RuntimeType::num_any(), exec_state)?;
    let d: TyF64 = args.get_kw_arg_typed("divisor", &RuntimeType::num_any(), exec_state)?;

    let (n, d, ty) = NumericType::combine_div(n, d);
    if ty == NumericType::Unknown {
        exec_state.warn(CompilationError::err(
            args.source_range,
            "Calling `rem` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`"
        ));
    }
    let remainder = inner_rem(n, d);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(remainder, ty)))
}

/// Compute the remainder after dividing `num` by `div`.
/// If `num` is negative, the result will be too.
///
/// ```no_run
/// assert(rem( 7,    divisor =   4), isEqualTo =   3, error = "remainder is 3")
/// assert(rem(-7,    divisor =   4), isEqualTo =  -3, error = "remainder is -3")
/// assert(rem( 7,    divisor =  -4), isEqualTo =   3, error = "remainder is 3")
/// assert(rem( 6,    divisor = 2.5), isEqualTo =   1, error = "remainder is 1")
/// assert(rem( 6.5,  divisor = 2.5), isEqualTo = 1.5, error = "remainder is 1.5")
/// assert(rem( 6.5,  divisor =   2), isEqualTo = 0.5, error = "remainder is 0.5")
/// ```
#[stdlib {
    name = "rem",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        num = {docs = "The number which will be divided by `divisor`."},
        divisor = {docs = "The number which will divide `num`."},
    }
}]
fn inner_rem(num: f64, divisor: f64) -> f64 {
    num % divisor
}

/// Compute the cosine of a number (in radians).
pub async fn cos(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::angle(), exec_state)?;
    let num = match num.ty {
        NumericType::Default {
            angle: UnitAngle::Degrees,
            ..
        } => {
            exec_state.warn(CompilationError::err(
                args.source_range,
                "`cos` requires its input in radians, but the input is assumed to be in degrees. You can use a numeric suffix (e.g., `0rad`) or type ascription (e.g., `(1/2): number(rad)`) to show the number is in radians, or `units::toRadians` to convert from degrees to radians",
            ));
            num.n
        }
        NumericType::Known(UnitType::Angle(UnitAngle::Degrees)) => num.n.to_radians(),
        _ => num.n,
    };

    Ok(args.make_user_val_from_f64_with_type(TyF64::count(num.cos())))
}

/// Compute the sine of a number (in radians).
pub async fn sin(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::angle(), exec_state)?;
    let num = match num.ty {
        NumericType::Default {
            angle: UnitAngle::Degrees,
            ..
        } => {
            exec_state.warn(CompilationError::err(
                args.source_range,
                "`sin` requires its input in radians, but the input is assumed to be in degrees. You can use a numeric suffix (e.g., `0rad`) or type ascription (e.g., `(1/2): number(rad)`) to show the number is in radians, or `units::toRadians` to convert from degrees to radians",
            ));
            num.n
        }
        NumericType::Known(UnitType::Angle(UnitAngle::Degrees)) => num.n.to_radians(),
        _ => num.n,
    };
    Ok(args.make_user_val_from_f64_with_type(TyF64::count(num.sin())))
}

/// Compute the tangent of a number (in radians).
pub async fn tan(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::angle(), exec_state)?;
    let num = match num.ty {
        NumericType::Default {
            angle: UnitAngle::Degrees,
            ..
        } => {
            exec_state.warn(CompilationError::err(
                args.source_range,
                "`tan` requires its input in radians, but the input is assumed to be in degrees. You can use a numeric suffix (e.g., `0rad`) or type ascription (e.g., `(1/2): number(rad)`) to show the number is in radians, or `units::toRadians` to convert from degrees to radians",
            ));
            num.n
        }
        NumericType::Known(UnitType::Angle(UnitAngle::Degrees)) => num.n.to_radians(),
        _ => num.n,
    };
    Ok(args.make_user_val_from_f64_with_type(TyF64::count(num.tan())))
}

/// Return the value of `pi`. Archimedes’ constant (π).
pub async fn pi(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_pi()?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::count(result)))
}

/// Return the value of `pi`. Archimedes’ constant (π).
///
/// **DEPRECATED** use the constant PI
///
/// ```no_run
/// circumference = 70
///
/// exampleSketch = startSketchOn("XZ")
///  |> circle( center = [0, 0], radius = circumference/ (2 * pi()) )
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "pi",
    tags = ["math"],
    deprecated = true,
}]
fn inner_pi() -> Result<f64, KclError> {
    Ok(std::f64::consts::PI)
}

/// Compute the square root of a number.
pub async fn sqrt(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_sqrt(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the square root of a number.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 50,
///     length = sqrt(2500),
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "sqrt",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute the square root of."},
    }
}]
fn inner_sqrt(input: f64) -> f64 {
    input.sqrt()
}

/// Compute the absolute value of a number.
pub async fn abs(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_abs(input.n);

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the absolute value of a number.
///
/// ```no_run
/// myAngle = -120
///
/// sketch001 = startSketchOn('XZ')
///   |> startProfile(at = [0, 0])
///   |> line(end = [8, 0])
///   |> angledLine(
///     angle = abs(myAngle),
///     length = 5,
///   )
///   |> line(end = [-5, 0])
///   |> angledLine(
///     angle = myAngle,
///     length = 5,
///   )
///   |> close()
///
/// baseExtrusion = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "abs",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute the absolute value of."},
    }
}]
fn inner_abs(input: f64) -> f64 {
    input.abs()
}

/// Round a number to the nearest integer.
pub async fn round(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_round(input.n);

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Round a number to the nearest integer.
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///    |> startProfile(at = [0, 0])
///    |> line(endAbsolute = [12, 10])
///    |> line(end = [round(7.02986), 0])
///    |> yLine(endAbsolute = 0)
///    |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "round",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to round."},
    }
}]
fn inner_round(input: f64) -> f64 {
    input.round()
}

/// Compute the largest integer less than or equal to a number.
pub async fn floor(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_floor(input.n);

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the largest integer less than or equal to a number.
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///    |> startProfile(at = [0, 0])
///    |> line(endAbsolute = [12, 10])
///    |> line(end = [floor(7.02986), 0])
///    |> yLine(endAbsolute = 0)
///    |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "floor",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to round."},
    }
}]
fn inner_floor(input: f64) -> f64 {
    input.floor()
}

/// Compute the smallest integer greater than or equal to a number.
pub async fn ceil(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_ceil(input.n);

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the smallest integer greater than or equal to a number.
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///   |> startProfile(at = [0, 0])
///   |> line(endAbsolute = [12, 10])
///   |> line(end = [ceil(7.02986), 0])
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "ceil",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to round."},
    }
}]
fn inner_ceil(input: f64) -> f64 {
    input.ceil()
}

/// Compute the minimum of the given arguments.
pub async fn min(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let nums: Vec<TyF64> = args.get_unlabeled_kw_arg_typed(
        "input",
        &RuntimeType::Array(Box::new(RuntimeType::num_any()), ArrayLen::None),
        exec_state,
    )?;
    let (nums, ty) = NumericType::combine_eq_array(&nums);
    if ty == NumericType::Unknown {
        exec_state.warn(CompilationError::err(
            args.source_range,
            "Calling `min` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`",
        ));
    }
    let result = inner_min(nums);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, ty)))
}

/// Compute the minimum of the given arguments.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 70,
///     length = min([15, 31, 4, 13, 22])
///   )
///   |> line(end = [20, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "min",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "An array of numbers to compute the minimum of."},
    }
}]
fn inner_min(input: Vec<f64>) -> f64 {
    let mut min = f64::MAX;
    for num in input.iter() {
        if *num < min {
            min = *num;
        }
    }

    min
}

/// Compute the maximum of the given arguments.
pub async fn max(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let nums: Vec<TyF64> = args.get_unlabeled_kw_arg_typed(
        "input",
        &RuntimeType::Array(Box::new(RuntimeType::num_any()), ArrayLen::None),
        exec_state,
    )?;
    let (nums, ty) = NumericType::combine_eq_array(&nums);
    if ty == NumericType::Unknown {
        exec_state.warn(CompilationError::err(
            args.source_range,
            "Calling `max` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`",
        ));
    }
    let result = inner_max(nums);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, ty)))
}

/// Compute the maximum of the given arguments.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 70,
///     length = max([15, 31, 4, 13, 22])
///   )
///   |> line(end = [20, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "max",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "An array of numbers to compute the maximum of."},
    }
}]
fn inner_max(input: Vec<f64>) -> f64 {
    let mut max = f64::MIN;
    for num in input.iter() {
        if *num > max {
            max = *num;
        }
    }

    max
}

/// Compute the number to a power.
pub async fn pow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let exp: TyF64 = args.get_kw_arg_typed("exp", &RuntimeType::count(), exec_state)?;
    let result = inner_pow(input.n, exp.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the number to a power.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 50,
///     length = pow(5, exp = 2),
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "pow",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to raise."},
        exp = {docs = "The power to raise to."},
    }
}]
fn inner_pow(input: f64, exp: f64) -> f64 {
    input.powf(exp)
}

/// Compute the arccosine of a number (in radians).
pub async fn acos(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::count(), exec_state)?;
    let result = inner_acos(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the arccosine of a number (in radians).
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = units::toDegrees(acos(0.5)),
///     length = 10,
///   )
///   |> line(end = [5, 0])
///   |> line(endAbsolute = [12, 0])
///   |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "acos",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute arccosine of."},
    }
}]
fn inner_acos(input: f64) -> f64 {
    input.acos()
}

/// Compute the arcsine of a number (in radians).
pub async fn asin(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::count(), exec_state)?;
    let result = inner_asin(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the arcsine of a number (in radians).
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = units::toDegrees(asin(0.5)),
///     length = 20,
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "asin",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute arcsine of."},
    }
}]
fn inner_asin(input: f64) -> f64 {
    input.asin()
}

/// Compute the arctangent of a number (in radians).
pub async fn atan(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::count(), exec_state)?;
    let result = inner_atan(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the arctangent of a number (in radians).
///
/// Consider using `atan2()` instead for the true inverse of tangent.
///
/// ```no_run
/// sketch001 = startSketchOn('XZ')
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = units::toDegrees(atan(1.25)),
///     length = 20,
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "atan",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute arctangent of."},
    }
}]
fn inner_atan(input: f64) -> f64 {
    input.atan()
}

/// Compute the four quadrant arctangent of Y and X (in radians).
pub async fn atan2(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let y = args.get_kw_arg_typed("y", &RuntimeType::length(), exec_state)?;
    let x = args.get_kw_arg_typed("x", &RuntimeType::length(), exec_state)?;
    let (y, x, _) = NumericType::combine_eq_coerce(y, x);
    let result = inner_atan2(y, x);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the four quadrant arctangent of Y and X (in radians).
///
/// ```no_run
/// sketch001 = startSketchOn(XZ)
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = units::toDegrees(atan2(y = 1.25, x = 2)),
///     length = 20,
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// extrude001 = extrude(sketch001, length = 5)
/// ```
#[stdlib {
    name = "atan2",
    tags = ["math"],
    keywords = true,
    unlabeled_first = false,
    args = {
        y = { docs = "Y"},
        x = { docs = "X"},
    }
}]
fn inner_atan2(y: f64, x: f64) -> f64 {
    y.atan2(x)
}

/// Compute the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
pub async fn log(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let base: TyF64 = args.get_kw_arg_typed("base", &RuntimeType::count(), exec_state)?;
    let result = inner_log(input.n, base.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> line(end = [log(100, base = 5), 0])
///   |> line(end = [5, 8])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "log",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute the logarithm of."},
        base = {docs = "The base of the logarithm."},
    }
}]
fn inner_log(input: f64, base: f64) -> f64 {
    input.log(base)
}

/// Compute the base 2 logarithm of the number.
pub async fn log2(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_log2(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the base 2 logarithm of the number.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> line(end = [log2(100), 0])
///   |> line(end = [5, 8])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "log2",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute the logarithm of."},
    }
}]
fn inner_log2(input: f64) -> f64 {
    input.log2()
}

/// Compute the base 10 logarithm of the number.
pub async fn log10(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_log10(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the base 10 logarithm of the number.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> line(end = [log10(100), 0])
///   |> line(end = [5, 8])
///   |> line(end = [-10, 0])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "log10",
    tags = ["math"],
}]
fn inner_log10(num: f64) -> f64 {
    num.log10()
}

/// Compute the natural logarithm of the number.
pub async fn ln(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg_typed("input", &RuntimeType::num_any(), exec_state)?;
    let result = inner_ln(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the natural logarithm of the number.
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> line(end = [ln(100), 15])
///   |> line(end = [5, -6])
///   |> line(end = [-10, -10])
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "ln",
    tags = ["math"],
    keywords = true,
    unlabeled_first = true,
    args = {
        input = {docs = "The number to compute the logarithm of."},
    }
}]
fn inner_ln(input: f64) -> f64 {
    input.ln()
}

/// Return the value of Euler’s number `e`.
pub async fn e(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_e()?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::count())))
}

/// Return the value of Euler’s number `e`.
///
/// **DEPRECATED** use the constant E
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 30,
///     length = 2 * e() ^ 2,
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///  
/// example = extrude(exampleSketch, length = 10)
/// ```
#[stdlib {
    name = "e",
    tags = ["math"],
    deprecated = true,
}]
fn inner_e() -> Result<f64, KclError> {
    Ok(std::f64::consts::E)
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
pub async fn tau(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_tau()?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::count())))
}

/// Return the value of `tau`. The full circle constant (τ). Equal to 2π.
///
/// **DEPRECATED** use the constant TAU
///
/// ```no_run
/// exampleSketch = startSketchOn("XZ")
///   |> startProfile(at = [0, 0])
///   |> angledLine(
///     angle = 50,
///     length = 10 * tau(),
///   )
///   |> yLine(endAbsolute = 0)
///   |> close()
///
/// example = extrude(exampleSketch, length = 5)
/// ```
#[stdlib {
    name = "tau",
    tags = ["math"],
    deprecated = true,
}]
fn inner_tau() -> Result<f64, KclError> {
    Ok(std::f64::consts::TAU)
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[test]
    fn test_inner_max() {
        let nums = vec![4.0, 5.0, 6.0];
        let result = inner_max(nums);
        assert_eq!(result, 6.0);
    }

    #[test]
    fn test_inner_max_with_neg() {
        let nums = vec![4.0, -5.0];
        let result = inner_max(nums);
        assert_eq!(result, 4.0);
    }

    #[test]
    fn test_inner_min() {
        let nums = vec![4.0, 5.0, 6.0];
        let result = inner_min(nums);
        assert_eq!(result, 4.0);
    }

    #[test]
    fn test_inner_min_with_neg() {
        let nums = vec![4.0, -5.0];
        let result = inner_min(nums);
        assert_eq!(result, -5.0);
    }
}
