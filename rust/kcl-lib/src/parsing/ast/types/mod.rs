//! Data types for the AST.

use std::{
    cell::RefCell,
    collections::{BTreeMap, HashMap},
    fmt,
    ops::{Deref, DerefMut, RangeInclusive},
    rc::Rc,
    sync::{Arc, Mutex},
};

use anyhow::Result;
use parse_display::{Display, FromStr};
pub use path::{NodePath, Step};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{
    Color, ColorInformation, ColorPresentation, CompletionItem, CompletionItemKind, DocumentSymbol, FoldingRange,
    FoldingRangeKind, SymbolKind,
};

pub use crate::parsing::ast::types::{
    condition::{ElseIf, IfExpression},
    literal_value::LiteralValue,
    none::KclNone,
};
use crate::{
    ModuleId, TypedPath,
    errors::KclError,
    execution::{
        KclValue, Metadata, TagIdentifier, annotations,
        types::{ArrayLen, UnitAngle, UnitLen},
    },
    parsing::{PIPE_OPERATOR, ast::digest::Digest, token::NumericSuffix},
    source_range::SourceRange,
};

mod condition;
mod literal_value;
mod none;
mod path;

#[derive(Debug)]
pub enum Definition<'a> {
    Variable(&'a VariableDeclarator),
    Import(NodeRef<'a, ImportStatement>),
    Type(NodeRef<'a, TypeDeclaration>),
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Node<T> {
    #[serde(flatten)]
    pub inner: T,
    pub start: usize,
    pub end: usize,
    pub module_id: ModuleId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outer_attrs: NodeList<Annotation>,
    // Some comments are kept here, some are kept in NonCodeMeta, and some are ignored. See how each
    // node is parsed to check for certain. In any case, only comments which are strongly associated
    // with an item are kept here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pre_comments: Vec<String>,
    pub comment_start: usize,
}

impl<T: JsonSchema> schemars::JsonSchema for Node<T> {
    fn schema_name() -> String {
        T::schema_name()
    }

    fn json_schema(r#gen: &mut schemars::r#gen::SchemaGenerator) -> schemars::schema::Schema {
        let mut child = T::json_schema(r#gen).into_object();
        // We want to add the start and end fields to the schema.
        // Ideally we would add _any_ extra fields from the Node type automatically
        // but this is a bit hard since this isn't a macro.
        let Some(object) = &mut child.object else {
            // This should never happen. But it will panic at compile time of docs if it does.
            // Which is better than runtime.
            panic!("Expected object schema for {}", T::schema_name());
        };
        object.properties.insert("start".to_string(), usize::json_schema(r#gen));
        object.properties.insert("end".to_string(), usize::json_schema(r#gen));

        schemars::schema::Schema::Object(child.clone())
    }
}

impl<T> Node<T> {
    pub fn new(inner: T, start: usize, end: usize, module_id: ModuleId) -> Self {
        Self {
            inner,
            start,
            end,
            module_id,
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: start,
        }
    }

    pub fn new_node(start: usize, end: usize, module_id: ModuleId, inner: T) -> Self {
        Self {
            inner,
            start,
            end,
            module_id,
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: start,
        }
    }

    pub fn no_src(inner: T) -> Self {
        Self {
            inner,
            start: 0,
            end: 0,
            module_id: ModuleId::default(),
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: 0,
        }
    }

    pub fn boxed(inner: T, start: usize, end: usize, module_id: ModuleId) -> BoxNode<T> {
        Box::new(Node {
            inner,
            start,
            end,
            module_id,
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: start,
        })
    }

    fn reset_source(&mut self) {
        self.start = 0;
        self.end = 0;
        self.module_id = ModuleId::default();
        self.comment_start = 0;
    }

    pub fn as_source_range(&self) -> SourceRange {
        SourceRange::new(self.start, self.end, self.module_id)
    }

    pub fn as_source_ranges(&self) -> Vec<SourceRange> {
        vec![self.as_source_range()]
    }

    pub fn metadata(&self) -> Metadata {
        Metadata {
            source_range: SourceRange::new(self.start, self.end, self.module_id),
        }
    }

    pub fn contains(&self, pos: usize) -> bool {
        self.start <= pos && pos <= self.end
    }

    pub(crate) fn contains_range(&self, range: &SourceRange) -> bool {
        self.as_source_range().contains_range(range)
    }

    pub fn map<U>(self, f: impl Fn(T) -> U) -> Node<U> {
        Node {
            inner: f(self.inner),
            start: self.start,
            end: self.end,
            module_id: self.module_id,
            outer_attrs: self.outer_attrs,
            pre_comments: self.pre_comments,
            comment_start: self.comment_start,
        }
    }

    pub fn set_comments(&mut self, comments: Vec<String>, start: usize) {
        self.pre_comments = comments;
        self.comment_start = start;
    }

    pub fn map_ref<'a, U: 'a>(&'a self, f: impl Fn(&'a T) -> U) -> Node<U> {
        Node {
            inner: f(&self.inner),
            start: self.start,
            end: self.end,
            module_id: self.module_id,
            outer_attrs: self.outer_attrs.clone(),
            pre_comments: self.pre_comments.clone(),
            comment_start: self.start,
        }
    }
}

impl<T> Deref for Node<T> {
    type Target = T;

    fn deref(&self) -> &Self::Target {
        &self.inner
    }
}

impl<T> DerefMut for Node<T> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.inner
    }
}

impl<T: fmt::Display> fmt::Display for Node<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.fmt(f)
    }
}

impl<T> From<Node<T>> for SourceRange {
    fn from(v: Node<T>) -> Self {
        Self::new(v.start, v.end, v.module_id)
    }
}

impl<T> From<&Node<T>> for SourceRange {
    fn from(v: &Node<T>) -> Self {
        Self::new(v.start, v.end, v.module_id)
    }
}

impl<T> From<&BoxNode<T>> for SourceRange {
    fn from(v: &BoxNode<T>) -> Self {
        Self::new(v.start, v.end, v.module_id)
    }
}

pub type BoxNode<T> = Box<Node<T>>;
pub type NodeList<T> = Vec<Node<T>>;
pub type NodeRef<'a, T> = &'a Node<T>;

/// A KCL program top level, or function body.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub body: Vec<BodyItem>,
    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shebang: Option<Node<Shebang>>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner_attrs: NodeList<Annotation>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<Program> {
    /// Walk the ast and get all the variables and tags as completion items.
    pub fn completion_items<'a>(&'a self, position: usize) -> Result<Vec<CompletionItem>> {
        let completions = Rc::new(RefCell::new(vec![]));
        crate::walk::walk(self, |node: crate::walk::Node<'a>| {
            let mut findings = completions.borrow_mut();
            match node {
                crate::walk::Node::TagDeclarator(tag) => {
                    findings.push(tag.into());
                }
                crate::walk::Node::VariableDeclaration(variable) => {
                    findings.extend::<Vec<CompletionItem>>((&variable.inner).into());
                }
                crate::walk::Node::ImportStatement(i) => {
                    findings.extend::<Vec<CompletionItem>>((&i.inner).into());
                }
                _ => {}
            }
            Ok::<bool, anyhow::Error>(true)
        })?;
        let mut completions = completions.take();

        if self.body.is_empty() || position <= self.body[0].start() {
            // The cursor is before any items in the body, we can suggest the settings annotation as a completion.
            completions.push(CompletionItem {
                label: "@settings".to_owned(),
                kind: Some(CompletionItemKind::STRUCT),
                detail: Some("Settings attribute".to_owned()),
                insert_text: Some(crate::execution::annotations::settings_completion_text()),
                insert_text_format: Some(tower_lsp::lsp_types::InsertTextFormat::SNIPPET),
                ..CompletionItem::default()
            });
        }
        Ok(completions)
    }

    /// Returns all the lsp symbols in the program.
    pub fn get_lsp_symbols<'a>(&'a self, code: &str) -> Result<Vec<DocumentSymbol>> {
        let symbols = Arc::new(Mutex::new(vec![]));
        crate::walk::walk(self, |node: crate::walk::Node<'a>| {
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
            Ok::<bool, anyhow::Error>(true)
        })?;
        let x = symbols.lock().unwrap();
        Ok(x.clone())
    }

    /// Check the provided Program for any lint findings.
    pub fn lint<'a, RuleT>(&'a self, rule: RuleT) -> Result<Vec<crate::lint::Discovered>>
    where
        RuleT: crate::lint::Rule<'a>,
    {
        let v = Arc::new(Mutex::new(vec![]));
        crate::walk::walk(self, |node: crate::walk::Node<'a>| {
            let mut findings = v.lock().map_err(|_| anyhow::anyhow!("mutex"))?;
            findings.append(&mut rule.check(node, self)?);
            Ok::<bool, anyhow::Error>(true)
        })?;
        let x = v.lock().unwrap();
        Ok(x.clone())
    }

    pub fn lint_all(&self) -> Result<Vec<crate::lint::Discovered>> {
        let rules = vec![
            crate::lint::checks::lint_variables,
            crate::lint::checks::lint_object_properties,
            crate::lint::checks::lint_should_be_default_plane,
            crate::lint::checks::lint_should_be_offset_plane,
        ];

        let mut findings = vec![];
        for rule in rules {
            findings.append(&mut self.lint(rule)?);
        }
        Ok(findings)
    }

    /// Get the annotations for the meta settings from the kcl file.
    pub fn meta_settings(&self) -> Result<Option<crate::execution::MetaSettings>, KclError> {
        for annotation in &self.inner_attrs {
            if annotation.name() == Some(annotations::SETTINGS) {
                let mut meta_settings = crate::execution::MetaSettings::default();
                meta_settings.update_from_annotation(annotation)?;
                return Ok(Some(meta_settings));
            }
        }

        Ok(None)
    }

    pub fn change_default_units(
        &self,
        length_units: Option<UnitLen>,
        angle_units: Option<UnitAngle>,
    ) -> Result<Self, KclError> {
        let mut new_program = self.clone();
        let mut found = false;
        for node in &mut new_program.inner_attrs {
            if node.name() == Some(annotations::SETTINGS) {
                if let Some(len) = length_units {
                    node.inner.add_or_update(
                        annotations::SETTINGS_UNIT_LENGTH,
                        Expr::Name(Box::new(Name::new(&len.to_string()))),
                    );
                }
                if let Some(angle) = angle_units {
                    node.inner.add_or_update(
                        annotations::SETTINGS_UNIT_ANGLE,
                        Expr::Name(Box::new(Name::new(&angle.to_string()))),
                    );
                }

                // Previous source range no longer makes sense, but we want to
                // preserve other things like comments.
                node.reset_source();
                found = true;
                break;
            }
        }

        if !found {
            let mut settings = Annotation::new(annotations::SETTINGS);
            if let Some(len) = length_units {
                settings.inner.add_or_update(
                    annotations::SETTINGS_UNIT_LENGTH,
                    Expr::Name(Box::new(Name::new(&len.to_string()))),
                );
            }
            if let Some(angle) = angle_units {
                settings.inner.add_or_update(
                    annotations::SETTINGS_UNIT_ANGLE,
                    Expr::Name(Box::new(Name::new(&angle.to_string()))),
                );
            }

            new_program.inner_attrs.push(settings);
        }

        Ok(new_program)
    }

    /// Returns true if the given KCL is empty or only contains settings that
    /// would be auto-generated.
    pub fn is_empty_or_only_settings(&self) -> bool {
        if !self.body.is_empty() {
            return false;
        }

        if self.non_code_meta.start_nodes.iter().any(|node| node.is_comment()) {
            return false;
        }

        for item in &self.inner_attrs {
            if item.name() != Some(annotations::SETTINGS) {
                return false;
            }
        }

        true
    }

    /// Find all the color strings in the program.
    /// For example `appearance(color = "#ff0000")`
    /// This is to fulfill the `documentColor` request in LSP.
    pub fn document_color<'a>(&'a self, code: &str) -> Result<Vec<ColorInformation>> {
        let colors = Rc::new(RefCell::new(vec![]));

        let add_color = |literal: &Node<Literal>| {
            // Check if the string is a color.
            if let Some(c) = literal.value.is_color() {
                let source_range = literal.as_source_range();
                // We subtract 1 from either side because of the "'s in the literal.
                let fixed_source_range = SourceRange::new(
                    source_range.start() + 1,
                    source_range.end() - 1,
                    source_range.module_id(),
                );
                let color = ColorInformation {
                    range: fixed_source_range.to_lsp_range(code),
                    color: tower_lsp::lsp_types::Color {
                        red: c.r,
                        green: c.g,
                        blue: c.b,
                        alpha: c.a,
                    },
                };
                if colors.borrow().contains(&color) {
                    return;
                }
                colors.borrow_mut().push(color);
            }
        };

        // The position must be within the variable declaration.
        crate::walk::walk(self, |node: crate::walk::Node<'a>| {
            match node {
                crate::walk::Node::CallExpressionKw(call) => {
                    if call.inner.callee.inner.name.inner.name == "appearance" {
                        for arg in &call.arguments {
                            if let Some(l) = &arg.label {
                                if l.inner.name == "color" {
                                    // Get the value of the argument.
                                    if let Expr::Literal(literal) = &arg.arg {
                                        add_color(literal);
                                    }
                                }
                            }
                        }
                    }
                }
                crate::walk::Node::Literal(literal) => {
                    // Check if the literal is a color.
                    add_color(literal);
                }
                _ => {
                    // Do nothing.
                }
            }
            Ok::<bool, anyhow::Error>(true)
        })?;

        let colors = colors.take();
        Ok(colors)
    }

    /// This is to fulfill the `colorPresentation` request in LSP.
    pub fn color_presentation<'a>(
        &'a self,
        color: &Color,
        pos_start: usize,
        pos_end: usize,
    ) -> Result<Option<ColorPresentation>> {
        let found = Rc::new(RefCell::new(false));
        // Find the literal with the same start and end.
        crate::walk::walk(self, |node: crate::walk::Node<'a>| {
            match node {
                crate::walk::Node::Literal(literal) => {
                    // Account for the quotes in the literal.
                    if (literal.start + 1) == pos_start
                        && (literal.end - 1) == pos_end
                        && literal.value.is_color().is_some()
                    {
                        found.replace(true);
                        return Ok(true);
                    }
                }
                _ => {
                    // Do nothing.
                }
            }
            Ok::<bool, anyhow::Error>(true)
        })?;

        let found = found.take();
        if !found {
            return Ok(None);
        }

        let new_color = csscolorparser::Color::new(color.red, color.green, color.blue, color.alpha);
        Ok(Some(ColorPresentation {
            // The label will be what they replace the color with.
            label: new_color.to_css_hex(),
            text_edit: None,
            additional_text_edits: None,
        }))
    }
}

