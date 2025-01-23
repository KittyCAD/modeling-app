use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionItemLabelDetails, Documentation, InsertTextFormat, MarkupContent,
    MarkupKind, ParameterInformation, ParameterLabel, SignatureHelp, SignatureInformation,
};

use crate::{
    parsing::{
        ast::types::{NonCodeNode, NonCodeValue, VariableKind},
        token::NumericSuffix,
    },
    ModuleId,
};

// TODO use this for docs
pub fn walk_prelude() -> Vec<DocData> {
    let mut visitor = CollectionVisitor::default();
    visitor.visit_module("prelude").unwrap();
    visitor.result
}

#[derive(Debug, Clone, Default)]
struct CollectionVisitor {
    name: String,
    result: Vec<DocData>,
    id: usize,
}

impl CollectionVisitor {
    fn visit_module(&mut self, name: &str) -> Result<(), String> {
        self.name = name.to_owned();
        let source = crate::modules::read_std(name).unwrap();
        let parsed = crate::parsing::parse_str(source, ModuleId::from_usize(self.id))
            .parse_errs_as_err()
            .unwrap();
        self.id += 1;

        for (i, n) in parsed.body.iter().enumerate() {
            match n {
                crate::parsing::ast::types::BodyItem::ImportStatement(import) if !import.visibility.is_default() => {
                    // Only supports glob imports for now.
                    assert!(matches!(
                        import.selector,
                        crate::parsing::ast::types::ImportSelector::Glob(..)
                    ));
                    match &import.path {
                        crate::parsing::ast::types::ImportPath::Std { path } => {
                            self.visit_module(&path[1])?;
                        }
                        p => return Err(format!("Unexpected import: `{p}`")),
                    }
                }
                crate::parsing::ast::types::BodyItem::VariableDeclaration(var) if !var.visibility.is_default() => {
                    let mut dd = match var.kind {
                        // TODO metadata for args
                        VariableKind::Fn => DocData::Fn(FnData::from_ast(var, format!("std::{}::", self.name))),
                        VariableKind::Const => {
                            DocData::Const(ConstData::from_ast(var, format!("std::{}::", self.name)))
                        }
                    };

                    // FIXME this association of metadata with items is pretty flaky.
                    if i == 0 {
                        dd.with_meta(&parsed.non_code_meta.start_nodes);
                    } else if let Some(meta) = parsed.non_code_meta.non_code_nodes.get(&(i - 1)) {
                        dd.with_meta(meta);
                    }

                    self.result.push(dd);
                }
                _ => {}
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum DocData {
    Fn(FnData),
    Const(ConstData),
}

impl DocData {
    pub fn name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.name,
            DocData::Const(c) => &c.name,
        }
    }

    pub fn to_completion_item(&self) -> CompletionItem {
        match self {
            DocData::Fn(f) => f.to_completion_item(),
            DocData::Const(c) => c.to_completion_item(),
        }
    }

    pub fn to_signature_help(&self) -> Option<SignatureHelp> {
        match self {
            DocData::Fn(f) => Some(f.to_signature_help()),
            DocData::Const(_) => None,
        }
    }

    fn with_meta(&mut self, meta: &[crate::parsing::ast::types::Node<NonCodeNode>]) {
        match self {
            DocData::Fn(f) => f.with_meta(meta),
            DocData::Const(c) => c.with_meta(meta),
        }
    }
}

#[derive(Debug, Clone)]
pub struct ConstData {
    pub name: String,
    /// The fully qualified name.
    pub qual_name: String,
    pub value: Option<String>,
    pub ty: Option<String>,
    pub properties: Properties,

    /// The summary of the function.
    pub summary: Option<String>,
    /// The description of the function.
    pub description: Option<String>,
    /// Code examples.
    /// These are tested and we know they compile and execute.
    pub examples: Vec<String>,
}

impl ConstData {
    fn from_ast(var: &crate::parsing::ast::types::VariableDeclaration, mut qual_name: String) -> Self {
        assert_eq!(var.kind, crate::parsing::ast::types::VariableKind::Const);

        let (value, ty) = match &var.declaration.init {
            crate::parsing::ast::types::Expr::Literal(lit) => (
                Some(lit.raw.clone()),
                Some(match &lit.value {
                    crate::parsing::ast::types::LiteralValue::Number { suffix, .. } => {
                        if *suffix == NumericSuffix::None {
                            "number".to_owned()
                        } else {
                            format!("number({suffix})")
                        }
                    }
                    crate::parsing::ast::types::LiteralValue::String { .. } => "string".to_owned(),
                    crate::parsing::ast::types::LiteralValue::Bool { .. } => "boolean".to_owned(),
                }),
            ),
            _ => (None, None),
        };

        let name = var.declaration.id.name.clone();
        qual_name.push_str(&name);
        ConstData {
            name,
            qual_name,
            value,
            // TODO use type decl when we have them.
            ty,
            properties: Properties {
                exported: !var.visibility.is_default(),
                deprecated: false,
                impl_kind: ImplKind::Kcl,
            },
            summary: None,
            description: None,
            examples: Vec::new(),
        }
    }

    fn short_docs(&self) -> Option<String> {
        match (&self.summary, &self.description) {
            (None, None) => None,
            (None, Some(d)) | (Some(d), None) => Some(d.clone()),
            (Some(s), Some(d)) => Some(format!("{s}\n\n{d}")),
        }
    }

    fn to_completion_item(&self) -> CompletionItem {
        let mut detail = self.qual_name.clone();
        if let Some(ty) = &self.ty {
            detail.push_str(": ");
            detail.push_str(ty);
        }
        CompletionItem {
            label: self.name.clone(),
            label_details: Some(CompletionItemLabelDetails {
                detail: self.value.clone(),
                description: None,
            }),
            kind: Some(CompletionItemKind::CONSTANT),
            detail: Some(detail),
            documentation: self.short_docs().map(|s| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: s,
                })
            }),
            deprecated: Some(self.properties.deprecated),
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

#[derive(Debug, Clone)]
pub struct FnData {
    /// The name of the function.
    pub name: String,
    /// The fully qualified name.
    pub qual_name: String,
    /// The args of the function.
    pub args: Vec<ArgData>,
    /// The return value of the function.
    pub return_type: Option<String>,
    pub properties: Properties,

    /// The summary of the function.
    pub summary: Option<String>,
    /// The description of the function.
    pub description: Option<String>,
    /// Code examples.
    /// These are tested and we know they compile and execute.
    pub examples: Vec<String>,
}

impl FnData {
    fn from_ast(var: &crate::parsing::ast::types::VariableDeclaration, mut qual_name: String) -> Self {
        assert_eq!(var.kind, crate::parsing::ast::types::VariableKind::Fn);
        let crate::parsing::ast::types::Expr::FunctionExpression(expr) = &var.declaration.init else {
            unreachable!();
        };
        let name = var.declaration.id.name.clone();
        qual_name.push_str(&name);
        FnData {
            name,
            qual_name,
            args: expr.params.iter().map(ArgData::from_ast).collect(),
            return_type: expr.return_type.as_ref().map(|t| t.recast(&Default::default(), 0)),
            properties: Properties {
                exported: !var.visibility.is_default(),
                deprecated: false,
                impl_kind: ImplKind::Kcl,
            },
            summary: None,
            description: None,
            examples: Vec::new(),
        }
    }

    fn short_docs(&self) -> Option<String> {
        match (&self.summary, &self.description) {
            (None, None) => None,
            (None, Some(d)) | (Some(d), None) => Some(d.clone()),
            (Some(s), Some(d)) => Some(format!("{s}\n\n{d}")),
        }
    }

    fn fn_signature(&self) -> String {
        let mut signature = String::new();

        for (i, arg) in self.args.iter().enumerate() {
            if i > 0 {
                signature.push_str(", ");
            }
            match &arg.kind {
                ArgKind::Special => signature.push_str(&format!("@{}", arg.name)),
                ArgKind::Labelled(true) => signature.push_str(&arg.name),
                ArgKind::Labelled(false) => signature.push_str(&format!("{}?", arg.name)),
            }
            if let Some(ty) = &arg.ty {
                signature.push_str(&format!(": {ty}"));
            }
        }
        signature.push(')');
        if let Some(ty) = &self.return_type {
            signature.push_str(&format!(": {ty}"));
        }

        signature
    }

    fn to_completion_item(&self) -> CompletionItem {
        CompletionItem {
            label: self.name.clone(),
            label_details: Some(CompletionItemLabelDetails {
                detail: Some(self.fn_signature()),
                description: None,
            }),
            kind: Some(CompletionItemKind::FUNCTION),
            detail: Some(self.qual_name.clone()),
            documentation: self.short_docs().map(|s| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: s,
                })
            }),
            deprecated: Some(self.properties.deprecated),
            preselect: None,
            sort_text: None,
            filter_text: None,
            insert_text: Some(self.to_autocomplete_snippet()),
            insert_text_format: Some(InsertTextFormat::SNIPPET),
            insert_text_mode: None,
            text_edit: None,
            additional_text_edits: None,
            command: None,
            commit_characters: None,
            data: None,
            tags: None,
        }
    }

    fn to_autocomplete_snippet(&self) -> String {
        if self.name == "loft" {
            return "loft([${0:sketch000}, ${1:sketch001}])${}".to_owned();
        } else if self.name == "hole" {
            return "hole(${0:holeSketch}, ${1:%})${}".to_owned();
        }
        let mut args = Vec::new();
        let mut index = 0;
        for arg in self.args.iter() {
            if let Some((i, arg_str)) = arg.get_autocomplete_snippet(index) {
                index = i + 1;
                args.push(arg_str);
            }
        }
        // We end with ${} so you can jump to the end of the snippet.
        // After the last argument.
        format!("{}({})${{}}", self.name, args.join(", "))
    }

    fn to_signature_help(&self) -> SignatureHelp {
        // TODO Fill this in based on the current position of the cursor.
        let active_parameter = None;

        SignatureHelp {
            signatures: vec![SignatureInformation {
                label: self.name.clone(),
                documentation: self.short_docs().map(|s| {
                    Documentation::MarkupContent(MarkupContent {
                        kind: MarkupKind::Markdown,
                        value: s,
                    })
                }),
                parameters: Some(self.args.iter().map(|arg| arg.to_param_info()).collect()),
                active_parameter,
            }],
            active_signature: Some(0),
            active_parameter,
        }
    }
}

