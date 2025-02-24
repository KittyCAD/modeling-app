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
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, DocumentSymbol, FoldingRange, FoldingRangeKind, Range as LspRange, SymbolKind,
};

pub use crate::parsing::ast::types::{
    condition::{ElseIf, IfExpression},
    literal_value::LiteralValue,
    none::KclNone,
};
use crate::{
    docs::StdLibFn,
    errors::KclError,
    execution::{annotations, KclValue, Metadata, TagIdentifier},
    parsing::{ast::digest::Digest, token::NumericSuffix, PIPE_OPERATOR},
    source_range::SourceRange,
    ModuleId,
};

mod condition;
mod literal_value;
mod none;

pub enum Definition<'a> {
    Variable(&'a VariableDeclarator),
    Import(NodeRef<'a, ImportStatement>),
}

#[derive(Debug, Default, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Node<T> {
    #[serde(flatten)]
    pub inner: T,
    pub start: usize,
    pub end: usize,
    #[serde(default, skip_serializing_if = "ModuleId::is_top_level")]
    pub module_id: ModuleId,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub outer_attrs: NodeList<Annotation>,
}

impl<T> Node<T> {
    pub fn metadata(&self) -> Metadata {
        Metadata {
            source_range: SourceRange::new(self.start, self.end, self.module_id),
        }
    }

    pub fn contains(&self, pos: usize) -> bool {
        self.start <= pos && pos <= self.end
    }
}

impl<T: JsonSchema> schemars::JsonSchema for Node<T> {
    fn schema_name() -> String {
        T::schema_name()
    }

