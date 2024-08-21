//! Data types for the AST.

use std::{
    collections::HashMap,
    fmt::Write,
    ops::RangeInclusive,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use databake::*;
use parse_display::{Display, FromStr};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value as JValue};
use sha2::{Digest as DigestTrait, Sha256};
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, DocumentSymbol, FoldingRange, FoldingRangeKind, Range as LspRange, SymbolKind,
};

pub use crate::ast::types::{literal_value::LiteralValue, none::KclNone};
use crate::{
    docs::StdLibFn,
    errors::{KclError, KclErrorDetails},
    executor::{
        BodyType, DynamicState, ExecutorContext, KclValue, Metadata, PipeInfo, ProgramMemory, SourceRange,
        StatementKind, TagEngineInfo, TagIdentifier, UserVal,
    },
    parser::PIPE_OPERATOR,
    std::{kcl_stdlib::KclStdLibFn, FunctionKind},
};

mod literal_value;
mod none;

/// Position-independent digest of the AST node.
pub type Digest = [u8; 32];

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    pub non_code_meta: NonCodeMeta,

    pub digest: Option<Digest>,
}

macro_rules! compute_digest {
    (|$slf:ident, $hasher:ident| $body:block) => {
        /// Compute a digest over the AST node.
        pub fn compute_digest(&mut self) -> Digest {
            if let Some(node_digest) = self.digest {
                return node_digest;
            }

            let mut $hasher = Sha256::new();

            #[allow(unused_mut)]
            let mut $slf = self;

            $hasher.update(std::any::type_name::<Self>());

            $body

            let node_digest: Digest = $hasher.finalize().into();
            $slf.digest = Some(node_digest);
            node_digest
        }
    };
}