#[derive(Debug, Clone)]
pub struct Properties {
    pub deprecated: bool,
    #[allow(dead_code)]
    pub exported: bool,
    pub impl_kind: ImplKind,
}

#[derive(Debug, Clone)]
pub enum ImplKind {
    Kcl,
    Rust,
}

#[derive(Debug, Clone)]
pub struct ArgData {
    /// The name of the argument.
    pub name: String,
    /// The type of the argument.
    pub ty: Option<String>,
    /// If the argument is required.
    pub kind: ArgKind,
    /// Additional information that could be used instead of the type's description.
    /// This is helpful if the type is really basic, like "u32" -- that won't tell the user much about
    /// how this argument is meant to be used.
    pub docs: Option<String>,
}

#[derive(Debug, Clone)]
pub enum ArgKind {
    Special,
    // Parameter is whether the arg is optional.
    // TODO should store default value if present
    Labelled(bool),
}

impl ArgData {
    fn from_ast(arg: &crate::parsing::ast::types::Parameter) -> Self {
        ArgData {
            name: arg.identifier.name.clone(),
            ty: arg.type_.as_ref().map(|t| t.recast(&Default::default(), 0)),
            // Doc comments are not yet supported on parameters.
            docs: None,
            kind: if arg.labeled {
                ArgKind::Special
            } else {
                ArgKind::Labelled(arg.optional())
            },
        }
    }

