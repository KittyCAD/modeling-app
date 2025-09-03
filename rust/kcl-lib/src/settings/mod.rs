//! This module contains settings for kcl projects as well as the Design Studio.

pub mod types;

#[cfg(test)]
mod generate_settings_docs;

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::units::UnitLength;

    use super::types::{Configuration, ModelingSettings};

    #[test]
    fn default_unit_length_is_millimeters() {
        // Ensure our settings default to millimeters as the base unit.
        let modeling = ModelingSettings::default();
        assert_eq!(modeling.base_unit, UnitLength::Millimeters);
    }

    #[test]
    fn toml_default_unit_length_roundtrip_is_mm() {
        // Explicitly setting mm should parse to the default configuration.
        let with_mm = r#"[settings.modeling]
base_unit = "mm"
"#;

        let parsed = toml::from_str::<Configuration>(with_mm).unwrap();
        assert_eq!(parsed.settings.modeling.base_unit, UnitLength::Millimeters);

        // Serializing defaults should omit modeling/base_unit entirely.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(serialized, "");

        // An empty [settings.modeling] section should still default to mm.
        let empty_modeling_section = r#"[settings.modeling]
"#;
        let parsed2 = toml::from_str::<Configuration>(empty_modeling_section).unwrap();
        assert_eq!(parsed2.settings.modeling.base_unit, UnitLength::Millimeters);
    }

    #[test]
    fn configuration_default_has_mm() {
        let cfg = Configuration::default();
        assert_eq!(cfg.settings.modeling.base_unit, UnitLength::Millimeters);

        // Default config serializes to empty TOML because everything is defaulted/omitted.
        let serialized = toml::to_string(&cfg).unwrap();
        assert_eq!(serialized, "");
    }
}