impl Program {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for body_item in slf.body.iter_mut() {
            hasher.update(body_item.compute_digest());
        }
        hasher.update(slf.non_code_meta.compute_digest());
    });

    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        // Check if we are in the non code meta.
        if let Some(meta) = self.get_non_code_meta_for_position(pos) {
            for node in &meta.start {
                if node.contains(pos) {
                    // We only care about the shebang.
                    if let NonCodeValue::Shebang { value: _ } = &node.value {
                        let source_range: SourceRange = node.into();
                        return Some(Hover::Comment {
                            value: r#"The `#!` at the start of a script, known as a shebang, specifies the path to the interpreter that should execute the script. This line is not necessary for your `kcl` to run in the modeling-app. You can safely delete it. If you wish to learn more about what you _can_ do with a shebang, read this doc: [zoo.dev/docs/faq/shebang](https://zoo.dev/docs/faq/shebang)."#.to_string(),
                            range: source_range.to_lsp_range(code),
                        });
                    }
                }
            }
        }

        let value = self.get_value_for_position(pos)?;

        value.get_hover_value_for_position(pos, code)
    }

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
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.recast(options, indentation_level)
                }
                BodyItem::ReturnStatement(return_statement) => {
                    format!(
                        "{}return {}",
                        indentation,
                        return_statement.argument.recast(options, 0, false)
                    )
                }
            })
            .enumerate()
            .fold(String::new(), |mut output, (index, recast_str)| {
                let start_string = if index == 0 {
                    // We need to indent.
                    if self.non_code_meta.start.is_empty() {
                        indentation.to_string()
                    } else {
                        self.non_code_meta
                            .start
                            .iter()
                            .map(|start| start.format(&indentation))
                            .collect()
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

                let custom_white_space_or_comment = match self.non_code_meta.non_code_nodes.get(&index) {
                    Some(noncodes) => noncodes
                        .iter()
                        .enumerate()
                        .map(|(i, custom_white_space_or_comment)| {
                            let formatted = custom_white_space_or_comment.format(&indentation);
                            if i == 0 && !formatted.trim().is_empty() {
                                if let NonCodeValue::BlockComment { .. } = custom_white_space_or_comment.value {
                                    format!("\n{}", formatted)
                                } else {
                                    formatted
                                }
                            } else {
                                formatted
                            }
                        })
                        .collect::<String>(),
                    None => String::new(),
                };
                let end_string = if custom_white_space_or_comment.is_empty() {
                    maybe_line_break
                } else {
                    custom_white_space_or_comment
                };

                let _ = write!(output, "{}{}{}", start_string, recast_str, end_string);
                output
            })
            .trim()
            .to_string();

        // Insert a final new line if the user wants it.
        if options.insert_final_newline && !result.is_empty() {
            format!("{}\n", result)
        } else {
            result
        }
    }

    /// Check the provided Program for any lint findings.
    pub fn lint<'a, RuleT>(&'a self, rule: RuleT) -> Result<Vec<crate::lint::Discovered>>
    where
        RuleT: crate::lint::rule::Rule<'a>,
    {
        let v = Arc::new(Mutex::new(vec![]));
        crate::walk::walk(self, &|node: crate::walk::Node<'a>| {
            let mut findings = v.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
            findings.append(&mut rule.check(node)?);
            Ok(true)
        })?;
        let x = v.lock().unwrap();
        Ok(x.clone())
    }

    pub fn lint_all(&self) -> Result<Vec<crate::lint::Discovered>> {
        let rules = vec![
            crate::lint::checks::lint_variables,
            crate::lint::checks::lint_object_properties,
            crate::lint::checks::lint_call_expressions,
        ];

        let mut findings = vec![];
        for rule in rules {
            findings.append(&mut self.lint(rule)?);
        }
        Ok(findings)
    }

    /// Walk the ast and get all the variables and tags as completion items.
    pub fn completion_items<'a>(&'a self) -> Result<Vec<CompletionItem>> {
        let completions = Arc::new(Mutex::new(vec![]));
        crate::walk::walk(self, &|node: crate::walk::Node<'a>| {
            let mut findings = completions.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
            match node {
                crate::walk::Node::TagDeclarator(tag) => {
                    findings.push(tag.into());
                }
                crate::walk::Node::VariableDeclaration(variable) => {
                    findings.extend::<Vec<CompletionItem>>(variable.into());
                }
                _ => {}
            }
            Ok(true)
        })?;
        let x = completions.lock().unwrap();
        Ok(x.clone())
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
    pub fn get_value_for_position(&self, pos: usize) -> Option<&Expr> {
        let item = self.get_body_item_for_position(pos)?;

        // Recurse over the item.
        match item {
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_value_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
        }
    }

    /// Returns a non code meta that includes the given character position.
    pub fn get_non_code_meta_for_position(&self, pos: usize) -> Option<&NonCodeMeta> {
        // Check if its in the body.
        if self.non_code_meta.contains(pos) {
            return Some(&self.non_code_meta);
        }
        let item = self.get_body_item_for_position(pos)?;

        // Recurse over the item.
        let value = match item {
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_value_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
        };

        // Check if the value's non code meta contains the position.
        if let Some(value) = value {
            if let Some(non_code_meta) = value.get_non_code_meta() {
                if non_code_meta.contains(pos) {
                    return Some(non_code_meta);
                }
            }
        }

        None
    }

    /// Returns all the lsp symbols in the program.
    pub fn get_lsp_symbols<'a>(&'a self, code: &str) -> Result<Vec<DocumentSymbol>> {
        let symbols = Arc::new(Mutex::new(vec![]));
        crate::walk::walk(self, &|node: crate::walk::Node<'a>| {
            let mut findings = symbols.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
            match node {
                crate::walk::Node::TagDeclarator(tag) => {
                    findings.extend::<Vec<DocumentSymbol>>(tag.get_lsp_symbols(code));
                }
                crate::walk::Node::VariableDeclaration(variable) => {
                    findings.extend::<Vec<DocumentSymbol>>(variable.get_lsp_symbols(code));
                }
                _ => {}
            }
            Ok(true)
        })?;
        let x = symbols.lock().unwrap();
        Ok(x.clone())
    }

    // Return all the lsp folding ranges in the program.
    pub fn get_lsp_folding_ranges(&self) -> Vec<FoldingRange> {
        let mut ranges = vec![];
        // We only care about the top level things in the program.
        for item in &self.body {
            match item {
                BodyItem::ExpressionStatement(expression_statement) => {
                    if let Some(folding_range) = expression_statement.expression.get_lsp_folding_range() {
                        ranges.push(folding_range)
                    }
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if let Some(folding_range) = variable_declaration.get_lsp_folding_range() {
                        ranges.push(folding_range)
                    }
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }

        ranges
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
            if let Some(Expr::FunctionExpression(ref mut function_expression)) = &mut value {
                // Check if the params to the function expression contain the position.
                for param in &mut function_expression.params {
                    let param_source_range: SourceRange = (&param.identifier).into();
                    if param_source_range.contains(pos) {
                        let old_name = param.identifier.name.clone();
                        // Rename the param.
                        param.identifier.rename(&old_name, new_name);
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

    /// Replace a variable declaration with the given name with a new one.
    pub fn replace_variable(&mut self, name: &str, declarator: VariableDeclarator) {
        for item in &mut self.body {
            match item {
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    for declaration in &mut variable_declaration.declarations {
                        if declaration.id.name == name {
                            *declaration = declarator;
                            return;
                        }
                    }
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }
    }

    /// Replace a value with the new value, use the source range for matching the exact value.
    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for item in &mut self.body {
            match item {
                BodyItem::ExpressionStatement(ref mut expression_statement) => expression_statement
                    .expression
                    .replace_value(source_range, new_value.clone()),
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    variable_declaration.replace_value(source_range, new_value.clone())
                }
                BodyItem::ReturnStatement(ref mut return_statement) => {
                    return_statement.argument.replace_value(source_range, new_value.clone())
                }
            }
        }
    }

    /// Get the variable declaration with the given name.
    pub fn get_variable(&self, name: &str) -> Option<&VariableDeclarator> {
        for item in &self.body {
            match item {
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    for declaration in &variable_declaration.declarations {
                        if declaration.id.name == name {
                            return Some(declaration);
                        }
                    }
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }

        None
    }
}

pub trait ValueMeta {
    fn start(&self) -> usize;

    fn end(&self) -> usize;
}

macro_rules! impl_value_meta {
    {$name:ident} => {
        impl crate::ast::types::ValueMeta for $name {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BodyItem {
    ExpressionStatement(ExpressionStatement),
    VariableDeclaration(VariableDeclaration),
    ReturnStatement(ReturnStatement),
}

impl BodyItem {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            BodyItem::ExpressionStatement(es) => es.compute_digest(),
            BodyItem::VariableDeclaration(vs) => vs.compute_digest(),
            BodyItem::ReturnStatement(rs) => rs.compute_digest(),
        }
    }

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

impl From<BodyItem> for SourceRange {
    fn from(item: BodyItem) -> Self {
        Self([item.start(), item.end()])
    }
}

impl From<&BodyItem> for SourceRange {
    fn from(item: &BodyItem) -> Self {
        Self([item.start(), item.end()])
    }
}

/// An expression can be evaluated to yield a single KCL value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Expr {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    TagDeclarator(Box<TagDeclarator>),
    BinaryExpression(Box<BinaryExpression>),
    FunctionExpression(Box<FunctionExpression>),
    CallExpression(Box<CallExpression>),
    PipeExpression(Box<PipeExpression>),
    PipeSubstitution(Box<PipeSubstitution>),
    ArrayExpression(Box<ArrayExpression>),
    ObjectExpression(Box<ObjectExpression>),
    MemberExpression(Box<MemberExpression>),
    UnaryExpression(Box<UnaryExpression>),
    None(KclNone),
}

impl Expr {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            Expr::Literal(lit) => lit.compute_digest(),
            Expr::Identifier(id) => id.compute_digest(),
            Expr::TagDeclarator(tag) => tag.compute_digest(),
            Expr::BinaryExpression(be) => be.compute_digest(),
            Expr::FunctionExpression(fe) => fe.compute_digest(),
            Expr::CallExpression(ce) => ce.compute_digest(),
            Expr::PipeExpression(pe) => pe.compute_digest(),
            Expr::PipeSubstitution(ps) => ps.compute_digest(),
            Expr::ArrayExpression(ae) => ae.compute_digest(),
            Expr::ObjectExpression(oe) => oe.compute_digest(),
            Expr::MemberExpression(me) => me.compute_digest(),
            Expr::UnaryExpression(ue) => ue.compute_digest(),
            Expr::None(_) => {
                let mut hasher = Sha256::new();
                hasher.update(b"Value::None");
                hasher.finalize().into()
            }
        }
    }

    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        match &self {
            Expr::BinaryExpression(bin_exp) => bin_exp.recast(options),
            Expr::ArrayExpression(array_exp) => array_exp.recast(options, indentation_level, is_in_pipe),
            Expr::ObjectExpression(ref obj_exp) => obj_exp.recast(options, indentation_level, is_in_pipe),
            Expr::MemberExpression(mem_exp) => mem_exp.recast(),
            Expr::Literal(literal) => literal.recast(),
            Expr::FunctionExpression(func_exp) => func_exp.recast(options, indentation_level),
            Expr::CallExpression(call_exp) => call_exp.recast(options, indentation_level, is_in_pipe),
            Expr::Identifier(ident) => ident.name.to_string(),
            Expr::TagDeclarator(tag) => tag.recast(),
            Expr::PipeExpression(pipe_exp) => pipe_exp.recast(options, indentation_level),
            Expr::UnaryExpression(unary_exp) => unary_exp.recast(options),
            Expr::PipeSubstitution(_) => crate::parser::PIPE_SUBSTITUTION_OPERATOR.to_string(),
            Expr::None(_) => {
                unimplemented!("there is no literal None, see https://github.com/KittyCAD/modeling-app/issues/1115")
            }
        }
    }

    pub fn get_lsp_folding_range(&self) -> Option<FoldingRange> {
        let recasted = self.recast(&FormatOptions::default(), 0, false);
        // If the code only has one line then we don't need to fold it.
        if recasted.lines().count() <= 1 {
            return None;
        }

        // This unwrap is safe because we know that the code has at least one line.
        let first_line = recasted.lines().next().unwrap().to_string();

        Some(FoldingRange {
            start_line: (self.start() + first_line.len()) as u32,
            start_character: None,
            end_line: self.end() as u32,
            end_character: None,
            kind: Some(FoldingRangeKind::Region),
            collapsed_text: Some(first_line),
        })
    }

    // Get the non code meta for the value.
    pub fn get_non_code_meta(&self) -> Option<&NonCodeMeta> {
        match self {
            Expr::BinaryExpression(_bin_exp) => None,
            Expr::ArrayExpression(_array_exp) => None,
            Expr::ObjectExpression(_obj_exp) => None,
            Expr::MemberExpression(_mem_exp) => None,
            Expr::Literal(_literal) => None,
            Expr::FunctionExpression(_func_exp) => None,
            Expr::CallExpression(_call_exp) => None,
            Expr::Identifier(_ident) => None,
            Expr::TagDeclarator(_tag) => None,
            Expr::PipeExpression(pipe_exp) => Some(&pipe_exp.non_code_meta),
            Expr::UnaryExpression(_unary_exp) => None,
            Expr::PipeSubstitution(_pipe_substitution) => None,
            Expr::None(_none) => None,
        }
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        if source_range == self.clone().into() {
            *self = new_value;
            return;
        }

        match self {
            Expr::BinaryExpression(ref mut bin_exp) => bin_exp.replace_value(source_range, new_value),
            Expr::ArrayExpression(ref mut array_exp) => array_exp.replace_value(source_range, new_value),
            Expr::ObjectExpression(ref mut obj_exp) => obj_exp.replace_value(source_range, new_value),
            Expr::MemberExpression(_) => {}
            Expr::Literal(_) => {}
            Expr::FunctionExpression(ref mut func_exp) => func_exp.replace_value(source_range, new_value),
            Expr::CallExpression(ref mut call_exp) => call_exp.replace_value(source_range, new_value),
            Expr::Identifier(_) => {}
            Expr::TagDeclarator(_) => {}
            Expr::PipeExpression(ref mut pipe_exp) => pipe_exp.replace_value(source_range, new_value),
            Expr::UnaryExpression(ref mut unary_exp) => unary_exp.replace_value(source_range, new_value),
            Expr::PipeSubstitution(_) => {}
            Expr::None(_) => {}
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.start(),
            Expr::Identifier(identifier) => identifier.start(),
            Expr::TagDeclarator(tag) => tag.start(),
            Expr::BinaryExpression(binary_expression) => binary_expression.start(),
            Expr::FunctionExpression(function_expression) => function_expression.start(),
            Expr::CallExpression(call_expression) => call_expression.start(),
            Expr::PipeExpression(pipe_expression) => pipe_expression.start(),
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.start(),
            Expr::ArrayExpression(array_expression) => array_expression.start(),
            Expr::ObjectExpression(object_expression) => object_expression.start(),
            Expr::MemberExpression(member_expression) => member_expression.start(),
            Expr::UnaryExpression(unary_expression) => unary_expression.start(),
            Expr::None(none) => none.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.end(),
            Expr::Identifier(identifier) => identifier.end(),
            Expr::TagDeclarator(tag) => tag.end(),
            Expr::BinaryExpression(binary_expression) => binary_expression.end(),
            Expr::FunctionExpression(function_expression) => function_expression.end(),
            Expr::CallExpression(call_expression) => call_expression.end(),
            Expr::PipeExpression(pipe_expression) => pipe_expression.end(),
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.end(),
            Expr::ArrayExpression(array_expression) => array_expression.end(),
            Expr::ObjectExpression(object_expression) => object_expression.end(),
            Expr::MemberExpression(member_expression) => member_expression.end(),
            Expr::UnaryExpression(unary_expression) => unary_expression.end(),
            Expr::None(none) => none.end,
        }
    }

    /// Returns a hover value that includes the given character position.
    /// This is really recursive so keep that in mind.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        match self {
            Expr::BinaryExpression(binary_expression) => binary_expression.get_hover_value_for_position(pos, code),
            Expr::FunctionExpression(function_expression) => {
                function_expression.get_hover_value_for_position(pos, code)
            }
            Expr::CallExpression(call_expression) => call_expression.get_hover_value_for_position(pos, code),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_hover_value_for_position(pos, code),
            Expr::ArrayExpression(array_expression) => array_expression.get_hover_value_for_position(pos, code),
            Expr::ObjectExpression(object_expression) => object_expression.get_hover_value_for_position(pos, code),
            Expr::MemberExpression(member_expression) => member_expression.get_hover_value_for_position(pos, code),
            Expr::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code),
            // TODO: LSP hover information for values/types. https://github.com/KittyCAD/modeling-app/issues/1126
            Expr::None(_) => None,
            Expr::Literal(_) => None,
            Expr::Identifier(_) => None,
            Expr::TagDeclarator(_) => None,
            // TODO: LSP hover information for symbols. https://github.com/KittyCAD/modeling-app/issues/1127
            Expr::PipeSubstitution(_) => None,
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            Expr::Literal(_literal) => {}
            Expr::Identifier(ref mut identifier) => identifier.rename(old_name, new_name),
            Expr::TagDeclarator(ref mut tag) => tag.rename(old_name, new_name),
            Expr::BinaryExpression(ref mut binary_expression) => {
                binary_expression.rename_identifiers(old_name, new_name)
            }
            Expr::FunctionExpression(_function_identifier) => {}
            Expr::CallExpression(ref mut call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Expr::PipeExpression(ref mut pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Expr::PipeSubstitution(_) => {}
            Expr::ArrayExpression(ref mut array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Expr::ObjectExpression(ref mut object_expression) => {
                object_expression.rename_identifiers(old_name, new_name)
            }
            Expr::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
            Expr::UnaryExpression(ref mut unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            Expr::None(_) => {}
        }
    }

    /// Get the constraint level for a value type.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match self {
            Expr::Literal(literal) => literal.get_constraint_level(),
            Expr::Identifier(identifier) => identifier.get_constraint_level(),
            Expr::TagDeclarator(tag) => tag.get_constraint_level(),
            Expr::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),

            Expr::FunctionExpression(function_identifier) => function_identifier.get_constraint_level(),
            Expr::CallExpression(call_expression) => call_expression.get_constraint_level(),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_constraint_level(),
            Expr::PipeSubstitution(pipe_substitution) => ConstraintLevel::Ignore {
                source_ranges: vec![pipe_substitution.into()],
            },
            Expr::ArrayExpression(array_expression) => array_expression.get_constraint_level(),
            Expr::ObjectExpression(object_expression) => object_expression.get_constraint_level(),
            Expr::MemberExpression(member_expression) => member_expression.get_constraint_level(),
            Expr::UnaryExpression(unary_expression) => unary_expression.get_constraint_level(),
            Expr::None(none) => none.get_constraint_level(),
        }
    }
}

impl From<Expr> for SourceRange {
    fn from(value: Expr) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&Expr> for SourceRange {
    fn from(value: &Expr) -> Self {
        Self([value.start(), value.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    CallExpression(Box<CallExpression>),
    UnaryExpression(Box<UnaryExpression>),
    MemberExpression(Box<MemberExpression>),
}

impl From<BinaryPart> for SourceRange {
    fn from(value: BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&BinaryPart> for SourceRange {
    fn from(value: &BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl BinaryPart {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            BinaryPart::Literal(lit) => lit.compute_digest(),
            BinaryPart::Identifier(id) => id.compute_digest(),
            BinaryPart::BinaryExpression(be) => be.compute_digest(),
            BinaryPart::CallExpression(ce) => ce.compute_digest(),
            BinaryPart::UnaryExpression(ue) => ue.compute_digest(),
            BinaryPart::MemberExpression(me) => me.compute_digest(),
        }
    }

    /// Get the constraint level.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match self {
            BinaryPart::Literal(literal) => literal.get_constraint_level(),
            BinaryPart::Identifier(identifier) => identifier.get_constraint_level(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),
            BinaryPart::CallExpression(call_expression) => call_expression.get_constraint_level(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_constraint_level(),
            BinaryPart::MemberExpression(member_expression) => member_expression.get_constraint_level(),
        }
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        match self {
            BinaryPart::Literal(_) => {}
            BinaryPart::Identifier(_) => {}
            BinaryPart::BinaryExpression(ref mut binary_expression) => {
                binary_expression.replace_value(source_range, new_value)
            }
            BinaryPart::CallExpression(ref mut call_expression) => {
                call_expression.replace_value(source_range, new_value)
            }
            BinaryPart::UnaryExpression(ref mut unary_expression) => {
                unary_expression.replace_value(source_range, new_value)
            }
            BinaryPart::MemberExpression(_) => {}
        }
    }

    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        match &self {
            BinaryPart::Literal(literal) => literal.recast(),
            BinaryPart::Identifier(identifier) => identifier.name.to_string(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.recast(options),
            BinaryPart::CallExpression(call_expression) => call_expression.recast(options, indentation_level, false),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.recast(options),
            BinaryPart::MemberExpression(member_expression) => member_expression.recast(),
        }
    }

    pub fn start(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.start(),
            BinaryPart::Identifier(identifier) => identifier.start(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.start(),
            BinaryPart::CallExpression(call_expression) => call_expression.start(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.start(),
            BinaryPart::MemberExpression(member_expression) => member_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.end(),
            BinaryPart::Identifier(identifier) => identifier.end(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.end(),
            BinaryPart::CallExpression(call_expression) => call_expression.end(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.end(),
            BinaryPart::MemberExpression(member_expression) => member_expression.end(),
        }
    }

    #[async_recursion::async_recursion]
    pub async fn get_result(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        match self {
            BinaryPart::Literal(literal) => Ok(literal.into()),
            BinaryPart::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                Ok(value.clone())
            }
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression
                    .get_result(memory, dynamic_state, pipe_info, ctx)
                    .await
            }
            BinaryPart::CallExpression(call_expression) => {
                call_expression.execute(memory, dynamic_state, pipe_info, ctx).await
            }
            BinaryPart::UnaryExpression(unary_expression) => {
                unary_expression.get_result(memory, dynamic_state, pipe_info, ctx).await
            }
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(memory),
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
            BinaryPart::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code)
            }
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
            BinaryPart::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NonCodeNode {
    pub start: usize,
    pub end: usize,
    pub value: NonCodeValue,

    pub digest: Option<Digest>,
}

impl From<NonCodeNode> for SourceRange {
    fn from(value: NonCodeNode) -> Self {
        Self([value.start, value.end])
    }
}

impl From<&NonCodeNode> for SourceRange {
    fn from(value: &NonCodeNode) -> Self {
        Self([value.start, value.end])
    }
}

impl NonCodeNode {
    compute_digest!(|slf, hasher| {
        match &slf.value {
            NonCodeValue::Shebang { value } => {
                hasher.update(value);
            }
            NonCodeValue::InlineComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::BlockComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::NewLineBlockComment { value, style } => {
                hasher.update(value);
                hasher.update(style.digestable_id());
            }
            NonCodeValue::NewLine => {
                hasher.update(b"\r\n");
            }
        }
    });

    pub fn contains(&self, pos: usize) -> bool {
        self.start <= pos && pos <= self.end
    }

    pub fn value(&self) -> String {
        match &self.value {
            NonCodeValue::Shebang { value } => value.clone(),
            NonCodeValue::InlineComment { value, style: _ } => value.clone(),
            NonCodeValue::BlockComment { value, style: _ } => value.clone(),
            NonCodeValue::NewLineBlockComment { value, style: _ } => value.clone(),
            NonCodeValue::NewLine => "\n\n".to_string(),
        }
    }

    pub fn format(&self, indentation: &str) -> String {
        match &self.value {
            NonCodeValue::Shebang { value } => format!("{}\n\n", value),
            NonCodeValue::InlineComment {
                value,
                style: CommentStyle::Line,
            } => format!(" // {}\n", value),
            NonCodeValue::InlineComment {
                value,
                style: CommentStyle::Block,
            } => format!(" /* {} */", value),
            NonCodeValue::BlockComment { value, style } => match style {
                CommentStyle::Block => format!("{}/* {} */", indentation, value),
                CommentStyle::Line => {
                    if value.trim().is_empty() {
                        format!("{}//\n", indentation)
                    } else {
                        format!("{}// {}\n", indentation, value.trim())
                    }
                }
            },
            NonCodeValue::NewLineBlockComment { value, style } => {
                let add_start_new_line = if self.start == 0 { "" } else { "\n\n" };
                match style {
                    CommentStyle::Block => format!("{}{}/* {} */\n", add_start_new_line, indentation, value),
                    CommentStyle::Line => {
                        if value.trim().is_empty() {
                            format!("{}{}//\n", add_start_new_line, indentation)
                        } else {
                            format!("{}{}// {}\n", add_start_new_line, indentation, value.trim())
                        }
                    }
                }
            }
            NonCodeValue::NewLine => "\n\n".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum CommentStyle {
    /// Like // foo
    Line,
    /// Like /* foo */
    Block,
}

impl CommentStyle {
    fn digestable_id(&self) -> [u8; 2] {
        match &self {
            CommentStyle::Line => *b"//",
            CommentStyle::Block => *b"/*",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum NonCodeValue {
    /// A shebang.
    /// This is a special type of comment that is at the top of the file.
    /// It looks like this:
    /// ```python,no_run
    /// #!/usr/bin/env python
    /// ```
    Shebang {
        value: String,
    },
    /// An inline comment.
    /// Here are examples:
    /// `1 + 1 // This is an inline comment`.
    /// `1 + 1 /* Here's another */`.
    InlineComment {
        value: String,
        style: CommentStyle,
    },
    /// A block comment.
    /// An example of this is the following:
    /// ```python,no_run
    /// /* This is a
    ///     block comment */
    /// 1 + 1
    /// ```
    /// Now this is important. The block comment is attached to the next line.
    /// This is always the case. Also the block comment doesn't have a new line above it.
    /// If it did it would be a `NewLineBlockComment`.
    BlockComment {
        value: String,
        style: CommentStyle,
    },
    /// A block comment that has a new line above it.
    /// The user explicitly added a new line above the block comment.
    NewLineBlockComment {
        value: String,
        style: CommentStyle,
    },
    // A new line like `\n\n` NOT a new line like `\n`.
    // This is also not a comment.
    NewLine,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NonCodeMeta {
    pub non_code_nodes: HashMap<usize, Vec<NonCodeNode>>,
    pub start: Vec<NonCodeNode>,

    pub digest: Option<Digest>,
}

// implement Deserialize manually because we to force the keys of non_code_nodes to be usize
// and by default the ts type { [statementIndex: number]: NonCodeNode } serializes to a string i.e. "0", "1", etc.
impl<'de> Deserialize<'de> for NonCodeMeta {
    fn deserialize<D>(deserializer: D) -> Result<NonCodeMeta, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct NonCodeMetaHelper {
            non_code_nodes: HashMap<String, Vec<NonCodeNode>>,
            start: Vec<NonCodeNode>,
        }

        let helper = NonCodeMetaHelper::deserialize(deserializer)?;
        let non_code_nodes = helper
            .non_code_nodes
            .into_iter()
            .map(|(key, value)| Ok((key.parse().map_err(serde::de::Error::custom)?, value)))
            .collect::<Result<HashMap<_, _>, _>>()?;
        Ok(NonCodeMeta {
            non_code_nodes,
            start: helper.start,
            digest: None,
        })
    }
}

impl NonCodeMeta {
    compute_digest!(|slf, hasher| {
        let mut keys = slf.non_code_nodes.keys().copied().collect::<Vec<_>>();
        keys.sort();

        for key in keys.into_iter() {
            hasher.update(key.to_ne_bytes());
            let nodes = slf.non_code_nodes.get_mut(&key).unwrap();
            hasher.update(nodes.len().to_ne_bytes());
            for node in nodes.iter_mut() {
                hasher.update(node.compute_digest());
            }
        }
    });

    pub fn insert(&mut self, i: usize, new: NonCodeNode) {
        self.non_code_nodes.entry(i).or_default().push(new);
    }

    pub fn contains(&self, pos: usize) -> bool {
        if self.start.iter().any(|node| node.contains(pos)) {
            return true;
        }

        self.non_code_nodes
            .iter()
            .any(|(_, nodes)| nodes.iter().any(|node| node.contains(pos)))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub start: usize,
    pub end: usize,
    pub expression: Expr,

    pub digest: Option<Digest>,
}

impl_value_meta!(ExpressionStatement);

impl ExpressionStatement {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.expression.compute_digest());
    });
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct CallExpression {
    pub start: usize,
    pub end: usize,
    pub callee: Identifier,
    pub arguments: Vec<Expr>,
    pub optional: bool,

    pub digest: Option<Digest>,
}

impl_value_meta!(CallExpression);

impl From<CallExpression> for Expr {
    fn from(call_expression: CallExpression) -> Self {
        Expr::CallExpression(Box::new(call_expression))
    }
}

impl CallExpression {
    pub fn new(name: &str, arguments: Vec<Expr>) -> Result<Self, KclError> {
        Ok(Self {
            start: 0,
            end: 0,
            callee: Identifier::new(name),
            arguments,
            optional: false,
            digest: None,
        })
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.callee.compute_digest());
        hasher.update(slf.arguments.len().to_ne_bytes());
        for argument in slf.arguments.iter_mut() {
            hasher.update(argument.compute_digest());
        }
        hasher.update(if slf.optional { [1] } else { [0] });
    });

    /// Is at least one argument the '%' i.e. the substitution operator?
    pub fn has_substitution_arg(&self) -> bool {
        self.arguments
            .iter()
            .any(|arg| matches!(arg, Expr::PipeSubstitution(_)))
    }

    pub fn as_source_ranges(&self) -> Vec<SourceRange> {
        vec![SourceRange([self.start, self.end])]
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for arg in &mut self.arguments {
            arg.replace_value(source_range, new_value.clone());
        }
    }

    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        format!(
            "{}{}({})",
            if is_in_pipe {
                "".to_string()
            } else {
                options.get_indentation(indentation_level)
            },
            self.callee.name,
            self.arguments
                .iter()
                .map(|arg| arg.recast(options, indentation_level, is_in_pipe))
                .collect::<Vec<String>>()
                .join(", ")
        )
    }

    #[async_recursion::async_recursion]
    pub async fn execute(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        let fn_name = self.callee.name.clone();

        let mut fn_args: Vec<KclValue> = Vec::with_capacity(self.arguments.len());

        for arg in &self.arguments {
            let metadata = Metadata {
                source_range: SourceRange([arg.start(), arg.end()]),
            };
            let result = ctx
                .execute_expr(
                    arg,
                    memory,
                    dynamic_state,
                    pipe_info,
                    &metadata,
                    StatementKind::Expression,
                )
                .await?;
            fn_args.push(result);
        }

        match ctx.stdlib.get_either(&self.callee.name) {
            FunctionKind::Core(func) => {
                // Attempt to call the function.
                let args =
                    crate::std::Args::new(fn_args, self.into(), ctx.clone(), memory.clone(), dynamic_state.clone());
                let mut result = func.std_lib_fn()(args).await?;

                // If the return result is a sketch group or extrude group, we want to update the
                // memory for the tags of the group.
                // TODO: This could probably be done in a better way, but as of now this was my only idea
                // and it works.
                match result {
                    KclValue::SketchGroup(ref sketch_group) => {
                        for (_, tag) in sketch_group.tags.iter() {
                            memory.update_tag(&tag.value, tag.clone())?;
                        }
                    }
                    KclValue::ExtrudeGroup(ref mut extrude_group) => {
                        for value in &extrude_group.value {
                            if let Some(tag) = value.get_tag() {
                                // Get the past tag and update it.
                                let mut t = if let Some(t) = extrude_group.sketch_group.tags.get(&tag.name) {
                                    t.clone()
                                } else {
                                    // It's probably a fillet or a chamfer.
                                    // Initialize it.
                                    TagIdentifier {
                                        value: tag.name.clone(),
                                        info: Some(TagEngineInfo {
                                            id: value.get_id(),
                                            surface: Some(value.clone()),
                                            path: None,
                                            sketch_group: extrude_group.id,
                                        }),
                                        meta: vec![Metadata {
                                            source_range: tag.clone().into(),
                                        }],
                                    }
                                };

                                let Some(ref info) = t.info else {
                                    return Err(KclError::Semantic(KclErrorDetails {
                                        message: format!("Tag {} does not have path info", tag.name),
                                        source_ranges: vec![tag.into()],
                                    }));
                                };

                                let mut info = info.clone();
                                info.surface = Some(value.clone());
                                info.sketch_group = extrude_group.id;
                                t.info = Some(info);

                                memory.update_tag(&tag.name, t.clone())?;

                                // update the sketch group tags.
                                extrude_group.sketch_group.tags.insert(tag.name.clone(), t);
                            }
                        }

                        // Find the stale sketch group in memory and update it.
                        if let Some(current_env) = memory.environments.get_mut(memory.current_env.index()) {
                            current_env.update_sketch_group_tags(&extrude_group.sketch_group);
                        }
                    }
                    _ => {}
                }

                Ok(result)
            }
            FunctionKind::Std(func) => {
                let function_expression = func.function();
                let parts = function_expression.clone().into_parts().map_err(|e| {
                    KclError::Semantic(KclErrorDetails {
                        message: format!("Error getting parts of function: {}", e),
                        source_ranges: vec![self.into()],
                    })
                })?;
                if fn_args.len() < parts.params_required.len() || fn_args.len() > function_expression.params.len() {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "this function expected {} arguments, got {}",
                            parts.params_required.len(),
                            fn_args.len(),
                        ),
                        source_ranges: vec![self.into()],
                    }));
                }

                // Add the arguments to the memory.
                let mut fn_memory = memory.clone();
                for (index, param) in parts.params_required.iter().enumerate() {
                    fn_memory.add(
                        &param.identifier.name,
                        fn_args.get(index).unwrap().clone(),
                        param.identifier.clone().into(),
                    )?;
                }
                // Add the optional arguments to the memory.
                for (index, param) in parts.params_optional.iter().enumerate() {
                    if let Some(arg) = fn_args.get(index + parts.params_required.len()) {
                        fn_memory.add(&param.identifier.name, arg.clone(), param.identifier.clone().into())?;
                    } else {
                        fn_memory.add(
                            &param.identifier.name,
                            KclValue::UserVal(UserVal {
                                value: serde_json::value::Value::Null,
                                meta: Default::default(),
                            }),
                            param.identifier.clone().into(),
                        )?;
                    }
                }

                let mut fn_dynamic_state = dynamic_state.clone();

                // Call the stdlib function
                let p = func.function().clone().body;
                let results = match ctx
                    .inner_execute(&p, &mut fn_memory, &mut fn_dynamic_state, BodyType::Block)
                    .await
                {
                    Ok(results) => results,
                    Err(err) => {
                        // We need to override the source ranges so we don't get the embedded kcl
                        // function from the stdlib.
                        return Err(err.override_source_ranges(vec![self.into()]));
                    }
                };
                let out = results.return_;
                let result = out.ok_or_else(|| {
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of stdlib function {} is undefined", fn_name),
                        source_ranges: vec![self.into()],
                    })
                })?;
                Ok(result)
            }
            FunctionKind::UserDefined => {
                let func = memory.get(&fn_name, self.into())?;
                let fn_dynamic_state = dynamic_state.merge(memory);
                let result = func
                    .call_fn(fn_args, &fn_dynamic_state, ctx.clone())
                    .await
                    .map_err(|e| {
                        // Add the call expression to the source ranges.
                        e.add_source_ranges(vec![self.into()])
                    })?;

                let result = result.ok_or_else(|| {
                    let mut source_ranges: Vec<SourceRange> = vec![self.into()];
                    // We want to send the source range of the original function.
                    if let KclValue::Function { meta, .. } = func {
                        source_ranges = meta.iter().map(|m| m.source_range).collect();
                    };
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of user-defined function {} is undefined", fn_name),
                        source_ranges,
                    })
                })?;

                Ok(result)
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

    /// Return the constraint level for this call expression.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        if self.arguments.is_empty() {
            return ConstraintLevel::Ignore {
                source_ranges: vec![self.into()],
            };
        }

        // Iterate over the arguments and get the constraint level for each one.
        let mut constraint_levels = ConstraintLevels::new();
        for arg in &self.arguments {
            constraint_levels.push(arg.get_constraint_level());
        }

        constraint_levels.get_constraint_level(self.into())
    }
}

/// A function declaration.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Function {
    /// A stdlib function written in Rust (aka core lib).
    StdLib {
        /// The function.
        func: Box<dyn StdLibFn>,
    },
    /// A stdlib function written in KCL.
    StdLibKcl {
        /// The function.
        func: Box<dyn KclStdLibFn>,
    },
    /// A function that is defined in memory.
    #[default]
    InMemory,
}

impl PartialEq for Function {
    fn eq(&self, other: &Self) -> bool {
        match (self, other) {
            (Function::StdLib { func: func1 }, Function::StdLib { func: func2 }) => func1.name() == func2.name(),
            (Function::InMemory, Function::InMemory) => true,
            _ => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclaration {
    pub start: usize,
    pub end: usize,
    pub declarations: Vec<VariableDeclarator>,
    pub kind: VariableKind, // Change to enum if there are specific values

    pub digest: Option<Digest>,
}

impl From<&VariableDeclaration> for Vec<CompletionItem> {
    fn from(declaration: &VariableDeclaration) -> Self {
        let mut completions = vec![];
        for variable in &declaration.declarations {
            completions.push(CompletionItem {
                label: variable.id.name.to_string(),
                label_details: None,
                kind: Some(match declaration.kind {
                    crate::ast::types::VariableKind::Let => CompletionItemKind::VARIABLE,
                    crate::ast::types::VariableKind::Const => CompletionItemKind::CONSTANT,
                    crate::ast::types::VariableKind::Var => CompletionItemKind::VARIABLE,
                    crate::ast::types::VariableKind::Fn => CompletionItemKind::FUNCTION,
                }),
                detail: Some(declaration.kind.to_string()),
                documentation: None,
                deprecated: None,
                preselect: None,
                sort_text: None,
                filter_text: None,
                insert_text: None,
                insert_text_format: None,
                insert_text_mode: None,
                text_edit: None,
                additional_text_edits: None,
                command: None,
                commit_characters: None,
                data: None,
                tags: None,
            })
        }
        completions
    }
}

impl_value_meta!(VariableDeclaration);

impl VariableDeclaration {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.declarations.len().to_ne_bytes());
        for declarator in &mut slf.declarations {
            hasher.update(declarator.compute_digest());
        }
        hasher.update(slf.kind.digestable_id());
    });

    pub fn new(declarations: Vec<VariableDeclarator>, kind: VariableKind) -> Self {
        Self {
            start: 0,
            end: 0,
            declarations,
            kind,
            digest: None,
        }
    }
    pub fn get_lsp_folding_range(&self) -> Option<FoldingRange> {
        let recasted = self.recast(&FormatOptions::default(), 0);
        // If the recasted value only has one line, don't fold it.
        if recasted.lines().count() <= 1 {
            return None;
        }

        // This unwrap is safe because we know that the code has at least one line.
        let first_line = recasted.lines().next().unwrap().to_string();

        Some(FoldingRange {
            start_line: (self.start() + first_line.len()) as u32,
            start_character: None,
            end_line: self.end() as u32,
            end_character: None,
            kind: Some(FoldingRangeKind::Region),
            collapsed_text: Some(first_line),
        })
    }

    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let indentation = options.get_indentation(indentation_level);
        self.declarations.iter().fold(String::new(), |mut output, declaration| {
            let _ = write!(
                output,
                "{}{} {} = {}",
                indentation,
                self.kind,
                declaration.id.name,
                declaration.init.recast(options, indentation_level, false).trim()
            );
            output
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for declaration in &mut self.declarations {
            declaration.init.replace_value(source_range, new_value.clone());
        }
    }

    /// Returns a value that includes the given character position.
    pub fn get_value_for_position(&self, pos: usize) -> Option<&Expr> {
        for declaration in &self.declarations {
            let source_range: SourceRange = declaration.into();
            if source_range.contains(pos) {
                return Some(&declaration.init);
            }
        }

        None
    }

    /// Returns a value that includes the given character position.
    pub fn get_mut_value_for_position(&mut self, pos: usize) -> Option<&mut Expr> {
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
                Expr::FunctionExpression(function_expression) => {
                    symbol_kind = SymbolKind::FUNCTION;
                    let mut children = vec![];
                    for param in &function_expression.params {
                        let param_source_range: SourceRange = (&param.identifier).into();
                        #[allow(deprecated)]
                        children.push(DocumentSymbol {
                            name: param.identifier.name.clone(),
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
                Expr::ObjectExpression(object_expression) => {
                    symbol_kind = SymbolKind::OBJECT;
                    let mut children = vec![];
                    for property in &object_expression.properties {
                        children.extend(property.get_lsp_symbols(code));
                    }
                    children
                }
                Expr::ArrayExpression(_) => {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display, Bake)]
#[databake(path = kcl_lib::ast::types)]
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
    fn digestable_id(&self) -> [u8; 1] {
        match self {
            VariableKind::Let => [1],
            VariableKind::Const => [2],
            VariableKind::Fn => [3],
            VariableKind::Var => [4],
        }
    }

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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclarator {
    pub start: usize,
    pub end: usize,
    /// The identifier of the variable.
    pub id: Identifier,
    /// The value of the variable.
    pub init: Expr,

    pub digest: Option<Digest>,
}

impl_value_meta!(VariableDeclarator);

impl VariableDeclarator {
    pub fn new(name: &str, init: Expr) -> Self {
        Self {
            start: 0,
            end: 0,
            id: Identifier::new(name),
            init,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.id.compute_digest());
        hasher.update(slf.init.compute_digest());
    });

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        self.init.get_constraint_level()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Literal {
    pub start: usize,
    pub end: usize,
    pub value: LiteralValue,
    pub raw: String,

    pub digest: Option<Digest>,
}

impl_value_meta!(Literal);

impl Literal {
    pub fn new(value: LiteralValue) -> Self {
        Self {
            start: 0,
            end: 0,
            raw: JValue::from(value.clone()).to_string(),
            value,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.value.digestable_id());
    });

    /// Get the constraint level for this literal.
    /// Literals are always not constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: vec![self.into()],
        }
    }

    fn recast(&self) -> String {
        match self.value {
            LiteralValue::Fractional(x) => {
                if x.fract() == 0.0 {
                    format!("{x:?}")
                } else {
                    self.raw.clone()
                }
            }
            LiteralValue::IInteger(_) => self.raw.clone(),
            LiteralValue::String(ref s) => {
                let quote = if self.raw.trim().starts_with('"') { '"' } else { '\'' };
                format!("{quote}{s}{quote}")
            }
            LiteralValue::Bool(_) => self.raw.clone(),
        }
    }
}

impl From<Literal> for KclValue {
    fn from(literal: Literal) -> Self {
        KclValue::UserVal(UserVal {
            value: JValue::from(literal.value.clone()),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        })
    }
}

impl From<&Box<Literal>> for KclValue {
    fn from(literal: &Box<Literal>) -> Self {
        KclValue::UserVal(UserVal {
            value: JValue::from(literal.value.clone()),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake, Eq)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Identifier {
    pub start: usize,
    pub end: usize,
    pub name: String,

    pub digest: Option<Digest>,
}

impl_value_meta!(Identifier);

impl Identifier {
    pub fn new(name: &str) -> Self {
        Self {
            start: 0,
            end: 0,
            name: name.to_string(),
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });

    /// Get the constraint level for this identifier.
    /// Identifier are always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if self.name == old_name {
            self.name = new_name.to_string();
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake, Eq)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct TagDeclarator {
    pub start: usize,
    pub end: usize,
    #[serde(rename = "value")]
    pub name: String,

    pub digest: Option<Digest>,
}

impl_value_meta!(TagDeclarator);

impl From<Box<TagDeclarator>> for SourceRange {
    fn from(tag: Box<TagDeclarator>) -> Self {
        Self([tag.start, tag.end])
    }
}

impl From<Box<TagDeclarator>> for Vec<SourceRange> {
    fn from(tag: Box<TagDeclarator>) -> Self {
        vec![tag.into()]
    }
}

impl From<&Box<TagDeclarator>> for KclValue {
    fn from(tag: &Box<TagDeclarator>) -> Self {
        KclValue::TagDeclarator(tag.clone())
    }
}

impl From<&TagDeclarator> for KclValue {
    fn from(tag: &TagDeclarator) -> Self {
        KclValue::TagDeclarator(Box::new(tag.clone()))
    }
}

impl From<&TagDeclarator> for TagIdentifier {
    fn from(tag: &TagDeclarator) -> Self {
        TagIdentifier {
            value: tag.name.clone(),
            info: None,
            meta: vec![Metadata {
                source_range: tag.into(),
            }],
        }
    }
}

impl From<&TagDeclarator> for CompletionItem {
    fn from(tag: &TagDeclarator) -> Self {
        CompletionItem {
            label: tag.name.to_string(),
            label_details: None,
            kind: Some(CompletionItemKind::REFERENCE),
            detail: Some("tag (A reference to an entity you previously named)".to_string()),
            documentation: None,
            deprecated: None,
            preselect: None,
            sort_text: None,
            filter_text: None,
            insert_text: None,
            insert_text_format: None,
            insert_text_mode: None,
            text_edit: None,
            additional_text_edits: None,
            command: None,
            commit_characters: None,
            data: None,
            tags: None,
        }
    }
}

impl TagDeclarator {
    pub fn new(name: &str) -> Self {
        Self {
            start: 0,
            end: 0,
            name: name.to_string(),
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        let name = slf.name.as_bytes();
        hasher.update(name.len().to_ne_bytes());
        hasher.update(name);
    });

    pub fn recast(&self) -> String {
        // TagDeclarators are always prefixed with a dollar sign.
        format!("${}", self.name)
    }

    /// Get the constraint level for this identifier.
    /// TagDeclarator are always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if self.name == old_name {
            self.name = new_name.to_string();
        }
    }

    pub async fn execute(&self, memory: &mut ProgramMemory) -> Result<KclValue, KclError> {
        let memory_item = KclValue::TagIdentifier(Box::new(TagIdentifier {
            value: self.name.clone(),
            info: None,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }));

        memory.add(&self.name, memory_item.clone(), self.into())?;

        Ok(self.into())
    }

    pub fn get_lsp_symbols(&self, code: &str) -> Vec<DocumentSymbol> {
        let source_range: SourceRange = self.into();

        vec![
            #[allow(deprecated)]
            DocumentSymbol {
                name: self.name.to_string(),
                detail: None,
                kind: SymbolKind::CONSTANT,
                range: source_range.to_lsp_range(code),
                selection_range: source_range.to_lsp_range(code),
                children: None,
                tags: None,
                deprecated: None,
            },
        ]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct PipeSubstitution {
    pub start: usize,
    pub end: usize,

    pub digest: Option<Digest>,
}

impl_value_meta!(PipeSubstitution);

impl PipeSubstitution {
    pub fn new() -> Self {
        Self {
            start: 0,
            end: 0,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(b"PipeSubstitution");
    });
}

impl Default for PipeSubstitution {
    fn default() -> Self {
        Self::new()
    }
}

impl From<PipeSubstitution> for Expr {
    fn from(pipe_substitution: PipeSubstitution) -> Self {
        Expr::PipeSubstitution(Box::new(pipe_substitution))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ArrayExpression {
    pub start: usize,
    pub end: usize,
    pub elements: Vec<Expr>,

    pub digest: Option<Digest>,
}

impl_value_meta!(ArrayExpression);

impl From<ArrayExpression> for Expr {
    fn from(array_expression: ArrayExpression) -> Self {
        Expr::ArrayExpression(Box::new(array_expression))
    }
}

impl ArrayExpression {
    pub fn new(elements: Vec<Expr>) -> Self {
        Self {
            start: 0,
            end: 0,
            elements,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.elements.len().to_ne_bytes());
        for value in slf.elements.iter_mut() {
            hasher.update(value.compute_digest());
        }
    });

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for element in &mut self.elements {
            element.replace_value(source_range, new_value.clone());
        }
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        if self.elements.is_empty() {
            return ConstraintLevel::Ignore {
                source_ranges: vec![self.into()],
            };
        }

        let mut constraint_levels = ConstraintLevels::new();
        for element in &self.elements {
            constraint_levels.push(element.get_constraint_level());
        }

        constraint_levels.get_constraint_level(self.into())
    }

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
                    .map(|el| el.recast(options, indentation_level, is_in_pipe))
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

    #[async_recursion::async_recursion]
    pub async fn execute(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let result = match element {
                Expr::Literal(literal) => literal.into(),
                Expr::TagDeclarator(tag) => tag.execute(memory).await?,
                Expr::None(none) => none.into(),
                Expr::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Expr::BinaryExpression(binary_expression) => {
                    binary_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::CallExpression(call_expression) => {
                    call_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::UnaryExpression(unary_expression) => {
                    unary_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::ObjectExpression(object_expression) => {
                    object_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::ArrayExpression(array_expression) => {
                    array_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::PipeExpression(pipe_expression) => {
                    pipe_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("PipeSubstitution not implemented here: {:?}", pipe_substitution),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Expr::MemberExpression(member_expression) => member_expression.get_result(memory)?,
                Expr::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("FunctionExpression not implemented here: {:?}", function_expression),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            }
            .get_json_value()?;

            results.push(result);
        }

        Ok(KclValue::UserVal(UserVal {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectExpression {
    pub start: usize,
    pub end: usize,
    pub properties: Vec<ObjectProperty>,

    pub digest: Option<Digest>,
}

impl ObjectExpression {
    pub fn new(properties: Vec<ObjectProperty>) -> Self {
        Self {
            start: 0,
            end: 0,
            properties,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.properties.len().to_ne_bytes());
        for prop in slf.properties.iter_mut() {
            hasher.update(prop.compute_digest());
        }
    });

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for property in &mut self.properties {
            property.value.replace_value(source_range, new_value.clone());
        }
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        if self.properties.is_empty() {
            return ConstraintLevel::Ignore {
                source_ranges: vec![self.into()],
            };
        }

        let mut constraint_levels = ConstraintLevels::new();
        for property in &self.properties {
            constraint_levels.push(property.value.get_constraint_level());
        }

        constraint_levels.get_constraint_level(self.into())
    }

    fn recast(&self, options: &FormatOptions, indentation_level: usize, is_in_pipe: bool) -> String {
        let flat_recast = format!(
            "{{ {} }}",
            self.properties
                .iter()
                .map(|prop| {
                    format!(
                        "{}: {}",
                        prop.key.name,
                        prop.value.recast(options, indentation_level + 1, is_in_pipe).trim()
                    )
                })
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
                    .map(|prop| {
                        format!(
                            "{}: {}",
                            prop.key.name,
                            prop.value.recast(options, indentation_level + 1, is_in_pipe)
                        )
                    })
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

    #[async_recursion::async_recursion]
    pub async fn execute(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        let mut object = Map::new();
        for property in &self.properties {
            let result = match &property.value {
                Expr::Literal(literal) => literal.into(),
                Expr::TagDeclarator(tag) => tag.execute(memory).await?,
                Expr::None(none) => none.into(),
                Expr::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Expr::BinaryExpression(binary_expression) => {
                    binary_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::CallExpression(call_expression) => {
                    call_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::UnaryExpression(unary_expression) => {
                    unary_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::ObjectExpression(object_expression) => {
                    object_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::ArrayExpression(array_expression) => {
                    array_expression.execute(memory, dynamic_state, pipe_info, ctx).await?
                }
                Expr::PipeExpression(pipe_expression) => {
                    pipe_expression
                        .get_result(memory, dynamic_state, pipe_info, ctx)
                        .await?
                }
                Expr::MemberExpression(member_expression) => member_expression.get_result(memory)?,
                Expr::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("PipeSubstitution not implemented here: {:?}", pipe_substitution),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Expr::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!("FunctionExpression not implemented here: {:?}", function_expression),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            };

            object.insert(property.key.name.clone(), result.get_json_value()?);
        }

        Ok(KclValue::UserVal(UserVal {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectProperty {
    pub start: usize,
    pub end: usize,
    pub key: Identifier,
    pub value: Expr,

    pub digest: Option<Digest>,
}

impl_value_meta!(ObjectProperty);

impl ObjectProperty {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.key.compute_digest());
        hasher.update(slf.value.compute_digest());
    });

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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MemberObject {
    MemberExpression(Box<MemberExpression>),
    Identifier(Box<Identifier>),
}

impl MemberObject {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            MemberObject::MemberExpression(me) => me.compute_digest(),
            MemberObject::Identifier(id) => id.compute_digest(),
        }
    }

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

impl From<MemberObject> for SourceRange {
    fn from(obj: MemberObject) -> Self {
        Self([obj.start(), obj.end()])
    }
}

impl From<&MemberObject> for SourceRange {
    fn from(obj: &MemberObject) -> Self {
        Self([obj.start(), obj.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LiteralIdentifier {
    Identifier(Box<Identifier>),
    Literal(Box<Literal>),
}

impl LiteralIdentifier {
    pub fn compute_digest(&mut self) -> Digest {
        match self {
            LiteralIdentifier::Identifier(id) => id.compute_digest(),
            LiteralIdentifier::Literal(lit) => lit.compute_digest(),
        }
    }

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

impl From<LiteralIdentifier> for SourceRange {
    fn from(id: LiteralIdentifier) -> Self {
        Self([id.start(), id.end()])
    }
}

impl From<&LiteralIdentifier> for SourceRange {
    fn from(id: &LiteralIdentifier) -> Self {
        Self([id.start(), id.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub start: usize,
    pub end: usize,
    pub object: MemberObject,
    pub property: LiteralIdentifier,
    pub computed: bool,

    pub digest: Option<Digest>,
}

impl_value_meta!(MemberExpression);

impl MemberExpression {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.object.compute_digest());
        hasher.update(slf.property.compute_digest());
        hasher.update(if slf.computed { [1] } else { [0] });
    });

    /// Get the constraint level for a member expression.
    /// This is always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }

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

    pub fn get_result_array(&self, memory: &mut ProgramMemory, index: usize) -> Result<KclValue, KclError> {
        let array = match &self.object {
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(memory)?,
            MemberObject::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        };

        let array_json = array.get_json_value()?;

        if let serde_json::Value::Array(array) = array_json {
            if let Some(value) = array.get(index) {
                Ok(KclValue::UserVal(UserVal {
                    value: value.clone(),
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                }))
            } else {
                Err(KclError::UndefinedValue(KclErrorDetails {
                    message: format!("index {} not found in array", index),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("MemberExpression array is not an array: {:?}", array),
                source_ranges: vec![self.clone().into()],
            }))
        }
    }

    pub fn get_result(&self, memory: &mut ProgramMemory) -> Result<KclValue, KclError> {
        #[derive(Debug)]
        enum Property {
            Number(usize),
            String(String),
        }

        impl Property {
            fn type_name(&self) -> &'static str {
                match self {
                    Property::Number(_) => "number",
                    Property::String(_) => "string",
                }
            }
        }

        let property_src: SourceRange = self.property.clone().into();
        let property_sr = vec![property_src];

        let property: Property = match self.property.clone() {
            LiteralIdentifier::Identifier(identifier) => {
                let name = identifier.name;
                if !self.computed {
                    // Treat the property as a literal
                    Property::String(name.to_string())
                } else {
                    // Actually evaluate memory to compute the property.
                    let prop = memory.get(&name, property_src)?;
                    let KclValue::UserVal(prop) = prop else {
                        return Err(KclError::Semantic(KclErrorDetails {
                            source_ranges: property_sr,
                            message: format!(
                                "{name} is not a valid property/index, you can only use a string or int (>= 0) here",
                            ),
                        }));
                    };
                    match prop.value {
                        JValue::Number(ref num) => {
                            num
                                .as_u64()
                                .and_then(|x| usize::try_from(x).ok())
                                .map(Property::Number)
                                .ok_or_else(|| {
                                    KclError::Semantic(KclErrorDetails {
                                        source_ranges: property_sr,
                                        message: format!(
                                            "{name}'s value is not a valid property/index, you can only use a string or int (>= 0) here",
                                        ),
                                    })
                                })?
                        }
                        JValue::String(ref x) => Property::String(x.to_owned()),
                        _ => {
                            return Err(KclError::Semantic(KclErrorDetails {
                                source_ranges: property_sr,
                                message: format!(
                                    "{name} is not a valid property/index, you can only use a string to get the property of an object, or an int (>= 0) to get an item in an array",
                                ),
                            }));
                        }
                    }
                }
            }
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                match value {
                    LiteralValue::IInteger(x) => {
                        if let Ok(x) = u64::try_from(x) {
                            Property::Number(x.try_into().unwrap())
                        } else {
                            return Err(KclError::Semantic(KclErrorDetails {
                                source_ranges: property_sr,
                                message: format!("{x} is not a valid index, indices must be whole numbers >= 0"),
                            }));
                        }
                    }
                    LiteralValue::String(s) => Property::String(s),
                    _ => {
                        return Err(KclError::Semantic(KclErrorDetails {
                            source_ranges: vec![self.into()],
                            message: "Only strings or ints (>= 0) can be properties/indexes".to_owned(),
                        }));
                    }
                }
            }
        };

        let object = match &self.object {
            // TODO: Don't use recursion here, use a loop.
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(memory)?,
            MemberObject::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        };

        let object_json = object.get_json_value()?;

        // Check the property and object match -- e.g. ints for arrays, strs for objects.
        match (object_json, property) {
            (JValue::Object(map), Property::String(property)) => {
                if let Some(value) = map.get(&property) {
                    Ok(KclValue::UserVal(UserVal {
                        value: value.clone(),
                        meta: vec![Metadata {
                            source_range: self.into(),
                        }],
                    }))
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Property '{property}' not found in object"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (JValue::Object(_), p) => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Only strings can be used as the property of an object, but you're using a {}",
                    p.type_name()
                ),
                source_ranges: vec![self.clone().into()],
            })),
            (JValue::Array(arr), Property::Number(index)) => {
                let value_of_arr: Option<&JValue> = arr.get(index);
                if let Some(value) = value_of_arr {
                    Ok(KclValue::UserVal(UserVal {
                        value: value.clone(),
                        meta: vec![Metadata {
                            source_range: self.into(),
                        }],
                    }))
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("The array doesn't have any item at index {index}"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (JValue::Array(_), p) => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Only integers >= 0 can be used as the index of an array, but you're using a {}",
                    p.type_name()
                ),
                source_ranges: vec![self.clone().into()],
            })),
            (being_indexed, _) => {
                let t = human_friendly_type(&being_indexed);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!("Only arrays and objects can be indexed, but you're trying to index a {t}"),
                    source_ranges: vec![self.clone().into()],
                }))
            }
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct BinaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: BinaryOperator,
    pub left: BinaryPart,
    pub right: BinaryPart,

    pub digest: Option<Digest>,
}

impl_value_meta!(BinaryExpression);

impl BinaryExpression {
    pub fn new(operator: BinaryOperator, left: BinaryPart, right: BinaryPart) -> Self {
        Self {
            start: left.start(),
            end: right.end(),
            operator,
            left,
            right,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.left.compute_digest());
        hasher.update(slf.right.compute_digest());
    });

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.left.replace_value(source_range, new_value.clone());
        self.right.replace_value(source_range, new_value);
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        let left_constraint_level = self.left.get_constraint_level();
        let right_constraint_level = self.right.get_constraint_level();

        let mut constraint_levels = ConstraintLevels::new();
        constraint_levels.push(left_constraint_level);
        constraint_levels.push(right_constraint_level);
        constraint_levels.get_constraint_level(self.into())
    }

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
                self.precedence() > bin_exp.precedence()
                    || self.operator == BinaryOperator::Sub
                    || self.operator == BinaryOperator::Div
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
        }

        if right_source_range.contains(pos) {
            return self.right.get_hover_value_for_position(pos, code);
        }

        None
    }

    #[async_recursion::async_recursion]
    pub async fn get_result(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        let left_json_value = self
            .left
            .get_result(memory, dynamic_state, pipe_info, ctx)
            .await?
            .get_json_value()?;
        let right_json_value = self
            .right
            .get_result(memory, dynamic_state, pipe_info, ctx)
            .await?
            .get_json_value()?;

        // First check if we are doing string concatenation.
        if self.operator == BinaryOperator::Add {
            if let (Some(left), Some(right)) = (
                parse_json_value_as_string(&left_json_value),
                parse_json_value_as_string(&right_json_value),
            ) {
                let value = serde_json::Value::String(format!("{}{}", left, right));
                return Ok(KclValue::UserVal(UserVal {
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
            BinaryOperator::Pow => (left.powf(right)).into(),
        };

        Ok(KclValue::UserVal(UserVal {
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

/// JSON value as bool.  If it isn't a bool, returns None.
pub fn json_as_bool(j: &serde_json::Value) -> Option<bool> {
    match j {
        JValue::Null => None,
        JValue::Bool(b) => Some(*b),
        JValue::Number(_) => None,
        JValue::String(_) => None,
        JValue::Array(_) => None,
        JValue::Object(_) => None,
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display, Bake)]
#[databake(path = kcl_lib::ast::types)]
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
    /// Raise a number to a power.
    #[serde(rename = "^")]
    #[display("^")]
    Pow,
}

/// Mathematical associativity.
/// Should a . b . c be read as (a . b) . c, or a . (b . c)
/// See <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#precedence_and_associativity> for more.
#[derive(PartialEq, Eq, Debug, Clone, Copy)]
pub enum Associativity {
    /// Read a . b . c as (a . b) . c
    Left,
    /// Read a . b . c as a . (b . c)
    Right,
}

impl Associativity {
    pub fn is_left(&self) -> bool {
        matches!(self, Self::Left)
    }
}

impl BinaryOperator {
    pub fn digestable_id(&self) -> [u8; 3] {
        match self {
            BinaryOperator::Add => *b"add",
            BinaryOperator::Sub => *b"sub",
            BinaryOperator::Mul => *b"mul",
            BinaryOperator::Div => *b"div",
            BinaryOperator::Mod => *b"mod",
            BinaryOperator::Pow => *b"pow",
        }
    }

    /// Follow JS definitions of each operator.
    /// Taken from <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#table>
    pub fn precedence(&self) -> u8 {
        match &self {
            BinaryOperator::Add | BinaryOperator::Sub => 11,
            BinaryOperator::Mul | BinaryOperator::Div | BinaryOperator::Mod => 12,
            BinaryOperator::Pow => 6,
        }
    }

    /// Follow JS definitions of each operator.
    /// Taken from <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#table>
    pub fn associativity(&self) -> Associativity {
        match self {
            Self::Add | Self::Sub | Self::Mul | Self::Div | Self::Mod => Associativity::Left,
            Self::Pow => Associativity::Right,
        }
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct UnaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: UnaryOperator,
    pub argument: BinaryPart,

    pub digest: Option<Digest>,
}

impl_value_meta!(UnaryExpression);

impl UnaryExpression {
    pub fn new(operator: UnaryOperator, argument: BinaryPart) -> Self {
        Self {
            start: 0,
            end: argument.end(),
            operator,
            argument,
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.operator.digestable_id());
        hasher.update(slf.argument.compute_digest());
    });

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.argument.replace_value(source_range, new_value);
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        self.argument.get_constraint_level()
    }

    fn recast(&self, options: &FormatOptions) -> String {
        match self.argument {
            BinaryPart::Literal(_)
            | BinaryPart::Identifier(_)
            | BinaryPart::MemberExpression(_)
            | BinaryPart::CallExpression(_) => {
                format!("{}{}", &self.operator, self.argument.recast(options, 0))
            }
            BinaryPart::BinaryExpression(_) | BinaryPart::UnaryExpression(_) => {
                format!("{}({})", &self.operator, self.argument.recast(options, 0))
            }
        }
    }

    pub async fn get_result(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        if self.operator == UnaryOperator::Not {
            let value = self
                .argument
                .get_result(memory, dynamic_state, pipe_info, ctx)
                .await?
                .get_json_value()?;
            let Some(bool_value) = json_as_bool(&value) else {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!("Cannot apply unary operator ! to non-boolean value: {}", value),
                    source_ranges: vec![self.into()],
                }));
            };
            let negated = !bool_value;
            return Ok(KclValue::UserVal(UserVal {
                value: serde_json::Value::Bool(negated),
                meta: vec![Metadata {
                    source_range: self.into(),
                }],
            }));
        }

        let num = parse_json_number_as_f64(
            &self
                .argument
                .get_result(memory, dynamic_state, pipe_info, ctx)
                .await?
                .get_json_value()?,
            self.into(),
        )?;
        Ok(KclValue::UserVal(UserVal {
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display, Bake)]
#[databake(path = kcl_lib::ast::types)]
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

impl UnaryOperator {
    pub fn digestable_id(&self) -> [u8; 3] {
        match self {
            UnaryOperator::Neg => *b"neg",
            UnaryOperator::Not => *b"not",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct PipeExpression {
    pub start: usize,
    pub end: usize,
    // TODO: Only the first body expression can be any Value.
    // The rest will be CallExpression, and the AST type should reflect this.
    pub body: Vec<Expr>,
    pub non_code_meta: NonCodeMeta,

    pub digest: Option<Digest>,
}

impl_value_meta!(PipeExpression);

impl From<PipeExpression> for Expr {
    fn from(pipe_expression: PipeExpression) -> Self {
        Expr::PipeExpression(Box::new(pipe_expression))
    }
}

impl PipeExpression {
    pub fn new(body: Vec<Expr>) -> Self {
        Self {
            start: 0,
            end: 0,
            body,
            non_code_meta: Default::default(),
            digest: None,
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.body.len().to_ne_bytes());
        for value in slf.body.iter_mut() {
            hasher.update(value.compute_digest());
        }
        hasher.update(slf.non_code_meta.compute_digest());
    });

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for value in &mut self.body {
            value.replace_value(source_range, new_value.clone());
        }
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        if self.body.is_empty() {
            return ConstraintLevel::Ignore {
                source_ranges: vec![self.into()],
            };
        }

        // Iterate over all body expressions.
        let mut constraint_levels = ConstraintLevels::new();
        for expression in &self.body {
            constraint_levels.push(expression.get_constraint_level());
        }

        constraint_levels.get_constraint_level(self.into())
    }

    fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        let pipe = self
            .body
            .iter()
            .enumerate()
            .map(|(index, statement)| {
                let indentation = options.get_indentation(indentation_level + 1);
                let mut s = statement.recast(options, indentation_level + 1, true);
                let non_code_meta = self.non_code_meta.clone();
                if let Some(non_code_meta_value) = non_code_meta.non_code_nodes.get(&index) {
                    for val in non_code_meta_value {
                        let formatted = if val.end == self.end {
                            let indentation = options.get_indentation(indentation_level);
                            val.format(&indentation).trim_end_matches('\n').to_string()
                        } else {
                            val.format(&indentation).trim_end_matches('\n').to_string()
                        };
                        if let NonCodeValue::BlockComment { .. } = val.value {
                            s += "\n";
                            s += &formatted;
                        } else {
                            s += &formatted;
                        }
                    }
                }

                if index != self.body.len() - 1 {
                    s += "\n";
                    s += &indentation;
                    s += PIPE_OPERATOR;
                    s += " ";
                }
                s
            })
            .collect::<String>();
        format!("{}{}", options.get_indentation(indentation_level), pipe)
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

    pub async fn get_result(
        &self,
        memory: &mut ProgramMemory,
        dynamic_state: &DynamicState,
        pipe_info: &PipeInfo,
        ctx: &ExecutorContext,
    ) -> Result<KclValue, KclError> {
        execute_pipe_body(memory, dynamic_state, &self.body, pipe_info, self.into(), ctx).await
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for statement in &mut self.body {
            statement.rename_identifiers(old_name, new_name);
        }
    }
}

#[async_recursion::async_recursion]
async fn execute_pipe_body(
    memory: &mut ProgramMemory,
    dynamic_state: &DynamicState,
    body: &[Expr],
    pipe_info: &PipeInfo,
    source_range: SourceRange,
    ctx: &ExecutorContext,
) -> Result<KclValue, KclError> {
    let mut body = body.iter();
    let first = body.next().ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: "Pipe expressions cannot be empty".to_owned(),
            source_ranges: vec![source_range],
        })
    })?;
    // Evaluate the first element in the pipeline.
    // They use the `pipe_info` from some AST node above this, so that if pipe expression is nested in a larger pipe expression,
    // they use the % from the parent. After all, this pipe expression hasn't been executed yet, so it doesn't have any % value
    // of its own.
    let meta = Metadata {
        source_range: SourceRange([first.start(), first.end()]),
    };
    let output = ctx
        .execute_expr(
            first,
            memory,
            dynamic_state,
            pipe_info,
            &meta,
            StatementKind::Expression,
        )
        .await?;
    // Now that we've evaluated the first child expression in the pipeline, following child expressions
    // should use the previous child expression for %.
    // This means there's no more need for the previous `pipe_info` from the parent AST node above this one.
    let mut new_pipe_info = PipeInfo::new();
    new_pipe_info.previous_results = Some(output);
    // Evaluate remaining elements.
    for expression in body {
        match expression {
            Expr::TagDeclarator(_) => {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!("This cannot be in a PipeExpression: {:?}", expression),
                    source_ranges: vec![expression.into()],
                }));
            }
            Expr::Literal(_)
            | Expr::Identifier(_)
            | Expr::BinaryExpression(_)
            | Expr::FunctionExpression(_)
            | Expr::CallExpression(_)
            | Expr::PipeExpression(_)
            | Expr::PipeSubstitution(_)
            | Expr::ArrayExpression(_)
            | Expr::ObjectExpression(_)
            | Expr::MemberExpression(_)
            | Expr::UnaryExpression(_)
            | Expr::None(_) => {}
        };
        let metadata = Metadata {
            source_range: SourceRange([expression.start(), expression.end()]),
        };
        let output = ctx
            .execute_expr(
                expression,
                memory,
                dynamic_state,
                &new_pipe_info,
                &metadata,
                StatementKind::Expression,
            )
            .await?;
        new_pipe_info.previous_results = Some(output);
    }
    // Safe to unwrap here, because `newpipe_info` always has something pushed in when the `match first` executes.
    let final_output = new_pipe_info.previous_results.unwrap();
    Ok(final_output)
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema, Bake, FromStr, Display)]
#[databake(path = kcl_lib::ast::types)]
#[serde(tag = "type")]
#[display(style = "snake_case")]
pub enum FnArgPrimitive {
    /// A string type.
    String,
    /// A number type.
    Number,
    /// A boolean type.
    #[display("bool")]
    #[serde(rename = "bool")]
    Boolean,
    /// A tag.
    Tag,
    /// A sketch group type.
    SketchGroup,
    /// A sketch surface type.
    SketchSurface,
    /// An extrude group type.
    ExtrudeGroup,
}

impl FnArgPrimitive {
    pub fn digestable_id(&self) -> &[u8] {
        match self {
            FnArgPrimitive::String => b"string",
            FnArgPrimitive::Number => b"number",
            FnArgPrimitive::Boolean => b"boolean",
            FnArgPrimitive::Tag => b"tag",
            FnArgPrimitive::SketchGroup => b"sketchgroup",
            FnArgPrimitive::SketchSurface => b"sketchsurface",
            FnArgPrimitive::ExtrudeGroup => b"extrudegroup",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[serde(tag = "type")]
pub enum FnArgType {
    /// A primitive type.
    Primitive(FnArgPrimitive),
    // An array of a primitive type.
    Array(FnArgPrimitive),
    // An object type.
    Object {
        properties: Vec<Parameter>,
    },
}

impl FnArgType {
    pub fn compute_digest(&mut self) -> Digest {
        let mut hasher = Sha256::new();

        match self {
            FnArgType::Primitive(prim) => {
                hasher.update(b"FnArgType::Primitive");
                hasher.update(prim.digestable_id())
            }
            FnArgType::Array(prim) => {
                hasher.update(b"FnArgType::Array");
                hasher.update(prim.digestable_id())
            }
            FnArgType::Object { properties } => {
                hasher.update(b"FnArgType::Object");
                hasher.update(properties.len().to_ne_bytes());
                for prop in properties.iter_mut() {
                    hasher.update(prop.compute_digest());
                }
            }
        }

        hasher.finalize().into()
    }
}

/// Parameter of a KCL function.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Parameter {
    /// The parameter's label or name.
    pub identifier: Identifier,
    /// The type of the parameter.
    /// This is optional if the user defines a type.
    #[serde(skip)]
    pub type_: Option<FnArgType>,
    /// Is the parameter optional?
    pub optional: bool,

    pub digest: Option<Digest>,
}

impl Parameter {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.identifier.compute_digest());
        match &mut slf.type_ {
            Some(arg) => {
                hasher.update(b"Parameter::type_::Some");
                hasher.update(arg.compute_digest())
            }
            None => {
                hasher.update(b"Parameter::type_::None");
            }
        }
        hasher.update(if slf.optional { [1] } else { [0] })
    });
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    pub start: usize,
    pub end: usize,
    pub params: Vec<Parameter>,
    pub body: Program,
    #[serde(skip)]
    pub return_type: Option<FnArgType>,

    pub digest: Option<Digest>,
}

impl_value_meta!(FunctionExpression);

pub struct FunctionExpressionParts {
    pub start: usize,
    pub end: usize,
    pub params_required: Vec<Parameter>,
    pub params_optional: Vec<Parameter>,
    pub body: Program,
}

#[derive(Debug, PartialEq, Clone)]
pub struct RequiredParamAfterOptionalParam(pub Parameter);

impl std::fmt::Display for RequiredParamAfterOptionalParam {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "KCL functions must declare any optional parameters after all the required parameters. But your required parameter {} is _after_ an optional parameter. You must move it to before the optional parameters instead.", self.0.identifier.name)
    }
}

impl FunctionExpression {
    /// Function expressions don't really apply.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Ignore {
            source_ranges: vec![self.into()],
        }
    }

    compute_digest!(|slf, hasher| {
        hasher.update(slf.params.len().to_ne_bytes());
        for param in slf.params.iter_mut() {
            hasher.update(param.compute_digest());
        }
        hasher.update(slf.body.compute_digest());
        match &mut slf.return_type {
            Some(rt) => {
                hasher.update(b"FunctionExpression::return_type::Some");
                hasher.update(rt.compute_digest());
            }
            None => {
                hasher.update(b"FunctionExpression::return_type::None");
            }
        }
    });

    pub fn into_parts(self) -> Result<FunctionExpressionParts, RequiredParamAfterOptionalParam> {
        let Self {
            start,
            end,
            params,
            body,
            digest: _,
            return_type: _,
        } = self;
        let mut params_required = Vec::with_capacity(params.len());
        let mut params_optional = Vec::with_capacity(params.len());
        for param in params {
            if param.optional {
                params_optional.push(param);
            } else {
                if !params_optional.is_empty() {
                    return Err(RequiredParamAfterOptionalParam(param));
                }
                params_required.push(param);
            }
        }
        params_required.shrink_to_fit();
        params_optional.shrink_to_fit();
        Ok(FunctionExpressionParts {
            start,
            end,
            params_required,
            params_optional,
            body,
        })
    }

    /// Required parameters must be declared before optional parameters.
    /// This gets all the required parameters.
    pub fn required_params(&self) -> &[Parameter] {
        let end_of_required_params = self
            .params
            .iter()
            .position(|param| param.optional)
            // If there's no optional params, then all the params are required params.
            .unwrap_or(self.params.len());
        &self.params[..end_of_required_params]
    }

    /// Minimum and maximum number of arguments this function can take.
    pub fn number_of_args(&self) -> RangeInclusive<usize> {
        self.required_params().len()..=self.params.len()
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.body.replace_value(source_range, new_value);
    }

    pub fn recast(&self, options: &FormatOptions, indentation_level: usize) -> String {
        // We don't want to end with a new line inside nested functions.
        let mut new_options = options.clone();
        new_options.insert_final_newline = false;
        format!(
            "({}) => {{\n{}{}\n}}",
            self.params
                .iter()
                .map(|param| param.identifier.name.clone())
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Bake)]
#[databake(path = kcl_lib::ast::types)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub start: usize,
    pub end: usize,
    pub argument: Expr,

    pub digest: Option<Digest>,
}

impl_value_meta!(ReturnStatement);

impl ReturnStatement {
    compute_digest!(|slf, hasher| {
        hasher.update(slf.argument.compute_digest());
    });
}

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
    Comment {
        value: String,
        range: LspRange,
    },
}

/// Format options.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[cfg_attr(feature = "pyo3", pyo3::pyclass)]
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

/// The constraint level.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema, Display)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
#[display(style = "snake_case")]
pub enum ConstraintLevel {
    /// Ignore constraints.
    /// This is useful for stuff like pipe substitutions where we don't want it to
    /// factor into the overall constraint level.
    /// Like empty arrays or objects, etc.
    #[display("ignore")]
    Ignore { source_ranges: Vec<SourceRange> },
    /// No constraints.
    #[display("none")]
    None { source_ranges: Vec<SourceRange> },
    /// Partially constrained.
    #[display("partial")]
    Partial {
        source_ranges: Vec<SourceRange>,
        levels: ConstraintLevels,
    },
    /// Fully constrained.
    #[display("full")]
    Full { source_ranges: Vec<SourceRange> },
}

impl From<ConstraintLevel> for Vec<SourceRange> {
    fn from(constraint_level: ConstraintLevel) -> Self {
        match constraint_level {
            ConstraintLevel::Ignore { source_ranges } => source_ranges,
            ConstraintLevel::None { source_ranges } => source_ranges,
            ConstraintLevel::Partial {
                source_ranges,
                levels: _,
            } => source_ranges,
            ConstraintLevel::Full { source_ranges } => source_ranges,
        }
    }
}

impl PartialEq for ConstraintLevel {
    fn eq(&self, other: &Self) -> bool {
        // Just check the variant.
        std::mem::discriminant(self) == std::mem::discriminant(other)
    }
}

impl ConstraintLevel {
    pub fn update_source_ranges(&self, source_range: SourceRange) -> Self {
        match self {
            ConstraintLevel::Ignore { source_ranges: _ } => ConstraintLevel::Ignore {
                source_ranges: vec![source_range],
            },
            ConstraintLevel::None { source_ranges: _ } => ConstraintLevel::None {
                source_ranges: vec![source_range],
            },
            ConstraintLevel::Partial {
                source_ranges: _,
                levels,
            } => ConstraintLevel::Partial {
                source_ranges: vec![source_range],
                levels: levels.clone(),
            },
            ConstraintLevel::Full { source_ranges: _ } => ConstraintLevel::Full {
                source_ranges: vec![source_range],
            },
        }
    }
}

/// A vector of constraint levels.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ConstraintLevels(pub Vec<ConstraintLevel>);

impl Default for ConstraintLevels {
    fn default() -> Self {
        Self::new()
    }
}

impl ConstraintLevels {
    pub fn new() -> Self {
        Self(vec![])
    }

    pub fn push(&mut self, constraint_level: ConstraintLevel) {
        self.0.push(constraint_level);
    }

    /// Get the overall constraint level.
    pub fn get_constraint_level(&self, source_range: SourceRange) -> ConstraintLevel {
        if self.0.is_empty() {
            return ConstraintLevel::Ignore {
                source_ranges: vec![source_range],
            };
        }

        // Check if all the constraint levels are the same.
        if self
            .0
            .iter()
            .all(|level| *level == self.0[0] || matches!(level, ConstraintLevel::Ignore { .. }))
        {
            self.0[0].clone()
        } else {
            ConstraintLevel::Partial {
                source_ranges: vec![source_range],
                levels: self.clone(),
            }
        }
    }

    pub fn get_all_partial_or_full_source_ranges(&self) -> Vec<SourceRange> {
        let mut source_ranges = Vec::new();
        // Add to our source ranges anything that is not none or ignore.
        for level in &self.0 {
            match level {
                ConstraintLevel::None { source_ranges: _ } => {}
                ConstraintLevel::Ignore { source_ranges: _ } => {}
                ConstraintLevel::Partial {
                    source_ranges: _,
                    levels,
                } => {
                    source_ranges.extend(levels.get_all_partial_or_full_source_ranges());
                }
                ConstraintLevel::Full {
                    source_ranges: full_source_ranges,
                } => {
                    source_ranges.extend(full_source_ranges);
                }
            }
        }

        source_ranges
    }
}

pub(crate) fn human_friendly_type(j: &JValue) -> &'static str {
    match j {
        JValue::Null => "null",
        JValue::Bool(_) => "boolean (true/false value)",
        JValue::Number(_) => "number",
        JValue::String(_) => "string (text)",
        JValue::Array(_) => "array (list)",
        JValue::Object(_) => "object",
    }
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_variable_kind_to_completion() {
        let completions = VariableKind::to_completion_items().unwrap();
        assert!(!completions.is_empty());
    }

    #[test]
    fn test_get_lsp_folding_ranges() {
        let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0000000000, 5.0000000000], %)
    |> line([0.4900857016, -0.0240763666], %)

startSketchOn('XY')
  |> startProfileAt([0.0000000000, 5.0000000000], %)
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, b: "thing"}

fn ghi = (x) => {
  return x
}

ghi("things")
"#;
        let tokens = crate::token::lexer(code).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();
        let folding_ranges = program.get_lsp_folding_ranges();
        assert_eq!(folding_ranges.len(), 3);
        assert_eq!(folding_ranges[0].start_line, 35);
        assert_eq!(folding_ranges[0].end_line, 134);
        assert_eq!(
            folding_ranges[0].collapsed_text,
            Some("const part001 = startSketchOn('XY')".to_string())
        );
        assert_eq!(folding_ranges[1].start_line, 155);
        assert_eq!(folding_ranges[1].end_line, 254);
        assert_eq!(
            folding_ranges[1].collapsed_text,
            Some("startSketchOn('XY')".to_string())
        );
        assert_eq!(folding_ranges[2].start_line, 390);
        assert_eq!(folding_ranges[2].end_line, 403);
        assert_eq!(folding_ranges[2].collapsed_text, Some("fn ghi = (x) => {".to_string()));
    }

    #[test]
    fn test_get_lsp_symbols() {
        let code = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0000000000, 5.0000000000], %)
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, b: "thing"}

fn ghi = (x) => {
  return x
}
"#;
        let tokens = crate::token::lexer(code).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();
        let symbols = program.get_lsp_symbols(code).unwrap();
        assert_eq!(symbols.len(), 7);
    }

    #[test]
    fn test_recast_bug_fn_in_fn() {
        let some_program_string = r#"// Start point (top left)
const zoo_x = -20
const zoo_y = 7
// Scale
const s = 1 // s = 1 -> height of Z is 13.4mm
// Depth
const d = 1

fn rect = (x, y, w, h) => {
  startSketchOn('XY')
    |> startProfileAt([x, y], %)
    |> xLine(w, %)
    |> yLine(h, %)
    |> xLine(-w, %)
    |> close(%)
    |> extrude(d, %)
}

fn quad = (x1, y1, x2, y2, x3, y3, x4, y4) => {
  startSketchOn('XY')
    |> startProfileAt([x1, y1], %)
    |> lineTo([x2, y2], %)
    |> lineTo([x3, y3], %)
    |> lineTo([x4, y4], %)
    |> close(%)
    |> extrude(d, %)
}

fn crosshair = (x, y) => {
  startSketchOn('XY')
    |> startProfileAt([x, y], %)
    |> yLine(1, %)
    |> yLine(-2, %)
    |> yLine(1, %)
    |> xLine(1, %)
    |> xLine(-2, %)
}

fn z = (z_x, z_y) => {
  const z_end_w = s * 8.4
  const z_end_h = s * 3
  const z_corner = s * 2
  const z_w = z_end_w + 2 * z_corner
  const z_h = z_w * 1.08130081300813
  rect(z_x, z_y, z_end_w, -z_end_h)
  rect(z_x + z_w, z_y, -z_corner, -z_corner)
  rect(z_x + z_w, z_y - z_h, -z_end_w, z_end_h)
  rect(z_x, z_y - z_h, z_corner, z_corner)
  quad(z_x, z_y - z_h + z_corner, z_x + z_w - z_corner, z_y, z_x + z_w, z_y - z_corner, z_x + z_corner, z_y - z_h)
}

fn o = (c_x, c_y) => {
  // Outer and inner radii
  const o_r = s * 6.95
  const i_r = 0.5652173913043478 * o_r

  // Angle offset for diagonal break
  const a = 7

  // Start point for the top sketch
  const o_x1 = c_x + o_r * cos((45 + a) / 360 * tau())
  const o_y1 = c_y + o_r * sin((45 + a) / 360 * tau())

  // Start point for the bottom sketch
  const o_x2 = c_x + o_r * cos((225 + a) / 360 * tau())
  const o_y2 = c_y + o_r * sin((225 + a) / 360 * tau())

  // End point for the bottom startSketchAt
  const o_x3 = c_x + o_r * cos((45 - a) / 360 * tau())
  const o_y3 = c_y + o_r * sin((45 - a) / 360 * tau())

  // Where is the center?
  // crosshair(c_x, c_y)


  startSketchOn('XY')
    |> startProfileAt([o_x1, o_y1], %)
    |> arc({
         radius: o_r,
         angle_start: 45 + a,
         angle_end: 225 - a
       }, %)
    |> angledLine([45, o_r - i_r], %)
    |> arc({
         radius: i_r,
         angle_start: 225 - a,
         angle_end: 45 + a
       }, %)
    |> close(%)
    |> extrude(d, %)

  startSketchOn('XY')
    |> startProfileAt([o_x2, o_y2], %)
    |> arc({
         radius: o_r,
         angle_start: 225 + a,
         angle_end: 360 + 45 - a
       }, %)
    |> angledLine([225, o_r - i_r], %)
    |> arc({
         radius: i_r,
         angle_start: 45 - a,
         angle_end: 225 + a - 360
       }, %)
    |> close(%)
    |> extrude(d, %)
}

fn zoo = (x0, y0) => {
  z(x0, y0)
  o(x0 + s * 20, y0 - (s * 6.7))
  o(x0 + s * 35, y0 - (s * 6.7))
}

zoo(zoo_x, zoo_y)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_bug_extra_parens() {
        let some_program_string = r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads. 

// Define constants like ball diameter, inside diameter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// Ball Bearing
// A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.


// Define constants like ball diameter, inside diameter, overhange length, and thickness
const sphereDia = 0.5
const insideDia = 1
const thickness = 0.25
const overHangLength = .4

// Sketch and revolve the inside bearing piece
const insideRevolve = startSketchOn('XZ')
  |> startProfileAt([insideDia / 2, 0], %)
  |> line([0, thickness + sphereDia / 2], %)
  |> line([overHangLength, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, -sphereDia], %)
  |> line([overHangLength - thickness, 0], %)
  |> line([0, -thickness], %)
  |> line([-overHangLength, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)

// Sketch and revolve one of the balls and duplicate it using a circular pattern. (This is currently a workaround, we have a bug with rotating on a sketch that touches the rotation axis)
const sphere = startSketchOn('XZ')
  |> startProfileAt([
       0.05 + insideDia / 2 + thickness,
       0 - 0.05
     ], %)
  |> line([sphereDia - 0.1, 0], %)
  |> arc({
       angle_start: 0,
       angle_end: -180,
       radius: sphereDia / 2 - 0.05
     }, %)
  |> close(%)
  |> revolve({ axis: 'x' }, %)
  |> patternCircular3d({
       axis: [0, 0, 1],
       center: [0, 0, 0],
       repetitions: 10,
       arcDegrees: 360,
       rotateDuplicates: true
     }, %)

// Sketch and revolve the outside bearing
const outsideRevolve = startSketchOn('XZ')
  |> startProfileAt([
       insideDia / 2 + thickness + sphereDia,
       0
     ], %)
  |> line([0, sphereDia / 2], %)
  |> line([-overHangLength + thickness, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength, 0], %)
  |> line([0, -2 * thickness - sphereDia], %)
  |> line([-overHangLength, 0], %)
  |> line([0, thickness], %)
  |> line([overHangLength - thickness, 0], %)
  |> close(%)
  |> revolve({ axis: 'y' }, %)
"#
        );
    }

    #[test]
    fn test_recast_fn_in_object() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [{ prop: callExp(bing.yo) }]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_fn_in_array() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [callExp(bing.yo)]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted, some_program_string);
    }

    #[test]
    fn test_recast_space_in_fn_call() {
        let some_program_string = r#"fn thing = (x) => {
    return x + 1
}

thing ( 1 )
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn thing = (x) => {
  return x + 1
}

thing(1)
"#
        );
    }

    #[test]
    fn test_recast_object_fn_in_array_weird_bracket() {
        let some_program_string = r#"const bing = { yo: 55 }
const myNestedVar = [
  {
  prop:   line([bing.yo, 21], sketch001)
}
]
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const bing = { yo: 55 }
const myNestedVar = [
  { prop: line([bing.yo, 21], sketch001) }
]
"#
        );
    }

    #[test]
    fn test_recast_empty_file() {
        let some_program_string = r#""#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_empty_file_new_line() {
        let some_program_string = r#"
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(recasted, r#""#);
    }

    #[test]
    fn test_recast_shebang_only() {
        let some_program_string = r#"#!/usr/local/env zoo kcl"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([21, 24])], message: "Unexpected end of file. The compiler expected a function body items (functions are made up of variable declarations, expressions, and return statements, each of those is a possible body item" }"#
        );
    }

    #[test]
    fn test_recast_shebang() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_shebang_new_lines() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        


const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_shebang_with_comments() {
        let some_program_string = r#"#!/usr/local/env zoo kcl
        
// Yo yo my comments.
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#;

        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"#!/usr/local/env zoo kcl

// Yo yo my comments.
const part001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> line([-20, 0], %)
  |> close(%)
"#
        );
    }

    #[test]
    fn test_recast_large_file() {
        let some_program_string = r#"// define constants
const radius = 6.0
const width = 144.0
const length = 83.0
const depth = 45.0
const thk = 5
const hole_diam = 5
// define a rectangular shape func
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('xy')
    |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
    |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %,$edge1)
    |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, $edge2)
    |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, $edge3)
    |> close(%, $edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
const scarlett_body = rectShape([0, 0], width, length)
  |> extrude(depth, %)
  |> fillet({
       radius: radius,
       tags: [
  edge2,
  edge4,
  getOppositeEdge(edge2),
  getOppositeEdge(edge4)
]
     }, %)
  // build the bracket sketch around the body
fn bracketSketch = (w, d, t) => {
  const s = startSketchOn({
         plane: {
  origin: { x: 0, y: length / 2 + thk, z: 0 },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 0, z: 1 },
  z_axis: { x: 0, y: 1, z: 0 }
}
       })
    |> startProfileAt([-w / 2 - t, d + t], %)
    |> lineTo([-w / 2 - t, -t], %, $edge1)
    |> lineTo([w / 2 + t, -t], %, $edge2)
    |> lineTo([w / 2 + t, d + t], %, $edge3)
    |> lineTo([w / 2, d + t], %, $edge4)
    |> lineTo([w / 2, 0], %, $edge5)
    |> lineTo([-w / 2, 0], %, $edge6)
    |> lineTo([-w / 2, d + t], %, $edge7)
    |> close(%, $edge8)
  return s
}
// build the body of the bracket
const bracket_body = bracketSketch(width, depth, thk)
  |> extrude(length + 10, %)
  |> fillet({
       radius: radius,
       tags: [
  getNextAdjacentEdge(edge7),
  getNextAdjacentEdge(edge2),
  getNextAdjacentEdge(edge3),
  getNextAdjacentEdge(edge6)
]
     }, %)
  // build the tabs of the mounting bracket (right side)
const tabs_r = startSketchOn({
       plane: {
  origin: { x: 0, y: 0, z: depth + thk },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 1, z: 0 },
  z_axis: { x: 0, y: 0, z: 1 }
}
     })
  |> startProfileAt([width / 2 + thk, length / 2 + thk], %)
  |> line([10, -5], %)
  |> line([0, -10], %)
  |> line([-10, -5], %)
  |> close(%)
  |> hole(circle([
       width / 2 + thk + hole_diam,
       length / 2 - hole_diam
     ], hole_diam / 2, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
  // build the tabs of the mounting bracket (left side)
const tabs_l = startSketchOn({
       plane: {
  origin: { x: 0, y: 0, z: depth + thk },
  x_axis: { x: 1, y: 0, z: 0 },
  y_axis: { x: 0, y: 1, z: 0 },
  z_axis: { x: 0, y: 0, z: 1 }
}
     })
  |> startProfileAt([-width / 2 - thk, length / 2 + thk], %)
  |> line([-10, -5], %)
  |> line([0, -10], %)
  |> line([10, -5], %)
  |> close(%)
  |> hole(circle([
       -width / 2 - thk - hole_diam,
       length / 2 - hole_diam
     ], hole_diam / 2, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        // Its VERY important this comes back with zero new lines.
        assert_eq!(
            recasted,
            r#"// define constants
const radius = 6.0
const width = 144.0
const length = 83.0
const depth = 45.0
const thk = 5
const hole_diam = 5
// define a rectangular shape func
fn rectShape = (pos, w, l) => {
  const rr = startSketchOn('xy')
    |> startProfileAt([pos[0] - (w / 2), pos[1] - (l / 2)], %)
    |> lineTo([pos[0] + w / 2, pos[1] - (l / 2)], %, $edge1)
    |> lineTo([pos[0] + w / 2, pos[1] + l / 2], %, $edge2)
    |> lineTo([pos[0] - (w / 2), pos[1] + l / 2], %, $edge3)
    |> close(%, $edge4)
  return rr
}
// build the body of the focusrite scarlett solo gen 4
// only used for visualization
const scarlett_body = rectShape([0, 0], width, length)
  |> extrude(depth, %)
  |> fillet({
       radius: radius,
       tags: [
         edge2,
         edge4,
         getOppositeEdge(edge2),
         getOppositeEdge(edge4)
       ]
     }, %)
// build the bracket sketch around the body
fn bracketSketch = (w, d, t) => {
  const s = startSketchOn({
         plane: {
           origin: { x: 0, y: length / 2 + thk, z: 0 },
           x_axis: { x: 1, y: 0, z: 0 },
           y_axis: { x: 0, y: 0, z: 1 },
           z_axis: { x: 0, y: 1, z: 0 }
         }
       })
    |> startProfileAt([-w / 2 - t, d + t], %)
    |> lineTo([-w / 2 - t, -t], %, $edge1)
    |> lineTo([w / 2 + t, -t], %, $edge2)
    |> lineTo([w / 2 + t, d + t], %, $edge3)
    |> lineTo([w / 2, d + t], %, $edge4)
    |> lineTo([w / 2, 0], %, $edge5)
    |> lineTo([-w / 2, 0], %, $edge6)
    |> lineTo([-w / 2, d + t], %, $edge7)
    |> close(%, $edge8)
  return s
}
// build the body of the bracket
const bracket_body = bracketSketch(width, depth, thk)
  |> extrude(length + 10, %)
  |> fillet({
       radius: radius,
       tags: [
         getNextAdjacentEdge(edge7),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge6)
       ]
     }, %)
// build the tabs of the mounting bracket (right side)
const tabs_r = startSketchOn({
       plane: {
         origin: { x: 0, y: 0, z: depth + thk },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 1, z: 0 },
         z_axis: { x: 0, y: 0, z: 1 }
       }
     })
  |> startProfileAt([width / 2 + thk, length / 2 + thk], %)
  |> line([10, -5], %)
  |> line([0, -10], %)
  |> line([-10, -5], %)
  |> close(%)
  |> hole(circle([
       width / 2 + thk + hole_diam,
       length / 2 - hole_diam
     ], hole_diam / 2, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
// build the tabs of the mounting bracket (left side)
const tabs_l = startSketchOn({
       plane: {
         origin: { x: 0, y: 0, z: depth + thk },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 1, z: 0 },
         z_axis: { x: 0, y: 0, z: 1 }
       }
     })
  |> startProfileAt([-width / 2 - thk, length / 2 + thk], %)
  |> line([-10, -5], %)
  |> line([0, -10], %)
  |> line([10, -5], %)
  |> close(%)
  |> hole(circle([
       -width / 2 - thk - hole_diam,
       length / 2 - hole_diam
     ], hole_diam / 2, %), %)
  |> extrude(-thk, %)
  |> patternLinear3d({
       axis: [0, -1, 0],
       repetitions: 1,
       distance: length - 10
     }, %)
"#
        );
    }

    #[test]
    fn test_recast_nested_var_declaration_in_fn_body() {
        let some_program_string = r#"fn cube = (pos, scale) => {
   const sg = startSketchOn('XY')
  |> startProfileAt(pos, %)
  |> line([0, scale], %)
  |> line([scale, 0], %)
  |> line([0, -scale], %)
  |> close(%)
  |> extrude(scale, %)
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn cube = (pos, scale) => {
  const sg = startSketchOn('XY')
    |> startProfileAt(pos, %)
    |> line([0, scale], %)
    |> line([scale, 0], %)
    |> line([0, -scale], %)
    |> close(%)
    |> extrude(scale, %)
}
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %)
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_with_bad_indentation_and_inline_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %) // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %) // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }
    #[test]
    fn test_recast_with_bad_indentation_and_line_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
              |> line([0.4900857016, -0.0240763666], %)
        // hello world
    |> line([0.6804562304, 0.9087880491], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)
  // hello world
  |> line([0.6804562304, 0.9087880491], %)
"#
        );
    }

    #[test]
    fn test_recast_comment_in_a_fn_block() {
        let some_program_string = r#"fn myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
    return things
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"fn myFn = () => {
  // this is a comment
  const yo = { a: { b: { c: '123' } } } /* block
  comment */

  const key = 'c'
  // this is also a comment
  return things
}
"#
        );
    }

    #[test]
    fn test_recast_comment_under_variable() {
        let some_program_string = r#"const key = 'c'
// this is also a comment
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const key = 'c'
// this is also a comment
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_start_file() {
        let some_program_string = r#"// hello world
// I am a comment
const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
// I am a comment
const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_empty_comment() {
        let some_program_string = r#"// hello world
//
// I am a comment
const key = 'c'

//
// I am a comment
const thing = 'c'

const foo = 'bar' //
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// hello world
//
// I am a comment
const key = 'c'

//
// I am a comment
const thing = 'c'

const foo = 'bar' //
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment_under_variable() {
        let some_program_string = r#"const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const key = 'c'
// this is also a comment
// hello
const thing = 'foo'
"#
        );
    }

    #[test]
    fn test_recast_comment_at_start() {
        let test_program = r#"
/* comment at start */

const mySk1 = startSketchAt([0, 0])"#;
        let tokens = crate::token::lexer(test_program).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"/* comment at start */

const mySk1 = startSketchAt([0, 0])
"#
        );
    }

    #[test]
    fn test_recast_lots_of_comments() {
        let some_program_string = r#"// comment at start
const mySk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, $myTag)
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
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"// comment at start
const mySk1 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> lineTo([1, 1], %)
  // comment here
  |> lineTo([0, 1], %, $myTag)
  |> lineTo([1, 1], %)
  /* and
  here */
  // a comment between pipe expression statements
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
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([-0.01, -0.08], %)
  |> line([0.62, 4.15], %, $seg01)
  |> line([2.77, -1.24], %)
  |> angledLineThatIntersects({
       angle: 201,
       offset: -1.35,
       intersectTag: seg01
     }, %)
  |> line([-0.42, -1.72], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        let expected = some_program_string.trim();
        // Currently new parser removes an empty line
        let actual = recasted.trim();
        assert_eq!(actual, expected);
    }

    #[test]
    fn test_recast_comment_tokens_inside_strings() {
        let some_program_string = r#"let b = {
  end: 141,
  start: 125,
  type: "NonCodeNode",
  value: "
 // a comment
   "
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
const part001 = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([1, 3.82], %, $seg01) // ln-should-get-tag
  |> angledLineToX([
       -angleToMatchLengthX(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
  |> angledLineToY([
       -angleToMatchLengthY(seg01, myVar, %),
       myVar
     ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
const part001 = startSketchOn('XY')
   |> startProfileAt([0, 0], %)
   |> line([1, 3.82], %, $seg01) // ln-should-get-tag
   |> angledLineToX([
         -angleToMatchLengthX(seg01, myVar, %),
         myVar
      ], %) // ln-lineTo-xAbsolute should use angleToMatchLengthX helper
   |> angledLineToY([
         -angleToMatchLengthY(seg01, myVar, %),
         myVar
      ], %) // ln-lineTo-yAbsolute should use angleToMatchLengthY helper
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0.0000000000, 5.0000000000], %)
    |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [part001, 0.0]
let blah = 1
const foo = false
let baz = {a: 1, part001: "thing"}

fn ghi = (part001) => {
  return part001
}
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let mut program = parser.ast().unwrap();
        program.rename_symbol("mySuperCoolPart", 6);

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const mySuperCoolPart = startSketchOn('XY')
  |> startProfileAt([0.0, 5.0], %)
  |> line([0.4900857016, -0.0240763666], %)

const part002 = "part002"
const things = [mySuperCoolPart, 0.0]
let blah = 1
const foo = false
let baz = { a: 1, part001: "thing" }

fn ghi = (part001) => {
  return part001
}
"#
        );
    }

    #[test]
    fn test_recast_after_rename_fn_args() {
        let some_program_string = r#"fn ghi = (x, y, z) => {
  return x
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
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
    fn test_recast_trailing_comma() {
        let some_program_string = r#"startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> arc({
    radius: 1,
    angle_start: 0,
    angle_end: 180,
  }, %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> arc({
       radius: 1,
       angle_start: 0,
       angle_end: 180
     }, %)
"#
        );
    }

    #[test]
    fn test_ast_get_non_code_node() {
        let some_program_string = r#"const r = 20 / pow(pi(), 1 / 3)
const h = 30

// st
const cylinder = startSketchOn('-XZ')
  |> startProfileAt([50, 0], %)
  |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: r
     }, %)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let value = program.get_non_code_meta_for_position(50);

        assert!(value.is_some());
    }

    #[test]
    fn test_ast_get_non_code_node_pipe() {
        let some_program_string = r#"const r = 20 / pow(pi(), 1 / 3)
const h = 30

// st
const cylinder = startSketchOn('-XZ')
  |> startProfileAt([50, 0], %)
  // comment
  |> arc({
       angle_end: 360,
       angle_start: 0,
       radius: r
     }, %)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let value = program.get_non_code_meta_for_position(124);

        assert!(value.is_some());
    }

    #[test]
    fn test_ast_get_non_code_node_inline_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> xLine(5, %) // lin
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let value = program.get_non_code_meta_for_position(86);

        assert!(value.is_some());
    }

    #[test]
    fn test_recast_negative_var() {
        let some_program_string = r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const w = 20
const l = 8
const h = 10

const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#
        );
    }

    #[test]
    fn test_recast_multiline_comment() {
        let some_program_string = r#"const w = 20
const l = 8
const h = 10

// This is my comment
// It has multiple lines
// And it's really long
const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(
            recasted,
            r#"const w = 20
const l = 8
const h = 10

// This is my comment
// It has multiple lines
// And it's really long
const firstExtrude = startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, -l], %)
  |> close(%)
  |> extrude(h, %)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_start_negative() {
        let some_program_string = r#"const myVar = -5 + 6"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number, arg1: string, tag?: string) => {
    return arg0
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declarations.first().unwrap().init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(params[0].type_, Some(FnArgType::Primitive(FnArgPrimitive::Number)));
        assert_eq!(params[1].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_array_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number[], arg1: string[], tag?: string) => {
    return arg0
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declarations.first().unwrap().init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(params[0].type_, Some(FnArgType::Array(FnArgPrimitive::Number)));
        assert_eq!(params[1].type_, Some(FnArgType::Array(FnArgPrimitive::String)));
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_object_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number[], arg1: {thing: number, things: string[], more?: string}, tag?: string) => {
    return arg0
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declarations.first().unwrap().init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(params[0].type_, Some(FnArgType::Array(FnArgPrimitive::Number)));
        assert_eq!(
            params[1].type_,
            Some(FnArgType::Object {
                properties: vec![
                    Parameter {
                        identifier: Identifier {
                            start: 35,
                            end: 40,
                            name: "thing".to_owned(),
                            digest: None,
                        },
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::Number)),
                        optional: false,
                        digest: None
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 50,
                            end: 56,
                            name: "things".to_owned(),
                            digest: None,
                        },
                        type_: Some(FnArgType::Array(FnArgPrimitive::String)),
                        optional: false,
                        digest: None
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 68,
                            end: 72,
                            name: "more".to_owned(),
                            digest: None
                        },
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::String)),
                        optional: true,
                        digest: None
                    }
                ]
            })
        );
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_return_type_on_functions() {
        let some_program_string = r#"fn thing = () => {thing: number, things: string[], more?: string} {
    return 1
}"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declarations.first().unwrap().init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 0);
        assert_eq!(
            func_expr.return_type,
            Some(FnArgType::Object {
                properties: vec![
                    Parameter {
                        identifier: Identifier {
                            start: 18,
                            end: 23,
                            name: "thing".to_owned(),
                            digest: None
                        },
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::Number)),
                        optional: false,
                        digest: None
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 33,
                            end: 39,
                            name: "things".to_owned(),
                            digest: None
                        },
                        type_: Some(FnArgType::Array(FnArgPrimitive::String)),
                        optional: false,
                        digest: None
                    },
                    Parameter {
                        identifier: Identifier {
                            start: 51,
                            end: 55,
                            name: "more".to_owned(),
                            digest: None
                        },
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::String)),
                        optional: true,
                        digest: None
                    }
                ]
            })
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_negate_parens() {
        let some_program_string = r#"const wallMountL = 3.82
const thickness = 0.5

startSketchOn('XY')
  |> startProfileAt([0, 0], %)
  |> line([0, -(wallMountL - thickness)], %)
  |> line([0, -(5 - thickness)], %)
  |> line([0, -(5 - 1)], %)
  |> line([0, -(-5 - 1)], %)"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_recast_math_nested_parens() {
        let some_program_string = r#"const distance = 5
const p = 3
const FOS = 2
const sigmaAllow = 8
const width = 20
const thickness = sqrt(distance * p * FOS * 6 / (sigmaAllow * width))"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        let recasted = program.recast(&Default::default(), 0);
        assert_eq!(recasted.trim(), some_program_string);
    }

    #[test]
    fn recast_literal() {
        use winnow::Parser;
        for (i, (raw, expected, reason)) in [
            (
                "5.0",
                "5.0",
                "fractional numbers should stay fractional, i.e. don't reformat this to '5'",
            ),
            (
                "5",
                "5",
                "integers should stay integral, i.e. don't reformat this to '5.0'",
            ),
            (
                "5.0000000",
                "5.0",
                "if the number is f64 but not fractional, use its canonical format",
            ),
            ("5.1", "5.1", "straightforward case works"),
        ]
        .into_iter()
        .enumerate()
        {
            let tokens = crate::token::lexer(raw).unwrap();
            let literal = crate::parser::parser_impl::unsigned_number_literal
                .parse(&tokens)
                .unwrap();
            assert_eq!(
                literal.recast(),
                expected,
                "failed test {i}, which is testing that {reason}"
            );
        }
    }

    #[test]
    fn required_params() {
        for (i, (test_name, expected, function_expr)) in [
            (
                "no params",
                (0..=0),
                FunctionExpression {
                    start: 0,
                    end: 0,
                    params: vec![],
                    body: Program {
                        start: 0,
                        end: 0,
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        digest: None,
                    },
                    return_type: None,
                    digest: None,
                },
            ),
            (
                "all required params",
                (1..=1),
                FunctionExpression {
                    start: 0,
                    end: 0,
                    params: vec![Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "foo".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: false,
                        digest: None,
                    }],
                    body: Program {
                        start: 0,
                        end: 0,
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        digest: None,
                    },
                    return_type: None,
                    digest: None,
                },
            ),
            (
                "all optional params",
                (0..=1),
                FunctionExpression {
                    start: 0,
                    end: 0,
                    params: vec![Parameter {
                        identifier: Identifier {
                            start: 0,
                            end: 0,
                            name: "foo".to_owned(),
                            digest: None,
                        },
                        type_: None,
                        optional: true,
                        digest: None,
                    }],
                    body: Program {
                        start: 0,
                        end: 0,
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        digest: None,
                    },
                    return_type: None,
                    digest: None,
                },
            ),
            (
                "mixed params",
                (1..=2),
                FunctionExpression {
                    start: 0,
                    end: 0,
                    params: vec![
                        Parameter {
                            identifier: Identifier {
                                start: 0,
                                end: 0,
                                name: "foo".to_owned(),
                                digest: None,
                            },
                            type_: None,
                            optional: false,
                            digest: None,
                        },
                        Parameter {
                            identifier: Identifier {
                                start: 0,
                                end: 0,
                                name: "bar".to_owned(),
                                digest: None,
                            },
                            type_: None,
                            optional: true,
                            digest: None,
                        },
                    ],
                    body: Program {
                        start: 0,
                        end: 0,
                        body: Vec::new(),
                        non_code_meta: Default::default(),
                        digest: None,
                    },
                    return_type: None,
                    digest: None,
                },
            ),
        ]
        .into_iter()
        .enumerate()
        {
            let actual = function_expr.number_of_args();
            assert_eq!(expected, actual, "failed test #{i} '{test_name}'");
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_object_bool() {
        let some_program_string = r#"some_func({thing: true, other_thing: false})"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast().unwrap();

        // We want to get the bool and verify it is a bool.

        let BodyItem::ExpressionStatement(ExpressionStatement {
            expression,
            start: _,
            end: _,
            digest: None,
        }) = program.body.first().unwrap()
        else {
            panic!("expected a function!");
        };

        let Expr::CallExpression(ce) = expression else {
            panic!("expected a function!");
        };

        assert!(!ce.arguments.is_empty());

        let Expr::ObjectExpression(oe) = ce.arguments.first().unwrap() else {
            panic!("expected a object!");
        };

        assert_eq!(oe.properties.len(), 2);

        let Expr::Literal(ref l) = oe.properties.first().unwrap().value else {
            panic!("expected a literal!");
        };

        assert_eq!(l.raw, "true");

        let Expr::Literal(ref l) = oe.properties.get(1).unwrap().value else {
            panic!("expected a literal!");
        };

        assert_eq!(l.raw, "false");
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_tag_named_std_lib() {
        let some_program_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %, $xLine)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([76, 82])], message: "Cannot assign a tag to a reserved keyword: xLine" }"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_empty_tag() {
        let some_program_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %, $)