impl Program {
    #[cfg(test)]
    pub fn empty() -> Node<Self> {
        Node::no_src(Program::default())
    }
    /// Is the last body item an expression?
    pub fn ends_with_expr(&self) -> bool {
        let Some(ref last) = self.body.last() else {
            return false;
        };
        matches!(last, BodyItem::ExpressionStatement(_))
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

    /// Returns an Expr that includes the given character position.
    /// This is a bit more recursive than `get_body_item_for_position`.
    pub fn get_expr_for_position(&self, pos: usize) -> Option<&Expr> {
        let item = self.get_body_item_for_position(pos)?;

        // Recurse over the item.
        match item {
            BodyItem::ImportStatement(_) | BodyItem::TypeDeclaration(_) => None,
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_expr_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
        }
    }

    /// Checks if the ast has any import statements.    
    pub fn has_import_statements(&self) -> bool {
        for item in &self.body {
            if let BodyItem::ImportStatement(_) = item {
                return true;
            }
        }
        false
    }

    pub fn in_comment(&self, pos: usize) -> bool {
        // Check if its in the body.
        if self.non_code_meta.in_comment(pos) {
            return true;
        }

        for item in &self.body {
            let r = item.comment_range();
            if pos >= r.0 && pos < r.1 {
                return true;
            }
            if pos < r.0 {
                break;
            }
        }
        for n in &self.inner_attrs {
            if pos >= n.comment_start && pos < n.start {
                return true;
            }
            if pos < n.comment_start {
                break;
            }
        }

        let item = self.get_body_item_for_position(pos);

        // Recurse over the item.
        let expr = match item {
            Some(BodyItem::ImportStatement(_)) => None,
            Some(BodyItem::ExpressionStatement(expression_statement)) => Some(&expression_statement.expression),
            Some(BodyItem::VariableDeclaration(variable_declaration)) => {
                variable_declaration.get_expr_for_position(pos)
            }
            Some(BodyItem::TypeDeclaration(_)) => None,
            Some(BodyItem::ReturnStatement(return_statement)) => Some(&return_statement.argument),
            None => return false,
        };

        // Check if the expr's non code meta contains the position.
        if let Some(expr) = expr {
            if let Some(non_code_meta) = expr.get_non_code_meta() {
                if non_code_meta.in_comment(pos) {
                    return true;
                }
            }
        }

        false
    }

    // Return all the lsp folding ranges in the program.
    pub fn get_lsp_folding_ranges(&self) -> Vec<FoldingRange> {
        let mut ranges = vec![];
        // We only care about the top level things in the program.
        for item in &self.body {
            match item {
                BodyItem::ImportStatement(_) | BodyItem::TypeDeclaration(_) => continue,
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
                BodyItem::ImportStatement(stmt) => {
                    if let Some(var_old_name) = stmt.rename_symbol(new_name, pos) {
                        old_name = Some(var_old_name);
                        break;
                    }
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if let Some(var_old_name) = variable_declaration.rename_symbol(new_name, pos) {
                        old_name = Some(var_old_name);
                        break;
                    }
                }
                _ => {}
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
                BodyItem::ImportStatement(_) => None, // TODO
                BodyItem::ExpressionStatement(expression_statement) => Some(&mut expression_statement.expression),
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.get_mut_expr_for_position(pos)
                }
                BodyItem::TypeDeclaration(_) => None,
                BodyItem::ReturnStatement(return_statement) => Some(&mut return_statement.argument),
            };

            // Check if we have a function expression.
            if let Some(Expr::FunctionExpression(function_expression)) = &mut value {
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
                BodyItem::ImportStatement(stmt) => {
                    stmt.rename_identifiers(old_name, new_name);
                }
                BodyItem::ExpressionStatement(expression_statement) => {
                    expression_statement.expression.rename_identifiers(old_name, new_name);
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.rename_identifiers(old_name, new_name);
                }
                BodyItem::TypeDeclaration(_) => {}
                BodyItem::ReturnStatement(return_statement) => {
                    return_statement.argument.rename_identifiers(old_name, new_name);
                }
            }
        }
    }

    /// Replace a variable declaration with the given name with a new one.
    pub fn replace_variable(&mut self, name: &str, declarator: Node<VariableDeclarator>) {
        for item in &mut self.body {
            match item {
                BodyItem::ImportStatement(_) => {
                    continue;
                }
                BodyItem::ExpressionStatement(_) => {
                    continue;
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if variable_declaration.declaration.id.name == name {
                        variable_declaration.declaration = declarator;
                        return;
                    }
                }
                BodyItem::TypeDeclaration(_) => {
                    continue;
                }
                BodyItem::ReturnStatement(_) => continue,
            }
        }
    }

    /// Replace a value with the new value, use the source range for matching the exact value.
    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for item in &mut self.body {
            match item {
                BodyItem::ImportStatement(_) => {} // TODO
                BodyItem::ExpressionStatement(expression_statement) => expression_statement
                    .expression
                    .replace_value(source_range, new_value.clone()),
                BodyItem::VariableDeclaration(variable_declaration) => {
                    variable_declaration.replace_value(source_range, new_value.clone())
                }
                BodyItem::TypeDeclaration(_) => {}
                BodyItem::ReturnStatement(return_statement) => {
                    return_statement.argument.replace_value(source_range, new_value.clone())
                }
            }
        }
    }

    /// Get the variable declaration with the given name.
    pub fn get_variable(&self, name: &str) -> Option<Definition<'_>> {
        for item in &self.body {
            match item {
                BodyItem::ImportStatement(stmt) => {
                    if stmt.get_variable(name) {
                        return Some(Definition::Import(stmt));
                    }
                }
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if variable_declaration.declaration.id.name == name {
                        return Some(Definition::Variable(&variable_declaration.declaration));
                    }
                }
                BodyItem::TypeDeclaration(ty_declaration) => {
                    if ty_declaration.name.name == name {
                        return Some(Definition::Type(ty_declaration));
                    }
                }
                BodyItem::ReturnStatement(_return_statement) => continue,
            }
        }

        None
    }
}

/// A shebang.
/// This is a special type of comment that is at the top of the file.
/// It looks like this:
/// ```python,no_run
/// #!/usr/bin/env python
/// ```
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Shebang {
    pub content: String,
}

