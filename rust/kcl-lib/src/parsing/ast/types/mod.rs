//! Data types for the AST.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::fmt;
use std::ops::Deref;
use std::ops::DerefMut;
use std::ops::RangeInclusive;
use std::rc::Rc;
use std::sync::Arc;
use std::sync::Mutex;

use anyhow::Result;
pub use kcl_api::ast::ItemVisibility;
use parse_display::Display;
use parse_display::FromStr;
pub use path::NodePath;
pub use path::NodePathExt;
pub use path::Step;
pub(crate) use path::fill_node_paths;
use serde::Deserialize;
use serde::Serialize;
use tower_lsp::lsp_types::Color;
use tower_lsp::lsp_types::ColorInformation;
use tower_lsp::lsp_types::ColorPresentation;
use tower_lsp::lsp_types::CompletionItem;
use tower_lsp::lsp_types::CompletionItemKind;
use tower_lsp::lsp_types::DocumentSymbol;
use tower_lsp::lsp_types::FoldingRange;
use tower_lsp::lsp_types::FoldingRangeKind;
use tower_lsp::lsp_types::SymbolKind;

use crate::ModuleId;
use crate::SourceRange;
use crate::TypedPath;
use crate::errors::KclError;
use crate::execution::KclValue;
use crate::execution::Metadata;
use crate::execution::TagIdentifier;
use crate::execution::annotations::VersionConstraint;
use crate::execution::annotations::WarningLevel;
use crate::execution::annotations::{self};
use crate::execution::types::ArrayLen;
use crate::lsp::ToLspRange;
use crate::parsing::PIPE_OPERATOR;
use crate::parsing::ast::digest::Digest;
pub use crate::parsing::ast::types::condition::ElseIf;
pub use crate::parsing::ast::types::condition::IfExpression;
pub use crate::parsing::ast::types::literal_value::LiteralValue;
pub use crate::parsing::ast::types::none::KclNone;
use crate::parsing::token::NumericSuffix;

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
    #[serde(skip)]
    pub node_path: Option<NodePath>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outer_attrs: NodeList<Annotation>,
    // Some comments are kept here, some are kept in NonCodeMeta, and some are ignored. See how each
    // node is parsed to check for certain. In any case, only comments which are strongly associated
    // with an item are kept here.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub pre_comments: Vec<String>,
    pub comment_start: usize,
}

impl<T> Node<T> {
    pub fn new(inner: T, start: usize, end: usize, module_id: ModuleId) -> Self {
        Self {
            inner,
            start,
            end,
            module_id,
            node_path: None,
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: start,
        }
    }

    #[cfg(test)]
    pub fn with_node_path(inner: T, start: usize, end: usize, module_id: ModuleId, node_path: NodePath) -> Self {
        Self {
            inner,
            start,
            end,
            module_id,
            node_path: Some(node_path),
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
            node_path: None,
            module_id: ModuleId::default(),
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: 0,
        }
    }

    pub fn boxed(start: usize, end: usize, module_id: ModuleId, inner: T) -> BoxNode<T> {
        Box::new(Node {
            inner,
            start,
            end,
            module_id,
            node_path: None,
            outer_attrs: Vec::new(),
            pre_comments: Vec::new(),
            comment_start: start,
        })
    }

