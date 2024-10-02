//! Functions related to unitsematics.

use anyhow::Result;
use derive_docs::stdlib;

use crate::{
    errors::KclError,
    executor::{ExecState, KclValue},
    settings::types::UnitLength,
    std::Args,
};

/// Millimeters conversion factor for current projects units.
pub async fn mm(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_mm(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * mm()
/// ```
#[stdlib {
    name = "mm",
    tags = ["units"],
}]
fn inner_mm(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(1.0),
        UnitLength::In => Ok(measurements::Length::from_millimeters(1.0).as_inches()),
        UnitLength::Ft => Ok(measurements::Length::from_millimeters(1.0).as_feet()),
        UnitLength::M => Ok(measurements::Length::from_millimeters(1.0).as_meters()),
        UnitLength::Cm => Ok(measurements::Length::from_millimeters(1.0).as_centimeters()),
        UnitLength::Yd => Ok(measurements::Length::from_millimeters(1.0).as_yards()),
    }
}

/// Inches conversion factor for current projects units.
pub async fn inch(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_inch(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * inch()
/// ```
#[stdlib {
    name = "inch",
    tags = ["units"],
}]
fn inner_inch(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(measurements::Length::from_inches(1.0).as_millimeters()),
        UnitLength::In => Ok(1.0),
        UnitLength::Ft => Ok(measurements::Length::from_inches(1.0).as_feet()),
        UnitLength::M => Ok(measurements::Length::from_inches(1.0).as_meters()),
        UnitLength::Cm => Ok(measurements::Length::from_inches(1.0).as_centimeters()),
        UnitLength::Yd => Ok(measurements::Length::from_inches(1.0).as_yards()),
    }
}

/// Feet conversion factor for current projects units.
pub async fn ft(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_ft(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * ft()
/// ```
#[stdlib {
    name = "ft",
    tags = ["units"],
}]
fn inner_ft(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(measurements::Length::from_feet(1.0).as_millimeters()),
        UnitLength::In => Ok(measurements::Length::from_feet(1.0).as_inches()),
        UnitLength::Ft => Ok(1.0),
        UnitLength::M => Ok(measurements::Length::from_feet(1.0).as_meters()),
        UnitLength::Cm => Ok(measurements::Length::from_feet(1.0).as_centimeters()),
        UnitLength::Yd => Ok(measurements::Length::from_feet(1.0).as_yards()),
    }
}

/// Meters conversion factor for current projects units.
pub async fn m(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_m(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * m()
/// ```
#[stdlib {
    name = "m",
    tags = ["units"],
}]
fn inner_m(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(measurements::Length::from_meters(1.0).as_millimeters()),
        UnitLength::In => Ok(measurements::Length::from_meters(1.0).as_inches()),
        UnitLength::Ft => Ok(measurements::Length::from_meters(1.0).as_feet()),
        UnitLength::M => Ok(1.0),
        UnitLength::Cm => Ok(measurements::Length::from_meters(1.0).as_centimeters()),
        UnitLength::Yd => Ok(measurements::Length::from_meters(1.0).as_yards()),
    }
}

/// Centimeters conversion factor for current projects units.
pub async fn cm(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_cm(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * cm()
/// ```
#[stdlib {
    name = "cm",
    tags = ["units"],
}]
fn inner_cm(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(measurements::Length::from_centimeters(1.0).as_millimeters()),
        UnitLength::In => Ok(measurements::Length::from_centimeters(1.0).as_inches()),
        UnitLength::Ft => Ok(measurements::Length::from_centimeters(1.0).as_feet()),
        UnitLength::M => Ok(measurements::Length::from_centimeters(1.0).as_meters()),
        UnitLength::Cm => Ok(1.0),
        UnitLength::Yd => Ok(measurements::Length::from_centimeters(1.0).as_yards()),
    }
}

/// Yards conversion factor for current projects units.
pub async fn yd(_exec_state: &mut ExecState, args: Args) -> Result<KclValue, KclError> {
    let result = inner_yd(&args)?;

    args.make_user_val_from_f64(result)
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
/// const totalWidth = 10 * yd()
/// ```
#[stdlib {
    name = "yd",
    tags = ["units"],
}]
fn inner_yd(args: &Args) -> Result<f64, KclError> {
    match args.ctx.settings.units {
        UnitLength::Mm => Ok(measurements::Length::from_yards(1.0).as_millimeters()),
        UnitLength::In => Ok(measurements::Length::from_yards(1.0).as_inches()),
        UnitLength::Ft => Ok(measurements::Length::from_yards(1.0).as_feet()),
        UnitLength::M => Ok(measurements::Length::from_yards(1.0).as_meters()),
        UnitLength::Cm => Ok(measurements::Length::from_yards(1.0).as_centimeters()),
        UnitLength::Yd => Ok(1.0),
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_mm() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_mm(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::In;
        let result = inner_mm(&args).unwrap();
        assert_eq!(result, 1.0 / 25.4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_inch() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::In;
        let result = inner_inch(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_inch(&args).unwrap();
        assert_eq!(result, 25.4);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_ft() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::Ft;
        let result = inner_ft(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_ft(&args).unwrap();
        assert_eq!(result, 304.8);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_m() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::M;
        let result = inner_m(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_m(&args).unwrap();
        assert_eq!(result, 1000.0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_cm() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::Cm;
        let result = inner_cm(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_cm(&args).unwrap();
        assert_eq!(result, 10.0);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_units_inner_yd() {
        let mut args = Args::new_test_args().await.unwrap();
        args.ctx.settings.units = UnitLength::Yd;
        let result = inner_yd(&args).unwrap();
        assert_eq!(result, 1.0);

        args.ctx.settings.units = UnitLength::Mm;
        let result = inner_yd(&args).unwrap();
        assert_eq!(result, 914.4);
    }
}
