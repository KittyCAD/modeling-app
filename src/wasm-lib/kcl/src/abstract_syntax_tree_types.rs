//! Data types for the AST.

use std::collections::HashMap;

use anyhow::Result;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Map;
use tower_lsp::lsp_types::{CompletionItem, CompletionItemKind, DocumentSymbol, Range as LspRange, SymbolKind};

use crate::{
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
    executor::{MemoryItem, Metadata, PipeInfo, ProgramMemory, SourceRange, UserVal},
    parser::PIPE_OPERATOR,
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    pub non_code_meta: NoneCodeMeta,
}

impl Program {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        let result = self
            .body
            .iter()
            .map(|statement| match statement.clone() {
                BodyItem::ExpressionStatement(expression_statement) => {
                    expression_statement
                        .expression
                        .recast(options, indentation_level, false)
                }
                BodyItem::VariableDeclaration(variable_declaration) => variable_declaration
                    .declarations
                    .iter()
                    .map(|declaration| {
                        format!(
                            "{}{} {} = {}",
                            indentation,
                            variable_declaration.kind,
                            declaration.id.name,
                            declaration.init.recast(options, 0, false)
                        )
                    })
                    .collect::<String>(),
                BodyItem::ReturnStatement(return_statement) => {
                    format!(
                        "{}return {}",
                        indentation,
                        return_statement.argument.recast(options, 0, false)
                    )
                }
            })
            .enumerate()
            .map(|(index, recast_str)| {
                let start_string = if index == 0 {
                    // We need to indent.
                    if let Some(start) = self.non_code_meta.start.clone() {
                        start.format(&indentation)
                    } else {
                        indentation.to_string()
                    }
                } else {
                    // Do nothing, we already applied the indentation elsewhere.
                    String::new()
                };

                // determine the value of the end string
                // basically if we are inside a nested function we want to end with a new line
                let maybe_line_break: String = if index == self.body.len() - 1 && indentation_level == 0 {
                    String::new()
                } else {
                    "\n".to_string()
                };

                let custom_white_space_or_comment = match self.non_code_meta.none_code_nodes.get(&index) {
                    Some(custom_white_space_or_comment) => custom_white_space_or_comment.format(&indentation),
                    None => String::new(),
                };
                let end_string = if custom_white_space_or_comment.is_empty() {
                    maybe_line_break
                } else {
                    custom_white_space_or_comment
                };

                format!("{}{}{}", start_string, recast_str, end_string)
            })
            .collect::<String>()
            .trim()
            .to_string();

