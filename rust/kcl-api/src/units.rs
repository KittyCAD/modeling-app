use kittycad_unit_conversion_derive::UnitConversion;
use parse_display_derive::Display;
use parse_display_derive::FromStr;
use schemars::JsonSchema;
use serde::Deserialize;
use serde::Serialize;
use ts_rs::TS;

/// The valid types of length units.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    UnitConversion,
    Hash,
    TS,
)]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitLength {
    /// Centimeters <https://en.wikipedia.org/wiki/Centimeter>
    #[serde(rename = "cm")]
    #[display("cm")]
    Centimeters,
    /// Feet <https://en.wikipedia.org/wiki/Foot_(unit)>
    #[serde(rename = "ft")]
    #[display("ft")]
    Feet,
    /// Inches <https://en.wikipedia.org/wiki/Inch>
    #[serde(rename = "in")]
    #[display("in")]
    Inches,
    /// Meters <https://en.wikipedia.org/wiki/Meter>
    #[default]
    #[serde(rename = "m")]
    #[display("m")]
    Meters,
    /// Millimeters <https://en.wikipedia.org/wiki/Millimeter>
    #[serde(rename = "mm")]
    #[display("mm")]
    Millimeters,
    /// Yards <https://en.wikipedia.org/wiki/Yard>
    #[serde(rename = "yd")]
    #[display("yd")]
    Yards,
}

impl UnitLength {
    /// Convert to measurement.
    pub fn as_measurement(self, value: f64) -> measurements::Length {
        match self {
            Self::Centimeters => measurements::Length::from_centimeters(value),
            Self::Feet => measurements::Length::from_feet(value),
            Self::Inches => measurements::Length::from_inches(value),
            Self::Meters => measurements::Length::from_meters(value),
            Self::Millimeters => measurements::Length::from_millimeters(value),
            Self::Yards => measurements::Length::from_yards(value),
        }
    }
}

/// The valid types of angle formats.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    UnitConversion,
    Hash,
    TS,
)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitAngle {
    /// Degrees <https://en.wikipedia.org/wiki/Degree_(angle)>
    #[default]
    #[display("deg")]
    Degrees,
    /// Radians <https://en.wikipedia.org/wiki/Radian>
    #[display("rad")]
    Radians,
}

/// The valid types of area units.
#[derive(
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    UnitConversion,
    Default,
    Hash,
    TS,
)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitArea {
    /// Square centimeters <https://en.wikipedia.org/wiki/Square_centimeter>
    #[serde(rename = "cm2")]
    #[display("cm2")]
    SquareCentimeters,
    /// Square decimeters <https://en.wikipedia.org/wiki/Square_decimeter>
    #[serde(rename = "dm2")]
    #[display("dm2")]
    SquareDecimeters,
    /// Square feet <https://en.wikipedia.org/wiki/Square_foot>
    #[serde(rename = "ft2")]
    #[display("ft2")]
    SquareFeet,
    /// Square inches <https://en.wikipedia.org/wiki/Square_inch>
    #[serde(rename = "in2")]
    #[display("in2")]
    SquareInches,
    /// Square kilometers <https://en.wikipedia.org/wiki/Square_kilometer>
    #[serde(rename = "km2")]
    #[display("km2")]
    SquareKilometers,
    /// Square meters <https://en.wikipedia.org/wiki/Square_meter>
    #[default]
    #[serde(rename = "m2")]
    #[display("m2")]
    SquareMeters,
    /// Square millimeters <https://en.wikipedia.org/wiki/Square_millimeter>
    #[serde(rename = "mm2")]
    #[display("mm2")]
    SquareMillimeters,
    /// Square yards <https://en.wikipedia.org/wiki/Square_mile>
    #[serde(rename = "yd2")]
    #[display("yd2")]
    SquareYards,
}

impl UnitArea {
    /// Convert to measurement.
    pub fn as_measurement(self, value: f64) -> measurements::Area {
        match self {
            Self::SquareCentimeters => measurements::Area::from_square_centimeters(value),
            Self::SquareDecimeters => measurements::Area::from_square_decimeters(value),
            Self::SquareFeet => measurements::Area::from_square_feet(value),
            Self::SquareInches => measurements::Area::from_square_inches(value),
            Self::SquareKilometers => measurements::Area::from_square_kilometers(value),
            Self::SquareMeters => measurements::Area::from_square_meters(value),
            Self::SquareMillimeters => measurements::Area::from_square_millimeters(value),
            Self::SquareYards => measurements::Area::from_square_yards(value),
        }
    }
}

/// The valid types for density units.
#[derive(
    Display,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    Default,
    UnitConversion,
    Hash,
    TS,
)]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitDensity {
    /// Pounds per cubic feet.
    #[serde(rename = "lb:ft3")]
    #[display("lb:ft3")]
    PoundsPerCubicFeet,

    /// Kilograms per cubic meter.
    #[default]
    #[serde(rename = "kg:m3")]
    #[display("kg:m3")]
    KilogramsPerCubicMeter,
}