    fn json_schema(gen: &mut schemars::gen::SchemaGenerator) -> schemars::schema::Schema {
        let mut child = T::json_schema(gen).into_object();
        // We want to add the start and end fields to the schema.
        // Ideally we would add _any_ extra fields from the Node type automatically
        // but this is a bit hard since this isn't a macro.
        let Some(ref mut object) = &mut child.object else {
            // This should never happen. But it will panic at compile time of docs if it does.
            // Which is better than runtime.
            panic!("Expected object schema for {}", T::schema_name());
        };
        object.properties.insert("start".to_string(), usize::json_schema(gen));
        object.properties.insert("end".to_string(), usize::json_schema(gen));

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
        }
    }

    pub fn no_src(inner: T) -> Self {
        Self {
            inner,
            start: 0,
            end: 0,
            module_id: ModuleId::default(),
            outer_attrs: Vec::new(),
        }
    }

    pub fn boxed(inner: T, start: usize, end: usize, module_id: ModuleId) -> BoxNode<T> {
        Box::new(Node {
            inner,
            start,
            end,
            module_id,
            outer_attrs: Vec::new(),
        })
    }

    pub fn as_source_range(&self) -> SourceRange {
        SourceRange::new(self.start, self.end, self.module_id)
    }

    pub fn as_source_ranges(&self) -> Vec<SourceRange> {
        vec![self.as_source_range()]
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
    pub fn completion_items<'a>(&'a self) -> Result<Vec<CompletionItem>> {
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
        let x = completions.take();
        Ok(x.clone())
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
            findings.append(&mut rule.check(node)?);
            Ok::<bool, anyhow::Error>(true)
        })?;
        let x = v.lock().unwrap();
        Ok(x.clone())
    }

    pub fn lint_all(&self) -> Result<Vec<crate::lint::Discovered>> {
        let rules = vec![
            crate::lint::checks::lint_variables,
            crate::lint::checks::lint_object_properties,
            crate::lint::checks::lint_call_expressions,
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

    pub fn change_meta_settings(&mut self, settings: crate::execution::MetaSettings) -> Result<Self, KclError> {
        let mut new_program = self.clone();
        let mut found = false;
        for node in &mut new_program.inner_attrs {
            if node.name() == Some(annotations::SETTINGS) {
                *node = Node::no_src(Annotation::new_from_meta_settings(&settings));
                found = true;
                break;
            }
        }

        if !found {
            new_program
                .inner_attrs
                .push(Node::no_src(Annotation::new_from_meta_settings(&settings)));
        }

        Ok(new_program)
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

    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        // Check if we are in shebang.
        if let Some(node) = &self.shebang {
            if node.contains(pos) {
                let source_range: SourceRange = node.into();
                return Some(Hover::Comment {
                    value: r#"The `#!` at the start of a script, known as a shebang, specifies the path to the interpreter that should execute the script. This line is not necessary for your `kcl` to run in the modeling-app. You can safely delete it. If you wish to learn more about what you _can_ do with a shebang, read this doc: [zoo.dev/docs/faq/shebang](https://zoo.dev/docs/faq/shebang)."#.to_string(),
                    range: source_range.to_lsp_range(code),
                });
            }
        }

        let value = self.get_expr_for_position(pos)?;

        value.get_hover_value_for_position(pos, code)
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
            BodyItem::ImportStatement(_) => None,
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_expr_for_position(pos),
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
        let expr = match item {
            BodyItem::ImportStatement(_) => None,
            BodyItem::ExpressionStatement(expression_statement) => Some(&expression_statement.expression),
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.get_expr_for_position(pos),
            BodyItem::ReturnStatement(return_statement) => Some(&return_statement.argument),
        };

        // Check if the expr's non code meta contains the position.
        if let Some(expr) = expr {
            if let Some(non_code_meta) = expr.get_non_code_meta() {
                if non_code_meta.contains(pos) {
                    return Some(non_code_meta);
                }
            }
        }

        None
    }

    // Return all the lsp folding ranges in the program.
    pub fn get_lsp_folding_ranges(&self) -> Vec<FoldingRange> {
        let mut ranges = vec![];
        // We only care about the top level things in the program.
        for item in &self.body {
            match item {
                BodyItem::ImportStatement(_) => continue,
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
                BodyItem::ImportStatement(_) => None, // TODO
                BodyItem::ExpressionStatement(ref mut expression_statement) => {
                    Some(&mut expression_statement.expression)
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    variable_declaration.get_mut_expr_for_position(pos)
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
                BodyItem::ImportStatement(ref mut stmt) => {
                    stmt.rename_identifiers(old_name, new_name);
                }
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
    pub fn replace_variable(&mut self, name: &str, declarator: Node<VariableDeclarator>) {
        for item in &mut self.body {
            match item {
                BodyItem::ImportStatement(_) => {
                    continue;
                }
                BodyItem::ExpressionStatement(_expression_statement) => {
                    continue;
                }
                BodyItem::VariableDeclaration(ref mut variable_declaration) => {
                    if variable_declaration.declaration.id.name == name {
                        variable_declaration.declaration = declarator;
                        return;
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
                BodyItem::ImportStatement(_) => {} // TODO
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
    ReturnStatement(Node<ReturnStatement>),
}

impl BodyItem {
    pub fn start(&self) -> usize {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.start,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.start,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.start,
            BodyItem::ReturnStatement(return_statement) => return_statement.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.end,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.end,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.end,
            BodyItem::ReturnStatement(return_statement) => return_statement.end,
        }
    }

    pub(crate) fn set_attrs(&mut self, attr: NodeList<Annotation>) {
        match self {
            BodyItem::ImportStatement(node) => node.outer_attrs = attr,
            BodyItem::ExpressionStatement(node) => node.outer_attrs = attr,
            BodyItem::VariableDeclaration(node) => node.outer_attrs = attr,
            BodyItem::ReturnStatement(node) => node.outer_attrs = attr,
        }
    }

    pub(crate) fn get_attrs(&self) -> &[Node<Annotation>] {
        match self {
            BodyItem::ImportStatement(node) => &node.outer_attrs,
            BodyItem::ExpressionStatement(node) => &node.outer_attrs,
            BodyItem::VariableDeclaration(node) => &node.outer_attrs,
            BodyItem::ReturnStatement(node) => &node.outer_attrs,
        }
    }

    pub(crate) fn get_attrs_mut(&mut self) -> &mut [Node<Annotation>] {
        match self {
            BodyItem::ImportStatement(node) => &mut node.outer_attrs,
            BodyItem::ExpressionStatement(node) => &mut node.outer_attrs,
            BodyItem::VariableDeclaration(node) => &mut node.outer_attrs,
            BodyItem::ReturnStatement(node) => &mut node.outer_attrs,
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
    Identifier(BoxNode<Identifier>),
    TagDeclarator(BoxNode<TagDeclarator>),
    BinaryExpression(BoxNode<BinaryExpression>),
    FunctionExpression(BoxNode<FunctionExpression>),
    CallExpression(BoxNode<CallExpression>),
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
            Expr::CallExpression(_call_exp) => None,
            Expr::CallExpressionKw(_call_exp) => None,
            Expr::Identifier(_ident) => None,
            Expr::TagDeclarator(_tag) => None,
            Expr::PipeExpression(pipe_exp) => Some(&pipe_exp.non_code_meta),
            Expr::UnaryExpression(_unary_exp) => None,
            Expr::PipeSubstitution(_pipe_substitution) => None,
            Expr::IfExpression(_) => None,
            Expr::LabelledExpression(expr) => expr.expr.get_non_code_meta(),
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
            Expr::ArrayRangeExpression(ref mut array_range) => array_range.replace_value(source_range, new_value),
            Expr::ObjectExpression(ref mut obj_exp) => obj_exp.replace_value(source_range, new_value),
            Expr::MemberExpression(_) => {}
            Expr::Literal(_) => {}
            Expr::FunctionExpression(ref mut func_exp) => func_exp.replace_value(source_range, new_value),
            Expr::CallExpression(ref mut call_exp) => call_exp.replace_value(source_range, new_value),
            Expr::CallExpressionKw(ref mut call_exp) => call_exp.replace_value(source_range, new_value),
            Expr::Identifier(_) => {}
            Expr::TagDeclarator(_) => {}
            Expr::PipeExpression(ref mut pipe_exp) => pipe_exp.replace_value(source_range, new_value),
            Expr::UnaryExpression(ref mut unary_exp) => unary_exp.replace_value(source_range, new_value),
            Expr::IfExpression(_) => {}
            Expr::PipeSubstitution(_) => {}
            Expr::LabelledExpression(expr) => expr.expr.replace_value(source_range, new_value),
            Expr::None(_) => {}
        }
    }

    pub fn start(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.start,
            Expr::Identifier(identifier) => identifier.start,
            Expr::TagDeclarator(tag) => tag.start,
            Expr::BinaryExpression(binary_expression) => binary_expression.start,
            Expr::FunctionExpression(function_expression) => function_expression.start,
            Expr::CallExpression(call_expression) => call_expression.start,
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
            Expr::None(none) => none.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Expr::Literal(literal) => literal.end,
            Expr::Identifier(identifier) => identifier.end,
            Expr::TagDeclarator(tag) => tag.end,
            Expr::BinaryExpression(binary_expression) => binary_expression.end,
            Expr::FunctionExpression(function_expression) => function_expression.end,
            Expr::CallExpression(call_expression) => call_expression.end,
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
            Expr::CallExpressionKw(call_expression) => call_expression.get_hover_value_for_position(pos, code),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_hover_value_for_position(pos, code),
            Expr::ArrayExpression(array_expression) => array_expression.get_hover_value_for_position(pos, code),
            Expr::ArrayRangeExpression(array_range) => array_range.get_hover_value_for_position(pos, code),
            Expr::ObjectExpression(object_expression) => object_expression.get_hover_value_for_position(pos, code),
            Expr::MemberExpression(member_expression) => member_expression.get_hover_value_for_position(pos, code),
            Expr::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code),
            Expr::IfExpression(expr) => expr.get_hover_value_for_position(pos, code),
            // TODO: LSP hover information for values/types. https://github.com/KittyCAD/modeling-app/issues/1126
            Expr::None(_) => None,
            Expr::Literal(_) => None,
            Expr::Identifier(_) => None,
            Expr::TagDeclarator(_) => None,
            // TODO LSP hover info for tag
            Expr::LabelledExpression(expr) => expr.expr.get_hover_value_for_position(pos, code),
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
            Expr::CallExpressionKw(ref mut call_expression) => call_expression.rename_identifiers(old_name, new_name),
            Expr::PipeExpression(ref mut pipe_expression) => pipe_expression.rename_identifiers(old_name, new_name),
            Expr::PipeSubstitution(_) => {}
            Expr::ArrayExpression(ref mut array_expression) => array_expression.rename_identifiers(old_name, new_name),
            Expr::ArrayRangeExpression(ref mut array_range) => array_range.rename_identifiers(old_name, new_name),
            Expr::ObjectExpression(ref mut object_expression) => {
                object_expression.rename_identifiers(old_name, new_name)
            }
            Expr::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
            Expr::UnaryExpression(ref mut unary_expression) => unary_expression.rename_identifiers(old_name, new_name),
            Expr::IfExpression(ref mut expr) => expr.rename_identifiers(old_name, new_name),
            Expr::LabelledExpression(expr) => expr.expr.rename_identifiers(old_name, new_name),
            Expr::None(_) => {}
        }
    }

    /// Get the constraint level for an expression.
    pub fn get_constraint_level(&self) -> ConstraintLevel {
        match self {
            Expr::Literal(literal) => literal.get_constraint_level(),
            Expr::Identifier(identifier) => identifier.get_constraint_level(),
            Expr::TagDeclarator(tag) => tag.get_constraint_level(),
            Expr::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),

            Expr::FunctionExpression(function_identifier) => function_identifier.get_constraint_level(),
            Expr::CallExpression(call_expression) => call_expression.get_constraint_level(),
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
            Expr::None(none) => none.get_constraint_level(),
        }
    }

    pub fn has_substitution_arg(&self) -> bool {
        match self {
            Expr::CallExpression(call_expression) => call_expression.has_substitution_arg(),
            Expr::CallExpressionKw(call_expression) => call_expression.has_substitution_arg(),
            Expr::LabelledExpression(expr) => expr.expr.has_substitution_arg(),
            _ => false,
        }
    }

    /// Describe this expression's type for a human, for typechecking.
    /// This is a best-effort function, it's OK to give a shitty string here (but we should work on improving it)
    pub fn human_friendly_type(&self) -> &'static str {
        match self {
            Expr::Literal(node) => match node.inner.value {
                LiteralValue::Number { .. } => "number",
                LiteralValue::String(_) => "string (text)",
                LiteralValue::Bool(_) => "boolean (true/false value)",
            },
            Expr::Identifier(_) => "named constant",
            Expr::TagDeclarator(_) => "tag declarator",
            Expr::BinaryExpression(_) => "expression",
            Expr::FunctionExpression(_) => "function definition",
            Expr::CallExpression(_) => "function call",
            Expr::CallExpressionKw(_) => "function call",
            Expr::PipeExpression(_) => "pipeline of function calls",
            Expr::PipeSubstitution(_) => "left-hand side of a |> pipeline",
            Expr::ArrayExpression(_) => "array",
            Expr::ArrayRangeExpression(_) => "array",
            Expr::ObjectExpression(_) => "object",
            Expr::MemberExpression(_) => "property of an object/array",
            Expr::UnaryExpression(_) => "expression",
            Expr::IfExpression(_) => "if expression",
            Expr::LabelledExpression(_) => "labelled expression",
            Expr::None(_) => "none",
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
            Expr::Identifier(ident) => Some(&ident.name),
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
pub enum BinaryPart {
    Literal(BoxNode<Literal>),
    Identifier(BoxNode<Identifier>),
    BinaryExpression(BoxNode<BinaryExpression>),
    CallExpression(BoxNode<CallExpression>),
    CallExpressionKw(BoxNode<CallExpressionKw>),
    UnaryExpression(BoxNode<UnaryExpression>),
    MemberExpression(BoxNode<MemberExpression>),
    IfExpression(BoxNode<IfExpression>),
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
            BinaryPart::Identifier(identifier) => identifier.get_constraint_level(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_constraint_level(),
            BinaryPart::CallExpression(call_expression) => call_expression.get_constraint_level(),
            BinaryPart::CallExpressionKw(call_expression) => call_expression.get_constraint_level(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_constraint_level(),
            BinaryPart::MemberExpression(member_expression) => member_expression.get_constraint_level(),
            BinaryPart::IfExpression(e) => e.get_constraint_level(),
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
            BinaryPart::CallExpressionKw(ref mut call_expression) => {
                call_expression.replace_value(source_range, new_value)
            }
            BinaryPart::UnaryExpression(ref mut unary_expression) => {
                unary_expression.replace_value(source_range, new_value)
            }
            BinaryPart::MemberExpression(_) => {}
            BinaryPart::IfExpression(e) => e.replace_value(source_range, new_value),
        }
    }

    pub fn start(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.start,
            BinaryPart::Identifier(identifier) => identifier.start,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.start,
            BinaryPart::CallExpression(call_expression) => call_expression.start,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.start,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.start,
            BinaryPart::MemberExpression(member_expression) => member_expression.start,
            BinaryPart::IfExpression(e) => e.start,
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.end,
            BinaryPart::Identifier(identifier) => identifier.end,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.end,
            BinaryPart::CallExpression(call_expression) => call_expression.end,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.end,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.end,
            BinaryPart::MemberExpression(member_expression) => member_expression.end,
            BinaryPart::IfExpression(e) => e.end,
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
            BinaryPart::CallExpressionKw(call_expression) => call_expression.get_hover_value_for_position(pos, code),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code),
            BinaryPart::IfExpression(e) => e.get_hover_value_for_position(pos, code),
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
            BinaryPart::CallExpressionKw(ref mut call_expression) => {
                call_expression.rename_identifiers(old_name, new_name)
            }
            BinaryPart::UnaryExpression(ref mut unary_expression) => {
                unary_expression.rename_identifiers(old_name, new_name)
            }
            BinaryPart::MemberExpression(ref mut member_expression) => {
                member_expression.rename_identifiers(old_name, new_name)
            }
            BinaryPart::IfExpression(ref mut if_expression) => if_expression.rename_identifiers(old_name, new_name),
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

    pub fn contains(&self, pos: usize) -> bool {
        if self.start_nodes.iter().any(|node| node.contains(pos)) {
            return true;
        }

        self.non_code_nodes
            .iter()
            .any(|(_, nodes)| nodes.iter().any(|node| node.contains(pos)))
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
    pub fn is_inner(&self) -> bool {
        self.name.is_some()
    }

    pub fn name(&self) -> Option<&str> {
        self.name.as_ref().map(|n| &*n.name)
    }

    pub fn new_from_meta_settings(settings: &crate::execution::MetaSettings) -> Annotation {
        let mut properties: Vec<Node<ObjectProperty>> = vec![ObjectProperty::new(
            Identifier::new(annotations::SETTINGS_UNIT_LENGTH),
            Expr::Identifier(Box::new(Identifier::new(&settings.default_length_units.to_string()))),
        )];

        if settings.default_angle_units != Default::default() {
            properties.push(ObjectProperty::new(
                Identifier::new(annotations::SETTINGS_UNIT_ANGLE),
                Expr::Identifier(Box::new(Identifier::new(&settings.default_angle_units.to_string()))),
            ));
        }
        Annotation {
            name: Some(Identifier::new(annotations::SETTINGS)),
            properties: Some(properties),
            digest: None,
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
    Kcl { filename: String },
    Foreign { path: String },
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

        let mut parts = match &self.path {
            ImportPath::Kcl { filename: s } | ImportPath::Foreign { path: s } => s.split('.'),
            _ => return None,
        };
        let path = parts.next()?;
        let _ext = parts.next()?;
        let rest = parts.next();

        if rest.is_some() {
            return None;
        }

        path.rsplit(&['/', '\\']).next().map(str::to_owned)
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
#[serde(tag = "type")]
pub struct CallExpression {
    pub callee: Node<Identifier>,
    pub arguments: Vec<Expr>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct CallExpressionKw {
    pub callee: Node<Identifier>,
    pub unlabeled: Option<Expr>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
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
    pub label: Identifier,
    pub arg: Expr,
}

impl From<Node<CallExpression>> for Expr {
    fn from(call_expression: Node<CallExpression>) -> Self {
        Expr::CallExpression(Box::new(call_expression))
    }
}

impl From<Node<CallExpressionKw>> for Expr {
    fn from(call_expression: Node<CallExpressionKw>) -> Self {
        Expr::CallExpressionKw(Box::new(call_expression))
    }
}

impl Node<CallExpression> {
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

impl CallExpression {
    pub fn new(name: &str, arguments: Vec<Expr>) -> Result<Node<Self>, KclError> {
        Ok(Node::no_src(Self {
            callee: Identifier::new(name),
            arguments,
            digest: None,
        }))
    }

    /// Is at least one argument the '%' i.e. the substitution operator?
    pub fn has_substitution_arg(&self) -> bool {
        self.arguments
            .iter()
            .any(|arg| matches!(arg, Expr::PipeSubstitution(_)))
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for arg in &mut self.arguments {
            arg.replace_value(source_range, new_value.clone());
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

impl CallExpressionKw {
    pub fn new(name: &str, unlabeled: Option<Expr>, arguments: Vec<LabeledArg>) -> Result<Node<Self>, KclError> {
        Ok(Node::no_src(Self {
            callee: Identifier::new(name),
            unlabeled,
            arguments,
            digest: None,
            non_code_meta: Default::default(),
        }))
    }

    /// Iterate over all arguments (labeled or not)
    pub fn iter_arguments(&self) -> impl Iterator<Item = &Expr> {
        self.unlabeled.iter().chain(self.arguments.iter().map(|arg| &arg.arg))
    }

    /// Is at least one argument the '%' i.e. the substitution operator?
    pub fn has_substitution_arg(&self) -> bool {
        self.arguments
            .iter()
            .any(|arg| matches!(arg.arg, Expr::PipeSubstitution(_)))
    }

    pub fn replace_value(&mut self, source_range: SourceRange, new_value: Expr) {
        for arg in &mut self.arguments {
            arg.arg.replace_value(source_range, new_value.clone());
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

        for (index, arg) in self.iter_arguments().enumerate() {
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
            arg.arg.rename_identifiers(old_name, new_name);
        }
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
            info: None,
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

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        for element in [&self.start_element, &self.end_element] {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code);
            }
        }

        None
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
    MemberExpression(BoxNode<MemberExpression>),
    Identifier(BoxNode<Identifier>),
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

impl From<MemberObject> for SourceRange {
    fn from(obj: MemberObject) -> Self {
        Self::new(obj.start(), obj.end(), obj.module_id())
    }
}

impl From<&MemberObject> for SourceRange {
    fn from(obj: &MemberObject) -> Self {
        Self::new(obj.start(), obj.end(), obj.module_id())
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
    pub object: MemberObject,
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
    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        let object_source_range: SourceRange = self.object.clone().into();
        if object_source_range.contains(pos) {
            return self.object.get_hover_value_for_position(pos, code);
        }

        None
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

    /// Rename all identifiers that have the old name to the new given name.
    fn rename_identifiers(&mut self, old_name: &str, new_name: &str) {
        for statement in &mut self.body {
            statement.rename_identifiers(old_name, new_name);
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq, JsonSchema)]
#[serde(tag = "type")]
pub enum FnArgPrimitive {
    /// A string type.
    String,
    /// A number type.
    Number(NumericSuffix),
    /// A boolean type.
    #[serde(rename = "bool")]
    Boolean,
    /// A tag.
    Tag,
    /// A sketch type.
    Sketch,
    /// A sketch surface type.
    SketchSurface,
    /// An solid type.
    Solid,
}

impl FnArgPrimitive {
    pub fn digestable_id(&self) -> &[u8] {
        match self {
            FnArgPrimitive::String => b"string",
            FnArgPrimitive::Number(suffix) => suffix.digestable_id(),
            FnArgPrimitive::Boolean => b"bool",
            FnArgPrimitive::Tag => b"tag",
            FnArgPrimitive::Sketch => b"Sketch",
            FnArgPrimitive::SketchSurface => b"SketchSurface",
            FnArgPrimitive::Solid => b"Solid",
        }
    }

    pub fn from_str(s: &str, suffix: Option<NumericSuffix>) -> Option<Self> {
        match (s, suffix) {
            ("string", None) => Some(FnArgPrimitive::String),
            ("bool", None) => Some(FnArgPrimitive::Boolean),
            ("tag", None) => Some(FnArgPrimitive::Tag),
            ("Sketch", None) => Some(FnArgPrimitive::Sketch),
            ("SketchSurface", None) => Some(FnArgPrimitive::SketchSurface),
            ("Solid", None) => Some(FnArgPrimitive::Solid),
            ("number", None) => Some(FnArgPrimitive::Number(NumericSuffix::None)),
            ("number", Some(s)) => Some(FnArgPrimitive::Number(s)),
            _ => None,
        }
    }
}

impl fmt::Display for FnArgPrimitive {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            FnArgPrimitive::Number(suffix) => {
                write!(f, "number")?;
                if *suffix != NumericSuffix::None {
                    write!(f, "({suffix})")?;
                }
                Ok(())
            }
            FnArgPrimitive::String => write!(f, "string"),
            FnArgPrimitive::Boolean => write!(f, "bool"),
            FnArgPrimitive::Tag => write!(f, "tag"),
            FnArgPrimitive::Sketch => write!(f, "Sketch"),
            FnArgPrimitive::SketchSurface => write!(f, "SketchSurface"),
            FnArgPrimitive::Solid => write!(f, "Solid"),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, JsonSchema)]
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
    pub type_: Option<FnArgType>,
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
    pub return_type: Option<FnArgType>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub digest: Option<Digest>,
}

#[derive(Debug, PartialEq, Clone)]
pub struct RequiredParamAfterOptionalParam(pub Box<Parameter>);

impl std::fmt::Display for RequiredParamAfterOptionalParam {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "KCL functions must declare any optional parameters after all the required parameters. But your required parameter {} is _after_ an optional parameter. You must move it to before the optional parameters instead.", self.0.identifier.name)
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

    /// Returns a hover value that includes the given character position.
    pub fn get_hover_value_for_position(&self, pos: usize, code: &str) -> Option<Hover> {
        if let Some(value) = self.body.get_expr_for_position(pos) {
            return value.get_hover_value_for_position(pos, code);
        }

        None
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

    // We have this as a test so we can ensure it never panics with an unwrap in the server.
    #[test]
    fn test_variable_kind_to_completion() {
        let completions = VariableKind::to_completion_items();
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
        let program = crate::parsing::top_level_parse(code).unwrap();
        let folding_ranges = program.get_lsp_folding_ranges();
        assert_eq!(folding_ranges.len(), 3);
        assert_eq!(folding_ranges[0].start_line, 29);
        assert_eq!(folding_ranges[0].end_line, 134);
        assert_eq!(
            folding_ranges[0].collapsed_text,
            Some("part001 = startSketchOn('XY')".to_string())
        );
        assert_eq!(folding_ranges[1].start_line, 155);
        assert_eq!(folding_ranges[1].end_line, 254);
        assert_eq!(
            folding_ranges[1].collapsed_text,
            Some("startSketchOn('XY')".to_string())
        );
        assert_eq!(folding_ranges[2].start_line, 384);
        assert_eq!(folding_ranges[2].end_line, 403);
        assert_eq!(folding_ranges[2].collapsed_text, Some("fn ghi(x) {".to_string()));
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
        let program = crate::parsing::top_level_parse(code).unwrap();
        let symbols = program.get_lsp_symbols(code).unwrap();
        assert_eq!(symbols.len(), 7);
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
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

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
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let value = program.get_non_code_meta_for_position(124);

        assert!(value.is_some());
    }

    #[test]
    fn test_ast_get_non_code_node_inline_comment() {
        let some_program_string = r#"const part001 = startSketchOn('XY')
  |> startProfileAt([0,0], %)
  |> xLine(length = 5) // lin
"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();

        let value = program.get_non_code_meta_for_position(86);

        assert!(value.is_some());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number(mm), arg1: string, tag?: string) => {
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
            params[0].type_,
            Some(FnArgType::Primitive(FnArgPrimitive::Number(NumericSuffix::Mm)))
        );
        assert_eq!(params[1].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_array_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number[], arg1: string[], tag?: string) => {
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
            params[0].type_,
            Some(FnArgType::Array(FnArgPrimitive::Number(NumericSuffix::None)))
        );
        assert_eq!(params[1].type_, Some(FnArgType::Array(FnArgPrimitive::String)));
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_type_args_object_on_functions() {
        let some_program_string = r#"fn thing = (arg0: number[], arg1: {thing: number, things: string[], more?: string}, tag?: string) => {
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
            params[0].type_,
            Some(FnArgType::Array(FnArgPrimitive::Number(NumericSuffix::None)))
        );
        assert_eq!(
            params[1].type_,
            Some(FnArgType::Object {
                properties: vec![
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "thing".to_owned(),
                                digest: None,
                            },
                            35,
                            40,
                            module_id,
                        ),
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::Number(NumericSuffix::None))),
                        default_value: None,
                        labeled: true,
                        digest: None,
                    },
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "things".to_owned(),
                                digest: None,
                            },
                            50,
                            56,
                            module_id,
                        ),
                        type_: Some(FnArgType::Array(FnArgPrimitive::String)),
                        default_value: None,
                        labeled: true,
                        digest: None
                    },
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "more".to_owned(),
                                digest: None
                            },
                            68,
                            72,
                            module_id,
                        ),
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::String)),
                        labeled: true,
                        default_value: Some(DefaultParamVal::none()),
                        digest: None
                    }
                ]
            })
        );
        assert_eq!(params[2].type_, Some(FnArgType::Primitive(FnArgPrimitive::String)));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_return_type_on_functions() {
        let some_program_string = r#"fn thing(): {thing: number, things: string[], more?: string} {
    return 1
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
        assert_eq!(params.len(), 0);
        assert_eq!(
            func_expr.return_type,
            Some(FnArgType::Object {
                properties: vec![
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "thing".to_owned(),
                                digest: None
                            },
                            13,
                            18,
                            module_id,
                        ),
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::Number(NumericSuffix::None))),
                        default_value: None,
                        labeled: true,
                        digest: None
                    },
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "things".to_owned(),
                                digest: None
                            },
                            28,
                            34,
                            module_id,
                        ),
                        type_: Some(FnArgType::Array(FnArgPrimitive::String)),
                        default_value: None,
                        labeled: true,
                        digest: None
                    },
                    Parameter {
                        identifier: Node::new(
                            Identifier {
                                name: "more".to_owned(),
                                digest: None
                            },
                            46,
                            50,
                            module_id,
                        ),
                        type_: Some(FnArgType::Primitive(FnArgPrimitive::String)),
                        labeled: true,
                        default_value: Some(DefaultParamVal::none()),
                        digest: None
                    }
                ]
            })
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
        let some_program_string = r#"some_func({thing: true, other_thing: false})"#;
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
    async fn test_parse_get_meta_settings_inch() {
        let some_program_string = r#"@settings(defaultLengthUnit = inch)

startSketchOn('XY')"#;
        let program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::kcl_value::UnitLen::Inches
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_inch_to_mm() {
        let some_program_string = r#"@settings(defaultLengthUnit = inch)

startSketchOn('XY')"#;
        let mut program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::kcl_value::UnitLen::Inches
        );

        // Edit the ast.
        let new_program = program
            .change_meta_settings(crate::execution::MetaSettings {
                default_length_units: crate::execution::kcl_value::UnitLen::Mm,
                ..Default::default()
            })
            .unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::kcl_value::UnitLen::Mm
        );

        let formatted = new_program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = mm)


startSketchOn('XY')
"#
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_parse_get_meta_settings_nothing_to_mm() {
        let some_program_string = r#"startSketchOn('XY')"#;
        let mut program = crate::parsing::top_level_parse(some_program_string).unwrap();
        let result = program.meta_settings().unwrap();
        assert!(result.is_none());

        // Edit the ast.
        let new_program = program
            .change_meta_settings(crate::execution::MetaSettings {
                default_length_units: crate::execution::kcl_value::UnitLen::Mm,
                ..Default::default()
            })
            .unwrap();

        let result = new_program.meta_settings().unwrap();
        assert!(result.is_some());
        let meta_settings = result.unwrap();

        assert_eq!(
            meta_settings.default_length_units,
            crate::execution::kcl_value::UnitLen::Mm
        );

        let formatted = new_program.recast(&Default::default(), 0);

        assert_eq!(
            formatted,
            r#"@settings(defaultLengthUnit = mm)
startSketchOn('XY')
"#
        );
    }
}
