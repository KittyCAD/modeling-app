use std::collections::HashSet;

use kcl_error::SourceRange;
use serde::Deserialize;
use serde::Serialize;

use crate::KclError;
use crate::ModuleId;
use crate::errors::KclErrorDetails;
use crate::parsing::ast::types::BinaryPart;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::LiteralValue;
use crate::parsing::ast::types::UnaryOperator;

type Result<T> = std::result::Result<T, KclError>;

/// Extracted from KCL programs.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct KclSourceVariable {
    /// Stable ID for updating this parameter.
    pub id: String,
    /// Filepath
    pub file_path: String,
    /// Source range of the assigned value in the KCL source.
    pub source_range: SourceRange,
    /// Name of the variable in the KCL source.
    pub variable_name: String,
    /// Type assigned to the variable in the KCL source.
    pub default_type: ParameterType,
    /// Value assigned to the variable in the KCL source.
    pub assigned: String,
}

/// A new value to assign to a KCL source parameter.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct KclParameterOverride {
    /// ID returned by [`get_parameters`].
    pub id: String,
    /// New value to assign to the parameter.
    pub assigned: String,
}

#[derive(Debug, PartialEq, Eq, Hash)]
struct ParameterId<'a> {
    file_path: &'a str,
    variable_name: &'a str,
    source_range: SourceRange,
    default_type: ParameterType,
}

impl<'a> From<&'a KclSourceVariable> for ParameterId<'a> {
    fn from(parameter: &'a KclSourceVariable) -> Self {
        Self {
            file_path: &parameter.file_path,
            variable_name: &parameter.variable_name,
            source_range: parameter.source_range,
            default_type: parameter.default_type,
        }
    }
}

impl<'a> ParameterId<'a> {
    fn to_stable_id(&self) -> String {
        format!(
            "{}\0{}\0{},{},{}\0{}",
            self.file_path,
            self.variable_name,
            self.source_range.start(),
            self.source_range.end(),
            self.source_range.module_id().as_usize(),
            self.default_type
        )
    }
}

/// Subset of KCL value's possible types, limited to types that can be easily given
/// as literals and then overridden.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ParameterType {
    String,
    Number,
    Bool,
}

impl std::fmt::Display for ParameterType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let stringified = match self {
            Self::String => "String",
            Self::Number => "Number",
            Self::Bool => "Bool",
        };
        write!(f, "{}", stringified)
    }
}

/// A KCL file, or directory of such files with a `main.kcl`.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct KclProject {
    pub files: Vec<KclFile>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
pub struct KclFile {
    /// Path to the file on disk.
    pub path: String,
    /// KCL source code contents.
    /// MUST be UTF-8.
    pub contents: String,
}

/// Extract parameters from this KCL program for customization.
pub fn get_parameters(kcl_project: &KclProject) -> Result<Vec<KclSourceVariable>> {
    let mut parameters = Vec::new();

    for (file_index, file) in kcl_project.files.iter().enumerate() {
        let ast = parse_file(&file.contents, file_index)?;

        for item in &ast.body {
            let BodyItem::VariableDeclaration(var_decl) = item else {
                continue;
            };

            let Some(default_type) = parameter_type(&var_decl.declaration.init) else {
                continue;
            };

            let source_range = SourceRange::from(&var_decl.declaration.init);
            let parameter_id = ParameterId {
                file_path: &file.path,
                variable_name: &var_decl.declaration.id.name,
                source_range,
                default_type,
            }
            .to_stable_id();
            parameters.push(KclSourceVariable {
                id: parameter_id,
                file_path: file.path.clone(),
                source_range,
                variable_name: var_decl.declaration.id.name.clone(),
                default_type,
                assigned: source_text(&file.contents, source_range)?.to_owned(),
            });
        }
    }

    Ok(parameters)
}

/// Update parameters from source parameter IDs and replacement values.
pub fn set_parameter_overrides(kcl_project: &KclProject, overrides: &[KclParameterOverride]) -> Result<KclProject> {
    let extracted_parameters = get_parameters(kcl_project)?;
    let parameters_by_id = extracted_parameters
        .iter()
        .map(|parameter| (parameter.id.as_str(), parameter))
        .collect::<std::collections::HashMap<_, _>>();

    let parameters = overrides
        .iter()
        .map(|parameter_override| {
            let Some(parameter) = parameters_by_id.get(parameter_override.id.as_str()) else {
                return Err(argument_error(format!(
                    "parameter ID `{}` was not found in the KCL project",
                    parameter_override.id
                )));
            };

            Ok(KclSourceVariable {
                assigned: parameter_override.assigned.clone(),
                ..(*parameter).clone()
            })
        })
        .collect::<Result<Vec<_>>>()?;

    set_parameters(kcl_project, &parameters)
}

