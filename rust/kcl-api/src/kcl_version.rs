use std::str::FromStr;

use kcl_error::KclError;
use kcl_error::KclErrorDetails;
use serde::Deserialize;
use serde::Serialize;

/// Which KCL versions does Zoo support?
#[derive(
    Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Ord, PartialOrd, schemars::JsonSchema, ts_rs::TS,
)]
#[ts(export)]
pub enum KclVersion {
    /// Original KCL released in 2025
    #[default]
    #[serde(rename = "1.0")]
    V1,
    /// KCL v2 is the same as KCL v1, except
    /// that it supports the `region` function.
    #[serde(rename = "2.0")]
    V2,
    /// KCL v3 is currently in development.
    #[serde(rename = "3.0-preview")]
    V3Preview,
    /// KCL v3 released 2026
    #[serde(rename = "3.0")]
    V3,
    // When you add a new version, please add it to the error string in KclVersionError's
    // Display and FromStr impls.
}

impl KclVersion {
    /// Get the canonical string representation for each version.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::V1 => "1.0",
            Self::V2 => "2.0",
            Self::V3Preview => "3.0-preview",
            Self::V3 => "3.0",
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone, Copy)]
pub struct KclVersionError;

impl core::error::Error for KclVersionError {}

impl std::fmt::Display for KclVersionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "Unrecognized version. Valid versions are 1.0, 2.0, 3.0 and (experimentally) 3.0-preview"
        )
    }
}

impl FromStr for KclVersion {
    type Err = KclVersionError;

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "1" | "1.0" | "1.0.0" => Ok(Self::V1),
            "2" | "2.0" | "2.0.0" => Ok(Self::V2),
            "3-preview" | "3.0-preview" | "3.0.0-preview" => Ok(Self::V3Preview),
            "3" | "3.0" | "3.0.0" => Ok(Self::V3),
            _other => Err(KclVersionError),
        }
    }
}

impl From<KclVersionError> for KclError {
    fn from(e: KclVersionError) -> Self {
        Self::Semantic {
            details: KclErrorDetails {
                source_ranges: Default::default(),
                backtrace: Default::default(),
                message: e.to_string(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_str() {
        for input in [KclVersion::V1, KclVersion::V2, KclVersion::V3Preview, KclVersion::V3] {
            let serialized = input.as_str();
            let deserialized: KclVersion = serialized.parse().unwrap();
            assert_eq!(input, deserialized);
        }
    }

    #[test]
    fn kcl_version_parses_supported_spellings() {
        assert_eq!(KclVersion::from_str("1"), Ok(KclVersion::V1));
        assert_eq!(KclVersion::from_str("1.0.0"), Ok(KclVersion::V1));
        assert_eq!(KclVersion::from_str("2"), Ok(KclVersion::V2));
        assert_eq!(KclVersion::from_str("2.0.0"), Ok(KclVersion::V2));
        assert_eq!(KclVersion::from_str("3.0-preview"), Ok(KclVersion::V3Preview));
        assert_eq!(KclVersion::from_str("3"), Ok(KclVersion::V3));
        assert_eq!(KclVersion::from_str("3.0"), Ok(KclVersion::V3));
        assert_eq!(KclVersion::from_str("3.0.0"), Ok(KclVersion::V3));
        // No such version.
        KclVersion::from_str("99.123").unwrap_err();
    }

    #[test]
    fn stable_v3_follows_preview() {
        assert!(KclVersion::V3Preview < KclVersion::V3);
    }
}
