//! This module contains settings for kcl projects as well as the Design Studio.

pub mod types;

#[cfg(test)]
mod generate_settings_docs;

#[cfg(test)]
mod tests {
    use kittycad_modeling_cmds::units::UnitLength;

    use super::types::Configuration;
    use super::types::ModelingEngine;
    use super::types::ModelingSettings;
    use super::types::project::ProjectConfiguration;

    #[test]
    fn default_unit_length_is_millimeters() {
        // Ensure our settings default to millimeters as the base unit.
        let modeling = ModelingSettings::default();
        assert_eq!(modeling.base_unit.unwrap_or_default().0, UnitLength::Millimeters);
    }

    #[test]
    fn toml_default_unit_length_roundtrip_is_mm() {
        // Explicitly setting mm should parse to the default configuration.
        let with_mm = r#"[settings.modeling]
base_unit = "mm"
"#;

        let parsed = toml::from_str::<Configuration>(with_mm).unwrap();
        assert_eq!(
            parsed
                .settings
                .modeling
                .clone()
                .unwrap_or_default()
                .base_unit
                .unwrap_or_default()
                .0,
            UnitLength::Millimeters
        );

        // Serializing the settings file back should not change it.
        let serialized = toml::to_string(&parsed).unwrap();
        assert_eq!(serialized, with_mm);

        // An empty [settings.modeling] section should still default to mm.
        let empty_modeling_section = r#"[settings.modeling]
"#;
        let parsed2 = toml::from_str::<Configuration>(empty_modeling_section).unwrap();
        assert_eq!(
            parsed2
                .clone()
                .settings
                .modeling
                .unwrap_or_default()
                .base_unit
                .unwrap_or_default()
                .0,
            UnitLength::Millimeters
        );
        // Serializing the settings file back should not change it.
        let serialized = toml::to_string(&parsed2).unwrap();
        assert_eq!(serialized, empty_modeling_section);
    }

    #[test]
    fn configuration_default_has_mm() {
        let cfg = Configuration::default();
        assert_eq!(
            cfg.settings
                .modeling
                .clone()
                .unwrap_or_default()
                .base_unit
                .unwrap_or_default()
                .0,
            UnitLength::Millimeters
        );

        // Default config serializes to empty TOML because everything is defaulted/omitted.
        let serialized = toml::to_string(&cfg).unwrap();
        assert_eq!(serialized, "");
    }

    #[test]
    fn default_modeling_engine_is_zoo() {
        let cfg = Configuration::default();
        let settings: crate::ExecutorSettings = cfg.into();

        assert_eq!(settings.engine, ModelingEngine::Zoo);
    }

    #[test]
    fn user_settings_accept_open_cascade_modeling_engine() {
        let parsed = toml::from_str::<Configuration>(
            r#"[settings.modeling]
engine = "open_cascade"
"#,
        )
        .unwrap();

        let modeling = parsed.settings.modeling.clone().unwrap_or_default();
        assert_eq!(modeling.engine, Some(ModelingEngine::OpenCascade));

        let settings: crate::ExecutorSettings = parsed.into();
        assert_eq!(settings.engine, ModelingEngine::OpenCascade);
    }

    #[test]
    fn project_settings_accept_open_cascade_modeling_engine() {
        let parsed = toml::from_str::<ProjectConfiguration>(
            r#"[settings.modeling]
engine = "open_cascade"
"#,
        )
        .unwrap();

        assert_eq!(parsed.settings.modeling.engine, Some(ModelingEngine::OpenCascade));

        let settings: crate::ExecutorSettings = parsed.into();
        assert_eq!(settings.engine, ModelingEngine::OpenCascade);
    }
}