"#;
        let tokens = crate::token::lexer(some_program_string).unwrap();
        let parser = crate::parser::Parser::new(tokens);
        let result = parser.ast();

        assert!(result.is_err());
        assert_eq!(
            result.unwrap_err().to_string(),
            r#"syntax: KclErrorDetails { source_ranges: [SourceRange([57, 59])], message: "Unexpected token: |>" }"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_digest() {
        let prog1_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %)
"#;
        let prog1_tokens = crate::token::lexer(prog1_string).unwrap();
        let prog1_parser = crate::parser::Parser::new(prog1_tokens);
        let prog1_digest = prog1_parser.ast().unwrap().compute_digest();

        let prog2_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 2], %)
    |> line([5, 5], %)
"#;
        let prog2_tokens = crate::token::lexer(prog2_string).unwrap();
        let prog2_parser = crate::parser::Parser::new(prog2_tokens);
        let prog2_digest = prog2_parser.ast().unwrap().compute_digest();

        assert!(prog1_digest != prog2_digest);

        let prog3_string = r#"startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([5, 5], %)
"#;
        let prog3_tokens = crate::token::lexer(prog3_string).unwrap();
        let prog3_parser = crate::parser::Parser::new(prog3_tokens);
        let prog3_digest = prog3_parser.ast().unwrap().compute_digest();

        assert_eq!(prog1_digest, prog3_digest);
    }
}