    #[cfg(test)]
    pub fn boxed_with_node_path(
        start: usize,
        end: usize,
        module_id: ModuleId,
        node_path: NodePath,
        inner: T,
    ) -> BoxNode<T> {
        Box::new(Node {
            inner,
            start,
            end,
            module_id,
            node_path: Some(node_path),
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
            node_path: self.node_path,
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
            node_path: self.node_path.clone(),
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
pub type NodeRefMut<'a, T> = &'a mut Node<T>;

/// A way to abstract over blocks of code.
pub trait CodeBlock {
    fn body(&self) -> &Vec<BodyItem>;
    fn body_mut(&mut self) -> &mut Vec<BodyItem>;
    fn non_code_meta_mut(&mut self) -> &mut NonCodeMeta;
    fn to_source_range(&self) -> SourceRange;
}

/// A KCL program top level, or function body.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

impl From<Node<Block>> for Node<Program> {
    fn from(block: Node<Block>) -> Self {
        Node::new(
            Program {
                body: block.inner.items,
                non_code_meta: block.inner.non_code_meta,
                shebang: None,
                inner_attrs: block.inner.inner_attrs,
                digest: None,
            },
            block.start,
            block.end,
            block.module_id,
        )
    }
}

impl CodeBlock for Node<Program> {
    fn body(&self) -> &Vec<BodyItem> {
        &self.body
    }

    fn body_mut(&mut self) -> &mut Vec<BodyItem> {
        &mut self.body
    }

    fn non_code_meta_mut(&mut self) -> &mut NonCodeMeta {
        &mut self.non_code_meta
    }

    fn to_source_range(&self) -> SourceRange {
        SourceRange::new(self.start, self.end, self.module_id)
    }
}

fn kcl_version_expr(kcl_version: &str) -> Result<Expr, KclError> {
    let value = kcl_version.parse::<f64>().map_err(|_| {
        KclError::new_semantic(crate::errors::KclErrorDetails::new(
            format!("Unexpected KCL version value: `{kcl_version}`; expected a number, e.g. `2.0`"),
            vec![],
        ))
    })?;

    Ok(Expr::Literal(Box::new(Node::no_src(Literal {
        value: LiteralValue::Number {
            value,
            suffix: NumericSuffix::None,
        },
        raw: kcl_version.to_owned(),
        digest: None,
    }))))
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
        self.lint_all_with_options(crate::lint::LintOptions::default())
    }

    /// Check the provided Program using the standard lint rules and explicitly
    /// enabled opt-in rules.
    pub fn lint_all_with_options(&self, options: crate::lint::LintOptions) -> Result<Vec<crate::lint::Discovered>> {
        let mut rules = vec![
            crate::lint::checks::lint_variables,
            crate::lint::checks::lint_object_properties,
            crate::lint::checks::lint_should_be_default_plane,
            crate::lint::checks::lint_should_be_offset_plane,
            crate::lint::checks::lint_profiles_should_not_be_chained,
            crate::lint::checks::lint_legacy_angle,
        ];
        if options.z0006_enabled() {
            rules.push(crate::lint::checks::lint_deprecated_edge_stdlib_in_fillet_chamfer);
        }

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
        length_units: Option<kittycad_modeling_cmds::units::UnitLength>,
    ) -> Result<Self, KclError> {
        let mut new_program = self.clone();
        let mut found = false;
        for node in &mut new_program.inner_attrs {
            if node.name() == Some(annotations::SETTINGS) {
                if let Some(len) = length_units {
                    node.inner.add_or_update(
                        annotations::SETTINGS_UNIT_LENGTH,
                        Expr::Name(Box::new(Name::new(len.to_string()))),
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
                    Expr::Name(Box::new(Name::new(len.to_string()))),
                );
            }

            new_program.inner_attrs.push(settings);
        }

        Ok(new_program)
    }

    /// Return a new program with the KCL version changed.
    pub fn change_kcl_version(&self, kcl_version: Option<String>) -> Result<Self, KclError> {
        let mut new_program = self.clone();
        new_program.set_kcl_version(kcl_version)?;

        Ok(new_program)
    }

    /// Set the KCL version in place.
    pub(crate) fn set_kcl_version(&mut self, kcl_version: Option<String>) -> Result<(), KclError> {
        let mut found = false;
        for node in &mut self.inner_attrs {
            if node.name() == Some(annotations::SETTINGS) {
                if let Some(version) = &kcl_version {
                    node.inner
                        .add_or_update(annotations::SETTINGS_VERSION, kcl_version_expr(version)?);
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
            if let Some(version) = &kcl_version {
                settings
                    .inner
                    .add_or_update(annotations::SETTINGS_VERSION, kcl_version_expr(version)?);
            }

            self.inner_attrs.push(settings);
        }

        Ok(())
    }

    /// Return a new program with the experimental features warning level
    /// changed.
    pub fn change_experimental_features(&self, warning_level: Option<WarningLevel>) -> Result<Self, KclError> {
        let mut new_program = self.clone();
        new_program.set_experimental_features(warning_level);

        Ok(new_program)
    }

    /// Set the experimental features warning level in place.
    pub(crate) fn set_experimental_features(&mut self, warning_level: Option<WarningLevel>) {
        let mut found = false;
        for node in &mut self.inner_attrs {
            if node.name() == Some(annotations::SETTINGS) {
                // TODO: Should we remove it if warning_level is None?
                if let Some(level) = warning_level {
                    node.inner.add_or_update(
                        annotations::SETTINGS_EXPERIMENTAL_FEATURES,
                        Expr::Name(Box::new(Name::new(level.as_str()))),
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
            if let Some(level) = warning_level {
                settings.inner.add_or_update(
                    annotations::SETTINGS_EXPERIMENTAL_FEATURES,
                    Expr::Name(Box::new(Name::new(level.as_str()))),
                );
            }

            self.inner_attrs.push(settings);
        }
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
                crate::walk::Node::CallExpressionKw(call)
                    if call.inner.callee.inner.name.inner.name == "appearance" =>
                {
                    for arg in &call.arguments {
                        if let Some(l) = &arg.label
                            && l.inner.name == "color"
                        {
                            // Get the value of the argument.
                            if let Expr::Literal(literal) = &arg.arg {
                                add_color(literal);
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
                crate::walk::Node::Literal(literal)
                    // Account for the quotes in the literal.
                    if (literal.start + 1) == pos_start
                        && (literal.end - 1) == pos_end
                        && literal.value.is_color().is_some()
                    => {
                        found.replace(true);
                        return Ok(true);
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
        item.get_expr_for_position(pos)
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
        if let Some(expr) = expr
            && let Some(non_code_meta) = expr.get_non_code_meta()
            && non_code_meta.in_comment(pos)
        {
            return true;
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
        for (index, item) in self.body.iter_mut().enumerate() {
            match item {
                BodyItem::ImportStatement(stmt) => {
                    if let Some(var_old_name) = stmt.rename_symbol(new_name, pos) {
                        // A whole-module import (`import "m.kcl" as alias`) binds in the
                        // module namespace; list imports bind ordinary values.
                        let is_module = matches!(&stmt.selector, ImportSelector::None { .. });
                        old_name = Some((var_old_name, is_module, index));
                        break;
                    }
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if let Some(var_old_name) = variable_declaration.rename_symbol(new_name, pos) {
                        old_name = Some((var_old_name, false, index));
                        break;
                    }
                }
                _ => {}
            }
        }

        if let Some((old_name, is_module, decl_index)) = old_name {
            // Rename references, starting at the declaration: the executor binds sequentially,
            // so references before it resolve to something else (e.g. a same-named standard
            // library function). The executor resolves a bare name to the value namespace
            // first and falls back to the module namespace, so the same shadow-aware walk
            // applies to a module's bare references: they stop being the module's at a value
            // binding of the same name.
            rename_identifiers_in_body(&mut self.body[decl_index..], &old_name, new_name);
            if is_module {
                // Qualified references (`old::item`) resolve in the module namespace, which
                // has no nested scopes (the executor rejects non-root imports), so rename
                // heads everywhere after the import.
                rename_module_refs_in_body(&mut self.body[decl_index..], &old_name, new_name);
            }
            return;
        }

        // It might be a declaration inside a sketch block, or a reference to one.
        if self.rename_sketch_block_symbol(new_name, pos) {
            return;
        }

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
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_mut_expr_for_position(pos),
            BodyItem::TypeDeclaration(_) => None,
            BodyItem::ReturnStatement(return_statement) => Some(&mut return_statement.argument),
        };

        // Check if we have a function expression.
        if let Some(Expr::FunctionExpression(function_expression)) = &mut value {
            // Check if the params to the function expression contain the position.
            for param in &mut function_expression.params {
                let param_source_range: SourceRange = (&param.identifier).into();
                if param_source_range.contains(pos) {
                    let old_name = std::mem::replace(&mut param.identifier.name, new_name.to_owned());
                    // Now rename all the identifiers in the function's body.
                    function_expression.body.rename_identifiers(&old_name, new_name);
                    return;
                }
            }
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name. Returns whether
    /// the body rebinds the old name in the current environment; if-expression branches
    /// execute in the current environment, so this propagates to the enclosing walk.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        rename_identifiers_in_body(&mut self.body, old_name, new_name)
    }

    /// Rename a symbol declared inside a sketch block, if `pos` is on such a declaration or on
    /// a reference to one: either a use inside the block, or the property of a member
    /// reference like `mySketch.line1`. The sketch block can be in any scope: top-level, or
    /// inside a function body at any depth. Renames the declaration, uses inside the block,
    /// member references on the sketch variable, and `.tags` member references on regions
    /// derived from the sketch, all within the scope where the sketch variable is declared.
    /// Returns false if `pos` doesn't resolve to a sketch block symbol.
    fn rename_sketch_block_symbol(&mut self, new_name: &str, pos: usize) -> bool {
        let mut candidates = self.sketch_symbol_candidates_at_pos(pos);
        if candidates.is_empty() {
            return false;
        }
        rename_sketch_symbol_in_body(&mut self.body, &mut candidates, new_name, pos, false)
    }

    /// Find what `pos` is on, as candidates for resolving a sketch block symbol: the
    /// identifier at `pos` (a declaration or use), the member reference `x.prop` whose
    /// property is at `pos`, or the region tag reference `r.tags.prop` whose property is at
    /// `pos`.
    fn sketch_symbol_candidates_at_pos(&self, pos: usize) -> SketchSymbolCandidates {
        use crate::walk::Node as WalkNode;
        use crate::walk::Walker;

        let decl_id_at_pos = std::cell::RefCell::new(None::<String>);
        let bare_use_at_pos = std::cell::RefCell::new(None::<String>);
        let member_at_pos = std::cell::RefCell::new(None::<(String, String)>);
        let tags_member_at_pos = std::cell::RefCell::new(None::<(String, String)>);
        let pos_is_member_property = std::cell::Cell::new(false);
        let finder = |node: WalkNode<'_>| -> Result<bool, anyhow::Error> {
            match node {
                // Only a reference (a bare name) or a declaration's id can identify a sketch
                // block symbol. Other identifiers at the position, like function parameters
                // and expression labels, bind different symbols; matching them would rename an
                // unrelated same-named declaration.
                WalkNode::Name(name) => {
                    if SourceRange::from(name).contains(pos)
                        && let Some(local) = name.local_ident()
                    {
                        *bare_use_at_pos.borrow_mut() = Some(local.inner.to_owned());
                    }
                }
                WalkNode::VariableDeclarator(decl) => {
                    if SourceRange::from(&decl.id).contains(pos) {
                        *decl_id_at_pos.borrow_mut() = Some(decl.id.name.clone());
                    }
                }
                WalkNode::MemberExpression(member) => {
                    if !member.computed
                        && let Expr::Name(property) = &member.property
                        && SourceRange::from(&**property).contains(pos)
                        && let Some(property) = property.local_ident()
                    {
                        // The name at the position is a field or tag access, not a bare
                        // reference; the member and tags candidates below carry it when the
                        // object shape is recognized.
                        pos_is_member_property.set(true);
                        match &member.object {
                            Expr::Name(object) => {
                                if let Some(object) = object.local_ident() {
                                    *member_at_pos.borrow_mut() =
                                        Some((object.inner.to_owned(), property.inner.to_owned()));
                                }
                            }
                            Expr::MemberExpression(inner) => {
                                if !inner.computed
                                    && let Expr::Name(region) = &inner.object
                                    && let Some(region) = region.local_ident()
                                    && matches!(&inner.property, Expr::Name(t) if t.local_ident().is_some_and(|t| t.inner == "tags"))
                                {
                                    *tags_member_at_pos.borrow_mut() =
                                        Some((region.inner.to_owned(), property.inner.to_owned()));
                                }
                            }
                            _ => {}
                        }
                    }
                }
                _ => {}
            }
            Ok(true)
        };
        for item in &self.body {
            let _ = finder.walk(WalkNode::from(item));
        }
        SketchSymbolCandidates {
            decl_id: decl_id_at_pos.into_inner(),
            bare_use: if pos_is_member_property.get() {
                None
            } else {
                bare_use_at_pos.into_inner()
            },
            member: member_at_pos.into_inner(),
            tags_member: tags_member_at_pos.into_inner(),
            region: None,
            std_region_shadowed: false,
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
            item.replace_value(source_range, new_value.clone());
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
#[derive(Debug, Default, Clone, PartialEq, Eq, Hash, Deserialize, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct Shebang {
    pub content: String,
}

impl Shebang {
    pub fn new(content: String) -> Self {
        Shebang { content }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

    /// Rename all identifiers that have the old name to the new given name. Returns whether
    /// this item rebinds the old name for what follows it.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            BodyItem::ImportStatement(_) => {
                // Imports only bind names (item names, aliases, module names); they contain
                // no references to rename. Whether they rebind the old name in the value
                // namespace mirrors body_item_binds_name.
                body_item_binds_name(self, old_name)
            }
            BodyItem::ExpressionStatement(expression_statement) => {
                expression_statement.expression.rename_identifiers(old_name, new_name)
            }
            BodyItem::VariableDeclaration(variable_declaration) => {
                variable_declaration.rename_identifiers(old_name, new_name)
            }
            BodyItem::TypeDeclaration(_) => false,
            BodyItem::ReturnStatement(return_statement) => {
                return_statement.argument.rename_identifiers(old_name, new_name)
            }
        }
    }

    fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        match self {
            BodyItem::ImportStatement(_) => {} // TODO
            BodyItem::ExpressionStatement(expression_statement) => {
                expression_statement.expression.replace_value(source_range, new_value)
            }
            BodyItem::VariableDeclaration(variable_declaration) => {
                variable_declaration.replace_value(source_range, new_value)
            }
            BodyItem::TypeDeclaration(_) => {}
            BodyItem::ReturnStatement(return_statement) => {
                return_statement.argument.replace_value(source_range, new_value)
            }
        }
    }

    fn get_expr_for_position(&self, pos: usize) -> Option<&Expr> {
        match self {
            BodyItem::ImportStatement(_) | BodyItem::TypeDeclaration(_) => None,
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_expr_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
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

/// Rename identifiers in body items, in the executor's evaluation order. Stops as soon as
/// something rebinds (shadows) the old name, since references evaluated after it refer to the
/// new binding, not the one being renamed. Rebinding can happen mid-item: the executor binds
/// tags, labels, and named function expressions the moment it evaluates them, so references
/// after them in the same statement are left alone, while references before them are renamed
/// (e.g. renaming outer `x` renames the use in a shadowing local `x = x + 1`, whose
/// initializer evaluates before the binding). Returns whether the old name was rebound, which
/// matters for if-expression branches: they execute in the current environment, so their
/// bindings leak to the enclosing walk.
fn rename_identifiers_in_body(body: &mut [BodyItem], old_name: &str, new_name: &str) -> bool {
    for item in body {
        if item.rename_identifiers(old_name, new_name) {
            return true;
        }
    }
    false
}

/// Rename the head segments of qualified names (`old::item` becomes `new::item`) throughout
/// the body, including every nested scope. The executor resolves qualified heads in the
/// module namespace, where imports may only appear at the file's root, so unlike value
/// renames no shadow tracking is needed.
fn rename_module_refs_in_body(body: &mut [BodyItem], old_name: &str, new_name: &str) {
    for item in body {
        if let Some(expr) = body_item_expr_mut(item) {
            rename_module_refs_expr(expr, old_name, new_name);
        }
    }
}

fn rename_module_refs_expr(expr: &mut Expr, old_name: &str, new_name: &str) {
    let recurse = |e: &mut Expr| rename_module_refs_expr(e, old_name, new_name);
    match expr {
        Expr::Literal(_) | Expr::TagDeclarator(_) | Expr::PipeSubstitution(_) | Expr::SketchVar(_) | Expr::None(_) => {}
        Expr::Name(name) => name.rename_module_head(old_name, new_name),
        Expr::MemberExpression(member) => {
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        Expr::FunctionExpression(func) => rename_module_refs_in_body(&mut func.body.body, old_name, new_name),
        Expr::CallExpressionKw(call) => {
            call.callee.rename_module_head(old_name, new_name);
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        Expr::PipeExpression(pipe) => {
            for e in &mut pipe.body {
                recurse(e);
            }
        }
        Expr::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        Expr::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_module_refs_binary_part(&mut bin_expr.left, old_name, new_name);
            rename_module_refs_binary_part(&mut bin_expr.right, old_name, new_name);
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_module_refs_binary_part(&mut unary_expr.argument, old_name, new_name)
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_module_refs_in_body(&mut if_expr.then_val.body, old_name, new_name);
            for else_if in &mut if_expr.else_ifs {
                rename_module_refs_expr(&mut else_if.cond, old_name, new_name);
                rename_module_refs_in_body(&mut else_if.then_val.body, old_name, new_name);
            }
            rename_module_refs_in_body(&mut if_expr.final_else.body, old_name, new_name);
        }
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
        Expr::SketchBlock(sketch_block) => {
            for arg in &mut sketch_block.arguments {
                recurse(&mut arg.arg);
            }
            rename_module_refs_in_body(&mut sketch_block.body.items, old_name, new_name);
        }
    }
}

fn rename_module_refs_binary_part(part: &mut BinaryPart, old_name: &str, new_name: &str) {
    let recurse = |e: &mut Expr| rename_module_refs_expr(e, old_name, new_name);
    match part {
        BinaryPart::Literal(_) | BinaryPart::SketchVar(_) => {}
        BinaryPart::Name(name) => name.rename_module_head(old_name, new_name),
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_module_refs_binary_part(&mut bin_expr.left, old_name, new_name);
            rename_module_refs_binary_part(&mut bin_expr.right, old_name, new_name);
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_module_refs_binary_part(&mut unary_expr.argument, old_name, new_name)
        }
        BinaryPart::CallExpressionKw(call) => {
            call.callee.rename_module_head(old_name, new_name);
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        BinaryPart::MemberExpression(member) => {
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        BinaryPart::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        BinaryPart::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        BinaryPart::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_module_refs_in_body(&mut if_expr.then_val.body, old_name, new_name);
            for else_if in &mut if_expr.else_ifs {
                rename_module_refs_expr(&mut else_if.cond, old_name, new_name);
                rename_module_refs_in_body(&mut else_if.then_val.body, old_name, new_name);
            }
            rename_module_refs_in_body(&mut if_expr.final_else.body, old_name, new_name);
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

/// Whether the block's body directly declares a variable with the given name.
fn block_declares_name(block: &Block, name: &str) -> bool {
    block
        .items
        .iter()
        .any(|item| matches!(item, BodyItem::VariableDeclaration(decl) if decl.declaration.id.name == name))
}

/// Whether the expression contains any reference to the given name.
fn expr_references_name(expr: &Expr, name: &str) -> bool {
    expr_references_name_where(expr, |n| n == name)
}

/// Whether the expression contains a reference to any name matching the predicate. Member
/// properties are visited too, so this over-approximates references; callers use it in the
/// conservative direction (refusing a rename rather than misapplying one).
fn expr_references_name_where(expr: &Expr, pred: impl Fn(&str) -> bool) -> bool {
    use crate::walk::Node as WalkNode;
    use crate::walk::Walker;

    let found = std::cell::Cell::new(false);
    let finder = |node: WalkNode<'_>| -> Result<bool, anyhow::Error> {
        if let WalkNode::Name(n) = node
            && n.local_ident().is_some_and(|ident| pred(ident.inner))
        {
            found.set(true);
            // Stop walking.
            return Ok(false);
        }
        Ok(true)
    };
    let _ = finder.walk(WalkNode::from(expr));
    found.get()
}

/// The expression a body item evaluates, if any.
fn body_item_expr_mut(item: &mut BodyItem) -> Option<&mut Expr> {
    match item {
        BodyItem::ImportStatement(_) | BodyItem::TypeDeclaration(_) => None,
        BodyItem::ExpressionStatement(stmt) => Some(&mut stmt.expression),
        BodyItem::VariableDeclaration(decl) => Some(&mut decl.declaration.init),
        BodyItem::ReturnStatement(stmt) => Some(&mut stmt.argument),
    }
}

/// Variables declared in this body whose value is a sketch block, e.g.
/// `s = sketch(on = XY) {...}`.
fn sketch_blocks_in_body(body: &[BodyItem]) -> impl Iterator<Item = (&str, &Node<Block>)> {
    body.iter().filter_map(|item| {
        let BodyItem::VariableDeclaration(decl) = item else {
            return None;
        };
        let Expr::SketchBlock(sketch) = &decl.declaration.init else {
            return None;
        };
        Some((decl.declaration.id.name.as_str(), &sketch.body))
    })
}

fn sketch_block_mut_in_body<'a>(body: &'a mut [BodyItem], name: &str) -> Option<&'a mut Node<Block>> {
    body.iter_mut().find_map(|item| {
        let BodyItem::VariableDeclaration(decl) = item else {
            return None;
        };
        if decl.declaration.id.name != name {
            return None;
        }
        let Expr::SketchBlock(sketch) = &mut decl.declaration.init else {
            return None;
        };
        Some(&mut sketch.body)
    })
}

/// Whether this declaration's value is a `region(...)` call deriving from the given sketch
/// variable, e.g. `region(segments = [s.line1])`, `region(point = [0, 0], sketch = s)`, or
/// `region(point = s.point1)`. Such regions inherit the sketch block's declared names as tags
/// (`myRegion.tags.line1`). Regions that only reach a variable indirectly (returned from a
/// helper function, aliased, or passed as a parameter) aren't detected.
fn is_region_derived_from_sketch(decl: &VariableDeclaration, sketch_name: &str) -> bool {
    region_call_derives_from(&decl.declaration.init, sketch_name)
}

/// Whether this expression is a `region(...)` call deriving from the given sketch variable.
/// Mirrors the executor's provenance rules (see `region_from_point` in std::sketch):
/// - `segments = [...]`: the region derives from the segments' sketches. (The executor
///   rejects a `sketch` argument alongside segments.)
/// - `point = <segment>`: a solved point segment carries its own sketch, and the executor
///   ignores any `sketch` argument. Syntactically, a point argument of the form `base.name`
///   (a member of a bare name) is treated as a segment of `base`.
/// - `point = [x, y]` or any deeper expression (e.g. `s.circle1.center`, a coordinate taken
///   from geometry): 2D coordinates; the `sketch` argument determines the sketch.
fn region_call_derives_from(init: &Expr, sketch_name: &str) -> bool {
    let Expr::CallExpressionKw(call) = init else {
        return false;
    };
    if call.callee.local_ident().map(|ident| ident.inner) != Some("region") {
        return false;
    }
    let arg_with_label = |label: &str| {
        call.arguments
            .iter()
            .find(|arg| arg.label.as_ref().is_some_and(|l| l.name == label))
            .map(|arg| &arg.arg)
    };
    if let Some(segments) = arg_with_label("segments") {
        return expr_references_name(segments, sketch_name);
    }
    let point = arg_with_label("point");
    // A point segment like `s.point1`: the segment's sketch is the provenance, and the
    // executor ignores any `sketch` argument.
    if let Some(Expr::MemberExpression(member)) = point
        && !member.computed
        && let Expr::Name(base) = &member.object
    {
        return base.local_ident().is_some_and(|ident| ident.inner == sketch_name);
    }
    if let Some(sketch_arg) = arg_with_label("sketch") {
        return expr_references_name(sketch_arg, sketch_name);
    }
    point.is_some_and(|arg| expr_references_name(arg, sketch_name))
}

/// What the rename position points at, as candidates for resolving a sketch block symbol.
/// During resolution, a candidate is killed (set to None) when a binding or scope boundary
/// shadows what it refers to, so that outer scopes don't match a reference that doesn't
/// resolve to their declarations.
struct SketchSymbolCandidates {
    /// The position is on the id of a variable declaration; a rename target only if that
    /// declaration is a direct item of a sketch block.
    decl_id: Option<String>,
    /// A bare name reference at the position.
    bare_use: Option<String>,
    /// A member reference `x.prop` with the position on `prop`: (object, property).
    member: Option<(String, String)>,
    /// A region tag reference `r.tags.prop` with the position on `prop`: (region, property).
    tags_member: Option<(String, String)>,
    /// A resolved tags_member: the region declaration's initializer (cloned), the property,
    /// and the end of the region's declaration. The sketch the region derives from is looked
    /// up among sketch declarations before that position.
    region: Option<(Expr, String, usize)>,
    /// Whether a user binding named `region` shadows the standard `region` function on the
    /// lexical path to the position; calls spelled `region(...)` are then not the standard
    /// function, so no provenance is inferred from them. Maintained with save/restore as the
    /// resolution enters and leaves scopes.
    std_region_shadowed: bool,
}

impl SketchSymbolCandidates {
    fn is_empty(&self) -> bool {
        self.decl_id.is_none()
            && self.bare_use.is_none()
            && self.member.is_none()
            && self.tags_member.is_none()
            && self.region.is_none()
    }
}

/// Rename a sketch block symbol within this scope, preferring the innermost scope: first
/// recurse into nested bodies (function bodies, if-expression branches, sketch blocks) that
/// contain `pos`; if no inner scope handles the rename, resolve the candidates against
/// declarations directly in this body. Candidates are passed mutably so that a scope boundary
/// or declaration that rebinds (shadows) what they refer to can kill them, preventing outer
/// scopes from matching a reference that doesn't resolve to their declarations. Returns
/// whether the rename was handled.
fn rename_sketch_symbol_in_body(
    body: &mut [BodyItem],
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
    in_sketch_block: bool,
) -> bool {
    // The innermost scope wins, so a fn-local sketch shadows a same-named outer one. Items
    // before the one containing the position can rebind `region` for everything inside it;
    // the flag is restored afterwards since those binders don't apply to enclosing scopes.
    let saved_region_shadowed = candidates.std_region_shadowed;
    if let Some(idx) = body.iter().position(|item| SourceRange::from(item).contains(pos)) {
        if body[..idx].iter().any(|item| body_item_binds_name(item, "region")) {
            candidates.std_region_shadowed = true;
        }
        if let Some(expr) = body_item_expr_mut(&mut body[idx])
            && rename_sketch_symbol_in_nested_bodies(expr, candidates, new_name, pos)
        {
            return true;
        }
    }
    candidates.std_region_shadowed = saved_region_shadowed;

    // A bare name reference resolves to the last binding before the position. Inside a
    // sketch block's body, only the block's own declaration of that name makes it a rename
    // target (matched by the enclosing scope, which knows the sketch variable); any other
    // binding, or no binding at all inside the block, means the reference is not to the
    // block's declaration.
    if let Some(name) = candidates.bare_use.as_ref() {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, name));
        let binder_is_own_decl = matches!(last_binder, Some(BodyItem::VariableDeclaration(decl))
            if decl.declaration.id.name == *name);
        if in_sketch_block {
            if !binder_is_own_decl {
                candidates.bare_use = None;
            }
        } else if last_binder.is_some() {
            candidates.bare_use = None;
        }
    }

    // A region tag reference like `r.tags.line1` resolves through the last binding of the
    // region name before the position. If that binding isn't a region call, the reference is
    // not a region tag, and outer scopes must not match it either.
    if let Some((region, property)) = candidates.tags_member.as_ref() {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, region));
        if let Some(binder) = last_binder {
            if let BodyItem::VariableDeclaration(decl) = binder
                && decl.declaration.id.name == *region
                && matches!(&decl.declaration.init, Expr::CallExpressionKw(call)
                    if call.callee.local_ident().map(|ident| ident.inner) == Some("region"))
                // The call is only the standard `region` if nothing rebinds that name at the
                // call's site: neither an enclosing scope on the path here nor an earlier
                // item in this body.
                && !candidates.std_region_shadowed
                && !body.iter().any(|item| {
                    SourceRange::from(item).end() <= SourceRange::from(binder).start()
                        && body_item_binds_name(item, "region")
                })
            {
                candidates.region = Some((
                    decl.declaration.init.clone(),
                    property.clone(),
                    SourceRange::from(binder).end(),
                ));
            }
            candidates.tags_member = None;
        }
    }

    // The sketch a resolved region derives from: a sketch declaration before the region that
    // the region's initializer references and whose block declares the property.
    let mut target: Option<(String, String)> = None;
    if let Some((region_init, property, region_pos)) = candidates.region.as_ref() {
        let sketch = body.iter().rfind(|item| {
            SourceRange::from(&**item).end() <= *region_pos
                && matches!(item, BodyItem::VariableDeclaration(decl)
                    if matches!(&decl.declaration.init, Expr::SketchBlock(sketch)
                        if block_declares_name(&sketch.body, property))
                    && region_call_derives_from(region_init, &decl.declaration.id.name))
        });
        if let Some(BodyItem::VariableDeclaration(decl)) = sketch {
            target = Some((decl.declaration.id.name.clone(), property.clone()));
        }
    }

    // A member reference like `mySketch.line1` resolves to the last binding of the sketch
    // name before the position. If that binding is a sketch block declaring the property, it
    // is the rename target. If it is any other binding, the reference is not to a sketch, and
    // outer scopes must not match it either.
    if target.is_none()
        && let Some((object, property)) = candidates.member.as_ref()
    {
        let last_binder = body
            .iter()
            .rfind(|item| SourceRange::from(&**item).end() <= pos && body_item_binds_name(item, object));
        if let Some(binder) = last_binder {
            if let BodyItem::VariableDeclaration(decl) = binder
                && decl.declaration.id.name == *object
                && let Expr::SketchBlock(sketch) = &decl.declaration.init
                && block_declares_name(&sketch.body, property)
            {
                target = Some((object.clone(), property.clone()));
            } else {
                candidates.member = None;
            }
        }
    }
    // Or the id of a declaration that is a direct item of a sketch block declared in this
    // body. Declarations nested deeper (e.g. a local inside a function inside the block) are
    // different symbols and don't match.
    let target = target.or_else(|| {
        candidates.decl_id.as_ref()?;
        sketch_blocks_in_body(body).find_map(|(sketch_name, block)| {
            block.items.iter().find_map(|item| match item {
                BodyItem::VariableDeclaration(decl) if SourceRange::from(&decl.declaration.id).contains(pos) => {
                    Some((sketch_name.to_owned(), decl.declaration.id.name.clone()))
                }
                _ => None,
            })
        })
    });
    // ...or a bare use inside a sketch block declared in this body.
    let target = target.or_else(|| {
        let name = candidates.bare_use.as_deref()?;
        sketch_blocks_in_body(body)
            .find(|(_, block)| block.as_source_range().contains(pos) && block_declares_name(block, name))
            .map(|(sketch_name, _)| (sketch_name.to_owned(), name.to_owned()))
    });
    let Some((sketch_name, old_name)) = target else {
        return false;
    };

    // Rename the declaration and the uses inside the block after it; the executor evaluates
    // block items in order, so references before the declaration resolve to an outer binding.
    if let Some(block) = sketch_block_mut_in_body(body, &sketch_name) {
        let mut decl_index = 0;
        for (index, item) in block.items.iter_mut().enumerate() {
            if let BodyItem::VariableDeclaration(decl) = item
                && decl.declaration.id.name == old_name
            {
                decl.declaration.id.name = new_name.to_owned();
                decl_index = index;
                break;
            }
        }
        rename_identifiers_in_body(&mut block.items[decl_index..], &old_name, new_name);
    }

    // Rename references outside the block, within this scope: the sketch value exposes the
    // block's declarations as members (`mySketch.line1`), and regions derived from the sketch
    // inherit them as tags (`myRegion.tags.line1`). Regions are discovered as the walk
    // proceeds, here and in nested scopes, since their `.tags` can only be referenced after
    // their declaration. The walk starts at the sketch's declaration: references before it
    // cannot refer to this sketch, only to an outer binding of the same name. This scope is
    // where the sketch and region variables are bound, so no rebinding is possible after the
    // sketch's declaration; only nested bodies can shadow them, which the recursion handles.
    let start = body
        .iter()
        .position(|item| {
            matches!(item, BodyItem::VariableDeclaration(decl)
                if decl.declaration.id.name == sketch_name && matches!(&decl.declaration.init, Expr::SketchBlock(_)))
        })
        .unwrap_or(0);
    // Whether the standard `region` function is shadowed: by an enclosing scope on the path
    // here, by an item before the sketch's declaration, or by an item the walk passes.
    let mut region_fn_shadowed =
        candidates.std_region_shadowed || body[..start].iter().any(|item| body_item_binds_name(item, "region"));
    let mut region_names: Vec<String> = Vec::new();
    for item in body[start..].iter_mut() {
        if let Some(expr) = body_item_expr_mut(item) {
            rename_sketch_member_refs_expr(
                expr,
                Some(&sketch_name),
                &region_names,
                &old_name,
                new_name,
                region_fn_shadowed,
            );
        }
        if !region_fn_shadowed
            && let BodyItem::VariableDeclaration(decl) = &*item
            && is_region_derived_from_sketch(decl, &sketch_name)
        {
            region_names.push(decl.declaration.id.name.clone());
        }
        region_fn_shadowed |= body_item_binds_name(item, "region");
    }
    true
}

/// Recurse into nested bodies (function bodies, if-expression branches, sketch blocks) within
/// this expression that contain `pos`, trying to rename a sketch block symbol declared in one
/// of them. Returns whether the rename was handled.
fn rename_sketch_symbol_in_nested_bodies(
    expr: &mut Expr,
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
) -> bool {
    if !SourceRange::from(&*expr).contains(pos) {
        return false;
    }
    let recurse =
        |e: &mut Expr, c: &mut SketchSymbolCandidates| rename_sketch_symbol_in_nested_bodies(e, c, new_name, pos);
    let recurse_body = |b: &mut Node<Program>, c: &mut SketchSymbolCandidates| {
        b.as_source_range().contains(pos) && rename_sketch_symbol_in_body(&mut b.body, c, new_name, pos, false)
    };
    match expr {
        Expr::Literal(_)
        | Expr::Name(_)
        | Expr::TagDeclarator(_)
        | Expr::PipeSubstitution(_)
        | Expr::SketchVar(_)
        | Expr::None(_) => false,
        Expr::FunctionExpression(func) => {
            // A parameter or the function's own name can also rebind `region` for the body;
            // restored below since it doesn't apply to enclosing scopes.
            let saved_region_shadowed = candidates.std_region_shadowed;
            if func.binds_name("region") {
                candidates.std_region_shadowed = true;
            }
            let handled = recurse_body(&mut func.body, candidates);
            // A parameter or the function's own name that rebinds a candidate's base name
            // shadows any outer binding; if the reference didn't resolve inside the function,
            // outer scopes must not resolve it either.
            if !handled {
                candidates.std_region_shadowed = saved_region_shadowed;
                if candidates.bare_use.as_ref().is_some_and(|name| func.binds_name(name)) {
                    candidates.bare_use = None;
                }
                if candidates
                    .member
                    .as_ref()
                    .is_some_and(|(object, _)| func.binds_name(object))
                {
                    candidates.member = None;
                }
                if candidates
                    .tags_member
                    .as_ref()
                    .is_some_and(|(region, _)| func.binds_name(region))
                {
                    candidates.tags_member = None;
                }
                // A resolved region's initializer references names that meant the function's
                // bindings inside it (e.g. `region(segments = [s.line1])` where `s` is a
                // parameter); outer scopes' same-named sketches are different bindings, and
                // the runtime provenance is whatever was passed in. Over-approximates by
                // matching any referenced name, which only refuses more renames.
                if candidates
                    .region
                    .as_ref()
                    .is_some_and(|(init, _, _)| expr_references_name_where(init, |name| func.binds_name(name)))
                {
                    candidates.region = None;
                }
            }
            handled
        }
        Expr::SketchBlock(sketch_block) => {
            sketch_block
                .arguments
                .iter_mut()
                .any(|arg| recurse(&mut arg.arg, candidates))
                || (sketch_block.body.as_source_range().contains(pos)
                    && rename_sketch_symbol_in_body(&mut sketch_block.body.items, candidates, new_name, pos, true))
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond, candidates)
                || recurse_body(&mut if_expr.then_val, candidates)
                || if_expr.else_ifs.iter_mut().any(|else_if| {
                    recurse(&mut else_if.cond, candidates) || recurse_body(&mut else_if.then_val, candidates)
                })
                || recurse_body(&mut if_expr.final_else, candidates)
        }
        Expr::MemberExpression(member) => {
            recurse(&mut member.object, candidates) || recurse(&mut member.property, candidates)
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.left, candidates, new_name, pos)
                || rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.right, candidates, new_name, pos)
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut unary_expr.argument, candidates, new_name, pos)
        }
        Expr::CallExpressionKw(call) => {
            call.unlabeled.as_mut().is_some_and(|u| recurse(u, candidates))
                || call.arguments.iter_mut().any(|arg| recurse(&mut arg.arg, candidates))
        }
        Expr::PipeExpression(pipe) => pipe.body.iter_mut().any(|e| recurse(e, candidates)),
        Expr::ArrayExpression(array) => array.elements.iter_mut().any(|e| recurse(e, candidates)),
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element, candidates) || recurse(&mut range.end_element, candidates)
        }
        Expr::ObjectExpression(obj) => obj.properties.iter_mut().any(|p| recurse(&mut p.value, candidates)),
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr, candidates),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr, candidates),
    }
}

fn rename_sketch_symbol_in_nested_bodies_binary_part(
    part: &mut BinaryPart,
    candidates: &mut SketchSymbolCandidates,
    new_name: &str,
    pos: usize,
) -> bool {
    let recurse =
        |e: &mut Expr, c: &mut SketchSymbolCandidates| rename_sketch_symbol_in_nested_bodies(e, c, new_name, pos);
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => false,
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.left, candidates, new_name, pos)
                || rename_sketch_symbol_in_nested_bodies_binary_part(&mut bin_expr.right, candidates, new_name, pos)
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_sketch_symbol_in_nested_bodies_binary_part(&mut unary_expr.argument, candidates, new_name, pos)
        }
        BinaryPart::CallExpressionKw(call) => {
            call.unlabeled.as_mut().is_some_and(|u| recurse(u, candidates))
                || call.arguments.iter_mut().any(|arg| recurse(&mut arg.arg, candidates))
        }
        BinaryPart::MemberExpression(member) => {
            recurse(&mut member.object, candidates) || recurse(&mut member.property, candidates)
        }
        BinaryPart::ArrayExpression(array) => array.elements.iter_mut().any(|e| recurse(e, candidates)),
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element, candidates) || recurse(&mut range.end_element, candidates)
        }
        BinaryPart::ObjectExpression(obj) => obj.properties.iter_mut().any(|p| recurse(&mut p.value, candidates)),
        BinaryPart::IfExpression(if_expr) => {
            let recurse_body = |b: &mut Node<Program>, c: &mut SketchSymbolCandidates| {
                b.as_source_range().contains(pos) && rename_sketch_symbol_in_body(&mut b.body, c, new_name, pos, false)
            };
            recurse(&mut if_expr.cond, candidates)
                || recurse_body(&mut if_expr.then_val, candidates)
                || if_expr.else_ifs.iter_mut().any(|else_if| {
                    recurse(&mut else_if.cond, candidates) || recurse_body(&mut else_if.then_val, candidates)
                })
                || recurse_body(&mut if_expr.final_else, candidates)
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr, candidates),
    }
}

