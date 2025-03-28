//! Functions related to unitsematics.

use anyhow::Result;
use kcl_derive_docs::stdlib;

use crate::{
    errors::KclError,
    execution::{types::UnitLen, ExecState, KclValue},
    std::Args,
};

/// Millimeters conversion factor for current projects units.
pub async fn mm(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_mm(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Millimeters conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to millimeters.
///
/// For example, if the current project uses inches, this function will return `(1/25.4)`.
/// If the current project uses millimeters, this function will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * mm()` is more readable that your intent is "I want 10 millimeters" than
/// `10 * (1/25.4)`, if the project settings are in inches.
///
/// ```no_run
/// totalWidth = 10 * mm()
/// ```
#[stdlib {
    name = "mm",
    tags = ["units"],
}]
fn inner_mm(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(1.0),
        UnitLen::Inches => Ok(measurements::Length::from_millimeters(1.0).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_millimeters(1.0).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_millimeters(1.0).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_millimeters(1.0).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_millimeters(1.0).as_yards()),
    }
}

/// Inches conversion factor for current projects units.
pub async fn inch(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_inch(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Inches conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to inches.
///
/// For example, if the current project uses inches, this function will return `1`.
/// If the current project uses millimeters, this function will return `25.4`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * inch()` is more readable that your intent is "I want 10 inches" than
/// `10 * 25.4`, if the project settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * inch()
/// ```
#[stdlib {
    name = "inch",
    tags = ["units"],
}]
fn inner_inch(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_inches(1.0).as_millimeters()),
        UnitLen::Inches => Ok(1.0),
        UnitLen::Feet => Ok(measurements::Length::from_inches(1.0).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_inches(1.0).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_inches(1.0).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_inches(1.0).as_yards()),
    }
}

/// Feet conversion factor for current projects units.
pub async fn ft(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_ft(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Feet conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to feet.
///
/// For example, if the current project uses inches, this function will return `12`.
/// If the current project uses millimeters, this function will return `304.8`.
/// If the current project uses feet, this function will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * ft()` is more readable that your intent is "I want 10 feet" than
/// `10 * 304.8`, if the project settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * ft()
/// ```
#[stdlib {
    name = "ft",
    tags = ["units"],
}]
fn inner_ft(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_feet(1.0).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_feet(1.0).as_inches()),
        UnitLen::Feet => Ok(1.0),
        UnitLen::M => Ok(measurements::Length::from_feet(1.0).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_feet(1.0).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_feet(1.0).as_yards()),
    }
}

/// Meters conversion factor for current projects units.
pub async fn m(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_m(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Meters conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to meters.
///
/// For example, if the current project uses inches, this function will return `39.3701`.
/// If the current project uses millimeters, this function will return `1000`.
/// If the current project uses meters, this function will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * m()` is more readable that your intent is "I want 10 meters" than
/// `10 * 1000`, if the project settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * m()
/// ```
#[stdlib {
    name = "m",
    tags = ["units"],
}]
fn inner_m(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_meters(1.0).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_meters(1.0).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_meters(1.0).as_feet()),
        UnitLen::M => Ok(1.0),
        UnitLen::Cm => Ok(measurements::Length::from_meters(1.0).as_centimeters()),
        UnitLen::Yards => Ok(measurements::Length::from_meters(1.0).as_yards()),
    }
}

/// Centimeters conversion factor for current projects units.
pub async fn cm(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_cm(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Centimeters conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to centimeters.
///
/// For example, if the current project uses inches, this function will return `0.393701`.
/// If the current project uses millimeters, this function will return `10`.
/// If the current project uses centimeters, this function will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * cm()` is more readable that your intent is "I want 10 centimeters" than
/// `10 * 10`, if the project settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * cm()
/// ```
#[stdlib {
    name = "cm",
    tags = ["units"],
}]
fn inner_cm(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_centimeters(1.0).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_centimeters(1.0).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_centimeters(1.0).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_centimeters(1.0).as_meters()),
        UnitLen::Cm => Ok(1.0),
        UnitLen::Yards => Ok(measurements::Length::from_centimeters(1.0).as_yards()),
    }
}

/// Yards conversion factor for current projects units.
pub async fn yd(exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_yd(exec_state)?;

    Ok(args.make_user_val_from_f64(result))
}

/// Yards conversion factor for current projects units.
///
/// No matter what units the current project uses, this function will always return the conversion
/// factor to yards.
///
/// For example, if the current project uses inches, this function will return `36`.
/// If the current project uses millimeters, this function will return `914.4`.
/// If the current project uses yards, this function will return `1`.
///
/// **Caution**: This function is only intended to be used when you absolutely MUST
/// have different units in your code than the project settings. Otherwise, it is
/// a bad pattern to use this function.
///
/// We merely provide these functions for convenience and readability, as
/// `10 * yd()` is more readable that your intent is "I want 10 yards" than
/// `10 * 914.4`, if the project settings are in millimeters.
///
/// ```no_run
/// totalWidth = 10 * yd()
/// ```
#[stdlib {
    name = "yd",
    tags = ["units"],
}]
fn inner_yd(exec_state: &ExecState) -> Result<f64, KclError> {
    match exec_state.length_unit() {
        UnitLen::Mm => Ok(measurements::Length::from_yards(1.0).as_millimeters()),
        UnitLen::Inches => Ok(measurements::Length::from_yards(1.0).as_inches()),
        UnitLen::Feet => Ok(measurements::Length::from_yards(1.0).as_feet()),
        UnitLen::M => Ok(measurements::Length::from_yards(1.0).as_meters()),
        UnitLen::Cm => Ok(measurements::Length::from_yards(1.0).as_centimeters()),
        UnitLen::Yards => Ok(1.0),
    }
}