        // Insert a final new line if the user wants it.
        if options.insert_final_newline {
            format!("{}\n", result)
        } else {
            result
        }
    }

    /// Returns the body item that includes the given character position.
    pub fn get_body_item_for_position(&self, pos: usize) -> Option<&BodyItem> {
        for item in &self.body {
            let source_range: SourceRange = item.into();
            if source_range.contains(pos) {
                return Some(item);
            }
        }

        None
    }

    /// Returns the body item that includes the given character position.
    pub fn get_mut_body_item_for_position(&mut self, pos: usize) -> Option<&mut BodyItem> {
        for item in &mut self.body {
            let source_range: SourceRange = item.clone().into();
            if source_range.contains(pos) {
                return Some(item);
            }
        }

        None
    }

    /// Returns a value that includes the given character position.
    /// This is a bit more recursive than `get_body_item_for_position`.
    pub fn get_value_for_position(&self, pos: usize) -> Option<&Value> {
        let Some(item) = self.get_body_item_for_position(pos) else {
            return None;
        };

        // Recurse over the item.
        match item {
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_value_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
        }
    }

    /// Returns all the lsp symbols in the program.
    pub fn get_lsp_symbols(&self, code: &str) -> Vec<DocumentSymbol> {
        let mut symbols = vec![];
        for item in &self.body {
            match item {
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    symbols.extend(variable_declaration.get_lsp_symbols(code))
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }

        symbols
    }

    /// Rename the variable declaration at the given position.
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) {
        // The position must be within the variable declaration.
        let mut old_name = None;
        for item in &mut self.body {
            match item {
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    if let Some(var_old_name) = variable_declaration.rename_symbol(new_name, pos) {
                        old_name = Some(var_old_name);
                        break;
                    }
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }

        if let Some(old_name) = old_name {
            // Now rename all the identifiers in the rest of the program.
            self.rename_identifiers(&old_name, new_name);
        } else {
            // Okay so this was not a top level variable declaration.
            // But it might be a variable declaration inside a function or function params.
            // So we need to check that.
            let Some(ref mut item) = self.get_mut_body_item_for_position(pos) else {
                return;
            };

            // Recurse over the item.
            let mut value = match item {
                BodyItem::ExpressionStatement(ref mut expression_statement) => {
                    Some(&mut expression_statement.expression)
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    variable_declaration.get_mut_value_for_position(pos)
                }
                BodyItem::ReturnStatement(ref mut return_statement) => Some(&mut return_statement.argument),
            };

            // Check if we have a function expression.
            if let Some(Value::FunctionExpression(ref mut function_expression)) = &mut value {
                // Check if the params to the function expression contain the position.
                for param in &mut function_expression.params {
                    let param_source_range: SourceRange = param.clone().into();
                    if param_source_range.contains(pos) {
                        let old_name = param.name.clone();
                        // Rename the param.
                        param.rename(&old_name, new_name);
                        // Now rename all the identifiers in the rest of the program.
                        function_expression.body.rename_identifiers(&old_name, new_name);
                        return;
                    }
                }
            }
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for item in &mut self.body {
            match item {
                BodyItem::ExpressionStatement(ref mut expression_statement) => {
                    expression_statement.expression.rename_identifiers(old_name, new_name);
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    variable_declaration.rename_identifiers(old_name, new_name);
                }
                BodyItem::ReturnStatement(ref mut return_statement) => {
                    return_statement.argument.rename_identifiers(old_name, new_name);
                }
            }
        }
    }
}

pub trait ValueMeta {
    fn start(&self) -> usize;

    fn end(&self) -> usize;
}

macro_rules! impl_value_meta {
    {$name:ident} => {
        impl crate::abstract_syntax_tree_types::ValueMeta for $name {
            fn start(&self) -> usize {
                self.start
            }

            fn end(&self) -> usize {
                self.end
            }
        }

        impl From<$name> for crate::executor::SourceRange {
            fn from(v: $name) -> Self {
                Self([v.start, v.end])
            }
        }

        impl From<&$name> for crate::executor::SourceRange {
            fn from(v: &$name) -> Self {
                Self([v.start, v.end])
            }
        }

        impl From<&Box<$name>> for crate::executor::SourceRange {
            fn from(v: &Box<$name>) -> Self {
                Self([v.start, v.end])
            }
        }
    };
}

pub(crate) use impl_value_meta;

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BodyItem {
    ExpressionStatement(ExpressionStatement),
    VariableDeclaration(VariableDeclaration),
    ReturnStatement(ReturnStatement),
}

impl BodyItem {
    pub fn start(&self) -> usize {
        match self {
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.start(),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.start(),
            BodyItem::ReturnStatement(return_statement) => return_statement.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.end(),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.end(),
            BodyItem::ReturnStatement(return_statement) => return_statement.end(),
        }
    }
}

impl From<BodyItem> for crate::executor::SourceRange {
    fn from(item: BodyItem) -> Self {
        Self([item.start(), item.end()])
    }
}

impl From<&BodyItem> for crate::executor::SourceRange {
    fn from(item: &BodyItem) -> Self {
        Self([item.start(), item.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Value {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    FunctionExpression(Box<FunctionExpression>),
    CallExpression(Box<CallExpression>),
    PipeExpression(Box<PipeExpression>),
    PipeSubstitution(Box<PipeSubstitution>),
    ArrayExpression(Box<ArrayExpression>),
    ObjectExpression(Box<ObjectExpression>),
    MemberExpression(Box<MemberExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

impl Value {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        match &self {
            Value::BinaryExpression(bin_exp) => bin_exp.recast(options),
            Value::ArrayExpression(array_exp) => array_exp.recast(options, indentation_level, is_in_pipe),
            Value::ObjectExpression(ref obj_exp) => obj_exp.recast(options, indentation_level, is_in_pipe),
            Value::MemberExpression(mem_exp) => mem_exp.recast(),
            Value::Literal(literal) => literal.recast(),
            Value::FunctionExpression(func_exp) => func_exp.recast(options, indentation_level),
            Value::CallExpression(call_exp) => call_exp.recast(options, indentation_level, is_in_pipe),
            Value::Identifier(ident) => ident.name.to_string(),
            Value::PipeExpression(pipe_exp) => pipe_exp.recast(options, indentation_level),
            Value::UnaryExpression(unary_exp) => unary_exp.recast(options),
            Value::PipeSubstitution(_) => crate::parser::PIPE_SUBSTITUTION_OPERATOR.to_string(),
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Value::Literal(literal) => literal.start(),
            Value::Identifier(identifier) => identifier.start(),
            Value::BinaryExpression(binary_expression) => binary_expression.start(),
            Value::FunctionExpression(function_expression) => function_expression.start(),
            Value::CallExpression(call_expression) => call_expression.start(),
            Value::PipeExpression(pipe_expression) => pipe_expression.start(),
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution.start(),
            Value::ArrayExpression(array_expression) => array_expression.start(),
            Value::ObjectExpression(object_expression) => object_expression.start(),
            Value::MemberExpression(member_expression) => member_expression.start(),
            Value::UnaryExpression(unary_expression) => unary_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Value::Literal(literal) => literal.end(),
            Value::Identifier(identifier) => identifier.end(),
            Value::BinaryExpression(binary_expression) => binary_expression.end(),
            Value::FunctionExpression(function_expression) => function_expression.end(),
            Value::CallExpression(call_expression) => call_expression.end(),
            Value::PipeExpression(pipe_expression) => pipe_expression.end(),
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution.end(),
            Value::ArrayExpression(array_expression) => array_expression.end(),
            Value::ObjectExpression(object_expression) => object_expression.end(),
            Value::MemberExpression(member_expression) => member_expression.end(),
            Value::UnaryExpression(unary_expression) => unary_expression.end(),
        }
    }

    /// Returns a hover value that includes the given character position.
    /// This is really recursive so keep that in mind.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        match self {
            Value::Literal(_literal) => None,
            Value::Identifier(_identifier) => None,
            Value::BinaryExpression(binary_expression) => binary_expression.get_hover_value_for_position(pos, code),
            Value::FunctionExpression(function_expression) => {
                function_expression.get_hover_value_for_position(pos, code)
            }
            Value::CallExpression(call_expression) => call_expression.get_hover_value_for_position(pos, code),
            Value::PipeExpression(pipe_expression) => pipe_expression.get_hover_value_for_position(pos, code),
            Value::PipeSubstitution(_) => None,
            Value::ArrayExpression(array_expression) => array_expression.get_hover_value_for_position(pos, code),
            Value::ObjectExpression(object_expression) => object_expression.get_hover_value_for_position(pos, code),
            Value::MemberExpression(member_expression) => member_expression.get_hover_value_for_position(pos, code),
            Value::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code),
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            Value::Literal(_literal) => {}
            Value::Identifier(ref mut identifier) => identifier.rename(old_name, new_name),
            Value::BinaryExpression(ref mut binary_expression) => {
                binary_expression.rename_identifiers(old_name, new_name)
            }
            Value::FunctionExpression(_function_identifier) => {}
            Value::CallExpression(ref mut call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Value::PipeExpression(ref mut pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Value::PipeSubstitution(_) => {}
            Value::ArrayExpression(ref mut array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Value::ObjectExpression(ref mut object_expression) => {
                object_expression.rename_identifiers(old_name, new_name)
            }
            Value::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
            Value::UnaryExpression(ref mut unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
        }
    }
}

impl From<Value> for crate::executor::SourceRange {
    fn from(value: Value) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&Value> for crate::executor::SourceRange {
    fn from(value: &Value) -> Self {
        Self([value.start(), value.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    CallExpression(Box<CallExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

impl From<BinaryPart> for crate::executor::SourceRange {
    fn from(value: BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&BinaryPart> for crate::executor::SourceRange {
    fn from(value: &BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl BinaryPart {
    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        match &self {
            BinaryPart::Literal(literal) => literal.recast(),
            BinaryPart::Identifier(identifier) => identifier.name.to_string(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.recast(options),
            BinaryPart::CallExpression(call_expression) => call_expression.recast(options, indentation_level, false),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.recast(options),
        }
    }

    pub fn start(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.start(),
            BinaryPart::Identifier(identifier) => identifier.start(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.start(),
            BinaryPart::CallExpression(call_expression) => call_expression.start(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.end(),
            BinaryPart::Identifier(identifier) => identifier.end(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.end(),
            BinaryPart::CallExpression(call_expression) => call_expression.end(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.end(),
        }
    }

    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
        // stop the execution of the pipe.
        // THIS IS IMPORTANT.
        let mut new_pipe_info = pipe_info.clone();
        new_pipe_info.is_in_pipe = false;

        match self {
            BinaryPart::Literal(literal) => Ok(literal.into()),
            BinaryPart::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                Ok(value.clone())
            }
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.get_result(memory, &mut new_pipe_info, engine)
            }
            BinaryPart::CallExpression(call_expression) => call_expression.execute(memory, &mut new_pipe_info, engine),
            BinaryPart::UnaryExpression(unary_expression) => {
                // Return an error this should not happen.
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!("UnaryExpression should not be a BinaryPart: {:?}", unary_expression),
                    source_ranges: vec![unary_expression.into()],
                }))
            }
        }
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        match self {
            BinaryPart::Literal(_literal) => None,
            BinaryPart::Identifier(_identifier) => None,
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.get_hover_value_for_position(pos, code)
            }
            BinaryPart::CallExpression(call_expression) => call_expression.get_hover_value_for_position(pos, code),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code),
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            BinaryPart::Literal(_literal) => {}
            BinaryPart::Identifier(ref mut identifier) => identifier.rename(old_name, new_name),
            BinaryPart::BinaryExpression(ref mut binary_expression) => {
                binary_expression.rename_identifiers(old_name, new_name)
            }
            BinaryPart::CallExpression(ref mut call_expression) => {
                call_expression.rename_identifiers(old_name, new_name)
            }
            BinaryPart::UnaryExpression(ref mut unary_expression) => {
                unary_expression.rename_identifiers(old_name, new_name)
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NoneCodeNode {
    pub start: usize,
    pub end: usize,
    pub value: NoneCodeValue,
}

impl NoneCodeNode {
    pub fn value(&self) -> String {
        match &self.value {
            NoneCodeValue::InlineComment { value } => value.clone(),
            NoneCodeValue::BlockComment { value } => value.clone(),
            NoneCodeValue::NewLineBlockComment { value } => value.clone(),
            NoneCodeValue::NewLine => "\n\n".to_string(),
        }
    }

    pub fn format(&self, indentation: &str) -> String {
        match &self.value {
            NoneCodeValue::InlineComment { value } => format!(" // {}\n", value),
            NoneCodeValue::BlockComment { value } => {
                let add_start_new_line = if self.start == 0 { "" } else { "\n" };
                if value.contains('\n') {
                    format!("{}{}/* {} */\n", add_start_new_line, indentation, value)
                } else {
                    format!("{}{}// {}\n", add_start_new_line, indentation, value)
                }
            }
            NoneCodeValue::NewLineBlockComment { value } => {
                let add_start_new_line = if self.start == 0 { "" } else { "\n\n" };
                if value.contains('\n') {
                    format!("{}{}/* {} */\n", add_start_new_line, indentation, value)
                } else {
                    format!("{}{}// {}\n", add_start_new_line, indentation, value)
                }
            }
            NoneCodeValue::NewLine => "\n\n".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NoneCodeValue {
    /// An inline comment.
    /// An example of this is the following: `1 + 1 // This is an inline comment`.
    InlineComment {
        value: String,
    },
    /// A block comment.
    /// An example of this is the following:
    /// ```python,no_run
    /// /* This is a
    ///     block comment */
    /// 1 + 1
    /// ```
    /// Now this is important. The block comment is attached to the next line.
    /// This is always the case. Also the block comment doesnt have a new line above it.
    /// If it did it would be a `NewLineBlockComment`.
    BlockComment {
        value: String,
    },
    /// A block comment that has a new line above it.
    /// The user explicitly added a new line above the block comment.
    NewLineBlockComment {
        value: String,
    },
    // A new line like `\n\n` NOT a new line like `\n`.
    // This is also not a comment.
    NewLine,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NoneCodeMeta {
    pub none_code_nodes: HashMap<usize, NoneCodeNode>,
    pub start: Option<NoneCodeNode>,
}

// implement Deserialize manually because we to force the keys of none_code_nodes to be usize
// and by default the ts type { [statementIndex: number]: NoneCodeNode } serializes to a string i.e. "0", "1", etc.
impl<'de> Deserialize<'de> for NoneCodeMeta {
    fn deserialize<D>(deserializer: D) -> Result<NoneCodeMeta, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct NoneCodeMetaHelper {
            none_code_nodes: HashMap<String, NoneCodeNode>,
            start: Option<NoneCodeNode>,
        }

        let helper = NoneCodeMetaHelper::deserialize(deserializer)?;
        let mut none_code_nodes = HashMap::new();
        for (key, value) in helper.none_code_nodes {
            none_code_nodes.insert(key.parse().map_err(serde::de::Error::custom)?, value);
        }
        Ok(NoneCodeMeta {
            none_code_nodes,
            start: helper.start,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub start: usize,
    pub end: usize,
    pub expression: Value,
}

impl_value_meta!(ExpressionStatement);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct CallExpression {
    pub start: usize,
    pub end: usize,
    pub callee: Identifier,
    pub arguments: Vec<Value>,
    pub optional: bool,
    pub function: Function,
}

impl_value_meta!(CallExpression);

impl CallExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        format!(
            "{}({})",
            self.callee.name,
            self.arguments
                .iter()
                .map(|arg| arg.recast(options, indentation_level, is_in_pipe))
                .collect::<Vec<String>>()
                .join(", ")
        )
    }

    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let fn_name = self.callee.name.clone();

        let mut fn_args: Vec<MemoryItem> = Vec::with_capacity(self.arguments.len());

        for arg in &self.arguments {
            let result: MemoryItem = match arg {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
                    // stop the execution of the pipe.
                    // THIS IS IMPORTANT.
                    let mut new_pipe_info = pipe_info.clone();
                    new_pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, &mut new_pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => unary_expression.get_result(memory, pipe_info, engine)?,
                Value::ObjectExpression(object_expression) => object_expression.execute(memory, pipe_info, engine)?,
                Value::ArrayExpression(array_expression) => array_expression.execute(memory, pipe_info, engine)?,
                Value::PipeExpression(pipe_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("PipeExpression not implemented here: {:?}", pipe_expression),
                        source_ranges: vec![pipe_expression.into()],
                    }));
                }
                Value::PipeSubstitution(pipe_substitution) => pipe_info
                    .previous_results
                    .get(&pipe_info.index - 1)
                    .ok_or_else(|| {
                        KclError::Semantic(KclErrorDetails {
                            message: format!("PipeSubstitution index out of bounds: {:?}", pipe_info),
                            source_ranges: vec![pipe_substitution.into()],
                        })
                    })?
                    .clone(),
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("MemberExpression not implemented here: {:?}", member_expression),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("FunctionExpression not implemented here: {:?}", function_expression),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            };

            fn_args.push(result);
        }

        match &self.function {
            Function::StdLib { func, engine_id } => {
                // Attempt to call the function.
                let mut args = crate::std::Args::new(fn_args, self.into(), engine_id, engine);
                let result = func.std_lib_fn()(&mut args)?;
                if pipe_info.is_in_pipe {
                    pipe_info.index += 1;
                    pipe_info.previous_results.push(result.memory_item);
                    execute_pipe_body(memory, &pipe_info.body.clone(), pipe_info, self.into(), engine)
                } else {
                    Ok(result.memory_item)
                }
            }
            Function::InMemory => {
                let mem = memory.clone();
                let func = mem.get(&fn_name, self.into())?;
                let result = func.call_fn(&fn_args, &mem, engine)?.ok_or_else(|| {
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of function {} is undefined", fn_name),
                        source_ranges: vec![self.into()],
                    })
                })?;

                let result = result.get_value()?;

                if pipe_info.is_in_pipe {
                    pipe_info.index += 1;
                    pipe_info.previous_results.push(result);

                    execute_pipe_body(memory, &pipe_info.body.clone(), pipe_info, self.into(), engine)
                } else {
                    Ok(result)
                }
            }
        }
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let callee_source_range: SourceRange = self.callee.clone().into();
        if callee_source_range.contains(pos) {
            return Some(Hover::Function {
                name: self.callee.name.clone(),
                range: callee_source_range.to_lsp_range(code),
            });
        }

        for (index, arg) in self.arguments.iter().enumerate() {
            let source_range: SourceRange = arg.into();
            if source_range.contains(pos) {
                return Some(Hover::Signature {
                    name: self.callee.name.clone(),
                    parameter_index: index as u32,
                    range: source_range.to_lsp_range(code),
                });
            }
        }

        None
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.callee.rename(old_name, new_name);

        for arg in &mut self.arguments {
            arg.rename_identifiers(old_name, new_name);
        }
    }
}

/// A function declaration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Function {
    /// A stdlib function.
    StdLib {
        /// The function.
        func: Box<dyn crate::docs::StdLibFn>,
        /// The id of the entity in the engine.
        /// We store this so we can modify the engine when we change arguments into this function,
        /// etc.
        /// Not all stdlib functions have an engine id.
        /// Only ones that modify parts of a model.
        engine_id: Option<uuid::Uuid>,
    },
    /// A function that is defined in memory.
    #[default]
    InMemory,
}

impl PartialEq for Function {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (
                Function::StdLib {
                    func: func1,
                    engine_id: engine_id1,
                },
                Function::StdLib {
                    func: func2,
                    engine_id: engine_id2,
                },
            ) => func1.name() == func2.name() && engine_id1 == engine_id2,
            (Function::InMemory, Function::InMemory) => true,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclaration {
    pub start: usize,
    pub end: usize,
    pub declarations: Vec<VariableDeclarator>,
    pub kind: VariableKind, // Change to enum if there are specific values
}

impl_value_meta!(VariableDeclaration);

impl VariableDeclaration {
    /// Returns a value that includes the given character position.
    pub fn get_value_for_position(&self, pos: usize) -> Option<&Value> {
        for declaration in &self.declarations {
            let source_range: SourceRange = declaration.into();
            if source_range.contains(pos) {
                return Some(&declaration.init);
            }
        }

        None
    }

    /// Returns a value that includes the given character position.
    pub fn get_mut_value_for_position(&mut self, pos: usize) -> Option<&mut Value> {
        for declaration in &mut self.declarations {
            let source_range: SourceRange = declaration.clone().into();
            if source_range.contains(pos) {
                return Some(&mut declaration.init);
            }
        }

        None
    }

    /// Rename the variable declaration at the given position.
    /// This returns the old name of the variable, if it found one.
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        // The position must be within the variable declaration.
        let source_range: SourceRange = self.clone().into();
        if !source_range.contains(pos) {
            return None;
        }

        for declaration in &mut self.declarations {
            let declaration_source_range: SourceRange = declaration.id.clone().into();
            if declaration_source_range.contains(pos) {
                let old_name = declaration.id.name.clone();
                declaration.id.name = new_name.to_string();
                return Some(old_name);
            }
        }

        None
    }

    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for declaration in &mut self.declarations {
            // Skip the init for the variable with the new name since it is the one we are renaming.
            if declaration.id.name == new_name {
                continue;
            }

            declaration.init.rename_identifiers(old_name, new_name);
        }
    }

    pub fn get_lsp_symbols(&self, code: &str) -> Vec<DocumentSymbol> {
        let mut symbols = vec![];

        for declaration in &self.declarations {
            let source_range: SourceRange = declaration.into();
            let inner_source_range: SourceRange = declaration.id.clone().into();

            let mut symbol_kind = match self.kind {
                VariableKind::Fn => SymbolKind::FUNCTION,
                VariableKind::Const => SymbolKind::CONSTANT,
                VariableKind::Let => SymbolKind::VARIABLE,
                VariableKind::Var => SymbolKind::VARIABLE,
            };

            let children = match &declaration.init {
                Value::FunctionExpression(function_expression) => {
                    symbol_kind = SymbolKind::FUNCTION;
                    let mut children = vec![];
                    for param in &function_expression.params {
                        let param_source_range: SourceRange = param.into();
                        #[allow(deprecated)]
                        children.push(DocumentSymbol {
                            name: param.name.clone(),
                            detail: None,
                            kind: SymbolKind::VARIABLE,
                            range: param_source_range.to_lsp_range(code),
                            selection_range: param_source_range.to_lsp_range(code),
                            children: None,
                            tags: None,
                            deprecated: None,
                        });
                    }
                    children
                }
                Value::ObjectExpression(object_expression) => {
                    symbol_kind = SymbolKind::OBJECT;
                    let mut children = vec![];
                    for property in &object_expression.properties {
                        children.extend(property.get_lsp_symbols(code));
                    }
                    children
                }
                Value::ArrayExpression(_) => {
                    symbol_kind = SymbolKind::ARRAY;
                    vec![]
                }
                _ => vec![],
            };

            #[allow(deprecated)]
            symbols.push(DocumentSymbol {
                name: declaration.id.name.clone(),
                detail: Some(self.kind.to_string()),
                kind: symbol_kind,
                range: source_range.to_lsp_range(code),
                selection_range: inner_source_range.to_lsp_range(code),
                children: Some(children),
                tags: None,
                deprecated: None,
            });
        }

        symbols
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum VariableKind {
    /// Declare a variable.
    Let,
    /// Declare a variable that is read-only.
    Const,
    /// Declare a function.
    Fn,
    /// Declare a variable.
    Var,
}

impl VariableKind {
    pub fn to_completion_items() -> Result<Vec<CompletionItem>> {
        let mut settings = schemars::gen::SchemaSettings::openapi3();
        settings.inline_subschemas = true;
        let mut generator = schemars::gen::SchemaGenerator::new(settings);
        let schema = VariableKind::json_schema(&mut generator);
        let schemars::schema::Schema::Object(o) = &schema else {
            anyhow::bail!("expected object schema: {:#?}", schema);
        };
        let Some(subschemas) = &o.subschemas else {
            anyhow::bail!("expected subschemas: {:#?}", schema);
        };
        let Some(one_ofs) = &subschemas.one_of else {
            anyhow::bail!("expected one_of: {:#?}", schema);
        };

        // Iterate over all the VariableKinds and create a completion for each.
        let mut completions = vec![];
        for one_of in one_ofs {
            completions.push(crate::docs::completion_item_from_enum_schema(
                one_of,
                CompletionItemKind::KEYWORD,
            )?);
        }

        Ok(completions)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclarator {
    pub start: usize,
    pub end: usize,
    /// The identifier of the variable.
    pub id: Identifier,
    /// The value of the variable.
    pub init: Value,
}

impl_value_meta!(VariableDeclarator);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Literal {
    pub start: usize,
    pub end: usize,
    pub value: serde_json::Value,
    pub raw: String,
}

impl_value_meta!(Literal);

impl Literal {
    fn recast(&self) -> String {
        if let serde_json::Value::String(value) = &self.value {
            let quote = if self.raw.trim().starts_with('"') { '"' } else { '\'' };
            format!("{}{}{}", quote, value, quote)
        } else {
            self.value.to_string()
        }
    }
}

impl From<Literal> for MemoryItem {
    fn from(literal: Literal) -> Self {
        MemoryItem::UserVal(UserVal {
            value: literal.value.clone(),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        })
    }
}

impl From<&Box<Literal>> for MemoryItem {
    fn from(literal: &Box<Literal>) -> Self {
        MemoryItem::UserVal(UserVal {
            value: literal.value.clone(),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Identifier {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

impl_value_meta!(Identifier);

impl Identifier {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if self.name == old_name {
            self.name = new_name.to_string();
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct PipeSubstitution {
    pub start: usize,
    pub end: usize,
}

impl_value_meta!(PipeSubstitution);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ArrayExpression {
    pub start: usize,
    pub end: usize,
    pub elements: Vec<Value>,
}

impl_value_meta!(ArrayExpression);

impl ArrayExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        let flat_recast = format!(
            "[{}]",
            self.elements
                .iter()
                .map(|el| el.recast(options, 0, false))
                .collect::<Vec<String>>()
                .join(", ")
        );
        let max_array_length = 40;
        if flat_recast.len() > max_array_length {
            let inner_indentation = if is_in_pipe {
                options.get_indentation_offset_pipe(indentation_level + 1)
            } else {
                options.get_indentation(indentation_level + 1)
            };
            format!(
                "[\n{}{}\n{}]",
                inner_indentation,
                self.elements
                    .iter()
                    .map(|el| el.recast(options, indentation_level, false))
                    .collect::<Vec<String>>()
                    .join(format!(",\n{}", inner_indentation).as_str()),
                if is_in_pipe {
                    options.get_indentation_offset_pipe(indentation_level)
                } else {
                    options.get_indentation(indentation_level)
                },
            )
        } else {
            flat_recast
        }
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        for element in &self.elements {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code);
            }
        }

        None
    }

    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let result = match element {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
                    // stop the execution of the pipe.
                    // THIS IS IMPORTANT.
                    let mut new_pipe_info = pipe_info.clone();
                    new_pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, &mut new_pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => unary_expression.get_result(memory, pipe_info, engine)?,
                Value::ObjectExpression(object_expression) => object_expression.execute(memory, pipe_info, engine)?,
                Value::ArrayExpression(array_expression) => array_expression.execute(memory, pipe_info, engine)?,
                Value::PipeExpression(pipe_expression) => pipe_expression.get_result(memory, pipe_info, engine)?,
                Value::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("PipeSubstitution not implemented here: {:?}", pipe_substitution),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("MemberExpression not implemented here: {:?}", member_expression),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("FunctionExpression not implemented here: {:?}", function_expression),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            }
            .get_json_value()?;

            results.push(result);
        }

        Ok(MemoryItem::UserVal(UserVal {
            value: results.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for element in &mut self.elements {
            element.rename_identifiers(old_name, new_name);
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectExpression {
    pub start: usize,
    pub end: usize,
    pub properties: Vec<ObjectProperty>,
}

impl ObjectExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        let flat_recast = format!(
            "{{ {} }}",
            self.properties
                .iter()
                .map(|prop| { format!("{}: {}", prop.key.name, prop.value.recast(options, 0, false)) })
                .collect::<Vec<String>>()
                .join(", ")
        );
        let max_array_length = 40;
        if flat_recast.len() > max_array_length {
            let inner_indentation = if is_in_pipe {
                options.get_indentation_offset_pipe(indentation_level + 1)
            } else {
                options.get_indentation(indentation_level + 1)
            };
            format!(
                "{{\n{}{}\n{}}}",
                inner_indentation,
                self.properties
                    .iter()
                    .map(|prop| { format!("{}: {}", prop.key.name, prop.value.recast(options, 0, false)) })
                    .collect::<Vec<String>>()
                    .join(format!(",\n{}", inner_indentation).as_str()),
                if is_in_pipe {
                    options.get_indentation_offset_pipe(indentation_level)
                } else {
                    options.get_indentation(indentation_level)
                },
            )
        } else {
            flat_recast
        }
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        for property in &self.properties {
            let property_source_range: SourceRange = property.into();
            if property_source_range.contains(pos) {
                return property.get_hover_value_for_position(pos, code);
            }
        }

        None
    }

    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let mut object = Map::new();
        for property in &self.properties {
            let result = match &property.value {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
                    // stop the execution of the pipe.
                    // THIS IS IMPORTANT.
                    let mut new_pipe_info = pipe_info.clone();
                    new_pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, &mut new_pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => unary_expression.get_result(memory, pipe_info, engine)?,
                Value::ObjectExpression(object_expression) => object_expression.execute(memory, pipe_info, engine)?,
                Value::ArrayExpression(array_expression) => array_expression.execute(memory, pipe_info, engine)?,
                Value::PipeExpression(pipe_expression) => pipe_expression.get_result(memory, pipe_info, engine)?,
                Value::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("PipeSubstitution not implemented here: {:?}", pipe_substitution),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("MemberExpression not implemented here: {:?}", member_expression),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("FunctionExpression not implemented here: {:?}", function_expression),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            };

            object.insert(property.key.name.clone(), result.get_json_value()?);
        }

        Ok(MemoryItem::UserVal(UserVal {
            value: object.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for property in &mut self.properties {
            property.value.rename_identifiers(old_name, new_name);
        }
    }
}

impl_value_meta!(ObjectExpression);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectProperty {
    pub start: usize,
    pub end: usize,
    pub key: Identifier,
    pub value: Value,
}

impl_value_meta!(ObjectProperty);

impl ObjectProperty {
    pub fn get_lsp_symbols(&self, code: &str) -> Vec<DocumentSymbol> {
        let source_range: SourceRange = self.clone().into();
        let inner_source_range: SourceRange = self.key.clone().into();
        vec![
            #[allow(deprecated)]
            DocumentSymbol {
                name: self.key.name.to_string(),
                detail: None,
                kind: SymbolKind::PROPERTY,
                range: source_range.to_lsp_range(code),
                selection_range: inner_source_range.to_lsp_range(code),
                children: None,
                tags: None,
                deprecated: None,
            },
        ]
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let value_source_range: SourceRange = self.value.clone().into();
        if value_source_range.contains(pos) {
            return self.value.get_hover_value_for_position(pos, code);
        }

        None
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MemberObject {
    MemberExpression(Box<MemberExpression>),
    Identifier(Box<Identifier>),
}

impl MemberObject {
    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        match self {
            MemberObject::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code)
            }
            MemberObject::Identifier(_identifier) => None,
        }
    }

    pub fn start(&self) -> usize {
        match self {
            MemberObject::MemberExpression(member_expression) => member_expression.start,
            MemberObject::Identifier(identifier) => identifier.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            MemberObject::MemberExpression(member_expression) => member_expression.end,
            MemberObject::Identifier(identifier) => identifier.end,
        }
    }
}

impl From<MemberObject> for crate::executor::SourceRange {
    fn from(obj: MemberObject) -> Self {
        Self([obj.start(), obj.end()])
    }
}

impl From<&MemberObject> for crate::executor::SourceRange {
    fn from(obj: &MemberObject) -> Self {
        Self([obj.start(), obj.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LiteralIdentifier {
    Identifier(Box<Identifier>),
    Literal(Box<Literal>),
}

impl LiteralIdentifier {
    pub fn start(&self) -> usize {
        match self {
            LiteralIdentifier::Identifier(identifier) => identifier.start,
            LiteralIdentifier::Literal(literal) => literal.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            LiteralIdentifier::Identifier(identifier) => identifier.end,
            LiteralIdentifier::Literal(literal) => literal.end,
        }
    }
}

impl From<LiteralIdentifier> for crate::executor::SourceRange {
    fn from(id: LiteralIdentifier) -> Self {
        Self([id.start(), id.end()])
    }
}

impl From<&LiteralIdentifier> for crate::executor::SourceRange {
    fn from(id: &LiteralIdentifier) -> Self {
        Self([id.start(), id.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub start: usize,
    pub end: usize,
    pub object: MemberObject,
    pub property: LiteralIdentifier,
    pub computed: bool,
}

impl_value_meta!(MemberExpression);

impl MemberExpression {
    fn recast(&self) -> String {
        let key_str = match &self.property {
            LiteralIdentifier::Identifier(identifier) => {
                if self.computed {
                    format!("[{}]", &(*identifier.name))
                } else {
                    format!(".{}", &(*identifier.name))
                }
            }
            LiteralIdentifier::Literal(lit) => format!("[{}]", &(*lit.raw)),
        };

        match &self.object {
            MemberObject::MemberExpression(member_exp) => member_exp.recast() + key_str.as_str(),
            MemberObject::Identifier(identifier) => identifier.name.to_string() + key_str.as_str(),
        }
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let object_source_range: SourceRange = self.object.clone().into();
        if object_source_range.contains(pos) {
            return self.object.get_hover_value_for_position(pos, code);
        }

        None
    }

    pub fn get_result(&self, memory: &mut ProgramMemory) -> Result<MemoryItem, KclError> {
        let property_name = match &self.property {
            LiteralIdentifier::Identifier(identifier) => identifier.name.to_string(),
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                // Parse this as a string.
                if let serde_json::Value::String(string) = value {
                    string
                } else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("Expected string literal for property name, found {:?}", value),
                        source_ranges: vec![literal.into()],
                    }));
                }
            }
        };

        let object = match &self.object {
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(memory)?,
            MemberObject::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        }
        .get_json_value()?;

        if let serde_json::Value::Object(map) = object {
            if let Some(value) = map.get(&property_name) {
                Ok(MemoryItem::UserVal(UserVal {
                    value: value.clone(),
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                }))
            } else {
                Err(KclError::UndefinedValue(KclErrorDetails {
                    message: format!("Property {} not found in object", property_name),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("MemberExpression object is not an object: {:?}", object),
                source_ranges: vec![self.clone().into()],
            }))
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match &mut self.object {
            MemberObject::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
            MemberObject::Identifier(ref mut identifier) => identifier.rename(old_name, new_name),
        }

        match &mut self.property {
            LiteralIdentifier::Identifier(ref mut identifier) => identifier.rename(old_name, new_name),
            LiteralIdentifier::Literal(_) => {}
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ObjectKeyInfo {
    pub key: LiteralIdentifier,
    pub index: usize,
    pub computed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct BinaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: BinaryOperator,
    pub left: BinaryPart,
    pub right: BinaryPart,
}

impl_value_meta!(BinaryExpression);

impl BinaryExpression {
    pub fn precedence(&self) -> u8 {
        self.operator.precedence()
    }

    fn recast(&self, options: &FormatOptions) -> String {
        let maybe_wrap_it = |a: String, doit: bool| -> String {
            if doit {
                format!("({})", a)
            } else {
                a
            }
        };

        let should_wrap_right = match &self.right {
            BinaryPart::BinaryExpression(bin_exp) => {
                self.precedence() > bin_exp.precedence() || self.operator == BinaryOperator::Sub
            }
            _ => false,
        };

        let should_wrap_left = match &self.left {
            BinaryPart::BinaryExpression(bin_exp) => self.precedence() > bin_exp.precedence(),
            _ => false,
        };

        format!(
            "{} {} {}",
            maybe_wrap_it(self.left.recast(options, 0), should_wrap_left),
            self.operator,
            maybe_wrap_it(self.right.recast(options, 0), should_wrap_right)
        )
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let left_source_range: SourceRange = self.left.clone().into();
        let right_source_range: SourceRange = self.right.clone().into();

        if left_source_range.contains(pos) {
            return self.left.get_hover_value_for_position(pos, code);
        } else if right_source_range.contains(pos) {
            return self.right.get_hover_value_for_position(pos, code);
        }

        None
    }

    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
        // stop the execution of the pipe.
        // THIS IS IMPORTANT.
        let mut new_pipe_info = pipe_info.clone();
        new_pipe_info.is_in_pipe = false;

        let left_json_value = self
            .left
            .get_result(memory, &mut new_pipe_info, engine)?
            .get_json_value()?;
        let right_json_value = self
            .right
            .get_result(memory, &mut new_pipe_info, engine)?
            .get_json_value()?;

        // First check if we are doing string concatenation.
        if self.operator == BinaryOperator::Add {
            if let (Some(left), Some(right)) = (
                parse_json_value_as_string(&left_json_value),
                parse_json_value_as_string(&right_json_value),
            ) {
                let value = serde_json::Value::String(format!("{}{}", left, right));
                return Ok(MemoryItem::UserVal(UserVal {
                    value,
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                }));
            }
        }

        let left = parse_json_number_as_f64(&left_json_value, self.left.clone().into())?;
        let right = parse_json_number_as_f64(&right_json_value, self.right.clone().into())?;

        let value: serde_json::Value = match self.operator {
            BinaryOperator::Add => (left + right).into(),
            BinaryOperator::Sub => (left - right).into(),
            BinaryOperator::Mul => (left * right).into(),
            BinaryOperator::Div => (left / right).into(),
            BinaryOperator::Mod => (left % right).into(),
        };

        Ok(MemoryItem::UserVal(UserVal {
            value,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.left.rename_identifiers(old_name, new_name);
        self.right.rename_identifiers(old_name, new_name);
    }
}

pub fn parse_json_number_as_f64(j: &serde_json::Value, source_range: SourceRange) -> Result<f64, KclError> {
    if let serde_json::Value::Number(n) = &j {
        n.as_f64().ok_or_else(|| {
            KclError::Syntax(KclErrorDetails {
                source_ranges: vec![source_range],
                message: format!("Invalid number: {}", j),
            })
        })
    } else {
        Err(KclError::Syntax(KclErrorDetails {
            source_ranges: vec![source_range],
            message: format!("Invalid number: {}", j),
        }))
    }
}

pub fn parse_json_value_as_string(j: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::String(n) = &j {
        Some(n.clone())
    } else {
        None
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum BinaryOperator {
    /// Add two numbers.
    #[serde(rename = "+")]
    #[display("+")]
    Add,
    /// Subtract two numbers.
    #[serde(rename = "-")]
    #[display("-")]
    Sub,
    /// Multiply two numbers.
    #[serde(rename = "*")]
    #[display("*")]
    Mul,
    /// Divide two numbers.
    #[serde(rename = "/")]
    #[display("/")]
    Div,
    /// Modulo two numbers.
    #[serde(rename = "%")]
    #[display("%")]
    Mod,
}

impl BinaryOperator {
    pub fn precedence(&self) -> u8 {
        match &self {
            BinaryOperator::Add | BinaryOperator::Sub => 11,
            BinaryOperator::Mul | BinaryOperator::Div | BinaryOperator::Mod => 12,
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct UnaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: UnaryOperator,
    pub argument: BinaryPart,
}

impl_value_meta!(UnaryExpression);

impl UnaryExpression {
    fn recast(&self, options: &FormatOptions) -> String {
        format!("{}{}", &self.operator, self.argument.recast(options, 0))
    }

    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        // We DO NOT set this gloablly because if we did and this was called inside a pipe it would
        // stop the execution of the pipe.
        // THIS IS IMPORTANT.
        let mut new_pipe_info = pipe_info.clone();
        new_pipe_info.is_in_pipe = false;

        let num = parse_json_number_as_f64(
            &self
                .argument
                .get_result(memory, &mut new_pipe_info, engine)?
                .get_json_value()?,
            self.into(),
        )?;
        Ok(MemoryItem::UserVal(UserVal {
            value: (-(num)).into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let argument_source_range: SourceRange = self.argument.clone().into();
        if argument_source_range.contains(pos) {
            return self.argument.get_hover_value_for_position(pos, code);
        }

        None
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.argument.rename_identifiers(old_name, new_name);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum UnaryOperator {
    /// Negate a number.
    #[serde(rename = "-")]
    #[display("-")]
    Neg,
    /// Negate a boolean.
    #[serde(rename = "!")]
    #[display("!")]
    Not,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct PipeExpression {
    pub start: usize,
    pub end: usize,
    pub body: Vec<Value>,
    pub non_code_meta: NoneCodeMeta,
}

impl_value_meta!(PipeExpression);

impl PipeExpression {
    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        self.body
            .iter()
            .enumerate()
            .map(|(index, statement)| {
                let indentation = options.get_indentation(indentation_level + 1);
                let mut s = statement.recast(options, indentation_level + 1, true);
                let non_code_meta = self.non_code_meta.clone();
                if let Some(non_code_meta_value) = non_code_meta.none_code_nodes.get(&index) {
                    s += non_code_meta_value.format(&indentation).trim_end_matches('\n')
                }

                if index != self.body.len() - 1 {
                    s += "\n";
                    s += &indentation;
                    s += PIPE_OPERATOR;
                    s += " ";
                }
                s
            })
            .collect::<String>()
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        for b in &self.body {
            let b_source_range: SourceRange = b.into();
            if b_source_range.contains(pos) {
                return b.get_hover_value_for_position(pos, code);
            }
        }

        None
    }

    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        // Reset the previous results.
        pipe_info.previous_results = vec![];
        pipe_info.index = 0;
        execute_pipe_body(memory, &self.body, pipe_info, self.into(), engine)
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for statement in &mut self.body {
            statement.rename_identifiers(old_name, new_name);
        }
    }
}

fn execute_pipe_body(
    memory: &mut ProgramMemory,
    body: &[Value],
    pipe_info: &mut PipeInfo,
    source_range: SourceRange,
    engine: &mut EngineConnection,
) -> Result<MemoryItem, KclError> {
    if pipe_info.index == body.len() {
        pipe_info.is_in_pipe = false;
        return Ok(pipe_info
            .previous_results
            .last()
            .ok_or_else(|| {
                KclError::Semantic(KclErrorDetails {
                    message: "Pipe body results should have at least one expression".to_string(),
                    source_ranges: vec![source_range],
                })
            })?
            .clone());
    }

    let expression = body.get(pipe_info.index).ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: format!("Invalid index for pipe: {}", pipe_info.index),
            source_ranges: vec![source_range],
        })
    })?;

    match expression {
        Value::BinaryExpression(binary_expression) => {
            let result = binary_expression.get_result(memory, pipe_info, engine)?;
            pipe_info.previous_results.push(result);
            pipe_info.index += 1;
            execute_pipe_body(memory, body, pipe_info, source_range, engine)
        }
        Value::CallExpression(call_expression) => {
            pipe_info.is_in_pipe = true;
            pipe_info.body = body.to_vec();
            call_expression.execute(memory, pipe_info, engine)
        }
        _ => {
            // Return an error this should not happen.
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("PipeExpression not implemented here: {:?}", expression),
                source_ranges: vec![expression.into()],
            }))
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    pub start: usize,
    pub end: usize,
    pub params: Vec<Identifier>,
    pub body: Program,
}

impl_value_meta!(FunctionExpression);

impl FunctionExpression {
    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        // We don't want to end with a new line inside nested functions.
        let mut new_options = options.clone();
        new_options.insert_final_newline = false;
        format!(
            "({}) => {{\n{}{}\n}}",
            self.params
                .iter()
                .map(|param| param.name.clone())
                .collect::<Vec<String>>()
                .join(", "),
            options.get_indentation(indentation_level + 1),
            self.body.recast(&new_options, indentation_level + 1)
        )
    }

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        if let Some(value) = self.body.get_value_for_position(pos) {
            return value.get_hover_value_for_position(pos, code);
        }

        None
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub start: usize,
    pub end: usize,
    pub argument: Value,
}

impl_value_meta!(ReturnStatement);

/// Describes information about a hover.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Hover {
    Function {
        name: String,
        range: LspRange,
    },
    Signature {
        name: String,
        parameter_index: u32,
        range: LspRange,
    },
}

/// Format options.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct FormatOptions {
    /// Size of a tab in spaces.
    pub tab_size: usize,
    /// Prefer tabs over spaces.
    pub use_tabs: bool,
    /// How to handle the final newline in the file.
    /// If true, ensure file ends with a newline.
    /// If false, ensure file does not end with a newline.
    pub insert_final_newline: bool,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self::new()
    }
}

impl FormatOptions {
    /// Define the default format options.
    /// We use 2 spaces for indentation.
    pub fn new() -> Self {
        Self {
            tab_size: 2,
            use_tabs: false,
            insert_final_newline: true,
        }
    }

    /// Get the indentation string for the given level.
    pub fn get_indentation(&self, level: usize) -> String {
        if self.use_tabs {
            "\t".repeat(level)
        } else {
            " ".repeat(level * self.tab_size)
        }
    }

    /// Get the indentation string for the given level.
    /// But offset the pipe operator (and a space) by one level.
    pub fn get_indentation_offset_pipe(&self, level: usize) -> String {
        if self.use_tabs {
            "\t".repeat(level + 1)
        } else {
            " ".repeat(level * self.tab_size) + " ".repeat(PIPE_OPERATOR.len() + 1).as_str()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_variable_kind_to_completion() {
        let completions = VariableKind::to_completion_items().unwrap();
        assert!(!completions.is_empty());
    }

    #[test]
    fn test_get_lsp_symbols() {
        let code = r#"const part001 = startSketchAt([0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, b: "thing"}

fn ghi = (x) => {
  return x
}

show(part001)"#;
        let tokens = crate::tokeniser::lexer(code);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();
        let symbols = program.get_lsp_symbols(code);
        assert_eq!(symbols.len(), 7);
    }

    #[test]
    fn test_recast_with_std_and_non_stdlib() {
        let some_program_string = r#"{"body":[{"type":"VariableDeclaration","start":0,"end":0,"declarations":[{"type":"VariableDeclarator","start":0,"end":0,"id":{"type":"Identifier","start":0,"end":0,"name":"part001"},"init":{"type":"PipeExpression","start":0,"end":0,"body":[{"type":"CallExpression","start":0,"end":0,"callee":{"type":"Identifier","start":0,"end":0,"name":"startSketchAt"},"function":{"type":"StdLib","func":{"name":"startSketchAt","summary":"","description":"","tags":[],"returnValue":{"type":"","required":false,"name":"","schema":{}},"args":[],"unpublished":false,"deprecated":false}},"optional":false,"arguments":[{"type":"Literal","start":0,"end":0,"value":"default","raw":"default"}]},{"type":"CallExpression","start":0,"end":0,"callee":{"type":"Identifier","start":0,"end":0,"name":"ry"},"function":{"type":"InMemory"},"optional":false,"arguments":[{"type":"Literal","start":0,"end":0,"value":90,"raw":"90"},{"type":"PipeSubstitution","start":0,"end":0}]},{"type":"CallExpression","start":0,"end":0,"callee":{"type":"Identifier","start":0,"end":0,"name":"line"},"function":{"type":"StdLib","func":{"name":"line","summary":"","description":"","tags":[],"returnValue":{"type":"","required":false,"name":"","schema":{}},"args":[],"unpublished":false,"deprecated":false}},"optional":false,"arguments":[{"type":"Literal","start":0,"end":0,"value":"default","raw":"default"},{"type":"PipeSubstitution","start":0,"end":0}]}],"nonCodeMeta":{"noneCodeNodes":{},"start":null}}}],"kind":"const"},{"type":"ExpressionStatement","start":0,"end":0,"expression":{"type":"CallExpression","start":0,"end":0,"callee":{"type":"Identifier","start":0,"end":0,"name":"show"},"function":{"type":"StdLib","func":{"name":"show","summary":"","description":"","tags":[],"returnValue":{"type":"","required":false,"name":"","schema":{}},"args":[],"unpublished":false,"deprecated":false}},"optional":false,"arguments":[{"type":"Identifier","start":0,"end":0,"name":"part001"}]}}],"start":0,"end":0,"nonCodeMeta":{"noneCodeNodes":{},"start":null}}"#;
        let some_program: crate::abstract_syntax_tree_types::Program =
            serde_json::from_str(some_program_string).unwrap();

        let recasted = some_program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchAt('default')
  |> ry(90, %)
  |> line('default', %)
show(part001)
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation() {
        let some_program_string = r#"const part001 = startSketchAt([0.0, 5.0])
              |> line([0.4900857016, -0.0240763666], %)
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchAt([0.0, 5.0])
  |> line([0.4900857016, -0.0240763666], %)
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation_and_inline_comment() {
        let some_program_string = r#"const part001 = startSketchAt([0.0, 5.0])
              |> line([0.4900857016, -0.0240763666], %) // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchAt([0.0, 5.0])
  |> line([0.4900857016, -0.0240763666], %) // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }
    #[test]
    fn test_recast_with_bad_indentation_and_line_comment() {
        let some_program_string = r#"const part001 = startSketchAt([0.0, 5.0])
              |> line([0.4900857016, -0.0240763666], %)
        // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchAt([0.0, 5.0])
  |> line([0.4900857016, -0.0240763666], %)
  // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_comment_in_a_fn_block() {
        let some_program_string = r#"const myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
    return things
}"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } }
  /* block
  comment */
  const key = 'c'
  // this is also a comment
  return things
}
"#
        );
    }

    #[test]
    fn test_recast_lots_of_comments() {
        let some_program_string = r#"// comment at start
const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo({ to: [0, 1], tag: 'myTag' }, %)
  |> lineTo([1, 1], %)
  /* and
  here
  */
  // a comment between pipe expression statements
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)
  |> rx(45, %)
// one more for good measure"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// comment at start
const mySk1 = startSketchAt([0, 0])
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo({ to: [0, 1], tag: 'myTag' }, %)
  |> lineTo([1, 1], %)
  /* and
  here

a comment between pipe expression statements */
  |> rx(90, %)
  // and another with just white space between others below
  |> ry(45, %)
  |> rx(45, %)
// one more for good measure
"#
        );
    }

    #[test]
    fn test_recast_multiline_object() {
        let some_program_string = r#"const part001 = startSketchAt([-0.01, -0.08])
  |> line({ to: [0.62, 4.15], tag: 'seg01' }, %)
  |> line([2.77, -1.24], %)
  |> angledLineThatIntersects({
       angle: 201,
       offset: -1.35,
       intersectTag: 'seg01'
     }, %)
  |> line([-0.42, -1.72], %)

show(part001)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_first_level_object() {
        let some_program_string = r#"const three = 3

const yo = {
  aStr: 'str',
  anum: 2,
  identifier: three,
  binExp: 4 + 5
}
const yo = [
  1,
  "  2,",
  "three",
  4 + 5,
  "  hey oooooo really long long long"
]
"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_new_line_before_comment() {
        let some_program_string = r#"
// this is a comment
const yo = { a: { b: { c: '123' } } }

const key = 'c'
const things = "things"

// this is also a comment"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string.trim());
    }

    #[test]
    fn test_recast_comment_tokens_inside_strings() {
        let some_program_string = r#"let b = {
  "end": 141,
  "start": 125,
  "type": "NoneCodeNode",
  "value": "
 // a comment
   "
}"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string.trim());
    }

    #[test]
    fn test_recast_array_new_line_in_pipe() {
        let some_program_string = r#"const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchAt([0, 0])
  |> line({ to: [1, 3.82], tag: 'seg01' }, %) // ln-should-get-tag
  |> angledLineToX([
       -angleToMatchLengthX('seg01', myVar, %),
       myVar
     ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLineToY([
       -angleToMatchLengthY('seg01', myVar, %),
       myVar
     ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn test_recast_array_new_line_in_pipe_custom() {
        let some_program_string = r#"const myVar = 3
const myVar2 = 5
const myVar3 = 6
const myAng = 40
const myAng2 = 134
const part001 = startSketchAt([0, 0])
   |> line({ to: [1, 3.82], tag: 'seg01' }, %) // ln-should-get-tag
   |> angledLineToX([
         -angleToMatchLengthX('seg01', myVar, %),
         myVar
      ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
   |> angledLineToY([
         -angleToMatchLengthY('seg01', myVar, %),
         myVar
      ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(
            &FormatOptions {
                tab_size: 3,
                use_tabs: false,
                insert_final_newline: true,
            },
            0,
        );
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_after_rename_std() {
        let some_program_string = r#"const part001 = startSketchAt([0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, part001: "thing"}

fn ghi = (part001) => {
  return part001
}

show(part001)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let mut program = parser.ast().unwrap();
        program.rename_symbol("mySuperCoolPart", 6);

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const mySuperCoolPart = startSketchAt([0.0, 5.0])
  |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [mySuperCoolPart, 0.0]
let blah = 1
const foo = false
let baz = { a: 1, part001: "thing" }

fn ghi = (part001) => {
  return part001
}

show(mySuperCoolPart)
"#
        );
    }

    #[test]
    fn test_recast_after_rename_fn_args() {
        let some_program_string = r#"fn ghi = (x, y, z) => {
  return x
}"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let mut program = parser.ast().unwrap();
        program.rename_symbol("newName", 10);

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn ghi = (newName, y, z) => {
  return newName
}
"#
        );
    }

    #[test]
    fn test_recast_negative_var() {
        let some_program_string = r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchAt([0,0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)"#;
        let tokens = crate::tokeniser::lexer(some_program_string);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchAt([0, 0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)
"#
        );
    }
}
