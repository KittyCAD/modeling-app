pub mod length {
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

pub mod angle {
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