    fn _with_meta(&mut self, _meta: &[crate::parsing::ast::types::Node<NonCodeNode>]) {
        // TODO use comments for docs (we can't currently get the comments for an argument)
    }

    pub fn get_autocomplete_snippet(&self, index: usize) -> Option<(usize, String)> {
        match &self.ty {
            Some(s)
                if [
                    "Sketch",
                    "SketchSet",
                    "Solid",
                    "SolidSet",
                    "SketchSurface",
                    "SketchOrSurface",
                ]
                .contains(&&**s) =>
            {
                Some((index, format!("${{{}:{}}}", index, "%")))
            }
            _ => None,
        }
    }

    fn to_param_info(&self) -> ParameterInformation {
        ParameterInformation {
            label: ParameterLabel::Simple(self.name.clone()),
            documentation: self.docs.as_ref().map(|docs| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: docs.clone(),
                })
            }),
        }
    }
}

trait ApplyMeta {
    fn apply_docs(&mut self, summary: Option<String>, description: Option<String>, examples: Vec<String>);
    fn deprecated(&mut self, deprecated: bool);
    fn impl_kind(&mut self, impl_kind: ImplKind);

    fn with_meta(&mut self, meta: &[crate::parsing::ast::types::Node<NonCodeNode>]) {
        let mut comments = Vec::new();
        for m in meta {
            // TODO should only apply unnamed annotations
            match &m.value {
                NonCodeValue::Annotation {
                    properties: Some(props),
                    ..
                } => {
                    for p in props {
                        match &*p.key.name {
                            "impl" => {
                                if let Some(s) = p.value.ident_name() {
                                    self.impl_kind(match s {
                                        "kcl" => ImplKind::Kcl,
                                        "std_rust" => ImplKind::Rust,
                                        _ => unreachable!(),
                                    });
                                }
                            }
                            "deprecated" => {
                                if let Some(b) = p.value.literal_bool() {
                                    self.deprecated(b);
                                }
                            }
                            _ => {}
                        }
                    }
                }
                NonCodeValue::BlockComment { value, .. } | NonCodeValue::NewLineBlockComment { value, .. } => {
                    comments.push(value)
                }
                _ => {}
            }
        }

        let mut summary = None;
        let mut description = None;
        let mut example: Option<String> = None;
        let mut examples = Vec::new();
        for l in comments
            .into_iter()
            .filter(|l| l.starts_with('/'))
            .map(|l| l[1..].trim())
        {
            if description.is_none() && summary.is_none() {
                summary = Some(l.to_owned());
                continue;
            }
            if description.is_none() {
                if l.is_empty() {
                    description = Some(String::new());
                } else {
                    description = summary;
                    summary = None;
                    let d = description.as_mut().unwrap();
                    d.push_str(l);
                    d.push('\n');
                }
                continue;
            }
            if l.starts_with("```") {
                if let Some(e) = example {
                    examples.push(e.trim().to_owned());
                    example = None;
                } else {
                    example = Some(String::new());
                }
                continue;
            }
            if let Some(e) = &mut example {
                e.push_str(l);
                e.push('\n');
                continue;
            }
            match &mut description {
                Some(d) => {
                    d.push_str(l);
                    d.push('\n');
                }
                None => unreachable!(),
            }
        }
        assert!(example.is_none());
        if let Some(d) = &mut description {
            if d.is_empty() {
                description = None;
            }
        }

        self.apply_docs(
            summary.map(|s| s.trim().to_owned()),
            description.map(|s| s.trim().to_owned()),
            examples,
        );
    }
}