/// Update the parameters from this KCL program.
pub fn set_parameters(kcl_project: &KclProject, parameters: &[KclSourceVariable]) -> Result<KclProject> {
    let extracted_parameters = get_parameters(kcl_project)?;
    let extracted_parameter_identities = extracted_parameters
        .iter()
        .map(ParameterId::from)
        .collect::<HashSet<_>>();

    for parameter in parameters {
        if !extracted_parameter_identities.contains(&ParameterId::from(parameter)) {
            return Err(argument_error(format!(
                "parameter `{}` in `{}` was not found in the KCL project",
                parameter.variable_name, parameter.file_path
            )));
        }

        let replacement_type = parse_parameter_value(&parameter.assigned)?;
        if replacement_type != parameter.default_type {
            return Err(argument_error(format!(
                "parameter `{}` in `{}` has type {}, but replacement `{}` has type {}",
                parameter.variable_name,
                parameter.file_path,
                parameter.default_type,
                parameter.assigned,
                replacement_type
            )));
        }
    }

    let mut output_project = kcl_project.clone();

    for file in &mut output_project.files {
        let mut replacements = parameters
            .iter()
            .filter(|parameter| parameter.file_path == file.path)
            .collect::<Vec<_>>();

        replacements.sort_by_key(|parameter| parameter.source_range.start());

        let mut previous_range: Option<SourceRange> = None;
        for parameter in &replacements {
            validate_range(&file.contents, parameter.source_range)?;
            if let Some(previous) = previous_range
                && previous.end() > parameter.source_range.start()
            {
                return Err(argument_error(format!(
                    "overlapping replacements for `{}` in `{}`",
                    parameter.variable_name, parameter.file_path
                )));
            }
            previous_range = Some(parameter.source_range);
        }

        for parameter in replacements.into_iter().rev() {
            file.contents.replace_range(
                parameter.source_range.start()..parameter.source_range.end(),
                &parameter.assigned,
            );
        }
    }

    Ok(output_project)
}

fn parse_file(
    code: &str,
    file_index: usize,
) -> Result<crate::parsing::ast::types::Node<crate::parsing::ast::types::Program>> {
    if file_index > u32::MAX as usize {
        return Err(argument_error("too many files in the KCL project".to_owned()));
    }

    crate::parsing::parse_str(code, ModuleId::from_usize(file_index)).parse_errs_as_err()
}

fn parameter_type(expr: &Expr) -> Option<ParameterType> {
    match expr {
        Expr::Literal(literal) => literal_parameter_type(&literal.value),
        Expr::UnaryExpression(unary_expr)
            if matches!(unary_expr.operator, UnaryOperator::Neg | UnaryOperator::Plus)
                && matches!(
                    &unary_expr.argument,
                    BinaryPart::Literal(literal)
                        if matches!(literal.value, LiteralValue::Number { .. })
                ) =>
        {
            Some(ParameterType::Number)
        }
        _ => None,
    }
}

fn literal_parameter_type(literal: &LiteralValue) -> Option<ParameterType> {
    match literal {
        LiteralValue::String(_) => Some(ParameterType::String),
        LiteralValue::Number { .. } => Some(ParameterType::Number),
        LiteralValue::Bool(_) => Some(ParameterType::Bool),
    }
}

fn parse_parameter_value(value: &str) -> Result<ParameterType> {
    let code = format!("__parameter__ = {value}");
    let ast = crate::parsing::parse_str(&code, ModuleId::default()).parse_errs_as_err()?;
    if ast.body.len() != 1 {
        return Err(argument_error(format!(
            "replacement `{value}` is not a single KCL literal value"
        )));
    }

    let Some(BodyItem::VariableDeclaration(var_decl)) = ast.body.first() else {
        return Err(argument_error(format!(
            "replacement `{value}` is not a KCL literal value"
        )));
    };

    let value_range = SourceRange::from(&var_decl.declaration.init);
    if !code[value_range.end()..].trim().is_empty() {
        return Err(argument_error(format!(
            "replacement `{value}` is not a single KCL literal value"
        )));
    }

    parameter_type(&var_decl.declaration.init)
        .ok_or_else(|| argument_error(format!("replacement `{value}` is not a supported KCL literal value")))
}