/// Rename member references to a sketch block symbol in a nested scope: `<sketch>.<old>` and
/// `<region>.tags.<old>`. Stops tracking a sketch or region name once an item rebinds
/// (shadows) it, since member references after that refer to the new binding. References
/// within the rebinding item itself are still renamed, consistent with identifier renames.
/// Regions derived from the sketch that are declared in this scope are tracked from their
/// declaration on, as long as the sketch itself is still live here.
fn rename_sketch_member_refs_in_body(
    body: &mut [BodyItem],
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let mut sketch_name = sketch_name;
    let mut region_names = region_names.to_vec();
    let mut region_fn_shadowed = std_region_shadowed;
    for item in body {
        if sketch_name.is_none() && region_names.is_empty() {
            return;
        }
        if let Some(expr) = body_item_expr_mut(item) {
            rename_sketch_member_refs_expr(expr, sketch_name, &region_names, old_name, new_name, region_fn_shadowed);
        }
        if sketch_name.is_some_and(|s| body_item_binds_name(item, s)) {
            sketch_name = None;
        }
        region_names.retain(|r| !body_item_binds_name(item, r));
        // Discover regions after the drops, so that a region declaration isn't dropped for
        // binding its own name. Only calls to the standard `region` function derive; a user
        // binding of that name shadows it from its item on.
        if !region_fn_shadowed
            && let Some(s) = sketch_name
            && let BodyItem::VariableDeclaration(decl) = &*item
            && is_region_derived_from_sketch(decl, s)
        {
            region_names.push(decl.declaration.id.name.clone());
        }
        region_fn_shadowed |= body_item_binds_name(item, "region");
    }
}