impl ApplyMeta for ConstData {
    fn apply_docs(&mut self, summary: Option<String>, description: Option<String>, examples: Vec<String>) {
        self.summary = summary;
        self.description = description;
        self.examples = examples;
    }

    fn deprecated(&mut self, deprecated: bool) {
        self.properties.deprecated = deprecated;
    }

    fn impl_kind(&mut self, _impl_kind: ImplKind) {}
}

impl ApplyMeta for FnData {
    fn apply_docs(&mut self, summary: Option<String>, description: Option<String>, examples: Vec<String>) {
        self.summary = summary;
        self.description = description;
        self.examples = examples;
    }

    fn deprecated(&mut self, deprecated: bool) {
        self.properties.deprecated = deprecated;
    }

    fn impl_kind(&mut self, impl_kind: ImplKind) {
        self.properties.impl_kind = impl_kind;
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn smoke() {
        let result = walk_prelude();
        for d in result {
            if let DocData::Const(d) = d {
                if d.name == "PI" {
                    assert!(d.value.unwrap().starts_with('3'));
                    assert_eq!(d.ty, Some("number".to_owned()));
                    assert_eq!(d.qual_name, "std::math::PI");
                    assert!(d.summary.is_some());
                    assert!(!d.examples.is_empty());
                    return;
                }
            }
        }
        panic!("didn't find PI");
    }
}
