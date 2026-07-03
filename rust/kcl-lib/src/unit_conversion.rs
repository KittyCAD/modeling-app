use kittycad_modeling_cmds::units as kcmcu;

/// Converts a unit from kcl_api to its equivalent for kcmc.
pub trait ToKcmc {
    type Equivalent;
    /// Converts this unit of measurement from kcl_api to its equivalent for kcmc.
    fn to_kcmc(self) -> Self::Equivalent;
}

/// Converts a unit from kcmc to its equivalent for kcl_api.
pub trait ToApi {
    type Equivalent;
    /// Converts this unit of measurement from kcmc to its equivalent for kcl_api.
    fn to_api(self) -> Self::Equivalent;
}

impl ToKcmc for kcl_api::UnitLength {
    type Equivalent = kcmcu::UnitLength;
    fn to_kcmc(self) -> Self::Equivalent {
        length::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitLength {
    type Equivalent = kcl_api::UnitLength;
    fn to_api(self) -> Self::Equivalent {
        length::kcmc_to_api(self)
    }
}

impl ToKcmc for kcl_api::UnitAngle {
    type Equivalent = kcmcu::UnitAngle;
    fn to_kcmc(self) -> Self::Equivalent {
        angle::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitAngle {
    type Equivalent = kcl_api::UnitAngle;
    fn to_api(self) -> Self::Equivalent {
        angle::kcmc_to_api(self)
    }
}

impl ToKcmc for kcl_api::UnitMass {
    type Equivalent = kcmcu::UnitMass;
    fn to_kcmc(self) -> Self::Equivalent {
        mass::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitMass {
    type Equivalent = kcl_api::UnitMass;
    fn to_api(self) -> Self::Equivalent {
        mass::kcmc_to_api(self)
    }
}

impl ToKcmc for kcl_api::UnitArea {
    type Equivalent = kcmcu::UnitArea;
    fn to_kcmc(self) -> Self::Equivalent {
        area::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitArea {
    type Equivalent = kcl_api::UnitArea;
    fn to_api(self) -> Self::Equivalent {
        area::kcmc_to_api(self)
    }
}

impl ToKcmc for kcl_api::UnitDensity {
    type Equivalent = kcmcu::UnitDensity;
    fn to_kcmc(self) -> Self::Equivalent {
        density::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitDensity {
    type Equivalent = kcl_api::UnitDensity;
    fn to_api(self) -> Self::Equivalent {
        density::kcmc_to_api(self)
    }
}

impl ToKcmc for kcl_api::UnitVolume {
    type Equivalent = kcmcu::UnitVolume;
    fn to_kcmc(self) -> Self::Equivalent {
        volume::api_to_kcmc(self)
    }
}

impl ToApi for kcmcu::UnitVolume {
    type Equivalent = kcl_api::UnitVolume;
    fn to_api(self) -> Self::Equivalent {
        volume::kcmc_to_api(self)
    }
}

mod length {
    use kittycad_modeling_cmds::units::UnitLength;

    pub fn kcmc_to_api(value: UnitLength) -> kcl_api::UnitLength {
        match value {
            UnitLength::Centimeters => kcl_api::UnitLength::Centimeters,
            UnitLength::Feet => kcl_api::UnitLength::Feet,
            UnitLength::Inches => kcl_api::UnitLength::Inches,
            UnitLength::Meters => kcl_api::UnitLength::Meters,
            UnitLength::Millimeters => kcl_api::UnitLength::Millimeters,
            UnitLength::Yards => kcl_api::UnitLength::Yards,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitLength) -> UnitLength {
        match value {
            kcl_api::UnitLength::Centimeters => UnitLength::Centimeters,
            kcl_api::UnitLength::Feet => UnitLength::Feet,
            kcl_api::UnitLength::Inches => UnitLength::Inches,
            kcl_api::UnitLength::Meters => UnitLength::Meters,
            kcl_api::UnitLength::Millimeters => UnitLength::Millimeters,
            kcl_api::UnitLength::Yards => UnitLength::Yards,
        }
    }
}

mod volume {
    use kittycad_modeling_cmds::units::UnitVolume;

    pub fn kcmc_to_api(value: UnitVolume) -> kcl_api::UnitVolume {
        match value {
            UnitVolume::CubicMillimeters => kcl_api::UnitVolume::CubicMillimeters,
            UnitVolume::CubicCentimeters => kcl_api::UnitVolume::CubicCentimeters,
            UnitVolume::CubicFeet => kcl_api::UnitVolume::CubicFeet,
            UnitVolume::CubicInches => kcl_api::UnitVolume::CubicInches,
            UnitVolume::CubicMeters => kcl_api::UnitVolume::CubicMeters,
            UnitVolume::CubicYards => kcl_api::UnitVolume::CubicYards,
            UnitVolume::FluidOunces => kcl_api::UnitVolume::FluidOunces,
            UnitVolume::Gallons => kcl_api::UnitVolume::Gallons,
            UnitVolume::Liters => kcl_api::UnitVolume::Liters,
            UnitVolume::Milliliters => kcl_api::UnitVolume::Milliliters,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitVolume) -> UnitVolume {
        match value {
            kcl_api::UnitVolume::CubicMillimeters => UnitVolume::CubicMillimeters,
            kcl_api::UnitVolume::CubicCentimeters => UnitVolume::CubicCentimeters,
            kcl_api::UnitVolume::CubicFeet => UnitVolume::CubicFeet,
            kcl_api::UnitVolume::CubicInches => UnitVolume::CubicInches,
            kcl_api::UnitVolume::CubicMeters => UnitVolume::CubicMeters,
            kcl_api::UnitVolume::CubicYards => UnitVolume::CubicYards,
            kcl_api::UnitVolume::FluidOunces => UnitVolume::FluidOunces,
            kcl_api::UnitVolume::Gallons => UnitVolume::Gallons,
            kcl_api::UnitVolume::Liters => UnitVolume::Liters,
            kcl_api::UnitVolume::Milliliters => UnitVolume::Milliliters,
        }
    }
}

mod mass {
    use kittycad_modeling_cmds::units::UnitMass;

    pub fn kcmc_to_api(value: UnitMass) -> kcl_api::UnitMass {
        match value {
            UnitMass::Grams => kcl_api::UnitMass::Grams,
            UnitMass::Kilograms => kcl_api::UnitMass::Kilograms,
            UnitMass::Pounds => kcl_api::UnitMass::Pounds,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitMass) -> UnitMass {
        match value {
            kcl_api::UnitMass::Grams => UnitMass::Grams,
            kcl_api::UnitMass::Kilograms => UnitMass::Kilograms,
            kcl_api::UnitMass::Pounds => UnitMass::Pounds,
        }
    }
}

mod area {
    use kittycad_modeling_cmds::units::UnitArea;

    pub fn kcmc_to_api(value: UnitArea) -> kcl_api::UnitArea {
        match value {
            UnitArea::SquareCentimeters => kcl_api::UnitArea::SquareCentimeters,
            UnitArea::SquareDecimeters => kcl_api::UnitArea::SquareDecimeters,
            UnitArea::SquareFeet => kcl_api::UnitArea::SquareFeet,
            UnitArea::SquareInches => kcl_api::UnitArea::SquareInches,
            UnitArea::SquareKilometers => kcl_api::UnitArea::SquareKilometers,
            UnitArea::SquareMeters => kcl_api::UnitArea::SquareMeters,
            UnitArea::SquareMillimeters => kcl_api::UnitArea::SquareMillimeters,
            UnitArea::SquareYards => kcl_api::UnitArea::SquareYards,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitArea) -> UnitArea {
        match value {
            kcl_api::UnitArea::SquareCentimeters => UnitArea::SquareCentimeters,
            kcl_api::UnitArea::SquareDecimeters => UnitArea::SquareDecimeters,
            kcl_api::UnitArea::SquareFeet => UnitArea::SquareFeet,
            kcl_api::UnitArea::SquareInches => UnitArea::SquareInches,
            kcl_api::UnitArea::SquareKilometers => UnitArea::SquareKilometers,
            kcl_api::UnitArea::SquareMeters => UnitArea::SquareMeters,
            kcl_api::UnitArea::SquareMillimeters => UnitArea::SquareMillimeters,
            kcl_api::UnitArea::SquareYards => UnitArea::SquareYards,
        }
    }
}

mod density {
    use kittycad_modeling_cmds::units::UnitDensity;

    pub fn kcmc_to_api(value: UnitDensity) -> kcl_api::UnitDensity {
        match value {
            UnitDensity::PoundsPerCubicFeet => kcl_api::UnitDensity::PoundsPerCubicFeet,
            UnitDensity::KilogramsPerCubicMeter => kcl_api::UnitDensity::KilogramsPerCubicMeter,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitDensity) -> UnitDensity {
        match value {
            kcl_api::UnitDensity::PoundsPerCubicFeet => UnitDensity::PoundsPerCubicFeet,
            kcl_api::UnitDensity::KilogramsPerCubicMeter => UnitDensity::KilogramsPerCubicMeter,
        }
    }
}

mod angle {
    use kittycad_modeling_cmds::units::UnitAngle;

    pub fn kcmc_to_api(value: UnitAngle) -> kcl_api::UnitAngle {
        match value {
            UnitAngle::Degrees => kcl_api::UnitAngle::Degrees,
            UnitAngle::Radians => kcl_api::UnitAngle::Radians,
        }
    }

    pub fn api_to_kcmc(value: kcl_api::UnitAngle) -> UnitAngle {
        match value {
            kcl_api::UnitAngle::Degrees => UnitAngle::Degrees,
            kcl_api::UnitAngle::Radians => UnitAngle::Radians,
        }
    }
}