fn source_text(contents: &str, source_range: SourceRange) -> Result<&str> {
    validate_range(contents, source_range)?;
    Ok(&contents[source_range.start()..source_range.end()])
}

fn validate_range(contents: &str, source_range: SourceRange) -> Result<()> {
    if source_range.start() > source_range.end()
        || source_range.end() > contents.len()
        || !contents.is_char_boundary(source_range.start())
        || !contents.is_char_boundary(source_range.end())
    {
        return Err(argument_error(format!(
            "invalid source range [{}, {}]",
            source_range.start(),
            source_range.end()
        )));
    }

    Ok(())
}

fn argument_error(message: String) -> KclError {
    KclError::new_argument(KclErrorDetails::new(message, vec![]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_and_updates_single_top_level_number_parameter() {
        let input_project = KclProject {
            files: vec![KclFile {
                path: "proj/main.kcl".to_owned(),
                contents: "width = 3".to_owned(),
            }],
        };

        let mut params = get_parameters(&input_project).expect("get parameters");
        assert_eq!(params.len(), 1);
        let mut param = params.pop().expect("one parameter");
        assert!(!param.id.is_empty());
        assert_eq!(param.file_path, "proj/main.kcl");
        assert_eq!(param.variable_name, "width");
        assert_eq!(param.default_type, ParameterType::Number);
        assert_eq!(param.assigned, "3");

        param.assigned = "44".to_owned();
        let mut output_project = set_parameters(&input_project, &[param]).expect("set parameters");
        let output_file = output_project.files.pop().unwrap();
        assert_eq!(
            output_file,
            KclFile {
                path: "proj/main.kcl".to_owned(),
                contents: "width = 44".to_owned(),
            }
        );
    }

    #[test]
    fn extracts_exported_bool_string_and_negative_number_parameters() {
        let input_project = project(
            "proj/main.kcl",
            r#"export enabled = true
name = "bracket"
depth = -3.14"#,
        );

        let params = get_parameters(&input_project).expect("get parameters");
        assert_eq!(
            params
                .iter()
                .map(|param| (&*param.variable_name, param.default_type, &*param.assigned))
                .collect::<Vec<_>>(),
            vec![
                ("enabled", ParameterType::Bool, "true"),
                ("name", ParameterType::String, r#""bracket""#),
                ("depth", ParameterType::Number, "-3.14"),
            ]
        );
    }

    #[test]
    fn preserves_inline_comments_and_spacing() {
        let input_project = project("proj/main.kcl", "width=3 // outer width");
        let param = get_only_parameter(&input_project);
        let parameter_override = KclParameterOverride {
            id: param.id,
            assigned: "44".to_owned(),
        };

        let output_project = set_parameter_overrides(&input_project, &[parameter_override]).expect("set parameters");

        assert_eq!(output_project.files[0].contents, "width=44 // outer width");
    }

    #[test]
    fn skips_non_literal_expressions() {
        let input_project = project(
            "proj/main.kcl",
            r#"width = 40 / 20
height = x * 3
radius = f(3)
center = [0, 0]"#,
        );

        let params = get_parameters(&input_project).expect("get parameters");

        assert!(params.is_empty());
    }

    #[test]
    fn extracts_only_top_level_variables() {
        let input_project = project(
            "proj/main.kcl",
            r#"fn makePart() {
  width = 3
}

outerWidth = 5"#,
        );

        let params = get_parameters(&input_project).expect("get parameters");

        assert_eq!(params.len(), 1);
        assert_eq!(params[0].variable_name, "outerWidth");
    }

    #[test]
    fn extracts_and_updates_numeric_units() {
        let input_project = project(
            "proj/main.kcl",
            r#"width = 2cm
angle = 45deg"#,
        );
        let mut params = get_parameters(&input_project).expect("get parameters");
        assert_eq!(params.len(), 2);
        assert_eq!(params[0].assigned, "2cm");
        assert_eq!(params[1].assigned, "45deg");

        params[0].assigned = "14cm".to_owned();
        params[1].assigned = "90deg".to_owned();
        let output_project = set_parameters(&input_project, &params).expect("set parameters");

        assert_eq!(
            output_project.files[0].contents,
            r#"width = 14cm
angle = 90deg"#
        );
    }

    #[test]
    fn updates_only_the_target_file() {
        let input_project = KclProject {
            files: vec![
                KclFile {
                    path: "proj/main.kcl".to_owned(),
                    contents: r#"import * from "parameters.kcl""#.to_owned(),
                },
                KclFile {
                    path: "proj/parameters.kcl".to_owned(),
                    contents: "export width = 3".to_owned(),
                },
            ],
        };
        let mut param = get_parameters(&input_project)
            .expect("get parameters")
            .into_iter()
            .find(|param| param.variable_name == "width")
            .expect("width parameter");
        param.assigned = "44".to_owned();

        let output_project = set_parameters(&input_project, &[param]).expect("set parameters");

        assert_eq!(output_project.files[0].contents, r#"import * from "parameters.kcl""#);
        assert_eq!(output_project.files[1].contents, "export width = 44");
    }

    #[test]
    fn duplicate_names_in_different_files_are_independently_targetable() {
        let input_project = KclProject {
            files: vec![
                KclFile {
                    path: "proj/a.kcl".to_owned(),
                    contents: "width = 3".to_owned(),
                },
                KclFile {
                    path: "proj/b.kcl".to_owned(),
                    contents: "width = 5".to_owned(),
                },
            ],
        };
        let mut params = get_parameters(&input_project).expect("get parameters");
        let mut second_width = params.pop().expect("second width");
        second_width.assigned = "8".to_owned();

        let output_project = set_parameters(&input_project, &[second_width]).expect("set parameters");

        assert_eq!(output_project.files[0].contents, "width = 3");
        assert_eq!(output_project.files[1].contents, "width = 8");
    }

    #[test]
    fn duplicate_names_in_same_file_are_independently_targetable_by_range() {
        let input_project = project(
            "proj/main.kcl",
            r#"width = 3
width = 5"#,
        );
        let params = get_parameters(&input_project).expect("get parameters");
        let mut second_width = params[1].clone();
        second_width.assigned = "8".to_owned();

        let output_project = set_parameters(&input_project, &[second_width]).expect("set parameters");

        assert_eq!(
            output_project.files[0].contents,
            r#"width = 3
width = 8"#
        );
    }

    #[test]
    fn invalid_replacement_type_is_rejected() {
        let input_project = project("proj/main.kcl", "width = 3");
        let mut param = get_only_parameter(&input_project);
        param.assigned = r#""oops""#.to_owned();

        let err = set_parameters(&input_project, &[param]).expect_err("invalid replacement");

        assert!(err.to_string().contains("has type Number"));
    }

    #[test]
    fn replacement_must_be_a_single_literal() {
        let input_project = project("proj/main.kcl", "width = 3");
        let mut param = get_only_parameter(&input_project);
        param.assigned = "44\nheight = 5".to_owned();

        let err = set_parameters(&input_project, &[param]).expect_err("invalid replacement");

        assert!(err.to_string().contains("single KCL literal value"));
    }

    #[test]
    fn stale_parameter_identity_is_rejected() {
        let input_project = project("proj/main.kcl", "width = 3");
        let mut param = get_only_parameter(&input_project);
        param.variable_name = "height".to_owned();
        param.assigned = "44".to_owned();

        let err = set_parameters(&input_project, &[param]).expect_err("stale parameter");

        assert!(err.to_string().contains("was not found in the KCL project"));
    }

    #[test]
    fn stale_parameter_id_is_rejected() {
        let input_project = project("proj/main.kcl", "width = 3");
        let parameter_override = KclParameterOverride {
            id: "missing".to_owned(),
            assigned: "44".to_owned(),
        };

        let err = set_parameter_overrides(&input_project, &[parameter_override]).expect_err("stale parameter");

        assert!(err.to_string().contains("was not found in the KCL project"));
    }

    #[test]
    fn input_project_is_not_mutated() {
        let input_project = project("proj/main.kcl", "width = 3");
        let mut param = get_only_parameter(&input_project);
        param.assigned = "44".to_owned();

        let output_project = set_parameters(&input_project, &[param]).expect("set parameters");

        assert_eq!(input_project.files[0].contents, "width = 3");
        assert_eq!(output_project.files[0].contents, "width = 44");
    }

    fn project(path: &str, contents: &str) -> KclProject {
        KclProject {
            files: vec![KclFile {
                path: path.to_owned(),
                contents: contents.to_owned(),
            }],
        }
    }

    fn get_only_parameter(project: &KclProject) -> KclSourceVariable {
        let params = get_parameters(project).expect("get parameters");
        assert_eq!(params.len(), 1);
        params.into_iter().next().unwrap()
    }
}