fn rename_sketch_member_refs_expr(
    expr: &mut Expr,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let recurse = |e: &mut Expr| {
        rename_sketch_member_refs_expr(e, sketch_name, region_names, old_name, new_name, std_region_shadowed)
    };
    let recurse_body = |b: &mut Node<Program>| {
        rename_sketch_member_refs_in_body(
            &mut b.body,
            sketch_name,
            region_names,
            old_name,
            new_name,
            std_region_shadowed,
        )
    };
    match expr {
        Expr::Literal(_)
        | Expr::Name(_)
        | Expr::TagDeclarator(_)
        | Expr::PipeSubstitution(_)
        | Expr::SketchVar(_)
        | Expr::None(_) => {}
        Expr::MemberExpression(member) => {
            rename_sketch_member_ref(member, sketch_name, region_names, old_name, new_name);
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        Expr::FunctionExpression(func) => {
            // The function's own name or a parameter can shadow the sketch or region
            // variables, or the standard `region` function, for the whole body.
            let sketch_name = sketch_name.filter(|s| !func.binds_name(s));
            let region_names: Vec<String> = region_names.iter().filter(|r| !func.binds_name(r)).cloned().collect();
            if sketch_name.is_some() || !region_names.is_empty() {
                let region_fn_shadowed = std_region_shadowed || func.binds_name("region");
                rename_sketch_member_refs_in_body(
                    &mut func.body.body,
                    sketch_name,
                    &region_names,
                    old_name,
                    new_name,
                    region_fn_shadowed,
                );
            }
        }
        Expr::SketchBlock(sketch_block) => {
            for arg in &mut sketch_block.arguments {
                recurse(&mut arg.arg);
            }
            rename_sketch_member_refs_in_body(
                &mut sketch_block.body.items,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            recurse_body(&mut if_expr.then_val);
            for else_if in &mut if_expr.else_ifs {
                rename_sketch_member_refs_expr(
                    &mut else_if.cond,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
                rename_sketch_member_refs_in_body(
                    &mut else_if.then_val.body,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
            }
            recurse_body(&mut if_expr.final_else);
        }
        Expr::BinaryExpression(bin_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.left,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.right,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::UnaryExpression(unary_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut unary_expr.argument,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        Expr::CallExpressionKw(call) => {
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        Expr::PipeExpression(pipe) => {
            for e in &mut pipe.body {
                recurse(e);
            }
        }
        Expr::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        Expr::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        Expr::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        Expr::LabelledExpression(labeled) => recurse(&mut labeled.expr),
        Expr::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

fn rename_sketch_member_refs_binary_part(
    part: &mut BinaryPart,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
    std_region_shadowed: bool,
) {
    let recurse = |e: &mut Expr| {
        rename_sketch_member_refs_expr(e, sketch_name, region_names, old_name, new_name, std_region_shadowed)
    };
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => {}
        BinaryPart::MemberExpression(member) => {
            rename_sketch_member_ref(member, sketch_name, region_names, old_name, new_name);
            recurse(&mut member.object);
            recurse(&mut member.property);
        }
        BinaryPart::BinaryExpression(bin_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.left,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            rename_sketch_member_refs_binary_part(
                &mut bin_expr.right,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::UnaryExpression(unary_expr) => {
            rename_sketch_member_refs_binary_part(
                &mut unary_expr.argument,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::CallExpressionKw(call) => {
            if let Some(unlabeled) = &mut call.unlabeled {
                recurse(unlabeled);
            }
            for arg in &mut call.arguments {
                recurse(&mut arg.arg);
            }
        }
        BinaryPart::ArrayExpression(array) => {
            for e in &mut array.elements {
                recurse(e);
            }
        }
        BinaryPart::ArrayRangeExpression(range) => {
            recurse(&mut range.start_element);
            recurse(&mut range.end_element);
        }
        BinaryPart::ObjectExpression(obj) => {
            for property in &mut obj.properties {
                recurse(&mut property.value);
            }
        }
        BinaryPart::IfExpression(if_expr) => {
            recurse(&mut if_expr.cond);
            rename_sketch_member_refs_in_body(
                &mut if_expr.then_val.body,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
            for else_if in &mut if_expr.else_ifs {
                rename_sketch_member_refs_expr(
                    &mut else_if.cond,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
                rename_sketch_member_refs_in_body(
                    &mut else_if.then_val.body,
                    sketch_name,
                    region_names,
                    old_name,
                    new_name,
                    std_region_shadowed,
                );
            }
            rename_sketch_member_refs_in_body(
                &mut if_expr.final_else.body,
                sketch_name,
                region_names,
                old_name,
                new_name,
                std_region_shadowed,
            );
        }
        BinaryPart::AscribedExpression(ascribed) => recurse(&mut ascribed.expr),
    }
}

/// If this member expression is `<sketch>.<old>`, or `<region>.tags.<old>` for one of the
/// given regions, rename its property to the new name.
fn rename_sketch_member_ref(
    member: &mut Node<MemberExpression>,
    sketch_name: Option<&str>,
    region_names: &[String],
    old_name: &str,
    new_name: &str,
) {
    // Reborrow through the Node so that the object and property field borrows are disjoint.
    let member = &mut **member;
    if member.computed {
        return;
    }
    let Expr::Name(property) = &mut member.property else {
        return;
    };
    if property.local_ident().map(|ident| ident.inner) != Some(old_name) {
        return;
    }
    let object_is_sketch_or_region_tags = match &member.object {
        Expr::Name(object) => sketch_name.is_some_and(|s| object.local_ident().is_some_and(|ident| ident.inner == s)),
        Expr::MemberExpression(inner) => {
            !inner.computed
                && matches!(&inner.object, Expr::Name(o) if o.local_ident().is_some_and(|ident| region_names.iter().any(|r| r == ident.inner)))
                && matches!(&inner.property, Expr::Name(p) if p.local_ident().is_some_and(|ident| ident.inner == "tags"))
        }
        _ => false,
    };
    if object_is_sketch_or_region_tags {
        property.name.name = new_name.to_owned();
    }
}

/// Whether this body item introduces a binding for `name`: a variable declaration, or a
/// TagDeclarator, LabelledExpression label, or named function anywhere in its expressions.
/// Names bound inside nested function bodies don't count; they are scoped to that function.
/// Mirrors frontend modify::find_defined_names_expr.
fn body_item_binds_name(item: &BodyItem, name: &str) -> bool {
    match item {
        BodyItem::ImportStatement(import) => match &import.selector {
            ImportSelector::List { items } => items.iter().any(|item| item.identifier() == name),
            // A whole-module import binds in the module namespace, which the executor keeps
            // separate from ordinary values (modules are stored under a prefix and resolved
            // as a fallback), so it doesn't shadow value bindings.
            ImportSelector::None { .. } => false,
            // A glob import binds an unknowable set of names; treat it as binding none rather
            // than stopping every rename that crosses it.
            ImportSelector::Glob(_) => false,
        },
        BodyItem::TypeDeclaration(_) => false,
        BodyItem::ExpressionStatement(expr_stmt) => expr_binds_name(&expr_stmt.expression, name),
        BodyItem::VariableDeclaration(var_decl) => {
            var_decl.declaration.id.name == name || expr_binds_name(&var_decl.declaration.init, name)
        }
        BodyItem::ReturnStatement(ret_stmt) => expr_binds_name(&ret_stmt.argument, name),
    }
}

fn expr_binds_name(expr: &Expr, name: &str) -> bool {
    match expr {
        Expr::TagDeclarator(tag_decl) => tag_decl.name == name,
        Expr::LabelledExpression(labeled) => labeled.label.name == name || expr_binds_name(&labeled.expr, name),
        Expr::FunctionExpression(func) => func.name.as_ref().is_some_and(|n| n.name == name),
        Expr::CallExpressionKw(call) => call.iter_arguments().any(|(_, arg)| expr_binds_name(arg, name)),
        Expr::PipeExpression(pipe) => pipe.body.iter().any(|e| expr_binds_name(e, name)),
        Expr::BinaryExpression(bin_expr) => {
            binary_part_binds_name(&bin_expr.left, name) || binary_part_binds_name(&bin_expr.right, name)
        }
        Expr::ArrayExpression(array) => array.elements.iter().any(|e| expr_binds_name(e, name)),
        Expr::ArrayRangeExpression(range) => {
            expr_binds_name(&range.start_element, name) || expr_binds_name(&range.end_element, name)
        }
        Expr::ObjectExpression(obj) => obj.properties.iter().any(|p| expr_binds_name(&p.value, name)),
        Expr::MemberExpression(member) => {
            expr_binds_name(&member.object, name) || expr_binds_name(&member.property, name)
        }
        Expr::UnaryExpression(unary_expr) => binary_part_binds_name(&unary_expr.argument, name),
        Expr::IfExpression(if_expr) => {
            // Branches execute in the current environment, so their declarations bind here
            // too; only one branch runs, but any branch binding conservatively counts.
            expr_binds_name(&if_expr.cond, name)
                || if_expr
                    .then_val
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
                || if_expr.else_ifs.iter().any(|else_if| {
                    expr_binds_name(&else_if.cond, name)
                        || else_if
                            .then_val
                            .body
                            .iter()
                            .any(|item| body_item_binds_name(item, name))
                })
                || if_expr
                    .final_else
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
        }
        Expr::AscribedExpression(expr) => expr_binds_name(&expr.expr, name),
        Expr::SketchBlock(sketch_block) => sketch_block.arguments.iter().any(|a| expr_binds_name(&a.arg, name)),
        Expr::Literal(_) | Expr::Name(_) | Expr::PipeSubstitution(_) | Expr::SketchVar(_) | Expr::None(_) => false,
    }
}

fn binary_part_binds_name(part: &BinaryPart, name: &str) -> bool {
    match part {
        BinaryPart::Literal(_) | BinaryPart::Name(_) | BinaryPart::SketchVar(_) => false,
        BinaryPart::BinaryExpression(binary_expr) => {
            binary_part_binds_name(&binary_expr.left, name) || binary_part_binds_name(&binary_expr.right, name)
        }
        BinaryPart::CallExpressionKw(call) => call.iter_arguments().any(|(_, arg)| expr_binds_name(arg, name)),
        BinaryPart::UnaryExpression(unary_expr) => binary_part_binds_name(&unary_expr.argument, name),
        BinaryPart::MemberExpression(member) => {
            expr_binds_name(&member.object, name) || expr_binds_name(&member.property, name)
        }
        BinaryPart::ArrayExpression(array) => array.elements.iter().any(|e| expr_binds_name(e, name)),
        BinaryPart::ArrayRangeExpression(range) => {
            expr_binds_name(&range.start_element, name) || expr_binds_name(&range.end_element, name)
        }
        BinaryPart::ObjectExpression(obj) => obj.properties.iter().any(|p| expr_binds_name(&p.value, name)),
        BinaryPart::IfExpression(if_expr) => {
            // See the Expr::IfExpression case: branch declarations bind the current
            // environment.
            expr_binds_name(&if_expr.cond, name)
                || if_expr
                    .then_val
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
                || if_expr.else_ifs.iter().any(|else_if| {
                    expr_binds_name(&else_if.cond, name)
                        || else_if
                            .then_val
                            .body
                            .iter()
                            .any(|item| body_item_binds_name(item, name))
                })
                || if_expr
                    .final_else
                    .body
                    .iter()
                    .any(|item| body_item_binds_name(item, name))
        }
        BinaryPart::AscribedExpression(expr) => expr_binds_name(&expr.expr, name),
    }
}

/// An expression can be evaluated to yield a single KCL value.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    SketchBlock(BoxNode<SketchBlock>),
    SketchVar(BoxNode<SketchVar>),
    None(Node<KclNone>),
}

impl Expr {
    pub fn get_lsp_folding_range(&self) -> Option<FoldingRange> {
        let mut recasted = String::new();
        self.recast(
            &mut recasted,
            &FormatOptions::default(),
            0,
            crate::unparser::ExprContext::Other,
        );
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
            Expr::SketchBlock(expr) => Some(&expr.non_code_meta),
            Expr::SketchVar(_) => None,
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
            Expr::SketchBlock(e) => e.replace_value(source_range, new_value),
            Expr::SketchVar(_) => {}
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
            Expr::SketchBlock(sketch_block) => sketch_block.start,
            Expr::SketchVar(expr) => expr.start,
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
            Expr::SketchBlock(expr) => expr.end,
            Expr::SketchVar(expr) => expr.end,
            Expr::None(none) => none.end,
        }
    }

    pub(crate) fn node_path(&self) -> Option<&NodePath> {
        match self {
            Expr::Literal(node) => node.node_path.as_ref(),
            Expr::Name(node) => node.node_path.as_ref(),
            Expr::TagDeclarator(node) => node.node_path.as_ref(),
            Expr::BinaryExpression(node) => node.node_path.as_ref(),
            Expr::FunctionExpression(node) => node.node_path.as_ref(),
            Expr::CallExpressionKw(node) => node.node_path.as_ref(),
            Expr::PipeExpression(node) => node.node_path.as_ref(),
            Expr::PipeSubstitution(node) => node.node_path.as_ref(),
            Expr::ArrayExpression(node) => node.node_path.as_ref(),
            Expr::ArrayRangeExpression(node) => node.node_path.as_ref(),
            Expr::ObjectExpression(node) => node.node_path.as_ref(),
            Expr::MemberExpression(node) => node.node_path.as_ref(),
            Expr::UnaryExpression(node) => node.node_path.as_ref(),
            Expr::IfExpression(node) => node.node_path.as_ref(),
            Expr::LabelledExpression(node) => node.node_path.as_ref(),
            Expr::AscribedExpression(node) => node.node_path.as_ref(),
            Expr::SketchBlock(node) => node.node_path.as_ref(),
            Expr::SketchVar(node) => node.node_path.as_ref(),
            Expr::None(node) => node.node_path.as_ref(),
        }
    }

    fn contains_range(&self, range: &SourceRange) -> bool {
        let expr_range = SourceRange::from(self);
        expr_range.contains_range(range)
    }

    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name, following the
    /// executor's evaluation order: returns true as soon as something rebinds the old name (a
    /// tag declarator, an expression label, or a named function expression, which the
    /// executor binds the moment it evaluates them), so that references evaluated after the
    /// rebinding are left alone.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            Expr::Literal(_literal) => false,
            Expr::Name(identifier) => {
                identifier.rename(old_name, new_name);
                false
            }
            Expr::TagDeclarator(tag) => {
                // TagDeclarators introduce new bindings. Renaming other symbols should not
                // rewrite the tag's identifier, but the executor binds the tag's name as soon
                // as it is evaluated, shadowing the name being renamed from here on.
                tag.name == old_name
            }
            Expr::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            Expr::FunctionExpression(function_expression) => function_expression.rename_identifiers(old_name, new_name),
            Expr::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Expr::PipeExpression(pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Expr::PipeSubstitution(_) => false,
            Expr::ArrayExpression(array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Expr::ArrayRangeExpression(array_range) => array_range.rename_identifiers(old_name, new_name),
            Expr::ObjectExpression(object_expression) => object_expression.rename_identifiers(old_name, new_name),
            Expr::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            Expr::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            Expr::IfExpression(expr) => expr.rename_identifiers(old_name, new_name),
            Expr::LabelledExpression(expr) => {
                // The label binds after its expression evaluates.
                let bound = expr.expr.rename_identifiers(old_name, new_name);
                bound || expr.label.name == old_name
            }
            Expr::AscribedExpression(expr) => expr.expr.rename_identifiers(old_name, new_name),
            Expr::SketchBlock(expr) => expr.rename_identifiers(old_name, new_name),
            Expr::SketchVar(_) => false,
            Expr::None(_) => false,
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
            Expr::SketchBlock(expr) => ConstraintLevel::Ignore {
                source_ranges: vec![expr.into()],
            },
            Expr::SketchVar(expr) => expr.get_constraint_level(),
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

    /// If we have a named function expression, return the name being declared.
    /// This is a purely lexical check to handle the fact that we copy the fn
    /// variable declaration name to the function expression name while parsing.
    pub fn fn_declaring_name(&self) -> Option<&str> {
        match self {
            Expr::Literal(_) => None,
            Expr::Name(_) => None,
            Expr::TagDeclarator(_) => None,
            Expr::BinaryExpression(_) => None,
            Expr::FunctionExpression(func) => func.name.as_ref().map(|name| name.name.as_str()),
            Expr::CallExpressionKw(_) => None,
            Expr::PipeExpression(_) => None,
            Expr::PipeSubstitution(_) => None,
            Expr::ArrayExpression(_) => None,
            Expr::ArrayRangeExpression(_) => None,
            Expr::ObjectExpression(_) => None,
            Expr::MemberExpression(_) => None,
            Expr::UnaryExpression(_) => None,
            Expr::IfExpression(_) => None,
            Expr::LabelledExpression(node) => node.expr.fn_declaring_name(),
            Expr::AscribedExpression(node) => node.expr.fn_declaring_name(),
            Expr::SketchBlock(_) => None,
            Expr::SketchVar(_) => None,
            Expr::None(_) => None,
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
            BinaryPart::SketchVar(e) => Expr::SketchVar(e.clone()),
        }
    }
}

impl TryFrom<Expr> for BinaryPart {
    type Error = String;

    fn try_from(expr: Expr) -> Result<Self, Self::Error> {
        match expr {
            Expr::Literal(n) => Ok(BinaryPart::Literal(n)),
            Expr::Name(n) => Ok(BinaryPart::Name(n)),
            Expr::BinaryExpression(n) => Ok(BinaryPart::BinaryExpression(n)),
            Expr::CallExpressionKw(n) => Ok(BinaryPart::CallExpressionKw(n)),
            Expr::UnaryExpression(n) => Ok(BinaryPart::UnaryExpression(n)),
            Expr::MemberExpression(n) => Ok(BinaryPart::MemberExpression(n)),
            Expr::ArrayExpression(n) => Ok(BinaryPart::ArrayExpression(n)),
            Expr::ArrayRangeExpression(n) => Ok(BinaryPart::ArrayRangeExpression(n)),
            Expr::ObjectExpression(n) => Ok(BinaryPart::ObjectExpression(n)),
            Expr::IfExpression(n) => Ok(BinaryPart::IfExpression(n)),
            Expr::AscribedExpression(n) => Ok(BinaryPart::AscribedExpression(n)),
            Expr::SketchVar(n) => Ok(BinaryPart::SketchVar(n)),
            other => Err(format!("Expression type cannot be converted to BinaryPart: {other:?}")),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct SketchBlock {
    pub arguments: Vec<LabeledArg>,
    pub body: Node<Block>,

    /// Transient field to indicate whether the sketch block is being edited.
    #[serde(skip)]
    pub is_being_edited: bool,

    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl SketchBlock {
    pub(crate) const CALLEE_NAME: &str = "sketch";

    /// Iterate over all arguments.
    pub fn iter_arguments(&self) -> impl Iterator<Item = (Option<&Node<Identifier>>, &Expr)> {
        self.arguments.iter().map(|arg| (arg.label.as_ref(), &arg.arg))
    }

    /// Iterate over all arguments.
    pub fn iter_arguments_mut(&mut self) -> impl Iterator<Item = (Option<&mut Node<Identifier>>, &mut Expr)> {
        self.arguments.iter_mut().map(|arg| (arg.label.as_mut(), &mut arg.arg))
    }

    fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for arg in &mut self.arguments {
            arg.arg.replace_value(source_range, new_value.clone());
        }

        self.body.replace_value(source_range, new_value);
    }

    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for arg in &mut self.arguments {
            if arg.arg.rename_identifiers(old_name, new_name) {
                // A binding in an argument shadows the name for the block body too.
                return true;
            }
        }

        // The block's declarations are scoped to the block (exposed as member references on
        // the sketch value), so they don't rebind the enclosing environment.
        self.body.rename_identifiers(old_name, new_name);
        false
    }
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Block {
    pub items: Vec<BodyItem>,
    #[serde(default, skip_serializing_if = "NonCodeMeta::is_empty")]
    pub non_code_meta: NonCodeMeta,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inner_attrs: NodeList<Annotation>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl From<Program> for Block {
    fn from(program: Program) -> Self {
        Block {
            items: program.body,
            non_code_meta: program.non_code_meta,
            inner_attrs: program.inner_attrs,
            digest: None,
        }
    }
}

impl CodeBlock for Node<Block> {
    fn body(&self) -> &Vec<BodyItem> {
        &self.items
    }

    fn body_mut(&mut self) -> &mut Vec<BodyItem> {
        &mut self.items
    }

    fn non_code_meta_mut(&mut self) -> &mut NonCodeMeta {
        &mut self.non_code_meta
    }

    fn to_source_range(&self) -> SourceRange {
        SourceRange::new(self.start, self.end, self.module_id)
    }
}

impl Block {
    fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for item in &mut self.items {
            item.replace_value(source_range, new_value.clone());
        }
    }

    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        rename_identifiers_in_body(&mut self.items, old_name, new_name)
    }

    /// Returns the body item that includes the given character position.
    fn get_body_item_for_position(&self, pos: usize) -> Option<&BodyItem> {
        for item in &self.items {
            let source_range = SourceRange::from(item);
            if source_range.contains(pos) {
                return Some(item);
            }
        }

        None
    }

    /// Returns an Expr that includes the given character position.
    pub fn get_expr_for_position(&self, pos: usize) -> Option<&Expr> {
        let item = self.get_body_item_for_position(pos)?;

        item.get_expr_for_position(pos)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct SketchVar {
    pub initial: Option<BoxNode<NumericLiteral>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<SketchVar> {
    /// Get the constraint level for this variable.
    /// Variables are always not constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: vec![self.into()],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    SketchVar(BoxNode<SketchVar>),
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
            BinaryPart::SketchVar(e) => e.get_constraint_level(),
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
            BinaryPart::SketchVar(_) => {}
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
            BinaryPart::SketchVar(e) => e.start,
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
            BinaryPart::SketchVar(e) => e.end,
        }
    }

    /// Rename all identifiers that have the old name to the new given name.
    /// Rename all identifiers that have the old name to the new given name, following the
    /// executor's evaluation order; see [Expr::rename_identifiers].
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        match self {
            BinaryPart::Literal(_literal) => false,
            BinaryPart::Name(identifier) => {
                identifier.rename(old_name, new_name);
                false
            }
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.rename_identifiers(old_name, new_name),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            BinaryPart::MemberExpression(member_expression) => member_expression.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ArrayRangeExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::ObjectExpression(e) => e.rename_identifiers(old_name, new_name),
            BinaryPart::IfExpression(if_expression) => if_expression.rename_identifiers(old_name, new_name),
            BinaryPart::AscribedExpression(e) => e.expr.rename_identifiers(old_name, new_name),
            BinaryPart::SketchVar(_) => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
            NonCodeValue::NewLine => "\n\n".to_string(),
        }
    }

    fn is_comment(&self) -> bool {
        match self.value {
            NonCodeValue::InlineComment { .. } => true,
            NonCodeValue::BlockComment { .. } => true,
            NonCodeValue::NewLine => false,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    /// This is always the case.
    BlockComment {
        value: String,
        style: CommentStyle,
    },
    // A new line like `\n\n` NOT a new line like `\n`.
    // i.e. an empty line, not just the ending of a non-empty line.
    // This is also not a comment.
    NewLine,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, ts_rs::TS)]
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

    /// The source range of a comment node should start at a '/', because both
    /// styles of comments (// line comments and /* block comments */) start
    /// with a /.
    /// If a comment does NOT start with a /, that likely indicates an off-by-one
    /// error, or some other kindof inaccurate source range. This is bad, because the
    /// LSP won't offer suggestions if it thinks the user is in a comment.
    /// So inaccurate comment start/ends could cause disabling autocompletion.
    pub fn comment_start_is_accurate(&self, str: &[u8]) -> bool {
        for nodes in self.non_code_nodes.values() {
            for node in nodes {
                match node.inner.value {
                    NonCodeValue::InlineComment { .. } => {
                        if str[node.start] != b'/' {
                            eprintln!("{:?}", node);
                            return false;
                        }
                    }
                    NonCodeValue::BlockComment { .. } => {
                        if str[node.start] != b'/' {
                            eprintln!("{:?}", node);
                            return false;
                        }
                    }
                    NonCodeValue::NewLine => {}
                }
            }
        }
        true
    }

    /// Split non-code metadata at the given body index. Returns the
    /// `NonCodeMeta` for `body[..split]` and mutates `self` in place to
    /// become the metadata for `body[split..]`.
    ///
    /// The key convention is that `non_code_nodes[k]` holds comments
    /// *after* `body[k]` (equivalently, *before* `body[k+1]`).
    ///
    /// Keys `0..split-1` go to the left side (they sit between/after
    /// elements that were all drained). Keys `split..` stay on the
    /// right side, re-keyed by subtracting `split`.
    pub fn split_at(&mut self, split: usize) -> NonCodeMeta {
        // Comments before body[0] belong to the left (extracted) side.
        let left_start = std::mem::take(&mut self.start_nodes);

        // Partition non_code_nodes by key.
        let mut left_nodes = BTreeMap::new();
        let mut right_nodes = BTreeMap::new();

        for (k, v) in std::mem::take(&mut self.non_code_nodes) {
            if k < split {
                // After an element that moved to the left side.
                left_nodes.insert(k, v);
            } else {
                // After an element that stays on the right side, re-keyed.
                right_nodes.insert(k - split, v);
            }
        }

        self.start_nodes = Default::default();
        self.non_code_nodes = right_nodes;
        self.digest = None;

        NonCodeMeta {
            non_code_nodes: left_nodes,
            start_nodes: left_start,
            digest: None,
        }
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

    /// Get a property by name. This is O(n) in the number of properties.
    pub(crate) fn property(&self, name: &str) -> Option<&Node<ObjectProperty>> {
        match &self.properties {
            Some(props) => props.iter().find(|p| p.key.name == name),
            None => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
                if !use_source_range.contains(pos) {
                    return None;
                }
                // The import has no alias, so rename by adding one, e.g. `import foo from "m.kcl"`
                // becomes `import foo as bar from "m.kcl"`.
                let old_name = self.name.name.clone();
                self.alias = Some(Identifier::new(new_name));
                Some(old_name)
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
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

    pub fn exposes_imported_name(&self) -> bool {
        matches!(self, ImportSelector::None { alias: None })
    }

    pub fn imports_items(&self) -> bool {
        !matches!(self, ImportSelector::None { .. })
    }
}

#[derive(Clone, Eq, PartialEq, Debug, Deserialize, Serialize, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    /// Get the name of the module object for this import.
    /// Validated during parsing and guaranteed to return `Some` if the statement imports
    /// the module itself (i.e., self.selector is ImportSelector::None).
    pub fn module_name(&self) -> Option<String> {
        if let ImportSelector::None { alias: Some(alias) } = &self.selector {
            return Some(alias.name.clone());
        }

        match &self.path {
            ImportPath::Kcl { filename: s } | ImportPath::Foreign { path: s } => Self::non_std_module_name(s),
            ImportPath::Std { path } => path.last().cloned(),
        }
    }

    /// Given the path to a non-std module, extract the module name if possible.
    pub(crate) fn non_std_module_name(path: &TypedPath) -> Option<String> {
        let name = path.to_string_lossy();
        if name.ends_with("/main.kcl") || name.ends_with("\\main.kcl") {
            let name = &name[..name.len() - 9];
            let start = name.rfind(['/', '\\']).map(|s| s + 1).unwrap_or(0);
            return Some(name[start..].to_owned());
        }

        let name = path.file_name()?;
        if name.contains('\\') || name.contains('/') {
            return None;
        }

        // Remove the extension if it exists.
        let extension = path.extension();
        Some(if let Some(extension) = extension {
            name.trim_end_matches(extension).trim_end_matches('.').to_string()
        } else {
            name
        })
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub expression: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    pub fn new(name: &str, unlabeled: Option<Expr>, arguments: Vec<LabeledArg>) -> Node<Self> {
        Node::no_src(Self {
            callee: Name::new(name),
            unlabeled,
            arguments,
            digest: None,
            non_code_meta: Default::default(),
        })
    }

    /// Iterate over all arguments (labeled or not)
    pub fn iter_arguments(&self) -> impl Iterator<Item = (Option<&Node<Identifier>>, &Expr)> {
        self.unlabeled
            .iter()
            .map(|e| (None, e))
            .chain(self.arguments.iter().map(|arg| (arg.label.as_ref(), &arg.arg)))
    }

    /// Iterate over all arguments (labeled or not)
    pub fn iter_arguments_mut(&mut self) -> impl Iterator<Item = (Option<&mut Node<Identifier>>, &mut Expr)> {
        self.unlabeled
            .iter_mut()
            .map(|e| (None, e))
            .chain(self.arguments.iter_mut().map(|arg| (arg.label.as_mut(), &mut arg.arg)))
    }

    pub fn num_arguments(&self) -> usize {
        self.arguments.len() + if self.unlabeled.is_some() { 1 } else { 0 }
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
    /// Rename all identifiers that have the old name to the new given name. The executor
    /// evaluates arguments in order and binds tags immediately, so renaming stops at an
    /// argument that rebinds the old name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.callee.rename(old_name, new_name);

        if let Some(unlabeled) = &mut self.unlabeled
            && unlabeled.rename_identifiers(old_name, new_name)
        {
            return true;
        }

        for arg in &mut self.arguments {
            if arg.arg.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct TypeDeclaration {
    pub name: Node<Identifier>,
    pub args: Option<NodeList<Identifier>>,
    #[serde(default, skip_serializing_if = "ItemVisibility::is_default")]
    pub visibility: ItemVisibility,
    pub definition: TypeDeclarationDefinition,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl TypeDeclaration {
    pub(crate) fn name(&self) -> &str {
        &self.name.name
    }
}

/// What a type declaration declares its name to be.
///
/// A discriminated definition rather than optional fields so that impossible
/// combinations (e.g. a declaration that is both an alias and an enum) cannot
/// be represented. A future nominal product (struct) definition would be added
/// as another variant here.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum TypeDeclarationDefinition {
    /// A declaration with no definition, e.g. `type Sketch`. Used for types
    /// implemented in Rust and primitives, whose declarations exist for
    /// documentation.
    Bare,
    /// An alias of another type, e.g. `type Temperature = number(_)`.
    Alias { ty: BoxNode<Type> },
    /// A nominal sum type with nullary variants, e.g. `type Color { | Red | Green | Blue }`.
    Enum(Box<EnumDeclaration>),
}

/// The body of an enum type declaration: its variants, e.g. `{ | Red | Green | Blue }`.
#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct EnumDeclaration {
    pub variants: NodeList<EnumVariant>,
    /// Comments and blank lines inside the enum body which are not strongly
    /// associated with a variant, keyed by variant index like
    /// `Program::non_code_meta`.
    pub non_code_meta: NonCodeMeta,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

/// A single nullary enum variant, e.g. `| Red`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct EnumVariant {
    pub name: Node<Identifier>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
        let mut recasted = String::new();
        self.recast(&mut recasted, &FormatOptions::default(), 0);
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
            let old_name = std::mem::replace(&mut self.declaration.id.name, new_name.to_string());
            // A function declaration `fn foo() {}` also records its name on the function
            // expression; keep it in sync. A named function expression assigned to a variable
            // (`foo = fn bar() {}`) is a distinct binding and is left alone.
            if let Expr::FunctionExpression(func) = &mut self.declaration.init
                && let Some(fn_name) = &mut func.name
                && fn_name.name == old_name
            {
                fn_name.name = new_name.to_string();
            }
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
        self.declaration.init.replace_value(source_range, new_value);
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

    pub fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        // The declaration that was just renamed (its id is already the new name): the variable
        // is not bound inside its own initializer, since the value is created before the
        // variable is bound, so references to the old name there are not to this variable. The
        // exception is the `fn foo() {}` sugar, whose function name is kept in sync with the
        // declaration id; references in its body are the recursive binding and are renamed
        // along with it.
        if self.declaration.id.name == new_name {
            let is_fn_sugar = matches!(
                &self.declaration.init,
                Expr::FunctionExpression(func) if func.name.as_ref().is_some_and(|n| n.name == new_name)
            );
            if !is_fn_sugar {
                return false;
            }
        }
        // The initializer evaluates before the variable is bound, so a rebinding inside it
        // (e.g. a tag) takes effect first; either way the declaration's own id binds next.
        let bound = self.declaration.init.rename_identifiers(old_name, new_name);
        bound || self.declaration.id.name == old_name
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, ts_rs::TS, FromStr, Display)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NumericLiteral {
    pub value: f64,
    pub suffix: NumericSuffix,
    pub raw: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

impl Node<NumericLiteral> {
    /// Get the constraint level for this literal.
    /// Literals are always not constrained.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        ConstraintLevel::None {
            source_ranges: vec![self.into()],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

impl From<NumericLiteral> for Literal {
    fn from(n: NumericLiteral) -> Self {
        Literal {
            value: LiteralValue::Number {
                value: n.value,
                suffix: n.suffix,
            },
            raw: n.raw,
            digest: n.digest,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, Eq)]
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
    pub fn new<S: Into<String>>(name: S) -> Node<Self> {
        Node::no_src(Self {
            name: name.into(),
            digest: None,
        })
    }

    pub fn is_nameable(&self) -> bool {
        !self.name.starts_with('_')
    }
}

/// A qualified name, e.g., `foo`, `bar::foo`, or `::bar::foo`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    pub fn new<S: Into<String>>(name: S) -> Node<Self> {
        Node::no_src(Name {
            name: Node::no_src(Identifier {
                name: name.into(),
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
    /// Rename this name if it is a bare (unqualified) reference to the old name. The head of
    /// a qualified name (`foo::item`) is deliberately not touched: the executor resolves it
    /// in the module namespace, which is separate from ordinary values, so a value rename
    /// must not rewrite it. See [rename_module_refs_in_body] for the module namespace.
    fn rename(&mut self, old_name: &str, new_name: &str) {
        if let Some(n) = self.local_ident()
            && n.inner == old_name
        {
            self.name.name = new_name.to_owned();
        }
    }

    /// Rename the head segment of a qualified name (`foo::item`), which the executor resolves
    /// in the module namespace. Later segments are members within the module. An absolute
    /// path (`::foo::bar`) doesn't start with a module binding of this file.
    fn rename_module_head(&mut self, old_name: &str, new_name: &str) {
        if !self.abs_path
            && let Some(head) = self.path.first_mut()
            && head.name == old_name
        {
            head.name = new_name.to_owned();
        }
    }
}

impl Name {
    /// Write the full name to the given string.
    pub fn write_to<W: std::fmt::Write>(&self, buf: &mut W) -> std::fmt::Result {
        if self.abs_path {
            buf.write_str("::")?;
        };
        for p in &self.path {
            buf.write_str(&p.name)?;
            buf.write_str("::")?;
        }
        buf.write_str(&self.name.name)
    }
}

impl fmt::Display for Name {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.write_to(f)
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, Eq)]
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

impl std::fmt::Display for TagNode {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.inner.name.fmt(f)
    }
}

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
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for element in &mut self.elements {
            if element.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
        self.end_element.replace_value(source_range, new_value);
    }

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.start_element.rename_identifiers(old_name, new_name)
            || self.end_element.rename_identifiers(old_name, new_name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for property in &mut self.properties {
            if property.value.rename_identifiers(old_name, new_name) {
                return true;
            }
        }
        false
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub object: Expr,
    pub property: Expr,
    /// True if `obj[prop]`, false if obj.prop
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        if self.object.rename_identifiers(old_name, new_name) {
            return true;
        }
        // A non-computed property like the `bar` in `foo.bar` is a field or tag
        // access, not a reference to a variable named `bar`, so it is not
        // renamed.
        if self.computed {
            return self.property.rename_identifiers(old_name, new_name);
        }
        false
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.left.rename_identifiers(old_name, new_name) || self.right.rename_identifiers(old_name, new_name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, FromStr, Display)]
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
    /// Are two numbers or strings equal?
    #[serde(rename = "==")]
    #[display("==")]
    Eq,
    /// Are two numbers or strings not equal?
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        self.argument.rename_identifiers(old_name, new_name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, FromStr, Display)]
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
    /// Identity for numbers.
    #[serde(rename = "+")]
    #[display("+")]
    Plus,
}

impl UnaryOperator {
    pub fn digestable_id(&self) -> [u8; 3] {
        match self {
            UnaryOperator::Neg => *b"neg",
            UnaryOperator::Not => *b"not",
            UnaryOperator::Plus => *b"pls",
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        for statement in &mut self.body {
            if statement.rename_identifiers(old_name, new_name) {
                // A tag bound in an earlier pipe element shadows the name for later ones.
                return true;
            }
        }
        false
    }
}

#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "p_type")]
pub enum PrimitiveType {
    /// The super type of all other types.
    Any,
    /// `never`, the uninhabited subtype of all other types.
    Never,
    /// `none`, the type of none values.
    None,
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
            ("never", None) => Some(PrimitiveType::Never),
            ("none", None) => Some(PrimitiveType::None),
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
            PrimitiveType::Never => "values of type `never`".to_owned(),
            PrimitiveType::None => "none".to_owned(),
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
            PrimitiveType::Never => write!(f, "never"),
            PrimitiveType::None => write!(f, "none"),
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Parameter {
    /// Whether it's experimental.
    #[serde(default, skip_serializing_if = "is_false")]
    pub experimental: bool,
    /// If true, this parameter is deprecated regardless of the KCL version. Use
    /// `deprecated_since` instead to deprecate the parameter only at or after a
    /// particular version. At most one of the two may be set.
    #[serde(default, skip_serializing_if = "is_false")]
    pub deprecated: bool,
    /// If set, this parameter is deprecated as of the given KCL version (e.g.,
    /// "2.0"). The parser validates that this is a dotted integer version;
    /// downstream code reparses it into a `VersionConstraint`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deprecated_since: Option<VersionConstraint>,
    /// The parameter's label or name.
    pub identifier: Node<Identifier>,
    /// The type of the parameter.
    /// This is optional if the user defines a type.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub param_type: Option<Node<Type>>,
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

fn is_false(b: &bool) -> bool {
    !*b
}

fn is_true(b: &bool) -> bool {
    *b
}

fn return_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<Node<Identifier>>,
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

    pub fn name_str(&self) -> Option<&str> {
        self.name.as_ref().map(|id| id.name.as_str())
    }
}

impl FunctionExpression {
    pub fn required_and_optional_params(
        &self,
    ) -> Result<(&[Parameter], &[Parameter]), RequiredParamAfterOptionalParam> {
        let Self {
            name: _,
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

    /// Rename all identifiers that have the old name to the new given name.
    /// If the function's own name or one of its parameters shadows the old name, the body refers
    /// to that binding instead of the one being renamed, so there is nothing to rename.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) -> bool {
        // The executor binds a named function expression's name in the enclosing scope, so it
        // rebinds the old name there; a parameter only shadows inside the body.
        let name_binds = self.name.as_ref().is_some_and(|n| n.name == old_name);
        if !self.binds_name(old_name) {
            // The body is its own scope; its bindings don't leak into the enclosing walk.
            self.body.rename_identifiers(old_name, new_name);
        }
        name_binds
    }

    /// Whether the function's own name (its recursive binding) or one of its parameters binds
    /// `name` inside the function's body, shadowing any outer binding of that name.
    fn binds_name(&self, name: &str) -> bool {
        self.name.as_ref().is_some_and(|n| n.name == name) || self.params.iter().any(|p| p.identifier.name == name)
    }

    pub fn signature(&self) -> String {
        let mut signature = String::new();

        if self.params.is_empty() {
            signature.push_str("()");
        } else if self.params.len() == 1 {
            signature.push('(');
            self.params[0].recast(&mut signature, &FormatOptions::default(), 0);
            signature.push(')');
        } else {
            signature.push('(');
            for a in &self.params {
                signature.push_str("\n  ");
                a.recast(&mut signature, &FormatOptions::default(), 0);
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
                name: None,
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub argument: Expr,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

/// Format options.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    pub fn write_indentation(&self, buf: &mut String, times: usize) {
        let ind = if self.use_tabs { '\t' } else { ' ' };
        let n = if self.use_tabs { 1 } else { self.tab_size };
        for _ in 0..(times * n) {
            buf.push(ind);
        }
    }

    /// Get the indentation string for the given level.
    /// But offset the pipe operator (and a space) by one level.
    pub fn get_indentation_offset_pipe(&self, level: usize) -> String {
        if self.use_tabs {
            "\t".repeat(level + 1)
        } else {
            " ".repeat(level * self.tab_size + PIPE_OPERATOR.len() + 1)
        }
    }
}

/// The constraint level.
#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, Display)]
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
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
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
    use kcl_api::UnitLength;
    use kittycad_modeling_cmds::units::UnitLength as KcmcUnitLength;
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
            params[0].param_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::Number(NumericSuffix::Mm))
        );
        assert_eq!(
            params[1].param_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
        assert_eq!(
            params[2].param_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::String)
        );
    }

    #[test]
    fn test_parse_never_type() {
        let program = parse(
            "@settings(experimentalFeatures = allow)\n\
             fn stop(@impossible: never): never { return impossible }\n\
             type impossible = never\n\
             type neverReturns = fn(): never\n\
             type valueOrNever = string | never",
        );
        let BodyItem::VariableDeclaration(var_decl) = program.body.first().unwrap() else {
            panic!("expected a variable declaration")
        };
        let Expr::FunctionExpression(function) = &var_decl.declaration.init else {
            panic!("expected a function expression")
        };

        assert_eq!(
            function.params[0].param_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::Never)
        );
        assert_eq!(
            function.return_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::Never)
        );

        let BodyItem::TypeDeclaration(impossible) = &program.body[1] else {
            panic!("expected a type declaration")
        };
        let TypeDeclarationDefinition::Alias { ty: impossible } = &impossible.definition else {
            panic!("expected a type alias")
        };
        assert_eq!(impossible.inner, Type::Primitive(PrimitiveType::Never));

        let BodyItem::TypeDeclaration(never_returns) = &program.body[2] else {
            panic!("expected a type declaration")
        };
        let TypeDeclarationDefinition::Alias { ty: never_returns } = &never_returns.definition else {
            panic!("expected a type alias")
        };
        let Type::Primitive(PrimitiveType::Function(never_returns)) = &never_returns.inner else {
            panic!("expected a function type")
        };
        assert_eq!(
            never_returns.return_type.as_ref().unwrap().inner,
            Type::Primitive(PrimitiveType::Never)
        );

        let BodyItem::TypeDeclaration(value_or_never) = &program.body[3] else {
            panic!("expected a type declaration")
        };
        let TypeDeclarationDefinition::Alias { ty: value_or_never } = &value_or_never.definition else {
            panic!("expected a type alias")
        };
        let Type::Union { tys } = &value_or_never.inner else {
            panic!("expected a union type")
        };
        assert_eq!(tys[0].inner, Type::Primitive(PrimitiveType::String));
        assert_eq!(tys[1].inner, Type::Primitive(PrimitiveType::Never));

        assert_eq!(
            serde_json::to_value(PrimitiveType::Never).unwrap(),
            serde_json::json!({ "p_type": "Never" })
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
            params[0].param_type.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::Number(NumericSuffix::None))),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[1].param_type.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::String)),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[2].param_type.as_ref().unwrap().inner,
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
            params[0].param_type.as_ref().unwrap().inner,
            Type::Array {
                ty: Box::new(Type::Primitive(PrimitiveType::Number(NumericSuffix::None))),
                len: ArrayLen::None
            }
        );
        assert_eq!(
            params[1].param_type.as_ref().unwrap().inner,
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
            params[2].param_type.as_ref().unwrap().inner,
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
                    name: None,
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
                    name: None,
                    params: vec![Parameter {
                        experimental: Default::default(),
                        deprecated: false,
                        deprecated_since: None,
                        identifier: Node::no_src(Identifier {
                            name: "foo".to_owned(),
                            digest: None,
                        }),
                        param_type: None,
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
                    name: None,
                    params: vec![Parameter {
                        experimental: Default::default(),
                        deprecated: false,
                        deprecated_since: None,
                        identifier: Node::no_src(Identifier {
                            name: "foo".to_owned(),
                            digest: None,
                        }),
                        param_type: None,
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
                    name: None,
                    params: vec![
                        Parameter {
                            experimental: Default::default(),
                            deprecated: false,
                            deprecated_since: None,
                            identifier: Node::no_src(Identifier {
                                name: "foo".to_owned(),
                                digest: None,
                            }),
                            param_type: None,
                            default_value: None,
                            labeled: true,
                            digest: None,
                        },
                        Parameter {
                            experimental: Default::default(),
                            deprecated: false,
                            deprecated_since: None,
                            identifier: Node::no_src(Identifier {
                                name: "bar".to_owned(),
                                digest: None,
                            }),
                            param_type: None,
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

        assert_eq!(meta_settings.default_length_units, UnitLength::Inches);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_inch_to_mm() {
        let some_program_string = r#"@settings(defaultLengthUnit = inch)

startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, UnitLength::Inches);

        // Edit the ast.
        let new_program = program.change_default_units(Some(KcmcUnitLength::Millimeters)).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, UnitLength::Millimeters);

        let formatted = new_program.recast_top(&Default::default(), 0);

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
        let new_program = program.change_default_units(Some(KcmcUnitLength::Millimeters)).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, UnitLength::Millimeters);

        let formatted = new_program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = mm)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_nothing_to_kcl_version() {
        let some_program_string = r#"startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_none());

        // Edit the ast.
        let new_program = program.change_kcl_version(Some("2.0".to_owned())).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.kcl_version, "2.0");

        let formatted = new_program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(kclVersion = 2.0)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_updates_kcl_version() {
        let some_program_string = r#"@settings(defaultLengthUnit = in, kclVersion = 1.0)

startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        // Edit the ast.
        let new_program = program.change_kcl_version(Some("2.0".to_owned())).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, UnitLength::Inches);
        assert_eq!(meta_settings.kcl_version, "2.0");

        let formatted = new_program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = in, kclVersion = 2.0)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_experimental_features_deny_to_allow() {
        let some_program_string = r#"@settings(experimentalFeatures = deny)

startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.experimental_features, WarningLevel::Deny);

        // Edit the ast.
        let new_program = program.change_experimental_features(Some(WarningLevel::Allow)).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.experimental_features, WarningLevel::Allow);

        let formatted = new_program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(experimentalFeatures = allow)

startSketchOn(XY)
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_experimental_features_nothing_to_warn() {
        let some_program_string = r#"startSketchOn(XY)"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_none());

        // Edit the ast.
        let new_program = program.change_experimental_features(Some(WarningLevel::Warn)).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.experimental_features, WarningLevel::Warn);

        let formatted = new_program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(experimentalFeatures = warn)

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

        let new_program = program.change_default_units(Some(KcmcUnitLength::Centimeters)).unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(meta_settings.default_length_units, UnitLength::Centimeters);

        let formatted = new_program.recast_top(&Default::default(), 0);

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
    fn test_rename_renames_computed_member_index_but_not_dot_property() {
        // In `arr[key]` the index is a reference to the variable `key`, so it is renamed. In
        // `obj.key` the property is a field access unrelated to the variable, so it is not,
        // and neither is the `key` in the object literal.
        let code = r#"key = 1
arr = [10, 20, 30]
obj = { key = 2, other = 3 }
byIndex = arr[key]
byField = obj.key + key
"#;
        let mut program = parse(code);
        let pos = code.find("key").unwrap() + 1;

        program.rename_symbol("idx", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"idx = 1
arr = [10, 20, 30]
obj = { key = 2, other = 3 }
byIndex = arr[idx]
byField = obj.key + idx
"#
        );
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
        let formatted = program.recast_top(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"rise = 4.5
yoyo = 8
angle = atan(rise / yoyo)
"#
        );
    }

    #[test]
    fn test_rename_handles_tag_bindings() {
        let code = r#"BEST = 2

fn foo() {
  sketch001 = startSketchOn(XY)
  profile001 = startProfile(sketch001, at = [0, 0])
    |> xLine(length = BEST)
    |> yLine(length = BEST, tag = $BEST)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  return profile001
}

foo()
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("BETTER", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"BETTER = 2

fn foo() {
  sketch001 = startSketchOn(XY)
  profile001 = startProfile(sketch001, at = [0, 0])
    |> xLine(length = BETTER)
    |> yLine(length = BETTER, tag = $BEST)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  return profile001
}

foo()
"#
        );
    }

    #[test]
    fn test_rename_stops_mid_statement_at_tag_binding() {
        // The executor binds `$BEST` the moment it evaluates the tag, shadowing the outer
        // name from that point in evaluation order: references evaluated before the tag (the
        // `at` coordinate, evaluated in an earlier pipe element) are renamed; references
        // after it (a later argument of the same call, a later pipe element, or a later
        // statement) are not.
        let code = r#"BEST = 2

fn foo() {
  startProfile(startSketchOn(XY), at = [0, BEST])
    |> xLine(tag = $BEST, length = BEST)
    |> yLine(length = BEST)
    |> close()
  return BEST
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("BETTER", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"BETTER = 2

fn foo() {
  startProfile(startSketchOn(XY), at = [0, BETTER])
    |> xLine(tag = $BEST, length = BEST)
    |> yLine(length = BEST)
    |> close()
  return BEST
}
"#
        );
    }

    #[test]
    fn test_rename_stops_at_binding_in_if_branch() {
        // If-expression branches execute in the current environment, so the tag bound inside
        // the branch leaks; whether it binds depends on which branch runs, so renaming
        // conservatively stops after the if expression.
        let code = r#"foo = 1
val = if true {
  p = startProfile(startSketchOn(XY), at = [0, foo])
    |> line(end = [1, 1], tag = $foo)
    |> close()
  5
} else {
  0
}
after = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1
val = if true {
  p = startProfile(startSketchOn(XY), at = [0, bar])
    |> line(end = [1, 1], tag = $foo)
    |> close()
  5
} else {
  0
}
after = foo
"#
        );
    }

    #[test]
    fn test_rename_stops_after_shadowing() {
        let code = r#"foo = 1

fn demo(a) {
  before = foo
  foo = a
  after = foo
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("foo_initial", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"foo_initial = 1

fn demo(a) {
  before = foo_initial
  foo = a
  after = foo
}
"#
        );
    }

    #[test]
    fn test_rename_inside_if_then_branch() {
        let code = r#"param1 = 1
if true {
  param1
} else if false {
  param1 + 1
} else {
  param1 + 2
}
"#;
        let mut program = parse(code);
        let pos = code.find("param1").unwrap() + 1;

        program.rename_symbol("height", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"height = 1
if true {
  height
} else if false {
  height + 1
} else {
  height + 2
}
"#
        );
    }

    #[test]
    fn test_rename_fn_renames_recursive_calls() {
        let code = r#"fn accum(n) {
  return accum(n)
}
total = accum(3)
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("addUp", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn addUp(n) {
  return addUp(n)
}
total = addUp(3)
"#
        );
    }

    #[test]
    fn test_rename_does_not_touch_shadowing_nested_fn() {
        let code = r#"foo = 1

fn helper() {
  fn foo() {
    return foo()
  }
  return foo()
}
"#;
        let mut program = parse(code);
        let BodyItem::VariableDeclaration(first_decl) = program.body.first().unwrap() else {
            panic!("expected variable declaration")
        };
        let pos = first_decl.declaration.id.start + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn helper() {
  fn foo() {
    return foo()
  }
  return foo()
}
"#
        );
    }

    #[test]
    fn test_rename_import_without_alias_adds_alias() {
        let code = r#"import foo from "m.kcl"

x = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import foo as bar from "m.kcl"

x = bar
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration() {
        let code = r#"@settings(kclVersion = 2.0)

blockSketch = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 24mm])
  coincident([edge1.end, edge2.start])
}

blockRegion = region(point = [5mm, 3mm], sketch = blockSketch)
"#;
        let mut program = parse(code);
        let pos = code.find("edge1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"@settings(kclVersion = 2.0)

blockSketch = sketch(on = XY) {
  edgeOne = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  edge2 = line(start = [var 10mm, var 0mm], end = [var 10mm, var 24mm])
  coincident([edgeOne.end, edge2.start])
}

blockRegion = region(point = [5mm, 3mm], sketch = blockSketch)
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_member_references() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1, s.line2])
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("line1Prime", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1Prime = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1Prime, s.line2])
"#
        );
    }

    #[test]
    fn test_rename_top_level_declaration_does_not_rename_shadowing_sketch_block_declaration() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.rfind("line1 = 99").unwrap() + 1;

        program.rename_symbol("topLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

topLine = 99
result = topLine
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_does_not_rename_same_named_top_level_declaration() {
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([line1.end, line1.start])
}

r = region(segments = [s.line1])
line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line").unwrap() + 1;

        program.rename_symbol("sketchLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  sketchLine = line(start = [var 0, var 0], end = [var 10, var 0])
  coincident([sketchLine.end, sketchLine.start])
}

r = region(segments = [s.sketchLine])
line1 = 99
result = line1
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_symbol_from_references() {
        let code = r#"@settings(kclVersion = 2.0, experimentalFeatures = allow)

s = sketch(on = XY) {
  line1 = line(start = [var 8.34mm, var 12.78mm], end = [var 17.82mm, var 12.78mm])
  line2 = line(start = [var 17.82mm, var 12.78mm], end = [var 17.82mm, var 6.3mm])
  line3 = line(start = [var 17.82mm, var 6.3mm], end = [var 8.34mm, var 6.3mm])
  line4 = line(start = [var 8.34mm, var 6.3mm], end = [var 8.34mm, var 12.78mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
r = region(segments = [s.line1, s.line2])
extrude(r, length = 5)
"#;
        let expected = r#"@settings(kclVersion = 2.0, experimentalFeatures = allow)

s = sketch(on = XY) {
  line1Prime = line(start = [var 8.34mm, var 12.78mm], end = [var 17.82mm, var 12.78mm])
  line2 = line(start = [var 17.82mm, var 12.78mm], end = [var 17.82mm, var 6.3mm])
  line3 = line(start = [var 17.82mm, var 6.3mm], end = [var 8.34mm, var 6.3mm])
  line4 = line(start = [var 8.34mm, var 6.3mm], end = [var 8.34mm, var 12.78mm])
  coincident([line1Prime.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1Prime.start])
  parallel([line2, line4])
  parallel([line3, line1Prime])
  perpendicular([line1Prime, line2])
  horizontal(line3)
}
r = region(segments = [s.line1Prime, s.line2])
extrude(r, length = 5)
"#;

        for pos in [
            code.find("perpendicular([line1").unwrap() + "perpendicular([".len() + 1,
            code.find("s.line1").unwrap() + "s.".len() + 1,
        ] {
            let mut program = parse(code);
            program.rename_symbol("line1Prime", pos);

            let formatted = program.recast_top(&Default::default(), 0);
            assert_eq!(formatted, expected);
        }
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_region_tag_references() {
        // Regions derived from a sketch inherit the sketch block's declared names as tags, so
        // `.tags` member references on them are renamed too. `rOther` is derived from a
        // different sketch, so its `.tags.line1` refers to that sketch's `line1` and is left
        // alone.
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [var 5, var 5])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r1 = region(segments = [s1.line1])
r2 = region(point = [0, 0], sketch = s1)
r3 = region(point = s1.point1)
rOther = region(sketch = s2)
a = r1.tags.line1
b = r2.tags.line1
c = r3.tags.line1
d = rOther.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("coolLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  coolLine = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [var 5, var 5])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r1 = region(segments = [s1.coolLine])
r2 = region(point = [0, 0], sketch = s1)
r3 = region(point = s1.point1)
rOther = region(sketch = s2)
a = r1.tags.coolLine
b = r2.tags.coolLine
c = r3.tags.coolLine
d = rOther.tags.line1
"#
        );
    }

    #[test]
    fn test_rename_top_level_declaration_does_not_rename_member_properties() {
        // `s.line1` refers to the declaration inside the sketch block, not the top-level
        // variable, so renaming the top-level `line1` must leave it alone.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
line1 = 99
result = line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = 99").unwrap() + 1;

        program.rename_symbol("topLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
topLine = 99
result = topLine
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_inside_function_body() {
        let code = r#"fn makePart() {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
    line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  }
  r = region(segments = [s.line1, s.line2])
  t = r.tags.line1
  return s.line1
}
part = makePart()
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("innerLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn makePart() {
  s = sketch(on = XY) {
    innerLine = line(start = [var 0, var 0], end = [var 10, var 0])
    line2 = line(start = [var 10, var 0], end = [var 10, var 10])
  }
  r = region(segments = [s.innerLine, s.line2])
  t = r.tags.innerLine
  return s.innerLine
}
part = makePart()
"#
        );
    }

    #[test]
    fn test_rename_function_local_sketch_shadows_top_level_sketch() {
        // The sketch inside `f` shadows the top-level sketch of the same name, so renaming its
        // `line1` must not touch the top-level sketch block or references to it.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = sketch(on = XY) {
    line1 = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  return s.line1
}

top = s.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line(start = [var 5").unwrap() + 1;

        program.rename_symbol("localLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = sketch(on = XY) {
    localLine = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  return s.localLine
}

top = s.line1
"#
        );
    }

    #[test]
    fn test_rename_top_level_sketch_skips_shadowing_function_scope() {
        // Renaming the top-level sketch's `line1` updates references in functions that close
        // over `s`, but not in functions where `s` is rebound (here, by a parameter), since
        // `s.line1` there refers to the parameter, not the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn usesOuter() {
  return s.line1
}

fn shadows(s) {
  return s.line1
}

top = s.line1
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn usesOuter() {
  return s.edgeOne
}

fn shadows(s) {
  return s.line1
}

top = s.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_inside_lambda_argument() {
        let code = r#"made = makeThing(cb = fn() {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.line1])
  return r.tags.line1
})
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("seg1", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"made = makeThing(cb = fn() {
  s = sketch(on = XY) {
    seg1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.seg1])
  return r.tags.seg1
})
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_inside_if_branch() {
        let code = r#"x = if true {
  s = sketch(on = XY) {
    line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.line1])
  r.tags.line1
} else {
  0
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"x = if true {
  s = sketch(on = XY) {
    edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  }
  r = region(segments = [s.edgeOne])
  r.tags.edgeOne
} else {
  0
}
"#
        );
    }

    #[test]
    fn test_rename_from_param_position_does_not_rename_sketch_block_declaration() {
        // The parameter `line1` is its own binding; even though the position is inside the
        // sketch block's range and the block declares a same-named symbol, renaming from the
        // parameter's position must not touch the block's declaration. (Renaming parameters
        // of nested functions isn't supported, so nothing is renamed at all.)
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn(line1) {
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("fn(line1").unwrap() + "fn(".len() + 1;

        program.rename_symbol("newName", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_sketch_member_refs_stop_after_local_shadows_sketch_var() {
        // Inside `f`, the local `s = 5` shadows the sketch variable from its statement on.
        // The reference before it refers to the sketch and is renamed; the reference after it
        // refers to the local and is not.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = 5
  b = s.line1
  return [a, b]
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.edgeOne
  s = 5
  b = s.line1
  return [a, b]
}
"#
        );
    }

    #[test]
    fn test_rename_via_member_ref_targets_only_that_sketch() {
        // Two sketches declare the same name. Renaming via `s2.line1` renames s2's
        // declaration and references; s1's are left alone.
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

a = s1.line1
b = s2.line1
"#;
        let mut program = parse(code);
        let pos = code.find("s2.line1").unwrap() + "s2.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

a = s1.line1
b = s2.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_sketch_member_ref_inside_another_sketch_block() {
        // A member reference to one sketch's declaration from inside another sketch block,
        // including as the head of a longer member chain (`s1.line1.end`).
        let code = r#"s1 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line2 = line(start = s1.line1.end, end = [var 9, var 9])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}
s2 = sketch(on = XY) {
  line2 = line(start = s1.edgeOne.end, end = [var 9, var 9])
}
"#
        );
    }

    #[test]
    fn test_rename_aliased_import() {
        let code = r#"import foo as bar from "m.kcl"

x = bar
"#;
        let mut program = parse(code);
        let pos = code.find("bar").unwrap() + 1;

        program.rename_symbol("baz", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import foo as baz from "m.kcl"

x = baz
"#
        );
    }

    #[test]
    fn test_rename_fn_param_with_same_named_sketch_block_declaration() {
        // Renaming the parameter `line1` must not be intercepted by the sketch block symbol
        // handling just because the body's sketch block declares the same name. The block's
        // own declaration shadows the parameter from its statement on, so it and its (empty
        // set of) later uses stay; the use in its own initializer refers to the parameter and
        // is renamed, like any use before a shadowing declaration.
        let code = r#"fn f(line1) {
  s = sketch(on = XY) {
    line1 = line(start = [line1, var 0], end = [var 10, var 0])
  }
  return line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("newLen", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn f(newLen) {
  s = sketch(on = XY) {
    line1 = line(start = [newLen, var 0], end = [var 10, var 0])
  }
  return newLen
}
"#
        );
    }

    #[test]
    fn test_rename_import_original_name_of_aliased_import_does_nothing() {
        // `foo` is the name exported by the other module; renaming it locally isn't
        // supported. Only the alias can be renamed.
        let code = r#"import foo as bar from "m.kcl"

x = bar
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("baz", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_sketch_block_declaration_updates_region_tags_in_nested_fn() {
        // A region derived from the sketch and declared inside a nested function gets its
        // `.tags` references renamed, just like its direct member references to the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.edgeOne])
  return r.tags.edgeOne
}
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_ignores_region_of_shadowed_sketch() {
        // Inside `f`, the local `s = 5` shadows the sketch before the region is declared, so
        // the region is derived from the local, not from the sketch being renamed. Nothing
        // inside `f` refers to the sketch, so nothing there is renamed.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#
        );
    }

    #[test]
    fn test_rename_variable_with_named_fn_initializer_leaves_fn_name_alone() {
        // `foo` and `bar` are distinct bindings: `foo` is the variable, `bar` is the
        // function's own recursive name, bound only inside its body. Renaming `foo` must not
        // touch `bar`, and must not rename anything inside the body, where `foo` is not bound
        // (the function value is created before `foo` is bound).
        let code = r#"foo = fn bar(n) {
  return bar(n) + foo
}
result = foo(1)
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("baz", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"baz = fn bar(n) {
  return bar(n) + foo
}
result = baz(1)
"#
        );
    }

    #[test]
    fn test_rename_from_member_ref_shadowed_by_param_does_nothing() {
        // The `s` in `s.line1` under the cursor is the parameter, not the outer sketch, so
        // there is no sketch symbol to rename; in particular the outer sketch must not be
        // touched.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(s) {
  return s.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("s.line1").unwrap() + "s.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_member_ref_shadowed_by_local_does_nothing() {
        // The `s` in `s.line1` under the cursor is the local `s = 5` (the last binding of `s`
        // before the reference), not the outer sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  s = 5
  return s.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("s.line1").unwrap() + "s.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_local_sketch_does_not_rename_refs_before_its_declaration() {
        // `a = s.line1` runs before the local sketch is declared, so its `s` is the outer
        // sketch; only references at or after the local sketch's declaration are renamed.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = sketch(on = XY) {
    line1 = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  b = s.line1
  return [a, b]
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line(start = [var 5").unwrap() + 1;

        program.rename_symbol("localLine", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  a = s.line1
  s = sketch(on = XY) {
    localLine = line(start = [var 5, var 5], end = [var 6, var 5])
  }
  b = s.localLine
  return [a, b]
}
"#
        );
    }

    #[test]
    fn test_rename_region_with_explicit_sketch_arg_derives_from_that_sketch_only() {
        // Mirrors the executor's coordinate branch (see region_from_point in std::sketch):
        // `s1.circle1.center` is a 2D coordinate taken from s1's geometry, not a segment, so
        // the explicit `sketch` argument (s2) determines the region's provenance and the
        // region does not derive from s1.
        let code = r#"s1 = sketch(on = XY) {
  circle1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.circle1.center, sketch = s2)
a = r.tags.line1
b = r.tags.circle1
"#;

        // Renaming s1's segment updates its member references but not r's tags, since r is
        // not derived from s1.
        let mut program = parse(code);
        let pos = code.find("circle1").unwrap() + 1;
        program.rename_symbol("loop1", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  loop1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.loop1.center, sketch = s2)
a = r.tags.line1
b = r.tags.circle1
"#
        );

        // Renaming s2's segment updates r's tags, since r derives from s2.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  circle1 = circle(center = [var 0, var 0], diameter = var 2)
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.circle1.center, sketch = s2)
a = r.tags.edgeOne
b = r.tags.circle1
"#
        );
    }

    #[test]
    fn test_rename_module_import_alias_renames_qualified_references() {
        let code = r#"import "m.kcl" as alias

x = alias::item
y = alias::helper(alias::item)
"#;
        let mut program = parse(code);
        let pos = code.find("alias").unwrap() + 1;

        program.rename_symbol("mod2", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as mod2

x = mod2::item
y = mod2::helper(mod2::item)
"#
        );
    }

    #[test]
    fn test_rename_variable_does_not_rename_qualified_member_segments() {
        // `alias::item` refers to `item` inside the module; renaming the local variable
        // `item` must not touch it.
        let code = r#"import "m.kcl" as alias

item = 1
x = alias::item + item
"#;
        let mut program = parse(code);
        let pos = code.find("item = 1").unwrap() + 1;

        program.rename_symbol("count", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as alias

count = 1
x = alias::item + count
"#
        );
    }

    #[test]
    fn test_rename_initiated_from_region_tag_reference() {
        // Renaming from the cursor on `line1` in `r.tags.line1` resolves through the region's
        // declaration to the sketch it derives from, then renames like a declaration rename.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.line1, s.line2])
x = r.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  line2 = line(start = [var 10, var 0], end = [var 10, var 10])
}

r = region(segments = [s.edgeOne, s.line2])
x = r.tags.edgeOne
"#
        );
    }

    #[test]
    fn test_rename_initiated_from_region_tag_reference_in_nested_fn() {
        // The region lives in a nested function while the sketch is at the top level; the tag
        // reference still resolves through the region to the sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f() {
  r = region(segments = [s.edgeOne])
  return r.tags.edgeOne
}
"#
        );
    }

    #[test]
    fn test_rename_from_tag_reference_of_non_region_does_nothing() {
        // `r` is not a region, so `r.tags.line1` doesn't resolve to any sketch symbol; in
        // particular the sketch's same-named declaration must not be touched.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = 5
x = r.tags.line1
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_stops_at_shadowing_import() {
        // The import rebinds `foo` inside `f`: the use before it refers to the outer variable
        // and is renamed; the import itself (a binder, not a use) and the use after it are
        // not. Grammar-level coverage only: the executor rejects non-root imports, so this
        // shadowing can't occur in executable code.
        let code = r#"foo = 1

fn f() {
  a = foo
  import foo from "m.kcl"
  return [a, foo]
}
result = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn f() {
  a = bar
  import foo from "m.kcl"
  return [a, foo]
}
result = bar
"#
        );
    }

    #[test]
    fn test_rename_value_passes_through_module_import() {
        // A module import binds in the module namespace, not the value namespace, so
        // renaming the value `foo` neither stops at `import "foo.kcl"` nor rewrites the
        // qualified head `foo::item`, which refers to the module. Grammar-level coverage
        // only: the executor rejects non-root imports.
        let code = r#"foo = 1

fn f() {
  import "foo.kcl"
  return foo::item
}
result = foo
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"bar = 1

fn f() {
  import "foo.kcl"
  return foo::item
}
result = bar
"#
        );
    }

    #[test]
    fn test_rename_value_leaves_same_named_module_alone() {
        // A value and a module can share a spelling: the executor stores modules separately
        // and resolves qualified heads in the module namespace. Renaming the value must not
        // rewrite `foo::item`.
        let code = r#"import "m.kcl" as foo

foo = 1
x = foo + foo::item
"#;
        let mut program = parse(code);
        let pos = code.find("foo = 1").unwrap() + 1;

        program.rename_symbol("bar", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as foo

bar = 1
x = bar + foo::item
"#
        );
    }

    #[test]
    fn test_rename_module_alias_leaves_same_named_value_alone() {
        // Renaming the module alias rewrites qualified heads everywhere and bare references
        // that resolve to the module (the executor falls back to the module namespace for a
        // bare name with no value binding, so `pre = foo` before the value declaration is the
        // module). The value declaration and bare references after it stay.
        let code = r#"import "m.kcl" as foo

a = foo::item
pre = foo
foo = 1
b = foo + foo::item
"#;
        let mut program = parse(code);
        let pos = code.find("foo").unwrap() + 1;

        program.rename_symbol("m2", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"import "m.kcl" as m2

a = m2::item
pre = m2
foo = 1
b = foo + m2::item
"#
        );
    }

    #[test]
    fn test_rename_region_point_segment_provenance_overrides_sketch_arg() {
        // Mirrors the executor: when `point` is a point segment (`s1.point1`), the region
        // derives from that segment's sketch and the `sketch` argument is ignored (see
        // region_from_point in std::sketch). This region call is executor-shaped: a segment
        // point plus a (dead) sketch argument.
        let code = r#"s1 = sketch(on = XY) {
  point1 = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.point1, sketch = s2)
a = r.tags.point1
b = r.tags.line1
"#;

        // Renaming s1's point segment updates r's tags: r derives from s1.
        let mut program = parse(code);
        let pos = code.find("point1").unwrap() + 1;
        program.rename_symbol("anchor", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  anchor = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.anchor, sketch = s2)
a = r.tags.anchor
b = r.tags.line1
"#
        );

        // Renaming s2's segment does not touch r's tags: the sketch argument is dead when
        // the point is a segment, so r does not derive from s2.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s1 = sketch(on = XY) {
  point1 = point(at = [var 1, var 1])
}
s2 = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(point = s1.point1, sketch = s2)
a = r.tags.point1
b = r.tags.line1
"#
        );
    }

    #[test]
    fn test_rename_from_unrelated_member_property_in_block_does_nothing() {
        // `cfg.line1` is a field access on an unrelated object. Even though the position is
        // inside a sketch block that declares `line1`, it is not a reference to the block's
        // declaration.
        let code = r#"cfg = { line1 = 1 }
s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  point1 = point(at = [cfg.line1, var 0])
}
"#;
        let mut program = parse(code);
        let pos = code.find("cfg.line1, var 0").unwrap() + "cfg.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_param_use_in_nested_fn_inside_block_does_nothing() {
        // The `line1` under the cursor is the parameter of the nested function, not the
        // block's declaration.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn(line1) {
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("return line1").unwrap() + "return ".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_local_decl_in_nested_fn_inside_block_does_nothing() {
        // The declaration under the cursor is a local of the nested function, not a direct
        // item of the sketch block, so it is a different symbol from the block's `line1`.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  helper = fn() {
    line1 = 5
    return line1
  }
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = 5").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_use_before_declaration_in_block_does_nothing() {
        // The executor evaluates block items in order, so a reference before the declaration
        // doesn't resolve to it; rename doesn't target the declaration from there.
        let code = r#"s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1.end").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_from_tag_reference_with_param_shadowed_sketch_does_nothing() {
        // The region derives from the parameter `s`, not the outer sketch of the same name;
        // at runtime its tags come from whatever argument is passed to `f`. Renaming from the
        // tag reference must not touch the outer sketch.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(s) {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_ignores_region_call_shadowed_by_user_function() {
        // `region` here is the user's function, not the standard one, so `r` is not a region
        // derived from the sketch: renaming the segment updates the sketch member reference
        // (an ordinary argument) but must not rewrite `r.tags.line1`, and initiating the
        // rename from that tag reference must do nothing.
        let code = r#"fn region(segments) {
  return segments
}
s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.line1])
x = r.tags.line1
"#;

        // Renaming from the declaration renames the member reference but not the tag.
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;
        program.rename_symbol("edgeOne", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"fn region(segments) {
  return segments
}
s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

