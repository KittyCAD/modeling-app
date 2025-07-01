//! Functions related to mathematics.

use anyhow::Result;

use crate::{
    CompilationError,
    errors::{KclError, KclErrorDetails},
    execution::{
        ExecState, KclValue,
        types::{ArrayLen, NumericType, RuntimeType},
    },
    std::args::{Args, TyF64},
};

/// Compute the remainder after dividing `num` by `div`.
/// If `num` is negative, the result will be too.
pub async fn rem(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let n: TyF64 = args.get_unlabeled_kw_arg("number to divide", &RuntimeType::num_any(), exec_state)?;
    let d: TyF64 = args.get_kw_arg("divisor", &RuntimeType::num_any(), exec_state)?;

    let (n, d, ty) = NumericType::combine_mod(n, d);
    if ty == NumericType::Unknown {
        exec_state.err(CompilationError::err(
            args.source_range,
            "Calling `rem` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`"
        ));
    }
    let remainder = n % d;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(remainder, ty)))
}

/// Compute the cosine of a number (in radians).
pub async fn cos(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::angle(), exec_state)?;
    let num = num.to_radians();
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(libm::cos(num), exec_state.current_default_units())))
}

/// Compute the sine of a number (in radians).
pub async fn sin(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::angle(), exec_state)?;
    let num = num.to_radians();
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(libm::sin(num), exec_state.current_default_units())))
}

/// Compute the tangent of a number (in radians).
pub async fn tan(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let num: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::angle(), exec_state)?;
    let num = num.to_radians();
    Ok(args.make_user_val_from_f64_with_type(TyF64::new(libm::tan(num), exec_state.current_default_units())))
}

/// Compute the square root of a number.
pub async fn sqrt(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;

    if input.n < 0.0 {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Attempt to take square root (`sqrt`) of a number less than zero ({})",
                input.n
            ),
            vec![args.source_range],
        )));
    }

    let result = input.n.sqrt();

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the absolute value of a number.
pub async fn abs(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.abs();

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Round a number to the nearest integer.
pub async fn round(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.round();

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the largest integer less than or equal to a number.
pub async fn floor(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.floor();

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the smallest integer greater than or equal to a number.
pub async fn ceil(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.ceil();

    Ok(args.make_user_val_from_f64_with_type(input.map_value(result)))
}

/// Compute the minimum of the given arguments.
pub async fn min(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let nums: Vec<TyF64> = args.get_unlabeled_kw_arg(
        "input",
        &RuntimeType::Array(Box::new(RuntimeType::num_any()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let (nums, ty) = NumericType::combine_eq_array(&nums);
    if ty == NumericType::Unknown {
        exec_state.warn(CompilationError::err(
            args.source_range,
            "Calling `min` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`",
        ));
    }

    let mut result = f64::MAX;
    for num in nums {
        if num < result {
            result = num;
        }
    }

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, ty)))
}

/// Compute the maximum of the given arguments.
pub async fn max(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let nums: Vec<TyF64> = args.get_unlabeled_kw_arg(
        "input",
        &RuntimeType::Array(Box::new(RuntimeType::num_any()), ArrayLen::Minimum(1)),
        exec_state,
    )?;
    let (nums, ty) = NumericType::combine_eq_array(&nums);
    if ty == NumericType::Unknown {
        exec_state.warn(CompilationError::err(
            args.source_range,
            "Calling `max` on numbers which have unknown or incompatible units.\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`",
        ));
    }

    let mut result = f64::MIN;
    for num in nums {
        if num > result {
            result = num;
        }
    }

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, ty)))
}

/// Compute the number to a power.
pub async fn pow(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let exp: TyF64 = args.get_kw_arg("exp", &RuntimeType::count(), exec_state)?;
    let result = input.n.powf(exp.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the arccosine of a number (in radians).
pub async fn acos(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::count(), exec_state)?;
    let result = libm::acos(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the arcsine of a number (in radians).
pub async fn asin(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::count(), exec_state)?;
    let result = libm::asin(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the arctangent of a number (in radians).
pub async fn atan(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::count(), exec_state)?;
    let result = libm::atan(input.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the four quadrant arctangent of Y and X (in radians).
pub async fn atan2(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let y = args.get_kw_arg("y", &RuntimeType::length(), exec_state)?;
    let x = args.get_kw_arg("x", &RuntimeType::length(), exec_state)?;
    let (y, x, _) = NumericType::combine_eq_coerce(y, x);
    let result = libm::atan2(y, x);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, NumericType::radians())))
}

/// Compute the logarithm of the number with respect to an arbitrary base.
///
/// The result might not be correctly rounded owing to implementation
/// details; `log2()` can produce more accurate results for base 2,
/// and `log10()` can produce more accurate results for base 10.
pub async fn log(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let base: TyF64 = args.get_kw_arg("base", &RuntimeType::count(), exec_state)?;
    let result = input.n.log(base.n);

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the base 2 logarithm of the number.
pub async fn log2(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.log2();

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the base 10 logarithm of the number.
pub async fn log10(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.log10();

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the natural logarithm of the number.
pub async fn ln(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input: TyF64 = args.get_unlabeled_kw_arg("input", &RuntimeType::num_any(), exec_state)?;
    let result = input.n.ln();

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Compute the length of the given leg.
pub async fn leg_length(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let hypotenuse: TyF64 = args.get_kw_arg("hypotenuse", &RuntimeType::length(), exec_state)?;
    let leg: TyF64 = args.get_kw_arg("leg", &RuntimeType::length(), exec_state)?;
    let (hypotenuse, leg, ty) = NumericType::combine_eq_coerce(hypotenuse, leg);
    let result = (hypotenuse.powi(2) - f64::min(hypotenuse.abs(), leg.abs()).powi(2)).sqrt();
    Ok(KclValue::from_number_with_type(result, ty, vec![args.into()]))
}

/// Compute the angle of the given leg for x.
pub async fn leg_angle_x(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let hypotenuse: TyF64 = args.get_kw_arg("hypotenuse", &RuntimeType::length(), exec_state)?;
    let leg: TyF64 = args.get_kw_arg("leg", &RuntimeType::length(), exec_state)?;
    let (hypotenuse, leg, _ty) = NumericType::combine_eq_coerce(hypotenuse, leg);
    let result = libm::acos(leg.min(hypotenuse) / hypotenuse).to_degrees();
    Ok(KclValue::from_number_with_type(
        result,
        NumericType::degrees(),
        vec![args.into()],
    ))
}

/// Compute the angle of the given leg for y.
pub async fn leg_angle_y(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let hypotenuse: TyF64 = args.get_kw_arg("hypotenuse", &RuntimeType::length(), exec_state)?;
    let leg: TyF64 = args.get_kw_arg("leg", &RuntimeType::length(), exec_state)?;
    let (hypotenuse, leg, _ty) = NumericType::combine_eq_coerce(hypotenuse, leg);
    let result = libm::asin(leg.min(hypotenuse) / hypotenuse).to_degrees();
    Ok(KclValue::from_number_with_type(
        result,
        NumericType::degrees(),
        vec![args.into()],
    ))
}