impl Shebang {
    pub fn new(content: String) -> Self {
        Shebang { content }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BodyItem {
    ImportStatement(BoxNode<ImportStatement>),
    ExpressionStatement(Node<ExpressionStatement>),
    VariableDeclaration(BoxNode<VariableDeclaration>),
    TypeDeclaration(BoxNode<TypeDeclaration>),
    ReturnStatement(Node<ReturnStatement>),
}

impl BodyItem {
    pub fn start(&self) -> usize {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.start,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.start,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.start,
            BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.start,
            BodyItem::ReturnStatement(return_statement) => return_statement.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.end,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.end,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.end,
            BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.end,
            BodyItem::ReturnStatement(return_statement) => return_statement.end,
        }
    }

    pub(crate) fn contains_range(&self, range: &SourceRange) -> bool {
        let item_range = SourceRange::from(self);
        item_range.contains_range(range)
    }

    pub(crate) fn set_attrs(&mut self, attr: NodeList<Annotation>) {
        match self {
            BodyItem::ImportStatement(node) => node.outer_attrs = attr,
            BodyItem::ExpressionStatement(node) => node.outer_attrs = attr,
            BodyItem::VariableDeclaration(node) => node.outer_attrs = attr,
            BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.outer_attrs = attr,
            BodyItem::ReturnStatement(node) => node.outer_attrs = attr,
        }
    }

    pub(crate) fn get_attrs(&self) -> &[Node<Annotation>] {
        match self {
            BodyItem::ImportStatement(node) => &node.outer_attrs,
            BodyItem::ExpressionStatement(node) => &node.outer_attrs,
            BodyItem::VariableDeclaration(node) => &node.outer_attrs,
            BodyItem::TypeDeclaration(ty_declaration) => &ty_declaration.outer_attrs,
            BodyItem::ReturnStatement(node) => &node.outer_attrs,
        }
    }

    pub(crate) fn get_attrs_mut(&mut self) -> &mut [Node<Annotation>] {
        match self {
            BodyItem::ImportStatement(node) => &mut node.outer_attrs,
            BodyItem::ExpressionStatement(node) => &mut node.outer_attrs,
            BodyItem::VariableDeclaration(node) => &mut node.outer_attrs,
            BodyItem::TypeDeclaration(ty_declaration) => &mut ty_declaration.outer_attrs,
            BodyItem::ReturnStatement(node) => &mut node.outer_attrs,
        }
    }

    pub(crate) fn set_comments(&mut self, comments: Vec<String>, start: usize) {
        match self {
            BodyItem::ImportStatement(node) => node.set_comments(comments, start),
            BodyItem::ExpressionStatement(node) => node.set_comments(comments, start),
            BodyItem::VariableDeclaration(node) => node.set_comments(comments, start),
            BodyItem::TypeDeclaration(node) => node.set_comments(comments, start),
            BodyItem::ReturnStatement(node) => node.set_comments(comments, start),
        }
    }

    pub(crate) fn get_comments(&self) -> &[String] {
        match self {
            BodyItem::ImportStatement(node) => &node.pre_comments,
            BodyItem::ExpressionStatement(node) => &node.pre_comments,
            BodyItem::VariableDeclaration(node) => &node.pre_comments,
            BodyItem::TypeDeclaration(node) => &node.pre_comments,
            BodyItem::ReturnStatement(node) => &node.pre_comments,
        }
    }

    pub(crate) fn comment_range(&self) -> (usize, usize) {
        match self {
            BodyItem::ImportStatement(node) => (node.comment_start, node.start),
            BodyItem::ExpressionStatement(node) => (node.comment_start, node.start),
            BodyItem::VariableDeclaration(node) => (node.comment_start, node.start),
            BodyItem::TypeDeclaration(node) => (node.comment_start, node.start),
            BodyItem::ReturnStatement(node) => (node.comment_start, node.start),
        }
    }

    pub(crate) fn visibility(&self) -> ItemVisibility {
        match self {
            BodyItem::ImportStatement(node) => node.visibility,
            BodyItem::VariableDeclaration(node) => node.visibility,
            BodyItem::TypeDeclaration(node) => node.visibility,
            BodyItem::ExpressionStatement(_) | BodyItem::ReturnStatement(_) => ItemVisibility::Default,
        }
    }
}

impl From<BodyItem> for SourceRange {
    fn from(item: BodyItem) -> Self {
        Self::new(item.start(), item.end(), item.module_id())
    }
}

impl From<&BodyItem> for SourceRange {
    fn from(item: &BodyItem) -> Self {
        Self::new(item.start(), item.end(), item.module_id())
    }
}

/// An expression can be evaluated to yield a single KCL value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum Expr {
    Literal(BoxNode<Literal>),
    Name(BoxNode<Name>),
    TagDeclarator(BoxNode<TagDeclarator>),
    BinaryExpression(BoxNode<BinaryExpression>),
    FunctionExpression(BoxNode<FunctionExpression>),
    CallExpressionKw(BoxNode<CallExpressionKw>),
    PipeExpression(BoxNode<PipeExpression>),
    PipeSubstitution(BoxNode<PipeSubstitution>),
    ArrayExpression(BoxNode<ArrayExpression>),
    ArrayRangeExpression(BoxNode<ArrayRangeExpression>),
    ObjectExpression(BoxNode<ObjectExpression>),
    MemberExpression(BoxNode<MemberExpression>),
    UnaryExpression(BoxNode<UnaryExpression>),
    IfExpression(BoxNode<IfExpression>),
    LabelledExpression(BoxNode<LabelledExpression>),
    AscribedExpression(BoxNode<AscribedExpression>),
    None(Node<KclNone>),
}

impl Expr {
    pub fn get_lsp_folding_range(&self) -> Option<FoldingRange> {
        let recasted = self.recast(&FormatOptions::default(), 0, crate::unparser::ExprContext::Other);
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
            Expr::ArrayRangeExpression(_array_exp) => None,
            Expr::ObjectExpression(_obj_exp) => None,
            Expr::MemberExpression(_mem_exp) => None,
            Expr::Literal(_literal) => None,
            Expr::FunctionExpression(_func_exp) => None,
            Expr::CallExpressionKw(_call_exp) => None,
            Expr::Name(_ident) => None,
            Expr::TagDeclarator(_tag) => None,
            Expr::PipeExpression(pipe_exp) => Some(&pipe_exp.non_code_meta),
            Expr::UnaryExpression(_unary_exp) => None,
            Expr::PipeSubstitution(_pipe_substitution) => None,
            Expr::IfExpression(_) => None,
            Expr::LabelledExpression(expr) => expr.expr.get_non_code_meta(),
            Expr::AscribedExpression(expr) => expr.expr.get_non_code_meta(),
            Expr::None(_none) => None,
        }
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        if source_range == self.clone().into() {
            *self = new_value;
            return;
        }

