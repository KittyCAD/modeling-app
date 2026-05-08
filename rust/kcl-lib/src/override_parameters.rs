use kcl_error::SourceRange;
use serde::{Deserialize, Serialize};

use crate::KclError;

type Result<T> = std::result::Result<T, KclError>;

/// Extracted from KCL programs.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct KclSourceVariable {
    /// Filepath
    pub file_path: String,
    /// Source range of the variable in the KCL source.
    pub source_range: SourceRange,
    /// Name of the variable in the KCL source.
    pub variable_name: String,
    /// Type assigned to the variable in the KCL source.
    pub default_type: ParameterType,
    /// Value assigned to the variable in the KCL source.
    pub assigned: String,
}

/// Subset of KCL value's possible types, limited to types that can be easily given
/// as literals and then overridden.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub enum ParameterType {
    String,
    Number,
    Bool,
}

/// A KCL file, or directory of such files with a `main.kcl`.
#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct KclProject {
    pub files: Vec<KclFile>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq)]
pub struct KclFile {
    /// Path to the file on disk.
    pub path: String,
    /// KCL source code contents.
    /// MUST be UTF-8.
    pub contents: String,
}

/// Extract parameters from this KCL program for customization.
pub fn get_parameters(_kcl_project: &KclProject) -> Result<Vec<KclSourceVariable>> {
    todo!()
}

/// Update the parameters from this KCL program.
pub fn set_parameters(_kcl_project: &KclProject, _parameters: &[KclSourceVariable]) -> Result<KclProject> {
    todo!()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basic() {
        // Setup
        let program = "width = 3".to_owned();
        let input_project = KclProject {
            files: vec![KclFile {
                path: "proj/main.kcl".to_owned(),
                contents: program,
            }],
        };

        // Test getting params.
        let mut params = get_parameters(&input_project).expect("Error getting parameters");
        assert_eq!(params.len(), 1);
        let mut param = params.pop().expect("Params should have an item");
        assert_eq!(param.variable_name, "width");

        // Test setting params.
        param.assigned = "44".to_owned();
        let mut output_project = set_parameters(&input_project, &vec![param]).unwrap();
        let output_file = output_project.files.pop().unwrap();
        assert_eq!(
            output_file,
            KclFile {
                path: "proj/main.kcl".to_owned(),
                contents: "width = 44".to_owned(),
            }
        );
    }
}
