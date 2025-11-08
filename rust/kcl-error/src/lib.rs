use serde::{Deserialize, Serialize};
pub use source_range::{ModuleId, SourceRange};

mod source_range;

/// An error which occurred during parsing, etc.
#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
pub struct CompilationError {
    #[serde(rename = "sourceRange")]
    pub source_range: SourceRange,
    pub message: String,
    pub suggestion: Option<Suggestion>,
    pub severity: Severity,
    pub tag: Tag,
}

impl CompilationError {
    pub fn err(source_range: SourceRange, message: impl ToString) -> CompilationError {
        CompilationError {
            source_range,
            message: message.to_string(),
            suggestion: None,
            severity: Severity::Error,
            tag: Tag::None,
        }
    }

    pub fn fatal(source_range: SourceRange, message: impl ToString) -> CompilationError {
        CompilationError {
            source_range,
            message: message.to_string(),
            suggestion: None,
            severity: Severity::Fatal,
            tag: Tag::None,
        }
    }

    pub fn with_suggestion(
        self,
        suggestion_title: impl ToString,
        suggestion_insert: impl ToString,
        // Will use the error source range if none is supplied
        source_range: Option<SourceRange>,
        tag: Tag,
    ) -> CompilationError {
        CompilationError {
            suggestion: Some(Suggestion {
                title: suggestion_title.to_string(),
                insert: suggestion_insert.to_string(),
                source_range: source_range.unwrap_or(self.source_range),
            }),
            tag,
            ..self
        }
    }

    #[cfg(test)]
    pub fn apply_suggestion(&self, src: &str) -> Option<String> {
        let suggestion = self.suggestion.as_ref()?;
        Some(format!(
            "{}{}{}",
            &src[0..suggestion.source_range.start()],
            suggestion.insert,
            &src[suggestion.source_range.end()..]
        ))
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Severity {
    Warning,
    Error,
    Fatal,
}

impl Severity {
    pub fn is_err(self) -> bool {
        match self {
            Severity::Warning => false,
            Severity::Error | Severity::Fatal => true,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub enum Tag {
    Deprecated,
    Unnecessary,
    UnknownNumericUnits,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, ts_rs::TS, PartialEq, Eq)]
#[ts(export)]
pub struct Suggestion {
    pub title: String,
    pub insert: String,
    pub source_range: SourceRange,
}

impl Suggestion {
    /// Apply the suggestion to the source code.
    pub fn apply(&self, src: &str) -> String {
        format!(
            "{}{}{}",
            &src[0..self.source_range.start()],
            self.insert,
            &src[self.source_range.end()..]
        )
    }
}
