//! Functions related to unitsematics.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::KclError,
    execution::{types::UnitLen, ExecState, KclValue},
    std::{args::TyF64, Args},
};

/// Millimeters conversion factor for current files units.
pub async fn from_mm(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_mm(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from mm to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in millimeters.
///
/// For example, if the current file uses inches, `fromMm(1)` will return `1/25.4`.
/// If the current file uses millimeters, `fromMm(1)` will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromMm(10)` is more readable that your intent is "I want 10 millimeters" than
/// `10 * (1/25.4)`, if the file settings are in inches.
///
/// ```no_run
/// totalWidth = fromMm(10)
/// ```
#[stdlib {
    name = "fromMm",
    tags = ["units"],
}]
fn inner_from_mm(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    Ok(match exec_state.length_unit() {
        UnitLen::Mm => input,
        UnitLen::Inches => measurements::Length::from_millimeters(input).as_inches(),
        UnitLen::Feet => measurements::Length::from_millimeters(input).as_feet(),
        UnitLen::M => measurements::Length::from_millimeters(input).as_meters(),
        UnitLen::Cm => measurements::Length::from_millimeters(input).as_centimeters(),
        UnitLen::Yards => measurements::Length::from_millimeters(input).as_yards(),
    })
}

/// Inches conversion factor for current files units.
pub async fn from_inches(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_inches(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from inches to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in inches.
///
/// For example, if the current file uses inches, `fromInches(1)` will return `1`.
/// If the current file uses millimeters, `fromInches(1)` will return `25.4`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromInches(10)` is more readable that your intent is "I want 10 inches" than
/// `10 * 25.4`, if the file settings are in millimeters.
///
/// ```no_run
/// totalWidth = fromInches(10)
/// ```
#[stdlib {
    name = "fromInches",
    tags = ["units"],
}]
fn inner_from_inches(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_inches(input).as_millimeters()),
        UnitLen::Inches => Ok(input),
        UnitLen::Feet => Ok(measurements::Length::from_inches(input).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_inches(input).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_inches(input).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_inches(input).as_yards()),
    }
}

/// Feet conversion factor for current files units.
pub async fn from_ft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_ft(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from feet to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in feet.
///
/// For example, if the current file uses inches, `fromFt(1)` will return `12`.
/// If the current file uses millimeters, `fromFt(1)` will return `304.8`.
/// If the current file uses feet, `fromFt(1)` will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromFt(10)` is more readable that your intent is "I want 10 feet" than
/// `10 * 304.8`, if the file settings are in millimeters.
///
/// ```no_run
/// totalWidth = fromFt(10)
/// ```
#[stdlib {
    name = "fromFt",
    tags = ["units"],
}]
fn inner_from_ft(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_feet(input).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_feet(input).as_inches()),
        UnitLen::Feet => Ok(input),
        UnitLen::M => Ok(measurements::Length::from_feet(input).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_feet(input).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_feet(input).as_yards()),
    }
}

/// Meters conversion factor for current files units.
pub async fn from_m(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_m(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from meters to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in meters.
///
/// For example, if the current file uses inches, `fromM(1)` will return `39.3701`.
/// If the current file uses millimeters, `fromM(1)` will return `1000`.
/// If the current file uses meters, `fromM(1)` will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromM(10)` is more readable that your intent is "I want 10 meters" than
/// `10 * 1000`, if the file settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * fromM(10)
/// ```
#[stdlib {
    name = "fromM",
    tags = ["units"],
}]
fn inner_from_m(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_meters(input).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_meters(input).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_meters(input).as_feet()),
        UnitLen::M => Ok(input),
        UnitLen::Cm => Ok(measurements::Length::from_meters(input).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_meters(input).as_yards()),
    }
}

/// Centimeters conversion factor for current files units.
pub async fn from_cm(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_cm(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from centimeters to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in centimeters.
///
/// For example, if the current file uses inches, `fromCm(1)` will return `0.393701`.
/// If the current file uses millimeters, `fromCm(1)` will return `10`.
/// If the current file uses centimeters, `fromCm(1)` will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromCm(10)` is more readable that your intent is "I want 10 centimeters" than
/// `10 * 10`, if the file settings are in millimeters.
///
/// ```no_run
/// totalWidth = fromCm(10)
/// ```
#[stdlib {
    name = "fromCm",
    tags = ["units"],
}]
fn inner_from_cm(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_centimeters(input).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_centimeters(input).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_centimeters(input).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_centimeters(input).as_meters()),
        UnitLen::Cm => Ok(input),
        UnitLen::Yards => Ok(measurements::Length::from_centimeters(input).as_yards()),
    }
}

/// Yards conversion factor for current files units.
pub async fn from_yd(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let input = args.get_number()?;
    let result = inner_from_yd(input, exec_state)?;

    Ok(args.make_user_val_from_f64_with_type(TyF64::new(result, exec_state.current_default_units())))
}

/// Converts a number from yards to the current default unit.
///
/// No matter what units the current file uses, this function will always return a number equivalent
/// to the input in yards.
///
/// For example, if the current file uses inches, `fromYd(1)` will return `36`.
/// If the current file uses millimeters, `fromYd(1)` will return `914.4`.
/// If the current file uses yards, `fromYd(1)` will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the file settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `fromYd(10)` is more readable that your intent is "I want 10 yards" than
/// `10 * 914.4`, if the file settings are in millimeters.
///
/// ```no_run
/// totalWidth = fromYd(10)
/// ```
#[stdlib {
    name = "fromYd",
    tags = ["units"],
}]
fn inner_from_yd(input: f64, exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_yards(input).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_yards(input).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_yards(input).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_yards(input).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_yards(input).as_centimeters()),
        UnitLen::Yards => Ok(input),
    }
}
