//! Types we need for communication with the server.

use ropey::Rope;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{Position, Range};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopilotCyclingCompletion {
    pub display_text: String, // partial text
    pub text: String,         // fulltext
    pub range: Range,         // start char always 0
    pub position: Position,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Choices {
    pub text: String,
    pub index: i16,
    pub finish_reason: Option<String>,
    pub logprobs: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CopilotCompletionResponse {
    pub completions: Vec<CopilotCyclingCompletion>,
    pub cancellation_reason: Option<String>,
}

impl CopilotCompletionResponse {
    pub fn from_str_vec(str_vec: Vec<String>, line_before: String, pos: Position) -> Self {
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
    pub fn new(text: String, line_before: String, position: Position) -> Self {
        let display_text = text.clone();
        let text = format!("{}{}", line_before, text);
        let end_char = text.find('\n').unwrap_or(text.len()) as u32;
        Self {
            display_text, // partial text
            text,         // fulltext
            range: Range {
                start: Position {
                    character: 0,
                    line: position.line,
                },
                end: Position {
                    character: end_char,
                    line: position.line,
                },
            }, // start char always 0
            position,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LanguageEntry {
    language_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorConfiguration {
    disabled_languages: Vec<LanguageEntry>,
    enable_auto_completions: bool,
}

impl Default for EditorConfiguration {
    fn default() -> Self {
        Self {
            disabled_languages: vec![],
            enable_auto_completions: true,
        }
    }
}
#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct EditorInfo {
    name: String,
    version: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopilotEditorInfo {
    editor_configuration: EditorConfiguration,
    editor_info: EditorInfo,
    editor_plugin_info: EditorInfo,
}

pub struct DocParams {
    pub rope: Rope,
    pub uri: String,
    pub pos: Position,
    pub language: String,
    pub line_before: String,
    pub prefix: String,
    pub suffix: String,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopilotLspCompletionParams {
    pub doc: CopilotDocParams,
}

#[derive(Debug, Default, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopilotDocParams {
    pub indent_size: u32,
    pub insert_spaces: bool,
    pub language_id: String,
    pub path: String,
    pub position: Position,
    pub relative_path: String,
    pub source: String,
    pub tab_size: u32,
    pub uri: String,
}
