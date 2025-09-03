//! This module contains settings for kcl projects as well as the Design Studio.

pub mod types;

#[cfg(test)]
mod generate_settings_docs;

#[cfg(test)]
mod tests {
    use super::types::{Configuration, ModelingSettings};
    use kittycad_modeling_cmds::units::UnitLength;

    #[test]
    fn default_unit_length_is_millimeters() {
        // Ensure our settings default to millimeters as the base unit.
        let modeling = ModelingSettings::default();
        assert_eq!(modeling.base_unit, UnitLength::Millimeters);
    }

    #[test]
    fn toml_default_unit_length_roundtrip_is_mm() {
        // Inspect how UnitLength::Millimeters serializes in TOML within ModelingSettings.
        let modeling_default = ModelingSettings::default();
        let modeling_toml = toml::to_string(&modeling_default).unwrap();
        eprintln!("ModelingSettings::default() TOML =\n{}", modeling_toml);

        // Explicitly setting mm should parse to the default configuration.
        let with_mm = r#"[settings.modeling]
base_unit = "mm"
"#;

        let parsed = toml::from_str::<Configuration>(with_mm).unwrap();
        eprintln!(
            "Parsed base_unit from with_mm: {:?}",
            parsed.settings.modeling.base_unit
        );
        assert_eq!(parsed.settings.modeling.base_unit, UnitLength::Millimeters);

        // Serializing defaults should omit modeling/base_unit entirely.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(serialized, "");

        // An empty [settings.modeling] section should still default to mm.
        let empty_modeling_section = r#"[settings.modeling]
"#;
        let parsed2 = toml::from_str::<Configuration>(empty_modeling_section).unwrap();
        eprintln!(
            "Parsed base_unit from empty section: {:?}",
            parsed2.settings.modeling.base_unit
        );
        assert_eq!(parsed2.settings.modeling.base_unit, UnitLength::Millimeters);
    }
}