        match self {
            Expr::BinaryExpression(bin_exp) => bin_exp.replace_value(source_range, new_value),
            Expr::ArrayExpression(array_exp) => array_exp.replace_value(source_range, new_value),
            Expr::ArrayRangeExpression(array_range) => array_range.replace_value(source_range, new_value),
            Expr::ObjectExpression(obj_exp) => obj_exp.replace_value(source_range, new_value),
            Expr::MemberExpression(_) => {}
            Expr::Literal(_) => {}
            Expr::FunctionExpression(func_exp) => func_exp.replace_value(source_range, new_value),
            Expr::CallExpressionKw(call_exp) => call_exp.replace_value(source_range, new_value),
            Expr::Name(_) => {}
            Expr::TagDeclarator(_) => {}
            Expr::PipeExpression(pipe_exp) => pipe_exp.replace_value(source_range, new_value),
            Expr::UnaryExpression(unary_exp) => unary_exp.replace_value(source_range, new_value),
            Expr::IfExpression(_) => {}
            Expr::PipeSubstitution(_) => {}
            Expr::LabelledExpression(expr) => expr.expr.replace_value(source_range, new_value),
            Expr::AscribedExpression(expr) => expr.expr.replace_value(source_range, new_value),
            Expr::None(_) => {}
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.start,
            Expr::Name(identifier) => identifier.start,
            Expr::TagDeclarator(tag) => tag.start,
            Expr::BinaryExpression(binary_expression) => binary_expression.start,
            Expr::FunctionExpression(function_expression) => function_expression.start,
            Expr::CallExpressionKw(call_expression) => call_expression.start,
            Expr::PipeExpression(pipe_expression) => pipe_expression.start,
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.start,
            Expr::ArrayExpression(array_expression) => array_expression.start,
            Expr::ArrayRangeExpression(array_range) => array_range.start,
            Expr::ObjectExpression(object_expression) => object_expression.start,
            Expr::MemberExpression(member_expression) => member_expression.start,
            Expr::UnaryExpression(unary_expression) => unary_expression.start,
            Expr::IfExpression(expr) => expr.start,
            Expr::LabelledExpression(expr) => expr.start,
            Expr::AscribedExpression(expr) => expr.start,
            Expr::None(none) => none.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.end,
            Expr::Name(identifier) => identifier.end,
            Expr::TagDeclarator(tag) => tag.end,
            Expr::BinaryExpression(binary_expression) => binary_expression.end,
            Expr::FunctionExpression(function_expression) => function_expression.end,
            Expr::CallExpressionKw(call_expression) => call_expression.end,
            Expr::PipeExpression(pipe_expression) => pipe_expression.end,
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.end,
            Expr::ArrayExpression(array_expression) => array_expression.end,
            Expr::ArrayRangeExpression(array_range) => array_range.end,
            Expr::ObjectExpression(object_expression) => object_expression.end,
            Expr::MemberExpression(member_expression) => member_expression.end,
            Expr::UnaryExpression(unary_expression) => unary_expression.end,
            Expr::IfExpression(expr) => expr.end,
            Expr::LabelledExpression(expr) => expr.end,
            Expr::AscribedExpression(expr) => expr.end,
            Expr::None(none) => none.end,
        }
    }

    fn contains_range(&self, range: &SourceRange) -> bool {
        let expr_range = SourceRange::from(self);
        expr_range.contains_range(range)
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            Expr::Literal(_literal) => {}
            Expr::Name(identifier) => identifier.rename(old_name, new_name),
            Expr::TagDeclarator(tag) => tag.rename(old_name, new_name),
            Expr::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            Expr::FunctionExpression(_function_identifier) => {}
            Expr::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Expr::PipeExpression(pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Expr::PipeSubstitution(_) => {}
            Expr::ArrayExpression(array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Expr::ArrayRangeExpression(array_range) => array_range.rename_identifiers(old_name, new_name),
            Expr::ObjectExpression(object_expression) => object_expression.rename_identifiers(old_name, new_name),
            Expr::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            Expr::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            Expr::IfExpression(expr) => expr.rename_identifiers(old_name, new_name),
            Expr::LabelledExpression(expr) => expr.expr.rename_identifiers(old_name, new_name),
            Expr::AscribedExpression(expr) => expr.expr.rename_identifiers(old_name, new_name),
            Expr::None(_) => {}
        }
    }

    /// Get the constraint level for an expression.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match self {
            Expr::Literal(literal) => literal.get_constraint_level(),
            Expr::Name(identifier) => identifier.get_constraint_level(),
            Expr::TagDeclarator(tag) => tag.get_constraint_level(),
            Expr::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),

            Expr::FunctionExpression(function_identifier) => function_identifier.get_constraint_level(),
            Expr::CallExpressionKw(call_expression) => call_expression.get_constraint_level(),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_constraint_level(),
            Expr::PipeSubstitution(pipe_substitution) => ConstraintLevel::Ignore {
                source_ranges: vec![pipe_substitution.into()],
            },
            Expr::ArrayExpression(array_expression) => array_expression.get_constraint_level(),
            Expr::ArrayRangeExpression(array_range) => array_range.get_constraint_level(),
            Expr::ObjectExpression(object_expression) => object_expression.get_constraint_level(),
            Expr::MemberExpression(member_expression) => member_expression.get_constraint_level(),
            Expr::UnaryExpression(unary_expression) => unary_expression.get_constraint_level(),
            Expr::IfExpression(expr) => expr.get_constraint_level(),
            Expr::LabelledExpression(expr) => expr.expr.get_constraint_level(),
            Expr::AscribedExpression(expr) => expr.expr.get_constraint_level(),
            Expr::None(none) => none.get_constraint_level(),
        }
    }

    pub fn literal_bool(&self) -> Option<bool> {
        match self {
            Expr::Literal(lit) => match lit.value {
                LiteralValue::Bool(b) => Some(b),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn literal_num(&self) -> Option<(f64, NumericSuffix)> {
        match self {
            Expr::Literal(lit) => match lit.value {
                LiteralValue::Number { value, suffix } => Some((value, suffix)),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn literal_str(&self) -> Option<&str> {
        match self {
            Expr::Literal(lit) => match &lit.value {
                LiteralValue::String(s) => Some(s),
                _ => None,
            },
            _ => None,
        }
    }

    pub fn ident_name(&self) -> Option<&str> {
        match self {
            Expr::Name(name) => name.local_ident().map(|n| n.inner),
            _ => None,
        }
    }
}

impl From<Expr> for SourceRange {
    fn from(value: Expr) -> Self {
        Self::new(value.start(), value.end(), value.module_id())
    }
}

impl From<&Expr> for SourceRange {
    fn from(value: &Expr) -> Self {
        Self::new(value.start(), value.end(), value.module_id())
    }
}

impl From<&BinaryPart> for Expr {
    fn from(value: &BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(literal) => Expr::Literal(literal.clone()),
            BinaryPart::Name(name) => Expr::Name(name.clone()),
            BinaryPart::BinaryExpression(binary_expression) => Expr::BinaryExpression(binary_expression.clone()),
            BinaryPart::CallExpressionKw(call_expression) => Expr::CallExpressionKw(call_expression.clone()),
            BinaryPart::UnaryExpression(unary_expression) => Expr::UnaryExpression(unary_expression.clone()),
            BinaryPart::MemberExpression(member_expression) => Expr::MemberExpression(member_expression.clone()),
            BinaryPart::ArrayExpression(e) => Expr::ArrayExpression(e.clone()),
            BinaryPart::ArrayRangeExpression(e) => Expr::ArrayRangeExpression(e.clone()),
            BinaryPart::ObjectExpression(e) => Expr::ObjectExpression(e.clone()),
            BinaryPart::IfExpression(e) => Expr::IfExpression(e.clone()),
            BinaryPart::AscribedExpression(e) => Expr::AscribedExpression(e.clone()),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct LabelledExpression {
    pub expr: Expr,
    pub label: Node<Identifier>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl LabelledExpression {
    pub(crate) fn new(expr: Expr, label: Node<Identifier>) -> Node<LabelledExpression> {
        let start = expr.start();
        let end = label.end;
        let module_id = expr.module_id();
        Node::new(
            LabelledExpression {
                expr,
                label,
                digest: None,
            },
            start,
            end,
            module_id,
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct AscribedExpression {
    pub expr: Expr,
    pub ty: Node<Type>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl AscribedExpression {
    pub(crate) fn new(expr: Expr, ty: Node<Type>) -> Node<AscribedExpression> {
        let start = expr.start();
        let end = ty.end;
        let module_id = expr.module_id();
        Node::new(AscribedExpression { expr, ty, digest: None }, start, end, module_id)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(BoxNode<Literal>),
    Name(BoxNode<Name>),
    BinaryExpression(BoxNode<BinaryExpression>),
    CallExpressionKw(BoxNode<CallExpressionKw>),
    UnaryExpression(BoxNode<UnaryExpression>),
    MemberExpression(BoxNode<MemberExpression>),
    ArrayExpression(BoxNode<ArrayExpression>),
    ArrayRangeExpression(BoxNode<ArrayRangeExpression>),
    ObjectExpression(BoxNode<ObjectExpression>),
    IfExpression(BoxNode<IfExpression>),
    AscribedExpression(BoxNode<AscribedExpression>),
}

impl From<BinaryPart> for SourceRange {
    fn from(value: BinaryPart) -> Self {
        Self::new(value.start(), value.end(), value.module_id())
    }
}

impl From<&BinaryPart> for SourceRange {
    fn from(value: &BinaryPart) -> Self {
        Self::new(value.start(), value.end(), value.module_id())
    }
}

impl BinaryPart {
    /// Get the constraint level.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match self {
            BinaryPart::Literal(literal) => literal.get_constraint_level(),
            BinaryPart::Name(identifier) => identifier.get_constraint_level(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.get_constraint_level(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_constraint_level(),
            BinaryPart::MemberExpression(member_expression) => member_expression.get_constraint_level(),
            BinaryPart::ArrayExpression(e) => e.get_constraint_level(),
            BinaryPart::ArrayRangeExpression(e) => e.get_constraint_level(),
            BinaryPart::ObjectExpression(e) => e.get_constraint_level(),
            BinaryPart::IfExpression(e) => e.get_constraint_level(),
            BinaryPart::AscribedExpression(e) => e.expr.get_constraint_level(),
        }
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        match self {
            BinaryPart::Literal(_) => {}
            BinaryPart::Name(_) => {}
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.replace_value(source_range, new_value),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.replace_value(source_range, new_value),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.replace_value(source_range, new_value),
            BinaryPart::MemberExpression(_) => {}
            BinaryPart::ArrayExpression(e) => e.replace_value(source_range, new_value),
            BinaryPart::ArrayRangeExpression(e) => e.replace_value(source_range, new_value),
            BinaryPart::ObjectExpression(e) => e.replace_value(source_range, new_value),
            BinaryPart::IfExpression(e) => e.replace_value(source_range, new_value),
            BinaryPart::AscribedExpression(e) => e.expr.replace_value(source_range, new_value),
        }
    }

    pub fn start(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.start,
            BinaryPart::Name(identifier) => identifier.start,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.start,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.start,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.start,
            BinaryPart::MemberExpression(member_expression) => member_expression.start,
            BinaryPart::ArrayExpression(e) => e.start,
            BinaryPart::ArrayRangeExpression(e) => e.start,
            BinaryPart::ObjectExpression(e) => e.start,
            BinaryPart::IfExpression(e) => e.start,
            BinaryPart::AscribedExpression(e) => e.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.end,
            BinaryPart::Name(identifier) => identifier.end,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.end,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.end,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.end,
            BinaryPart::MemberExpression(member_expression) => member_expression.end,
            BinaryPart::ArrayExpression(e) => e.end,
            BinaryPart::ArrayRangeExpression(e) => e.end,
            BinaryPart::ObjectExpression(e) => e.end,
            BinaryPart::IfExpression(e) => e.end,
            BinaryPart::AscribedExpression(e) => e.end,
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            BinaryPart::Literal(_literal) => {}
            BinaryPart::Name(identifier) => identifier.rename(old_name, new_name),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayRangeExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ObjectExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::IfExpression(if_expression) => if_expression.rename_identifiers(old_name, new_name),
            BinaryPart::AscribedExpression(e) => e.expr.rename_identifiers(old_name, new_name),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NonCodeNode {
    pub value: NonCodeValue,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl NonCodeNode {
    #[cfg(test)]
    pub fn value(&self) -> String {
        match &self.value {
            NonCodeValue::InlineComment { value, style: _ } => value.clone(),
            NonCodeValue::BlockComment { value, style: _ } => value.clone(),
            NonCodeValue::NewLineBlockComment { value, style: _ } => value.clone(),
            NonCodeValue::NewLine => "\n\n".to_string(),
        }
    }

    fn is_comment(&self) -> bool {
        matches!(
            self.value,
            NonCodeValue::InlineComment { .. }
                | NonCodeValue::BlockComment { .. }
                | NonCodeValue::NewLineBlockComment { .. }
        )
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum CommentStyle {
    /// Like // foo
    Line,
    /// Like /* foo */
    Block,
}

impl CommentStyle {
    pub fn render_comment(&self, comment: &str) -> String {
        match self {
            CommentStyle::Line => {
                let comment = comment.trim();
                let mut result = "//".to_owned();
                if !comment.is_empty() && !comment.starts_with('/') {
                    result.push(' ');
                }
                result.push_str(comment);
                result
            }
            CommentStyle::Block => format!("/* {comment} */"),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
#[allow(clippy::large_enum_variant)]
pub enum NonCodeValue {
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
    /// ```no_run
    /// /* This is a
    /// block comment */
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

#[derive(Debug, Default, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NonCodeMeta {
    pub non_code_nodes: BTreeMap<usize, NodeList<NonCodeNode>>,
    pub start_nodes: NodeList<NonCodeNode>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl NonCodeMeta {
    /// Does this contain anything?
    pub fn is_empty(&self) -> bool {
        self.non_code_nodes.is_empty() && self.start_nodes.is_empty()
    }

    /// How many non-code values does this have?
    pub fn non_code_nodes_len(&self) -> usize {
        self.non_code_nodes.values().map(|x| x.len()).sum()
    }

    pub fn insert(&mut self, i: usize, new: Node<NonCodeNode>) {
        self.non_code_nodes.entry(i).or_default().push(new);
    }

    pub fn in_comment(&self, pos: usize) -> bool {
        if self
            .start_nodes
            .iter()
            .filter(|node| node.is_comment())
            .any(|node| node.contains(pos))
        {
            return true;
        }

        self.non_code_nodes.iter().any(|(_, nodes)| {
            nodes
                .iter()
                .filter(|node| node.is_comment())
                .any(|node| node.contains(pos))
        })
    }

    /// Get the non-code meta immediately before the ith node in the AST that self is attached to.
    ///
    /// Returns an empty slice if there is no non-code metadata associated with the node.
    pub fn get(&self, i: usize) -> &[Node<NonCodeNode>] {
        if i == 0 {
            &self.start_nodes
        } else if let Some(meta) = self.non_code_nodes.get(&(i - 1)) {
            meta
        } else {
            &[]
        }
    }
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
            non_code_nodes: HashMap<String, NodeList<NonCodeNode>>,
            start_nodes: NodeList<NonCodeNode>,
        }

        let helper = NonCodeMetaHelper::deserialize(deserializer)?;
        let non_code_nodes = helper
            .non_code_nodes
            .into_iter()
            .map(|(key, value)| Ok((key.parse().map_err(serde::de::Error::custom)?, value)))
            .collect::<Result<BTreeMap<_, _>, _>>()?;
        Ok(NonCodeMeta {
            non_code_nodes,
            start_nodes: helper.start_nodes,
            digest: None,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Annotation {
    pub name: Option<Node<Identifier>>,
    pub properties: Option<Vec<Node<ObjectProperty>>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Annotation {
    // Creates a named annotation with an empty (but present) property list, `@name()`.
    pub fn new(name: &str) -> Node<Self> {
        Node::no_src(Annotation {
            name: Some(Identifier::new(name)),
            properties: Some(vec![]),
            digest: None,
        })
    }

    pub fn is_inner(&self) -> bool {
        self.name.is_some()
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_ref().map(|n| &*n.name)
    }

    pub(crate) fn add_or_update(&mut self, label: &str, value: Expr) {
        match &mut self.properties {
            Some(props) => match props.iter_mut().find(|p| p.key.name == label) {
                Some(p) => {
                    p.value = value;
                    p.digest = None;
                }
                None => props.push(ObjectProperty::new(Identifier::new(label), value)),
            },
            None => self.properties = Some(vec![ObjectProperty::new(Identifier::new(label), value)]),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ImportItem {
    /// Name of the item to import.
    pub name: Node<Identifier>,
    /// Rename the item using an identifier after `as`.
    pub alias: Option<Node<Identifier>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<ImportItem> {
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        match &mut self.alias {
            Some(alias) => {
                let alias_source_range = SourceRange::from(&*alias);
                if !alias_source_range.contains(pos) {
                    return None;
                }
                let old_name = std::mem::replace(&mut alias.name, new_name.to_owned());
                Some(old_name)
            }
            None => {
                let use_source_range = SourceRange::from(&*self);
                if use_source_range.contains(pos) {
                    self.alias = Some(Identifier::new(new_name));
                }
                // Return implicit name.
                Some(self.identifier().to_owned())
            }
        }
    }
}

impl ImportItem {
    pub fn identifier(&self) -> &str {
        match &self.alias {
            Some(alias) => &alias.name,
            None => &self.name.name,
        }
    }

    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        if let Some(alias) = &mut self.alias {
            alias.rename(old_name, new_name);
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum ImportSelector {
    /// A comma-separated list of names and possible aliases to import (may be a single item, but never zero).
    /// E.g., `import bar as baz from "foo.kcl"`
    List { items: NodeList<ImportItem> },
    /// Import all public items from a module.
    /// E.g., `import * from "foo.kcl"`
    Glob(Node<()>),
    /// Import the module itself (the param is an optional alias).
    /// E.g., `import "foo.kcl" as bar`
    None { alias: Option<Node<Identifier>> },
}

impl ImportSelector {
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        match self {
            ImportSelector::List { items } => {
                for item in items {
                    let source_range = SourceRange::from(&*item);
                    if source_range.contains(pos) {
                        let old_name = item.rename_symbol(new_name, pos);
                        if old_name.is_some() {
                            return old_name;
                        }
                    }
                }
                None
            }
            ImportSelector::Glob(_) => None,
            ImportSelector::None { alias: None } => None,
            ImportSelector::None { alias: Some(alias) } => {
                let alias_source_range = SourceRange::from(&*alias);
                if !alias_source_range.contains(pos) {
                    return None;
                }
                let old_name = std::mem::replace(&mut alias.name, new_name.to_owned());
                Some(old_name)
            }
        }
    }

    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        match self {
            ImportSelector::List { items } => {
                for item in items {
                    item.rename_identifiers(old_name, new_name);
                }
            }
            ImportSelector::Glob(_) => {}
            ImportSelector::None { alias: None } => {}
            ImportSelector::None { alias: Some(alias) } => alias.rename(old_name, new_name),
        }
    }

    pub fn exposes_imported_name(&self) -> bool {
        matches!(self, ImportSelector::None { alias: None })
    }

    pub fn imports_items(&self) -> bool {
        !matches!(self, ImportSelector::None { .. })
    }
}

#[derive(Clone, Eq, PartialEq, Debug, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum ImportPath {
    Kcl { filename: TypedPath },
    Foreign { path: TypedPath },
    Std { path: Vec<String> },
}

impl fmt::Display for ImportPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ImportPath::Kcl { filename: s } | ImportPath::Foreign { path: s } => write!(f, "{s}"),
            ImportPath::Std { path } => write!(f, "{}", path.join("::")),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ImportStatement {
    pub selector: ImportSelector,
    pub path: ImportPath,
    #[serde(default, skip_serializing_if = "ItemVisibility::is_default")]
    pub visibility: ItemVisibility,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<ImportStatement> {
    pub fn get_variable(&self, name: &str) -> bool {
        match &self.selector {
            ImportSelector::List { items } => {
                for import_item in items {
                    if import_item.identifier() == name {
                        return true;
                    }
                }
                false
            }
            ImportSelector::Glob(_) => false,
            ImportSelector::None { .. } => name == self.module_name().unwrap(),
        }
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }

    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        self.selector.rename_symbol(new_name, pos)
    }
}

impl ImportStatement {
    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.selector.rename_identifiers(old_name, new_name);
    }

    /// Get the name of the module object for this import.
    /// Validated during parsing and guaranteed to return `Some` if the statement imports
    /// the module itself (i.e., self.selector is ImportSelector::None).
    pub fn module_name(&self) -> Option<String> {
        if let ImportSelector::None { alias: Some(alias) } = &self.selector {
            return Some(alias.name.clone());
        }

        match &self.path {
            ImportPath::Kcl { filename: s } | ImportPath::Foreign { path: s } => {
                let name = s.to_string_lossy();
                if name.ends_with("/main.kcl") || name.ends_with("\\main.kcl") {
                    let name = &name[..name.len() - 9];
                    let start = name.rfind(['/', '\\']).map(|s| s + 1).unwrap_or(0);
                    return Some(name[start..].to_owned());
                }

                let name = s.file_name().map(|f| f.to_string())?;
                if name.contains('\\') || name.contains('/') {
                    return None;
                }

                // Remove the extension if it exists.
                let extension = s.extension();
                Some(if let Some(extension) = extension {
                    name.trim_end_matches(extension).trim_end_matches('.').to_string()
                } else {
                    name
                })
            }
            ImportPath::Std { path } => path.last().cloned(),
        }
    }
}

impl From<&ImportStatement> for Vec<CompletionItem> {
    fn from(import: &ImportStatement) -> Self {
        match &import.selector {
            ImportSelector::List { items } => {
                items
                    .iter()
                    .map(|i| {
                        let as_str = match &i.alias {
                            Some(s) => format!(" as {}", s.name),
                            None => String::new(),
                        };
                        CompletionItem {
                            label: i.identifier().to_owned(),
                            // TODO we can only find this after opening the module
                            kind: None,
                            detail: Some(format!("{}{as_str} from '{}'", i.name.name, import.path)),
                            ..CompletionItem::default()
                        }
                    })
                    .collect()
            }
            // TODO can't do completion for glob imports without static name resolution
            ImportSelector::Glob(_) => vec![],
            ImportSelector::None { .. } => vec![CompletionItem {
                label: import.module_name().unwrap(),
                kind: Some(CompletionItemKind::MODULE),
                detail: Some(format!("from '{}'", import.path)),
                ..CompletionItem::default()
            }],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub expression: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct CallExpressionKw {
    pub callee: Node<Name>,
    pub unlabeled: Option<Expr>,
    pub arguments: Vec<LabeledArg>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,

    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct LabeledArg {
    pub label: Option<Node<Identifier>>,
    pub arg: Expr,
}

impl From<Node<CallExpressionKw>> for Expr {
    fn from(call_expression: Node<CallExpressionKw>) -> Self {
        Expr::CallExpressionKw(Box::new(call_expression))
    }
}

impl Node<CallExpressionKw> {
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
            constraint_levels.push(arg.arg.get_constraint_level());
        }

        constraint_levels.get_constraint_level(self.into())
    }
}

impl CallExpressionKw {
    pub fn new(name: &str, unlabeled: Option<Expr>, arguments: Vec<LabeledArg>) -> Result<Node<Self>, KclError> {
        Ok(Node::no_src(Self {
            callee: Name::new(name),
            unlabeled,
            arguments,
            digest: None,
            non_code_meta: Default::default(),
        }))
    }

    /// Iterate over all arguments (labeled or not)
    pub fn iter_arguments(&self) -> impl Iterator<Item = (Option<&Node<Identifier>>, &Expr)> {
        self.unlabeled
            .iter()
            .map(|e| (None, e))
            .chain(self.arguments.iter().map(|arg| (arg.label.as_ref(), &arg.arg)))
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        if let Some(unlabeled) = &mut self.unlabeled {
            unlabeled.replace_value(source_range, new_value.clone());
        }

        for arg in &mut self.arguments {
            arg.arg.replace_value(source_range, new_value.clone());
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.callee.rename(old_name, new_name);

        if let Some(unlabeled) = &mut self.unlabeled {
            unlabeled.rename_identifiers(old_name, new_name);
        }

        for arg in &mut self.arguments {
            arg.arg.rename_identifiers(old_name, new_name);
        }
    }
}

#[derive(Debug, Default, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum ItemVisibility {
    #[default]
    Default,
    Export,
}

impl ItemVisibility {
    pub fn is_default(&self) -> bool {
        matches!(self, Self::Default)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct TypeDeclaration {
    pub name: Node<Identifier>,
    pub args: Option<NodeList<Identifier>>,
    #[serde(default, skip_serializing_if = "ItemVisibility::is_default")]
    pub visibility: ItemVisibility,
    pub alias: Option<Node<Type>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl TypeDeclaration {
    pub(crate) fn name(&self) -> &str {
        &self.name.name
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclaration {
    pub declaration: Node<VariableDeclarator>,
    #[serde(default, skip_serializing_if = "ItemVisibility::is_default")]
    pub visibility: ItemVisibility,
    pub kind: VariableKind, // Change to enum if there are specific values

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl From<&VariableDeclaration> for Vec<CompletionItem> {
    fn from(declaration: &VariableDeclaration) -> Self {
        vec![CompletionItem {
            label: declaration.declaration.id.name.to_string(),
            kind: Some(match declaration.kind {
                VariableKind::Const => CompletionItemKind::CONSTANT,
                VariableKind::Fn => CompletionItemKind::FUNCTION,
            }),
            detail: Some(declaration.kind.to_string()),
            ..CompletionItem::default()
        }]
    }
}

impl Node<VariableDeclaration> {
    pub fn get_lsp_folding_range(&self) -> Option<FoldingRange> {
        let recasted = self.recast(&FormatOptions::default(), 0);
        // If the recasted value only has one line, don't fold it.
        if recasted.lines().count() <= 1 {
            return None;
        }

        // This unwrap is safe because we know that the code has at least one line.
        let first_line = recasted.lines().next().unwrap().to_string();

        Some(FoldingRange {
            start_line: (self.start + first_line.len()) as u32,
            start_character: None,
            end_line: self.end as u32,
            end_character: None,
            kind: Some(FoldingRangeKind::Region),
            collapsed_text: Some(first_line),
        })
    }

    /// Rename the variable declaration at the given position.
    /// This returns the old name of the variable, if it found one.
    pub fn rename_symbol(&mut self, new_name: &str, pos: usize) -> Option<String> {
        // The position must be within the variable declaration.
        let source_range: SourceRange = self.clone().into();
        if !source_range.contains(pos) {
            return None;
        }

        let declaration_source_range: SourceRange = self.declaration.id.clone().into();
        if declaration_source_range.contains(pos) {
            let old_name = self.declaration.id.name.clone();
            self.declaration.id.name = new_name.to_string();
            return Some(old_name);
        }

        None
    }
}

impl VariableDeclaration {
    pub fn new(declaration: Node<VariableDeclarator>, visibility: ItemVisibility, kind: VariableKind) -> Self {
        Self {
            declaration,
            visibility,
            kind,
            digest: None,
        }
    }

    pub(crate) fn name(&self) -> &str {
        &self.declaration.id.name
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.declaration.init.replace_value(source_range, new_value.clone());
    }

    /// Returns an Expr that includes the given character position.
    pub fn get_expr_for_position(&self, pos: usize) -> Option<&Expr> {
        let source_range: SourceRange = self.declaration.clone().into();
        if source_range.contains(pos) {
            return Some(&self.declaration.init);
        }

        None
    }

    /// Returns an Expr that includes the given character position.
    pub fn get_mut_expr_for_position(&mut self, pos: usize) -> Option<&mut Expr> {
        let source_range: SourceRange = self.declaration.clone().into();
        if source_range.contains(pos) {
            return Some(&mut self.declaration.init);
        }

        None
    }

    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        // Skip the init for the variable with the new name since it is the one we are renaming.
        if self.declaration.id.name != new_name {
            self.declaration.init.rename_identifiers(old_name, new_name);
        }
    }

    pub fn get_lsp_symbols(&self, code: &str) -> Vec<DocumentSymbol> {
        let source_range: SourceRange = self.declaration.clone().into();
        let inner_source_range: SourceRange = self.declaration.id.clone().into();

        let mut symbol_kind = match self.kind {
            VariableKind::Fn => SymbolKind::FUNCTION,
            VariableKind::Const => SymbolKind::CONSTANT,
        };

        let children = match &self.declaration.init {
            Expr::FunctionExpression(function_expression) => {
                symbol_kind = SymbolKind::FUNCTION;
                let mut children = vec![];
                for param in &function_expression.params {
                    let param_source_range: SourceRange = (&param.identifier).into();
                    #[allow(deprecated)]
                    children.push(DocumentSymbol {
                        name: param.identifier.name.clone(),
                        detail: None,
                        kind: SymbolKind::CONSTANT,
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

        vec![
            #[allow(deprecated)]
            DocumentSymbol {
                name: self.declaration.id.name.clone(),
                detail: Some(self.kind.to_string()),
                kind: symbol_kind,
                range: source_range.to_lsp_range(code),
                selection_range: inner_source_range.to_lsp_range(code),
                children: Some(children),
                tags: None,
                deprecated: None,
            },
        ]
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, FromStr, Display)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
#[display(style = "snake_case")]
pub enum VariableKind {
    /// Declare a named constant.
    Const,
    /// Declare a function.
    Fn,
}

impl VariableKind {
    pub fn to_completion_items() -> Vec<CompletionItem> {
        fn completion_item(keyword: &str, description: &str) -> CompletionItem {
            CompletionItem {
                label: keyword.to_owned(),
                label_details: None,
                kind: Some(CompletionItemKind::KEYWORD),
                detail: Some(description.to_owned()),
                documentation: Some(tower_lsp::lsp_types::Documentation::MarkupContent(
                    tower_lsp::lsp_types::MarkupContent {
                        kind: tower_lsp::lsp_types::MarkupKind::Markdown,
                        value: description.to_owned(),
                    },
                )),
                deprecated: Some(false),
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

        vec![completion_item("fn", "Declare a function.")]
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclarator {
    /// The identifier of the variable.
    pub id: Node<Identifier>,
    /// The value of the variable.
    pub init: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl VariableDeclarator {
    pub fn new(name: &str, init: Expr) -> Node<Self> {
        Node::no_src(Self {
            id: Identifier::new(name),
            init,
            digest: None,
        })
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        self.init.get_constraint_level()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Literal {
    pub value: LiteralValue,
    pub raw: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<Literal> {
    /// Get the constraint level for this literal.
    /// Literals are always not constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: vec![self.into()],
        }
    }
}

impl Literal {
    pub fn new(value: LiteralValue) -> Node<Self> {
        Node::no_src(Self {
            raw: value.to_string(),
            value,
            digest: None,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Identifier {
    pub name: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<Identifier> {
    /// Get the constraint level for this identifier.
    /// Identifier are always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }
}

impl Identifier {
    pub fn new(name: &str) -> Node<Self> {
        Node::no_src(Self {
            name: name.to_string(),
            digest: None,
        })
    }

    pub fn is_nameable(&self) -> bool {
        !self.name.starts_with('_')
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if self.name == old_name {
            self.name = new_name.to_string();
        }
    }
}

/// A qualified name, e.g., `foo`, `bar::foo`, or `::bar::foo`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Name {
    pub name: Node<Identifier>,
    // The qualifying parts of the name.
    pub path: NodeList<Identifier>,
    // The path starts with `::`.
    pub abs_path: bool,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<Name> {
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match &*self.name.name {
            "XY" | "XZ" | "YZ" => ConstraintLevel::None {
                source_ranges: vec![self.into()],
            },
            _ => ConstraintLevel::Full {
                source_ranges: vec![self.into()],
            },
        }
    }
}

impl Name {
    pub fn new(name: &str) -> Node<Self> {
        Node::no_src(Name {
            name: Node::no_src(Identifier {
                name: name.to_string(),
                digest: None,
            }),
            path: Vec::new(),
            abs_path: false,
            digest: None,
        })
    }

    pub fn local_ident(&self) -> Option<Node<&str>> {
        if self.path.is_empty() && !self.abs_path {
            Some(self.name.map_ref(|n| &*n.name))
        } else {
            None
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if let Some(n) = self.local_ident() {
            if n.inner == old_name {
                self.name.name = new_name.to_owned();
            }
        }
    }
}

impl From<Node<Identifier>> for Node<Name> {
    fn from(value: Node<Identifier>) -> Self {
        let start = value.start;
        let end = value.end;
        let mod_id = value.module_id;

        Node::new(
            Name {
                name: value,
                path: Vec::new(),
                abs_path: false,
                digest: None,
            },
            start,
            end,
            mod_id,
        )
    }
}

impl fmt::Display for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.abs_path {
            f.write_str("::")?;
        }
        for p in &self.path {
            f.write_str(&p.name)?;
            f.write_str("::")?;
        }
        f.write_str(&self.name.name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema, Eq)]
#[ts(export)]
#[serde(tag = "type")]
pub struct TagDeclarator {
    #[serde(rename = "value")]
    pub name: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

pub type TagNode = Node<TagDeclarator>;

impl From<&BoxNode<TagDeclarator>> for KclValue {
    fn from(tag: &BoxNode<TagDeclarator>) -> Self {
        KclValue::TagDeclarator(tag.clone())
    }
}

impl From<&Node<TagDeclarator>> for KclValue {
    fn from(tag: &Node<TagDeclarator>) -> Self {
        KclValue::TagDeclarator(Box::new(tag.clone()))
    }
}

impl From<&Node<TagDeclarator>> for TagIdentifier {
    fn from(tag: &Node<TagDeclarator>) -> Self {
        TagIdentifier {
            value: tag.name.clone(),
            info: Vec::new(),
            meta: vec![Metadata {
                source_range: tag.into(),
            }],
        }
    }
}

impl From<&Node<TagDeclarator>> for CompletionItem {
    fn from(tag: &Node<TagDeclarator>) -> Self {
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

impl Node<TagDeclarator> {
    /// Get the constraint level for this identifier.
    /// TagDeclarator are always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
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

impl TagDeclarator {
    pub fn new(name: &str) -> Node<Self> {
        Node::no_src(Self {
            name: name.to_string(),
            digest: None,
        })
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if self.name == old_name {
            self.name = new_name.to_string();
        }
    }
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct PipeSubstitution {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl PipeSubstitution {
    pub fn new() -> Node<Self> {
        Node::no_src(Self { digest: None })
    }
}

impl From<Node<PipeSubstitution>> for Expr {
    fn from(pipe_substitution: Node<PipeSubstitution>) -> Self {
        Expr::PipeSubstitution(Box::new(pipe_substitution))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct ArrayExpression {
    pub elements: Vec<Expr>,
    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl From<Node<ArrayExpression>> for Expr {
    fn from(array_expression: Node<ArrayExpression>) -> Self {
        Expr::ArrayExpression(Box::new(array_expression))
    }
}

impl Node<ArrayExpression> {
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
}

impl ArrayExpression {
    pub fn new(elements: Vec<Expr>) -> Node<Self> {
        Node::no_src(Self {
            elements,
            non_code_meta: Default::default(),
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for element in &mut self.elements {
            element.replace_value(source_range, new_value.clone());
        }
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
#[serde(rename_all = "camelCase", tag = "type")]
pub struct ArrayRangeExpression {
    pub start_element: Expr,
    pub end_element: Expr,
    /// Is the `end_element` included in the range?
    pub end_inclusive: bool,
    // TODO (maybe) comments on range components?
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl From<Node<ArrayRangeExpression>> for Expr {
    fn from(array_expression: Node<ArrayRangeExpression>) -> Self {
        Expr::ArrayRangeExpression(Box::new(array_expression))
    }
}

impl Node<ArrayRangeExpression> {
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        let mut constraint_levels = ConstraintLevels::new();
        constraint_levels.push(self.start_element.get_constraint_level());
        constraint_levels.push(self.end_element.get_constraint_level());

        constraint_levels.get_constraint_level(self.into())
    }
}

impl ArrayRangeExpression {
    pub fn new(start_element: Expr, end_element: Expr) -> Node<Self> {
        Node::no_src(Self {
            start_element,
            end_element,
            end_inclusive: true,
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.start_element.replace_value(source_range, new_value.clone());
        self.end_element.replace_value(source_range, new_value.clone());
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.start_element.rename_identifiers(old_name, new_name);
        self.end_element.rename_identifiers(old_name, new_name);
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct ObjectExpression {
    pub properties: NodeList<ObjectProperty>,
    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<ObjectExpression> {
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
}

impl ObjectExpression {
    pub fn new(properties: NodeList<ObjectProperty>) -> Node<Self> {
        Node::no_src(Self {
            properties,
            non_code_meta: Default::default(),
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for property in &mut self.properties {
            property.value.replace_value(source_range, new_value.clone());
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for property in &mut self.properties {
            property.value.rename_identifiers(old_name, new_name);
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectProperty {
    pub key: Node<Identifier>,
    pub value: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<ObjectProperty> {
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
}

impl ObjectProperty {
    pub fn new(key: Node<Identifier>, value: Expr) -> Node<Self> {
        Node::no_src(Self {
            key,
            value,
            digest: None,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LiteralIdentifier {
    Identifier(BoxNode<Identifier>),
    Literal(BoxNode<Literal>),
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

    pub(crate) fn contains_range(&self, range: &SourceRange) -> bool {
        let sr = SourceRange::from(self);
        sr.contains_range(range)
    }
}

impl From<LiteralIdentifier> for SourceRange {
    fn from(id: LiteralIdentifier) -> Self {
        Self::new(id.start(), id.end(), id.module_id())
    }
}

impl From<&LiteralIdentifier> for SourceRange {
    fn from(id: &LiteralIdentifier) -> Self {
        Self::new(id.start(), id.end(), id.module_id())
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub object: Expr,
    pub property: LiteralIdentifier,
    pub computed: bool,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<MemberExpression> {
    /// Get the constraint level for a member expression.
    /// This is always fully constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Full {
            source_ranges: vec![self.into()],
        }
    }
}

impl MemberExpression {
    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.object.rename_identifiers(old_name, new_name);

        match &mut self.property {
            LiteralIdentifier::Identifier(identifier) => identifier.rename(old_name, new_name),
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
    pub operator: BinaryOperator,
    pub left: BinaryPart,
    pub right: BinaryPart,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<BinaryExpression> {
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        let left_constraint_level = self.left.get_constraint_level();
        let right_constraint_level = self.right.get_constraint_level();

        let mut constraint_levels = ConstraintLevels::new();
        constraint_levels.push(left_constraint_level);
        constraint_levels.push(right_constraint_level);
        constraint_levels.get_constraint_level(self.into())
    }
}

impl BinaryExpression {
    pub fn new(operator: BinaryOperator, left: BinaryPart, right: BinaryPart) -> Node<Self> {
        Node::no_src(Self {
            operator,
            left,
            right,
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.left.replace_value(source_range, new_value.clone());
        self.right.replace_value(source_range, new_value);
    }

    pub fn precedence(&self) -> u8 {
        self.operator.precedence()
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        self.left.rename_identifiers(old_name, new_name);
        self.right.rename_identifiers(old_name, new_name);
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
    /// Raise a number to a power.
    #[serde(rename = "^")]
    #[display("^")]
    Pow,
    /// Are two numbers equal?
    #[serde(rename = "==")]
    #[display("==")]
    Eq,
    /// Are two numbers not equal?
    #[serde(rename = "!=")]
    #[display("!=")]
    Neq,
    /// Is left greater than right
    #[serde(rename = ">")]
    #[display(">")]
    Gt,
    /// Is left greater than or equal to right
    #[serde(rename = ">=")]
    #[display(">=")]
    Gte,
    /// Is left less than right
    #[serde(rename = "<")]
    #[display("<")]
    Lt,
    /// Is left less than or equal to right
    #[serde(rename = "<=")]
    #[display("<=")]
    Lte,
    /// Are both left and right true?
    #[serde(rename = "&")]
    #[display("&")]
    And,
    /// Is either left or right true?
    #[serde(rename = "|")]
    #[display("|")]
    Or,
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
            BinaryOperator::Eq => *b"eqq",
            BinaryOperator::Neq => *b"neq",
            BinaryOperator::Gt => *b"gtr",
            BinaryOperator::Gte => *b"gte",
            BinaryOperator::Lt => *b"ltr",
            BinaryOperator::Lte => *b"lte",
            BinaryOperator::And => *b"and",
            BinaryOperator::Or => *b"lor",
        }
    }

    /// Follow JS definitions of each operator.
    /// Taken from <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#table>
    pub fn precedence(&self) -> u8 {
        match &self {
            BinaryOperator::Add | BinaryOperator::Sub => 11,
            BinaryOperator::Mul | BinaryOperator::Div | BinaryOperator::Mod => 12,
            BinaryOperator::Pow => 13,
            Self::Gt | Self::Gte | Self::Lt | Self::Lte => 9,
            Self::Eq | Self::Neq => 8,
            Self::And => 7,
            Self::Or => 6,
        }
    }

    /// The operator associativity of the operator (as in the parsing sense, not the mathematical sense of associativity).
    ///
    /// Follow JS definitions of each operator.
    /// Taken from <https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/Operator_precedence#table>
    pub fn associativity(&self) -> Associativity {
        match self {
            Self::Add | Self::Sub | Self::Mul | Self::Div | Self::Mod => Associativity::Left,
            Self::Pow => Associativity::Right,
            Self::Gt | Self::Gte | Self::Lt | Self::Lte | Self::Eq | Self::Neq => Associativity::Left, // I don't know if this is correct
            Self::And | Self::Or => Associativity::Left,
        }
    }

    /// Whether an operator is mathematically associative. If it is, then the operator associativity (given by the
    /// `associativity` method) is mostly irrelevant.
    pub fn associative(&self) -> bool {
        matches!(self, Self::Add | Self::Mul | Self::And | Self::Or)
    }
}
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct UnaryExpression {
    pub operator: UnaryOperator,
    pub argument: BinaryPart,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl UnaryExpression {
    pub fn new(operator: UnaryOperator, argument: BinaryPart) -> Node<Self> {
        Node::no_src(Self {
            operator,
            argument,
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        self.argument.replace_value(source_range, new_value);
    }

    pub fn get_constraint_level(&self) -> ConstraintLevel {
        self.argument.get_constraint_level()
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

impl UnaryOperator {
    pub fn digestable_id(&self) -> [u8; 3] {
        match self {
            UnaryOperator::Neg => *b"neg",
            UnaryOperator::Not => *b"not",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct PipeExpression {
    // TODO: Only the first body expression can be any Value.
    // The rest will be CallExpression, and the AST type should reflect this.
    pub body: Vec<Expr>,
    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl From<Node<PipeExpression>> for Expr {
    fn from(pipe_expression: Node<PipeExpression>) -> Self {
        Expr::PipeExpression(Box::new(pipe_expression))
    }
}

impl Node<PipeExpression> {
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
}

impl PipeExpression {
    pub fn new(body: Vec<Expr>) -> Node<Self> {
        Node::no_src(Self {
            body,
            non_code_meta: Default::default(),
            digest: None,
        })
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for value in &mut self.body {
            value.replace_value(source_range, new_value.clone());
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for statement in &mut self.body {
            statement.rename_identifiers(old_name, new_name);
        }
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "p_type")]
pub enum PrimitiveType {
    /// The super type of all other types.
    Any,
    /// A string type.
    String,
    /// A number type.
    Number(NumericSuffix),
    /// A boolean type.
    #[serde(rename = "bool")]
    Boolean,
    /// A tag declaration.
    TagDecl,
    /// Imported from other CAD system.
    ImportedGeometry,
    /// `fn`, type of functions.
    Function(FunctionType),
    /// An identifier used as a type (not really a primitive type, but whatever).
    Named { id: Node<Identifier> },
}

impl PrimitiveType {
    pub fn primitive_from_str(s: &str, suffix: Option<NumericSuffix>) -> Option<Self> {
        match (s, suffix) {
            ("any", None) => Some(PrimitiveType::Any),
            ("string", None) => Some(PrimitiveType::String),
            ("bool", None) => Some(PrimitiveType::Boolean),
            ("TagDecl", None) => Some(PrimitiveType::TagDecl),
            ("number", None) => Some(PrimitiveType::Number(NumericSuffix::None)),
            ("number", Some(s)) => Some(PrimitiveType::Number(s)),
            ("ImportedGeometry", None) => Some(PrimitiveType::ImportedGeometry),
            _ => None,
        }
    }

    fn display_multiple(&self) -> String {
        match self {
            PrimitiveType::Any => "values".to_owned(),
            PrimitiveType::Number(_) => "numbers".to_owned(),
            PrimitiveType::String => "strings".to_owned(),
            PrimitiveType::Boolean => "bools".to_owned(),
            PrimitiveType::ImportedGeometry => "imported geometries".to_owned(),
            PrimitiveType::Function(_) => "functions".to_owned(),
            PrimitiveType::Named { id } => format!("`{}`s", id.name),
            PrimitiveType::TagDecl => "tag declarations".to_owned(),
        }
    }
}

impl fmt::Display for PrimitiveType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PrimitiveType::Any => write!(f, "any"),
            PrimitiveType::Number(suffix) => {
                write!(f, "number")?;
                if *suffix != NumericSuffix::None {
                    write!(f, "({suffix})")?;
                }
                Ok(())
            }
            PrimitiveType::String => write!(f, "string"),
            PrimitiveType::Boolean => write!(f, "bool"),
            PrimitiveType::TagDecl => write!(f, "TagDecl"),
            PrimitiveType::ImportedGeometry => write!(f, "ImportedGeometry"),
            PrimitiveType::Function(t) => {
                write!(f, "fn")?;
                if t.unnamed_arg.is_some() || !t.named_args.is_empty() || t.return_type.is_some() {
                    write!(f, "(")?;
                    if let Some(u) = &t.unnamed_arg {
                        write!(f, "{u}")?;
                        if !t.named_args.is_empty() {
                            write!(f, ", ")?;
                        }
                    }
                    for (i, (a, t)) in t.named_args.iter().enumerate() {
                        if i != 0 {
                            write!(f, ", ")?;
                        }
                        write!(f, "{}: {t}", a.name)?;
                    }
                    write!(f, ")")?;
                    if let Some(r) = &t.return_type {
                        write!(f, ": {r}")?;
                    }
                }
                Ok(())
            }
            PrimitiveType::Named { id: n } => write!(f, "{}", n.name),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct FunctionType {
    pub unnamed_arg: Option<BoxNode<Type>>,
    pub named_args: Vec<(Node<Identifier>, Node<Type>)>,
    pub return_type: Option<BoxNode<Type>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl FunctionType {
    pub fn empty_fn_type() -> Self {
        FunctionType {
            unnamed_arg: None,
            named_args: Vec::new(),
            return_type: None,
            digest: None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum Type {
    /// A primitive type.
    Primitive(PrimitiveType),
    // An array of a primitive type.
    Array {
        ty: Box<Type>,
        len: ArrayLen,
    },
    // Union/enum types
    Union {
        tys: NodeList<Type>,
    },
    // An object type.
    Object {
        properties: Vec<(Node<Identifier>, Node<Type>)>,
    },
}

impl Type {
    pub fn human_friendly_type(&self) -> String {
        match self {
            Type::Primitive(ty) => format!("a value with type `{ty}`"),
            Type::Array {
                ty,
                len: ArrayLen::None | ArrayLen::Minimum(0),
            } => {
                format!("an array of {}", ty.display_multiple())
            }
            Type::Array {
                ty,
                len: ArrayLen::Minimum(1),
            } => format!("one or more {}", ty.display_multiple()),
            Type::Array {
                ty,
                len: ArrayLen::Minimum(n),
            } => {
                format!("an array of {n} or more {}", ty.display_multiple())
            }
            Type::Array {
                ty,
                len: ArrayLen::Known(n),
            } => format!("an array of {n} {}", ty.display_multiple()),
            Type::Union { tys } => tys
                .iter()
                .map(|t| t.human_friendly_type())
                .collect::<Vec<_>>()
                .join(" or "),
            Type::Object { .. } => format!("an object with fields `{self}`"),
        }
    }

    fn display_multiple(&self) -> String {
        match self {
            Type::Primitive(ty) => ty.display_multiple(),
            Type::Array { .. } => "arrays".to_owned(),
            Type::Union { tys } => tys
                .iter()
                .map(|t| t.display_multiple())
                .collect::<Vec<_>>()
                .join(" or "),
            Type::Object { .. } => format!("objects with fields `{self}`"),
        }
    }
}

impl fmt::Display for Type {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Type::Primitive(primitive_type) => primitive_type.fmt(f),
            Type::Array { ty, len } => {
                write!(f, "[{ty}")?;
                match len {
                    ArrayLen::None => {}
                    ArrayLen::Minimum(n) => write!(f, "; {n}+")?,
                    ArrayLen::Known(n) => write!(f, "; {n}")?,
                }
                write!(f, "]")
            }
            Type::Union { tys } => {
                write!(
                    f,
                    "{}",
                    tys.iter().map(|t| t.to_string()).collect::<Vec<_>>().join(" | ")
                )
            }
            Type::Object { properties } => {
                write!(f, "{{")?;
                let mut first = true;
                for p in properties {
                    if first {
                        first = false;
                    } else {
                        write!(f, ",")?;
                    }
                    write!(f, " {}:", p.0.name)?;
                    write!(f, " {}", p.1)?;
                }
                write!(f, " }}")
            }
        }
    }
}

/// Default value for a parameter of a KCL function.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
#[allow(clippy::large_enum_variant)]
pub enum DefaultParamVal {
    KclNone(KclNone),
    Literal(Node<Literal>),
}

impl DefaultParamVal {
    /// KCL none.
    pub(crate) fn none() -> Self {
        Self::KclNone(KclNone::default())
    }

    pub(crate) fn source_range(&self) -> SourceRange {
        match self {
            DefaultParamVal::Literal(l) => l.as_source_range(),
            DefaultParamVal::KclNone(_) => SourceRange::default(),
        }
    }
}

/// Parameter of a KCL function.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Parameter {
    /// The parameter's label or name.
    pub identifier: Node<Identifier>,
    /// The type of the parameter.
    /// This is optional if the user defines a type.
    #[serde(skip)]
    pub type_: Option<Node<Type>>,
    /// Is the parameter optional?
    /// If so, what is its default value?
    /// If this is None, then the parameter is required.
    /// Defaults to None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_value: Option<DefaultParamVal>,
    /// Functions may declare at most one parameter without label, prefixed by '@', and it must be the first parameter.
    #[serde(default = "return_true", skip_serializing_if = "is_true")]
    pub labeled: bool,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Parameter {
    /// Is the parameter optional?
    pub fn optional(&self) -> bool {
        self.default_value.is_some()
    }

    pub(crate) fn contains_range(&self, range: &SourceRange) -> bool {
        let sr = SourceRange::from(self);
        sr.contains_range(range)
    }
}

impl From<&Parameter> for SourceRange {
    fn from(p: &Parameter) -> Self {
        let sr = Self::from(&p.identifier);
        // If it's unlabelled, the span should start 1 char earlier than the identifier,
        // to include the '@' symbol.
        if !p.labeled {
            return Self::new(sr.start() - 1, sr.end(), sr.module_id());
        }
        sr
    }
}

fn is_true(b: &bool) -> bool {
    *b
}

fn return_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    pub params: Vec<Parameter>,
    pub body: Node<Program>,
    #[serde(skip)]
    pub return_type: Option<Node<Type>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, PartialEq, Clone)]
pub struct RequiredParamAfterOptionalParam(pub Box<Parameter>);

impl std::fmt::Display for RequiredParamAfterOptionalParam {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "KCL functions must declare any optional parameters after all the required parameters. But your required parameter {} is _after_ an optional parameter. You must move it to before the optional parameters instead.",
            self.0.identifier.name
        )
    }
}

impl Node<FunctionExpression> {
    /// Function expressions don't really apply.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::Ignore {
            source_ranges: vec![self.into()],
        }
    }
}

impl FunctionExpression {
    pub fn required_and_optional_params(
        &self,
    ) -> Result<(&[Parameter], &[Parameter]), RequiredParamAfterOptionalParam> {
        let Self {
            params,
            body: _,
            digest: _,
            return_type: _,
        } = self;
        let mut found_optional = false;
        for param in params {
            if param.optional() {
                found_optional = true;
            } else if found_optional {
                return Err(RequiredParamAfterOptionalParam(Box::new(param.clone())));
            }
        }
        let boundary = self.params.partition_point(|param| !param.optional());
        // SAFETY: split_at panics if the boundary is greater than the length.
        Ok(self.params.split_at(boundary))
    }

    /// Required parameters must be declared before optional parameters.
    /// This gets all the required parameters.
    pub fn required_params(&self) -> &[Parameter] {
        let end_of_required_params = self
            .params
            .iter()
            .position(|param| param.optional())
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

    pub fn signature(&self) -> String {
        let mut signature = String::new();

        if self.params.is_empty() {
            signature.push_str("()");
        } else if self.params.len() == 1 {
            signature.push('(');
            signature.push_str(&self.params[0].recast(&FormatOptions::default(), 0));
            signature.push(')');
        } else {
            signature.push('(');
            for a in &self.params {
                signature.push_str("\n  ");
                signature.push_str(&a.recast(&FormatOptions::default(), 0));
                signature.push(',');
            }
            signature.push('\n');
            signature.push(')');
        }

        if let Some(ty) = &self.return_type {
            signature.push_str(&format!(": {ty}"));
        }

        signature
    }

    #[cfg(test)]
    pub fn dummy() -> Box<Node<Self>> {
        Box::new(Node::new(
            FunctionExpression {
                params: Vec::new(),
                body: Node::new(Program::default(), 0, 0, ModuleId::default()),
                return_type: None,
                digest: None,
            },
            0,
            0,
            ModuleId::default(),
        ))
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub argument: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
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

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    #[track_caller]
    fn parse(code: &str) -> Node<Program> {
        crate::parsing::top_level_parse(code).unwrap()
    }

    #[test]
    fn test_empty_or_only_settings() {
        // Empty is empty.
        assert!(parse("").is_empty_or_only_settings());

        // Whitespace is empty.
        assert!(parse(" ").is_empty_or_only_settings());

        // Settings are empty.
        assert!(parse(r#"@settings(defaultLengthUnit = mm)"#).is_empty_or_only_settings());

        // Only comments is not empty.
        assert!(!parse("// comment").is_empty_or_only_settings());

        // Any statement is not empty.
        assert!(!parse("5").is_empty_or_only_settings());

        // Any statement is not empty, even with settings.
        let code = r#"@settings(defaultLengthUnit = mm)
5"#;
        assert!(!parse(code).is_empty_or_only_settings());

        // Non-settings attributes are not empty.
        assert!(!parse("@foo").is_empty_or_only_settings());
    }

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_variable_kind_to_completion() {
        let completions = VariableKind::to_completion_items();
        assert!(!completions.is_empty());
    }

    #[test]
    fn test_get_lsp_folding_ranges() {
        let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666])

startSketchOn(XY)
  |> startProfile(at = [0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666])

part002 = "part002"
things = [part001, 0.0]
blah = 1
foo = false
baz = {a = 1, b = "thing"}

fn ghi(@x) {
  return x
}

ghi("things")
"#;
        let program = crate::parsing::top_level_parse(code).unwrap();
        let folding_ranges = program.get_lsp_folding_ranges();
        assert_eq!(folding_ranges.len(), 3);
        assert_eq!(folding_ranges[0].start_line, 27);
        assert_eq!(folding_ranges[0].end_line, 123);
        assert_eq!(
            folding_ranges[0].collapsed_text,
            Some("part001 = startSketchOn(XY)".to_string())
        );
        assert_eq!(folding_ranges[1].start_line, 142);
        assert_eq!(folding_ranges[1].end_line, 238);
        assert_eq!(folding_ranges[1].collapsed_text, Some("startSketchOn(XY)".to_string()));
        assert_eq!(folding_ranges[2].start_line, 345);
        assert_eq!(folding_ranges[2].end_line, 358);
        assert_eq!(folding_ranges[2].collapsed_text, Some("fn ghi(@x) {".to_string()));
    }

    #[test]
    fn test_get_lsp_symbols() {
        let code = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0.0000000000, 5.0000000000])
    |> line([0.4900857016, -0.0240763666])

part002 = "part002"
things = [part001, 0.0]
blah = 1
foo = false
baz = {a = 1, b = "thing"}

fn ghi(x) {
  return x
}
"#;
        let program = crate::parsing::top_level_parse(code).unwrap();
        let symbols = program.get_lsp_symbols(code).unwrap();
        assert_eq!(symbols.len(), 7);
    }

    #[test]
    fn test_ast_in_comment() {
        let some_program_string = r#"r = 20 / pow(pi(), exp = 1 / 3)
h = 30

// st

cylinder = startSketchOn(-XZ)
  |> startProfile(at = [50, 0])
  |> arc(
       angle_end = 360,
       angle_start = 0,
       radius = r
     )
  |> extrude(h)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        assert!(program.in_comment(43));
    }

    #[test]
    fn test_ast_in_comment_pipe() {
        let some_program_string = r#"r = 20 / pow(pi(), exp = 1 / 3)
h = 30

// st
cylinder = startSketchOn(-XZ)
  |> startProfile(at = [50, 0])
  // comment
  |> arc(
       angle_end= 360,
       angle_start= 0,
       radius= r
     )
  |> extrude(h)
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        assert!(program.in_comment(117));
    }

    #[test]
    fn test_ast_in_comment_inline() {
        let some_program_string = r#"part001 = startSketchOn(XY)
  |> startProfile(at = [0,0])
  |> xLine(length = 5) // lin
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        assert!(program.in_comment(85));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_on_functions() {
        let some_program_string = r#"fn thing(arg0: number(mm), arg1: string, tag?: string) {
    return arg0
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declaration.init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(
            params[0].type_.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::Number(NumericSuffix::Mm))
        );
        assert_eq!(
            params[1].type_.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
        assert_eq!(
            params[2].type_.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_array_on_functions() {
        let some_program_string = r#"fn thing(arg0: [number], arg1: [string], tag?: string) {
    return arg0
}"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declaration.init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(
            params[0].type_.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::Number(NumericSuffix::None))),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[1].type_.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::String)),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[2].type_.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_object_on_functions() {
        let some_program_string = r#"fn thing(arg0: [number], arg1: {thing: number, things: [string], more: string}, tag?: string) {
    return arg0
}"#;
        let module_id = ModuleId::default();
        let program = crate::parsing::parse_str(some_program_string, module_id).unwrap();

        // Check the program output for the types of the parameters.
        let function = program.body.first().unwrap();
        let BodyItem::VariableDeclaration(var_decl) = function else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(ref func_expr) = var_decl.declaration.init else {
            panic!("expected a function expression")
        };
        let params = &func_expr.params;
        assert_eq!(params.len(), 3);
        assert_eq!(
            params[0].type_.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::Number(NumericSuffix::None))),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[1].type_.as_ref().unwrap().inner,
            Type::Object {
                properties: vec![
                    (
                        Node::new(
                            Identifier {
                                name: "thing".to_owned(),
                                digest: None,
                            },
                            32,
                            37,
                            module_id,
                        ),
                        Node::new(
                            Type::Primitive(PrimitiveType::Number(NumericSuffix::None)),
                            39,
                            45,
                            module_id
                        ),
                    ),
                    (
                        Node::new(
                            Identifier {
                                name: "things".to_owned(),
                                digest: None,
                            },
                            47,
                            53,
                            module_id,
                        ),
                        Node::new(
                            Type::Array {
                                ty: Box::new(Type::Primitive(PrimitiveType::String)),
                                len: ArrayLen::None
                            },
                            56,
                            62,
                            module_id
                        )
                    ),
                    (
                        Node::new(
                            Identifier {
                                name: "more".to_owned(),
                                digest: None
                            },
                            65,
                            69,
                            module_id,
                        ),
                        Node::new(Type::Primitive(PrimitiveType::String), 71, 77, module_id),
                    )
                ]
            }
        );
        assert_eq!(
            params[2].type_.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
    }

    #[test]
    fn required_params() {
        for (i, (test_name, expected, function_expr)) in [
            (
                "no params",
                (0..=0),
                Node::no_src(FunctionExpression {
                    params: vec![],
                    body: Program::empty(),
                    return_type: None,
                    digest: None,
                }),
            ),
            (
                "all required params",
                (1..=1),
                Node::no_src(FunctionExpression {
                    params: vec![Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "foo".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        default_value: None,
                        labeled: true,
                        digest: None,
                    }],
                    body: Program::empty(),
                    return_type: None,
                    digest: None,
                }),
            ),
            (
                "all optional params",
                (0..=1),
                Node::no_src(FunctionExpression {
                    params: vec![Parameter {
                        identifier: Node::no_src(Identifier {
                            name: "foo".to_owned(),
                            digest: None,
                        }),
                        type_: None,
                        default_value: Some(DefaultParamVal::none()),
                        labeled: true,
                        digest: None,
                    }],
                    body: Program::empty(),
                    return_type: None,
                    digest: None,
                }),
            ),
            (
                "mixed params",
                (1..=2),
                Node::no_src(FunctionExpression {
                    params: vec![
                        Parameter {
                            identifier: Node::no_src(Identifier {
                                name: "foo".to_owned(),
                                digest: None,
                            }),
                            type_: None,
                            default_value: None,
                            labeled: true,
                            digest: None,
                        },
                        Parameter {
                            identifier: Node::no_src(Identifier {
                                name: "bar".to_owned(),
                                digest: None,
                            }),
                            type_: None,
                            default_value: Some(DefaultParamVal::none()),
                            labeled: true,
                            digest: None,
                        },
                    ],
                    body: Program::empty(),
                    return_type: None,
                    digest: None,
                }),
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
        let some_program_string = r#"some_func({thing = true, other_thing = false})"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        // We want to get the bool and verify it is a bool.

        let BodyItem::ExpressionStatement(Node {
            inner:
                ExpressionStatement {
                    expression,
                    digest: None,
                    ..
                },
            ..
        }) = program.body.first().unwrap()
        else {
            panic!("expected a function!");
        };

        let oe = match expression {
            Expr::CallExpressionKw(ce) => {
                assert!(ce.unlabeled.is_some());

                let Expr::ObjectExpression(oe) = ce.unlabeled.as_ref().unwrap() else {
                    panic!("expected a object!");
                };
                oe
            }

            other => panic!("expected a CallKw, found {other:?}"),
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
    async fn test_parse_get_meta_settings_inch() {
        let some_program_string = r#"@settings(defaultLengthUnit = inch)

startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::types::UnitLen::Inches
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_inch_to_mm() {
        let some_program_string = r#"@settings(defaultLengthUnit = inch)

startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::types::UnitLen::Inches
        );

        // Edit the ast.
        let new_program = program
            .change_default_units(Some(crate::execution::types::UnitLen::Mm), None)
            .unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, crate::execution::types::UnitLen::Mm);

        let formatted = new_program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = mm)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_nothing_to_mm() {
        let some_program_string = r#"startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_none());

        // Edit the ast.
        let new_program = program
            .change_default_units(Some(crate::execution::types::UnitLen::Mm), None)
            .unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, crate::execution::types::UnitLen::Mm);

        let formatted = new_program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = mm)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_change_meta_settings_preserves_comments() {
        let code = r#"// Title

// Set Units
@settings(defaultLengthUnit = in)

// Between

// Above Code
5
"#;
        let program = crate::parsing::top_level_parse(code).unwrap();

        let new_program = program
            .change_default_units(Some(crate::execution::types::UnitLen::Cm), None)
            .unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, crate::execution::types::UnitLen::Cm);

        let formatted = new_program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"// Title

// Set Units
@settings(defaultLengthUnit = cm)

// Between

// Above Code
5
"#
        );
    }

    #[test]
    fn test_module_name() {
        #[track_caller]
        fn assert_mod_name(stmt: &str, name: &str) {
            let tokens = crate::parsing::token::lex(stmt, ModuleId::default()).unwrap();
            let stmt = crate::parsing::parser::import_stmt(&mut tokens.as_slice()).unwrap();
            assert_eq!(stmt.module_name().unwrap(), name);
        }

        assert_mod_name("import 'foo.kcl'", "foo");
        assert_mod_name("import 'foo.kcl' as bar", "bar");
        assert_mod_name("import 'main.kcl'", "main");
        assert_mod_name("import 'foo/main.kcl'", "foo");
        assert_mod_name("import 'foo\\bar\\main.kcl'", "bar");
    }

    #[test]
    fn test_rename_in_math_in_std_function() {
        let code = r#"rise = 4.5
run = 8
angle = atan(rise / run)"#;
        let mut program = crate::parsing::top_level_parse(code).unwrap();

        // We want to rename `run` to `run2`.
        let run = program.body.get(1).unwrap().clone();
        let BodyItem::VariableDeclaration(var_decl) = &run else {
            panic!("expected a variable declaration")
        };
        let Expr::Literal(lit) = &var_decl.declaration.init else {
            panic!("expected a literal");
        };
        assert_eq!(lit.raw, "8");

        // Rename it.
        program.rename_symbol("yoyo", var_decl.as_source_range().start() + 1);

        // Recast the program to a string.
        let formatted = program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"rise = 4.5
yoyo = 8
angle = atan(rise / yoyo)
"#
        );
    }
}
