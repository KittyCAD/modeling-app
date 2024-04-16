//! Custom notifications for the KCL LSP server that are not part of the LSP specification.

use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::notification::Notification;

/// A notification that the AST has changed.
#[derive(Debug)]
pub enum AstUpdated {}

impl Notification for AstUpdated {
    type Params = crate::ast::types::Program;
    const METHOD: &'static str = "kcl/astUpdated";
}

/// A notification that the Memory has changed.
#[derive(Debug)]
pub enum MemoryUpdated {}

impl Notification for MemoryUpdated {
    type Params = crate::executor::ProgramMemory;
    const METHOD: &'static str = "kcl/memoryUpdated";
}

/// Text documents are identified using a URI. On the protocol level, URIs are passed as strings.
#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TextDocumentIdentifier {
    /// The text document's URI.
    pub uri: url::Url,
}

/// The valid types of length units.
#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub enum UnitLength {
    /// Centimeters <https://en.wikipedia.org/wiki/Centimeter>
    #[serde(rename = "cm")]
    Cm,
    /// Feet <https://en.wikipedia.org/wiki/Foot_(unit)>
    #[serde(rename = "ft")]
    Ft,
    /// Inches <https://en.wikipedia.org/wiki/Inch>
    #[serde(rename = "in")]
    In,
    /// Meters <https://en.wikipedia.org/wiki/Meter>
    #[serde(rename = "m")]
    M,
    /// Millimeters <https://en.wikipedia.org/wiki/Millimeter>
    #[serde(rename = "mm")]
    Mm,
    /// Yards <https://en.wikipedia.org/wiki/Yard>
    #[serde(rename = "yd")]
    Yd,
}

impl From<kittycad::types::UnitLength> for UnitLength {
    fn from(unit: kittycad::types::UnitLength) -> Self {
        match unit {
            kittycad::types::UnitLength::Cm => UnitLength::Cm,
            kittycad::types::UnitLength::Ft => UnitLength::Ft,
            kittycad::types::UnitLength::In => UnitLength::In,
            kittycad::types::UnitLength::M => UnitLength::M,
            kittycad::types::UnitLength::Mm => UnitLength::Mm,
            kittycad::types::UnitLength::Yd => UnitLength::Yd,
        }
    }
}

impl From<UnitLength> for kittycad::types::UnitLength {
    fn from(unit: UnitLength) -> Self {
        match unit {
            UnitLength::Cm => kittycad::types::UnitLength::Cm,
            UnitLength::Ft => kittycad::types::UnitLength::Ft,
            UnitLength::In => kittycad::types::UnitLength::In,
            UnitLength::M => kittycad::types::UnitLength::M,
            UnitLength::Mm => kittycad::types::UnitLength::Mm,
            UnitLength::Yd => kittycad::types::UnitLength::Yd,
        }
    }
}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateUnitsParams {
    pub text_document: TextDocumentIdentifier,
    /// The content of the text document.
    pub text: String,
    pub units: UnitLength,
}

#[derive(Debug, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateUnitsResponse {}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct UpdateCanExecuteParams {
    pub can_execute: bool,
}

#[derive(Debug, Eq, PartialEq, Clone, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct UpdateCanExecuteResponse {}