r = region(segments = [s.edgeOne])
x = r.tags.line1
"#
        );

        // Initiating from the tag reference resolves to nothing.
        let mut program = parse(code);
        let pos = code.find("r.tags.line1").unwrap() + "r.tags.".len() + 1;
        program.rename_symbol("edgeOne", pos);
        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(formatted, code);
    }

    #[test]
    fn test_rename_ignores_region_call_shadowed_by_param() {
        // Inside `f`, `region` is the parameter, so the call is not the standard region
        // function; `r.tags.line1` must not be rewritten.
        let code = r#"s = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(region) {
  r = region(segments = [s.line1])
  return r.tags.line1
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"s = sketch(on = XY) {
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
}

fn f(region) {
  r = region(segments = [s.edgeOne])
  return r.tags.line1
}
"#
        );
    }

    #[test]
    fn test_rename_fn_does_not_rename_calls_before_its_declaration() {
        // Before the local `sin` is declared, `sin(0)` is the standard library function; the
        // executor binds sequentially, so only references after the declaration are renamed.
        let code = r#"before = sin(0)
fn sin(x) {
  return x
}
after = sin(1)
"#;
        let mut program = parse(code);
        let pos = code.find("fn sin").unwrap() + "fn ".len() + 1;

        program.rename_symbol("mySin", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"before = sin(0)
fn mySin(x) {
  return x
}
after = mySin(1)
"#
        );
    }

    #[test]
    fn test_rename_sketch_block_declaration_leaves_refs_before_it() {
        // Inside the block, references before the declaration resolve to the outer `line1`,
        // so only the declaration and references after it are renamed.
        let code = r#"line1 = 99
s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  line1 = line(start = [var 0, var 0], end = [var 10, var 0])
  parallel([line1, line1])
}
"#;
        let mut program = parse(code);
        let pos = code.find("line1 = line").unwrap() + 1;

        program.rename_symbol("edgeOne", pos);

        let formatted = program.recast_top(&Default::default(), 0);
        assert_eq!(
            formatted,
            r#"line1 = 99
s = sketch(on = XY) {
  coincident([line1.end, line1.start])
  edgeOne = line(start = [var 0, var 0], end = [var 10, var 0])
  parallel([edgeOne, edgeOne])
}
"#
        );
    }

    /// Helper to create a comment NonCodeNode for tests.
    fn comment_node(text: &str) -> Node<NonCodeNode> {
        Node::no_src(NonCodeNode {
            value: NonCodeValue::InlineComment {
                value: text.to_string(),
                style: CommentStyle::Line,
            },
            digest: None,
        })
    }

    #[test]
    fn test_non_code_meta_split_at_empty() {
        let mut meta = NonCodeMeta::default();
        let left = meta.split_at(0);
        assert!(left.is_empty());
        assert!(meta.is_empty());
    }

    #[test]
    fn test_non_code_meta_split_at_start_nodes_go_left() {
        let mut meta = NonCodeMeta {
            start_nodes: vec![comment_node("before first")],
            non_code_nodes: BTreeMap::new(),
            digest: None,
        };
        let left = meta.split_at(1);
        // start_nodes should move to the left side.
        assert_eq!(left.start_nodes.len(), 1);
        assert_eq!(left.start_nodes[0].value(), "before first");
        // Right side should have no start_nodes.
        assert!(meta.start_nodes.is_empty());
    }

    #[test]
    fn test_non_code_meta_split_at_preserves_boundary_on_left() {
        // Simulate a pipe with 4 body elements and comments between them.
        // non_code_nodes: { 0: "after 0", 1: "after 1", 2: "after 2" }
        let mut meta = NonCodeMeta {
            start_nodes: vec![comment_node("start")],
            non_code_nodes: BTreeMap::from([
                (0, vec![comment_node("after 0")]),
                (1, vec![comment_node("after 1")]),
                (2, vec![comment_node("after 2")]),
            ]),
            digest: None,
        };

        // Split at index 2: left gets body[0..2], right gets body[2..].
        let left = meta.split_at(2);

        // Left side:
        // - start_nodes = original start_nodes
        assert_eq!(left.start_nodes.len(), 1);
        assert_eq!(left.start_nodes[0].value(), "start");
        // - non_code_nodes: keys 0 and 1 (after body[0] and after body[1])
        assert_eq!(left.non_code_nodes.len(), 2);
        assert_eq!(left.non_code_nodes[&0][0].value(), "after 0");
        assert_eq!(left.non_code_nodes[&1][0].value(), "after 1");

        // Right side:
        // - no start_nodes
        assert!(meta.start_nodes.is_empty());
        // - non_code_nodes: original key 2 re-keyed to 0
        assert_eq!(meta.non_code_nodes.len(), 1);
        assert_eq!(meta.non_code_nodes[&0][0].value(), "after 2");
    }

    #[test]
    fn test_non_code_meta_split_at_all_left() {
        let mut meta = NonCodeMeta {
            start_nodes: vec![comment_node("start")],
            non_code_nodes: BTreeMap::from([(0, vec![comment_node("after 0")]), (1, vec![comment_node("after 1")])]),
            digest: None,
        };

        // Split at 3 (all 3 body elements go left).
        let left = meta.split_at(3);

        assert_eq!(left.start_nodes.len(), 1);
        assert_eq!(left.non_code_nodes.len(), 2);
        assert!(meta.start_nodes.is_empty());
        assert!(meta.non_code_nodes.is_empty());
    }

    #[test]
    fn test_non_code_meta_split_at_one() {
        // Split at 1: only the first body element goes left.
        let mut meta = NonCodeMeta {
            start_nodes: vec![comment_node("start")],
            non_code_nodes: BTreeMap::from([(0, vec![comment_node("after 0")]), (1, vec![comment_node("after 1")])]),
            digest: None,
        };

        let left = meta.split_at(1);

        // Left: start_nodes + key 0 (after the single left element).
        assert_eq!(left.start_nodes.len(), 1);
        assert_eq!(left.start_nodes[0].value(), "start");
        assert_eq!(left.non_code_nodes.len(), 1);
        assert_eq!(left.non_code_nodes[&0][0].value(), "after 0");

        // Right: no start_nodes, key 1 re-keyed to 0.
        assert!(meta.start_nodes.is_empty());
        assert_eq!(meta.non_code_nodes.len(), 1);
        assert_eq!(meta.non_code_nodes[&0][0].value(), "after 1");
    }
}