impl std::str::FromStr for UnitDensity {
    type Err = parse_display::ParseError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "lbft3" | "lb:ft3" | "lb-ft3" => Ok(Self::PoundsPerCubicFeet),
            "kgm3" | "kg:m3" | "kg-m3" => Ok(Self::KilogramsPerCubicMeter),
            _other => Err(Default::default()),
        }
    }
}

impl UnitDensity {
    /// Convert to measurement.
    pub fn as_measurement(self, value: f64) -> measurements::Density {
        match self {
            Self::PoundsPerCubicFeet => measurements::Density::from_pounds_per_cubic_feet(value),
            Self::KilogramsPerCubicMeter => measurements::Density::from_kilograms_per_cubic_meter(value),
        }
    }
}

/// The valid types of mass units.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    UnitConversion,
    Hash,
    TS,
)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitMass {
    /// Grams <https://en.wikipedia.org/wiki/Gram>
    #[default]
    #[serde(rename = "g")]
    #[display("g")]
    Grams,
    /// Kilograms <https://en.wikipedia.org/wiki/Kilogram>
    #[serde(rename = "kg")]
    #[display("kg")]
    Kilograms,
    /// Pounds <https://en.wikipedia.org/wiki/Pound_(mass)>
    #[serde(rename = "lb")]
    #[display("lb")]
    Pounds,
}

impl UnitMass {
    /// Convert to measurement.
    pub fn as_measurement(self, value: f64) -> measurements::Mass {
        match self {
            Self::Grams => measurements::Mass::from_grams(value),
            Self::Kilograms => measurements::Mass::from_kilograms(value),
            Self::Pounds => measurements::Mass::from_pounds(value),
        }
    }
}

/// The valid types of volume units.
#[derive(
    Default,
    Display,
    FromStr,
    Copy,
    Eq,
    PartialEq,
    Debug,
    JsonSchema,
    Deserialize,
    Serialize,
    Clone,
    Ord,
    PartialOrd,
    UnitConversion,
    Hash,
    TS,
)]
#[display(style = "snake_case")]
#[ts(export_to = "ModelingCmd.ts")]
#[cfg_attr(
    feature = "pyo3",
    pyo3::pyclass(eq, from_py_object),
    pyo3_stub_gen::derive::gen_stub_pyclass_enum
)]
pub enum UnitVolume {
    /// Cubic millimeters (mm³)
    #[serde(rename = "mm3")]
    #[display("mm3")]
    CubicMillimeters,
    /// Cubic centimeters (cc or cm³) <https://en.wikipedia.org/wiki/Cubic_centimeter>
    #[serde(rename = "cm3")]
    #[display("cm3")]
    CubicCentimeters,
    /// Cubic feet (ft³) <https://en.wikipedia.org/wiki/Cubic_foot>
    #[serde(rename = "ft3")]
    #[display("ft3")]
    CubicFeet,
    /// Cubic inches (cu in or in³) <https://en.wikipedia.org/wiki/Cubic_inch>
    #[serde(rename = "in3")]
    #[display("in3")]
    CubicInches,
    /// Cubic meters (m³) <https://en.wikipedia.org/wiki/Cubic_meter>
    #[default]
    #[serde(rename = "m3")]
    #[display("m3")]
    CubicMeters,
    /// Cubic yards (yd³) <https://en.wikipedia.org/wiki/Cubic_yard>
    #[serde(rename = "yd3")]
    #[display("yd3")]
    CubicYards,
    /// US Fluid Ounces (fl oz) <https://en.wikipedia.org/wiki/Fluid_ounce>
    #[serde(rename = "usfloz")]
    #[display("usfloz")]
    FluidOunces,
    /// US Gallons (gal US) <https://en.wikipedia.org/wiki/Gallon>
    #[serde(rename = "usgal")]
    #[display("usgal")]
    Gallons,
    /// Liters (l) <https://en.wikipedia.org/wiki/Litre>
    #[serde(rename = "l")]
    #[display("l")]
    Liters,
    /// Milliliters (ml) <https://en.wikipedia.org/wiki/Litre>
    #[serde(rename = "ml")]
    #[display("ml")]
    Milliliters,
}

impl UnitVolume {
    /// Convert to measurement.
    pub fn as_measurement(self, value: f64) -> measurements::Volume {
        match self {
            Self::CubicMillimeters => measurements::Volume::from_cubic_millimeters(value),
            Self::CubicCentimeters => measurements::Volume::from_cubic_centimeters(value),
            Self::CubicFeet => measurements::Volume::from_cubic_feet(value),
            Self::CubicInches => measurements::Volume::from_cubic_inches(value),
            Self::CubicMeters => measurements::Volume::from_cubic_meters(value),
            Self::CubicYards => measurements::Volume::from_cubic_yards(value),
            Self::FluidOunces => measurements::Volume::from_fluid_ounces(value),
            Self::Gallons => measurements::Volume::from_gallons(value),
            Self::Liters => measurements::Volume::from_liters(value),
            Self::Milliliters => measurements::Volume::from_milliliters(value),
        }
    }
}
