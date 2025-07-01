//! Types we need for communication with the server.

use ropey::Rope;
use serde::{Deserialize, Serialize};

/// Position in a text document expressed as zero-based line and character offset.
/// A position is between two characters like an 'insert' cursor in a editor.
#[derive(Debug, Eq, PartialEq, Ord, PartialOrd, Copy, Clone, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotPosition {
    /// Line position in a document (zero-based).
    pub line: u32,
    /// Character offset on a line in a document (zero-based). The meaning of this
    /// offset is determined by the negotiated `PositionEncodingKind`.
    ///
    /// If the character value is greater than the line length it defaults back
    /// to the line length.
    pub character: u32,
}

impl From<CopilotPosition> for tower_lsp::lsp_types::Position {
    fn from(position: CopilotPosition) -> Self {
        tower_lsp::lsp_types::Position {
            line: position.line,
            character: position.character,
        }
    }
}

/// A range in a text document expressed as (zero-based) start and end positions.
/// A range is comparable to a selection in an editor. Therefore the end position is exclusive.
#[derive(Debug, Eq, PartialEq, Copy, Clone, Default, Deserialize, Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotRange {
    /// The range's start position.
    pub start: CopilotPosition,
    /// The range's end position.
    pub end: CopilotPosition,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS, PartialEq)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotCyclingCompletion {
    pub uuid: uuid::Uuid,     // unique id we use for tracking accepted or rejected completions
    pub display_text: String, // partial text
    pub text: String,         // fulltext
    pub range: CopilotRange,  // start char always 0
    pub position: CopilotPosition,
}

#[derive(Debug, Serialize, Deserialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Choices {
    pub text: String,
    pub index: i16,
    pub finish_reason: Option<String>,
    pub logprobs: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotCompletionResponse {
    pub completions: Vec<CopilotCyclingCompletion>,
    pub cancellation_reason: Option<String>,
}

impl CopilotCompletionResponse {
    pub fn from_str_vec(str_vec: Vec<String>, line_before: String, pos: CopilotPosition) -> Self {
        let completions = str_vec
            .iter()
            .map(|x| CopilotCyclingCompletion::new(x.to_string(), line_before.to_string(), pos))
            .collect();
        Self {
            completions,
            cancellation_reason: None,
        }
    }
}

impl CopilotCyclingCompletion {
    pub fn new(text: String, line_before: String, position: CopilotPosition) -> Self {
        let display_text = text.clone();
        let text = format!("{line_before}{text}");
        let end_char = text.find('\n').unwrap_or(text.len()) as u32;
        Self {
            uuid: uuid::Uuid::new_v4(),
            display_text, // partial text
            text,         // fulltext
            range: CopilotRange {
                start: CopilotPosition {
                    character: 0,
                    line: position.line,
                },
                end: CopilotPosition {
                    character: end_char,
                    line: position.line,
                },
            }, // start char always 0
            position,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct LanguageEntry {
    pub language_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditorConfiguration {
    pub disabled_languages: Vec<LanguageEntry>,
    pub enable_auto_completions: bool,
}

impl Default for EditorConfiguration {
    fn default() -> Self {
        Self {
            disabled_languages: vec![],
            enable_auto_completions: true,
        }
    }
}
#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct EditorInfo {
    pub name: String,
    pub version: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotEditorInfo {
    pub editor_configuration: EditorConfiguration,
    pub editor_info: EditorInfo,
    pub editor_plugin_info: EditorInfo,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DocParams {
    #[serde(skip)]
    pub rope: Rope,
    pub uri: String,
    pub pos: CopilotPosition,
    pub language: String,
    pub line_before: String,
    pub prefix: String,
    pub suffix: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotLspCompletionParams {
    pub doc: CopilotDocParams,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotDocParams {
    pub indent_size: u32,
    pub insert_spaces: bool,
    pub language_id: String,
    pub path: String,
    pub position: CopilotPosition,
    pub relative_path: String,
    pub source: String,
    pub tab_size: u32,
    pub uri: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotAcceptCompletionParams {
    pub uuid: uuid::Uuid,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotRejectCompletionParams {
    pub uuids: Vec<uuid::Uuid>,
}

#[derive(Debug, Serialize, Deserialize, Clone, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct CopilotCompletionTelemetry {
    pub completion: CopilotCyclingCompletion,
    pub params: CopilotLspCompletionParams,
}
