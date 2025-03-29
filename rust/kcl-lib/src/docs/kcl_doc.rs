use std::{collections::HashSet, str::FromStr};

use regex::Regex;
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionItemLabelDetails, Documentation, InsertTextFormat, MarkupContent,
    MarkupKind, ParameterInformation, ParameterLabel, SignatureHelp, SignatureInformation,
};

use crate::{
    execution::annotations,
    parsing::{
        ast::types::{Annotation, ImportSelector, Node, PrimitiveType, Type, VariableKind},
        token::NumericSuffix,
    },
    ModuleId,
};

pub fn walk_prelude() -> Vec<DocData> {
    let mut visitor = CollectionVisitor::default();
    visitor.visit_module("prelude", "").unwrap();
    visitor.result
}

#[derive(Debug, Clone, Default)]
struct CollectionVisitor {
    name: String,
    result: Vec<DocData>,
    id: usize,
}

impl CollectionVisitor {
    fn visit_module(&mut self, name: &str, preferred_prefix: &str) -> Result<(), String> {
        let old_name = std::mem::replace(&mut self.name, name.to_owned());
        let source = crate::modules::read_std(name).unwrap();
        let parsed = crate::parsing::parse_str(source, ModuleId::from_usize(self.id))
            .parse_errs_as_err()
            .unwrap();
        self.id += 1;

        for n in &parsed.body {
            match n {
                crate::parsing::ast::types::BodyItem::ImportStatement(import) if !import.visibility.is_default() => {
                    match &import.path {
                        crate::parsing::ast::types::ImportPath::Std { path } => {
                            match import.selector {
                                ImportSelector::Glob(..) => self.visit_module(&path[1], "")?,
                                ImportSelector::None { .. } => {
                                    self.visit_module(&path[1], &format!("{}::", import.module_name().unwrap()))?
                                }
                                // Only supports glob or whole-module imports for now.
                                _ => unimplemented!(),
                            }
                        }
                        p => return Err(format!("Unexpected import: `{p}`")),
                    }
                }
                crate::parsing::ast::types::BodyItem::VariableDeclaration(var) if !var.visibility.is_default() => {
                    let qual_name = if self.name == "prelude" {
                        "std::".to_owned()
                    } else {
                        format!("std::{}::", self.name)
                    };
                    let mut dd = match var.kind {
                        VariableKind::Fn => DocData::Fn(FnData::from_ast(var, qual_name, preferred_prefix)),
                        VariableKind::Const => DocData::Const(ConstData::from_ast(var, qual_name, preferred_prefix)),
                    };

                    dd.with_meta(&var.outer_attrs);
                    for a in &var.outer_attrs {
                        dd.with_comments(&a.pre_comments);
                    }
                    dd.with_comments(n.get_comments());

                    self.result.push(dd);
                }
                crate::parsing::ast::types::BodyItem::TypeDeclaration(ty) if !ty.visibility.is_default() => {
                    let qual_name = if self.name == "prelude" {
                        "std::".to_owned()
                    } else {
                        format!("std::{}::", self.name)
                    };
                    let mut dd = DocData::Ty(TyData::from_ast(ty, qual_name, preferred_prefix));

                    dd.with_meta(&ty.outer_attrs);
                    for a in &ty.outer_attrs {
                        dd.with_comments(&a.pre_comments);
                    }
                    dd.with_comments(n.get_comments());

                    self.result.push(dd);
                }
                _ => {}
            }
        }

        self.name = old_name;
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub enum DocData {
    Fn(FnData),
    Const(ConstData),
    Ty(TyData),
}

impl DocData {
    pub fn name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.name,
            DocData::Const(c) => &c.name,
            DocData::Ty(t) => &t.name,
        }
    }

    #[allow(dead_code)]
    pub fn file_name(&self) -> String {
        match self {
            DocData::Fn(f) => f.qual_name.replace("::", "-"),
            DocData::Const(c) => format!("consts/{}", c.qual_name.replace("::", "-")),
            DocData::Ty(t) => format!("types/{}", t.name.clone()),
        }
    }

    #[allow(dead_code)]
    pub fn example_name(&self) -> String {
        match self {
            DocData::Fn(f) => f.qual_name.replace("::", "-"),
            DocData::Const(c) => format!("const_{}", c.qual_name.replace("::", "-")),
            DocData::Ty(t) => t.name.clone(),
        }
    }

    #[allow(dead_code)]
    pub fn mod_name(&self) -> String {
        let q = match self {
            DocData::Fn(f) => &f.qual_name,
            DocData::Const(c) => &c.qual_name,
            DocData::Ty(t) => {
                if t.properties.impl_kind == annotations::Impl::Primitive {
                    return "Primitive types".to_owned();
                }
                &t.qual_name
            }
        };
        q[0..q.rfind("::").unwrap()].to_owned()
    }

    #[allow(dead_code)]
    pub fn hide(&self) -> bool {
        match self {
            DocData::Fn(f) => f.properties.doc_hidden || f.properties.deprecated,
            DocData::Const(c) => c.properties.doc_hidden || c.properties.deprecated,
            DocData::Ty(t) => t.properties.doc_hidden || t.properties.deprecated,
        }
    }

    pub fn to_completion_item(&self) -> CompletionItem {
        match self {
            DocData::Fn(f) => f.to_completion_item(),
            DocData::Const(c) => c.to_completion_item(),
            DocData::Ty(t) => t.to_completion_item(),
        }
    }

    pub fn to_signature_help(&self) -> Option<SignatureHelp> {
        match self {
            DocData::Fn(f) => Some(f.to_signature_help()),
            DocData::Const(_) => None,
            DocData::Ty(_) => None,
        }
    }

    fn with_meta(&mut self, attrs: &[Node<Annotation>]) {
        match self {
            DocData::Fn(f) => f.with_meta(attrs),
            DocData::Const(c) => c.with_meta(attrs),
            DocData::Ty(t) => t.with_meta(attrs),
        }
    }

    fn with_comments(&mut self, comments: &[String]) {
        match self {
            DocData::Fn(f) => f.with_comments(comments),
            DocData::Const(c) => c.with_comments(comments),
            DocData::Ty(t) => t.with_comments(comments),
        }
    }

    #[cfg(test)]
    fn examples(&self) -> impl Iterator<Item = &String> {
        match self {
            DocData::Fn(f) => f.examples.iter(),
            DocData::Const(c) => c.examples.iter(),
            DocData::Ty(t) => t.examples.iter(),
        }
        .filter_map(|(s, p)| (!p.norun).then_some(s))
    }
}

#[derive(Debug, Clone)]
pub struct ConstData {
    pub name: String,
    /// How the const is indexed, etc.
    pub preferred_name: String,
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
    pub examples: Vec<(String, ExampleProperties)>,
}

impl ConstData {
    fn from_ast(
        var: &crate::parsing::ast::types::VariableDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
    ) -> Self {
        assert_eq!(var.kind, crate::parsing::ast::types::VariableKind::Const);

        let (value, ty) = match &var.declaration.init {
            crate::parsing::ast::types::Expr::Literal(lit) => (
                Some(lit.raw.clone()),
                Some(match &lit.value {
                    crate::parsing::ast::types::LiteralValue::Number { suffix, .. } => {
                        if *suffix == NumericSuffix::None || *suffix == NumericSuffix::Count {
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
            preferred_name: format!("{preferred_prefix}{name}"),
            name,
            qual_name,
            value,
            // TODO use type decl when we have them.
            ty,
            properties: Properties {
                exported: !var.visibility.is_default(),
                deprecated: false,
                doc_hidden: false,
                impl_kind: annotations::Impl::Kcl,
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
            label: self.preferred_name.clone(),
            label_details: Some(CompletionItemLabelDetails {
                detail: self.value.clone(),
                description: None,
            }),
            kind: Some(CompletionItemKind::CONSTANT),
            detail: Some(detail),
            documentation: self.short_docs().map(|s| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: remove_md_links(&s),
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
    /// How the function is indexed, etc.
    pub preferred_name: String,
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
    pub examples: Vec<(String, ExampleProperties)>,
    #[allow(dead_code)]
    pub referenced_types: Vec<String>,
}

impl FnData {
    fn from_ast(
        var: &crate::parsing::ast::types::VariableDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
    ) -> Self {
        assert_eq!(var.kind, crate::parsing::ast::types::VariableKind::Fn);
        let crate::parsing::ast::types::Expr::FunctionExpression(expr) = &var.declaration.init else {
            unreachable!();
        };
        let name = var.declaration.id.name.clone();
        qual_name.push_str(&name);

        let mut referenced_types = HashSet::new();
        if let Some(t) = &expr.return_type {
            collect_type_names(&mut referenced_types, t);
        }
        for p in &expr.params {
            if let Some(t) = &p.type_ {
                collect_type_names(&mut referenced_types, t);
            }
        }

        FnData {
            preferred_name: format!("{preferred_prefix}{name}"),
            name,
            qual_name,
            args: expr.params.iter().map(ArgData::from_ast).collect(),
            return_type: expr.return_type.as_ref().map(|t| t.to_string()),
            properties: Properties {
                exported: !var.visibility.is_default(),
                deprecated: false,
                doc_hidden: false,
                impl_kind: annotations::Impl::Kcl,
            },
            summary: None,
            description: None,
            examples: Vec::new(),
            referenced_types: referenced_types.into_iter().collect(),
        }
    }

    fn short_docs(&self) -> Option<String> {
        match (&self.summary, &self.description) {
            (None, None) => None,
            (None, Some(d)) | (Some(d), None) => Some(d.clone()),
            (Some(s), Some(d)) => Some(format!("{s}\n\n{d}")),
        }
    }

    pub fn fn_signature(&self) -> String {
        let mut signature = String::new();

        signature.push('(');
        for (i, arg) in self.args.iter().enumerate() {
            if i > 0 {
                signature.push_str(", ");
            }
            match &arg.kind {
                ArgKind::Special => signature.push_str(&format!("@{}", arg.name)),
                ArgKind::Labelled(false) => signature.push_str(&arg.name),
                ArgKind::Labelled(true) => signature.push_str(&format!("{}?", arg.name)),
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
                    value: remove_md_links(&s),
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

    #[allow(clippy::literal_string_with_formatting_args)]
    pub(super) fn to_autocomplete_snippet(&self) -> String {
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
        format!("{}({})${{}}", self.preferred_name, args.join(", "))
    }

    fn to_signature_help(&self) -> SignatureHelp {
        // TODO Fill this in based on the current position of the cursor.
        let active_parameter = None;

        SignatureHelp {
            signatures: vec![SignatureInformation {
                label: self.preferred_name.clone(),
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
    pub doc_hidden: bool,
    #[allow(dead_code)]
    pub exported: bool,
    pub impl_kind: annotations::Impl,
}

#[allow(dead_code)]
#[derive(Debug, Clone)]
pub struct ExampleProperties {
    pub norun: bool,
    pub inline: bool,
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
    /// This is helpful if the type is really basic, like "number" -- that won't tell the user much about
    /// how this argument is meant to be used.
    pub docs: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum ArgKind {
    Special,
    // Parameter is whether the arg is optional.
    // TODO should store default value if present
    Labelled(bool),
}

impl ArgData {
    fn from_ast(arg: &crate::parsing::ast::types::Parameter) -> Self {
        let mut result = ArgData {
            name: arg.identifier.name.clone(),
            ty: arg.type_.as_ref().map(|t| t.to_string()),
            docs: None,
            kind: if arg.labeled {
                ArgKind::Labelled(arg.optional())
            } else {
                ArgKind::Special
            },
        };

        result.with_comments(&arg.identifier.pre_comments);
        result
    }

    pub fn get_autocomplete_snippet(&self, index: usize) -> Option<(usize, String)> {
        let label = if self.kind == ArgKind::Special {
            String::new()
        } else {
            format!("{} = ", self.name)
        };
        match self.ty.as_deref() {
            Some(s) if ["Sketch", "Solid", "Plane | Face", "Sketch | Plane | Face"].contains(&s) => {
                Some((index, format!("{label}${{{}:{}}}", index, "%")))
            }
            Some("number") if self.kind.required() => Some((index, format!(r#"{label}${{{}:3.14}}"#, index))),
            Some("Point2d") if self.kind.required() => Some((
                index + 1,
                format!(r#"{label}[${{{}:3.14}}, ${{{}:3.14}}]"#, index, index + 1),
            )),
            Some("Point3d") if self.kind.required() => Some((
                index + 2,
                format!(
                    r#"{label}[${{{}:3.14}}, ${{{}:3.14}}, ${{{}:3.14}}]"#,
                    index,
                    index + 1,
                    index + 2
                ),
            )),
            Some("string") if self.kind.required() => Some((index, format!(r#"{label}${{{}:"string"}}"#, index))),
            Some("bool") if self.kind.required() => Some((index, format!(r#"{label}${{{}:false}}"#, index))),
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

impl ArgKind {
    #[allow(dead_code)]
    pub fn required(self) -> bool {
        match self {
            ArgKind::Special => true,
            ArgKind::Labelled(opt) => !opt,
        }
    }
}

#[derive(Debug, Clone)]
pub struct TyData {
    /// The name of the function.
    pub name: String,
    /// How the type is indexed, etc.
    pub preferred_name: String,
    /// The fully qualified name.
    pub qual_name: String,
    pub properties: Properties,
    pub alias: Option<String>,

    /// The summary of the function.
    pub summary: Option<String>,
    /// The description of the function.
    pub description: Option<String>,
    /// Code examples.
    /// These are tested and we know they compile and execute.
    pub examples: Vec<(String, ExampleProperties)>,
    #[allow(dead_code)]
    pub referenced_types: Vec<String>,
}

impl TyData {
    fn from_ast(
        ty: &crate::parsing::ast::types::TypeDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
    ) -> Self {
        let name = ty.name.name.clone();
        qual_name.push_str(&name);
        let mut referenced_types = HashSet::new();
        if let Some(t) = &ty.alias {
            collect_type_names(&mut referenced_types, t);
        }

        TyData {
            preferred_name: format!("{preferred_prefix}{name}"),
            name,
            qual_name,
            properties: Properties {
                exported: !ty.visibility.is_default(),
                deprecated: false,
                doc_hidden: false,
                impl_kind: annotations::Impl::Kcl,
            },
            alias: ty.alias.as_ref().map(|t| t.to_string()),
            summary: None,
            description: None,
            examples: Vec::new(),
            referenced_types: referenced_types.into_iter().collect(),
        }
    }

    #[allow(dead_code)]
    pub fn qual_name(&self) -> &str {
        if self.properties.impl_kind == annotations::Impl::Primitive {
            &self.name
        } else {
            &self.qual_name
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
        CompletionItem {
            label: self.preferred_name.clone(),
            label_details: self.alias.as_ref().map(|t| CompletionItemLabelDetails {
                detail: Some(format!("type {} = {t}", self.name)),
                description: None,
            }),
            kind: Some(CompletionItemKind::FUNCTION),
            detail: Some(self.qual_name().to_owned()),
            documentation: self.short_docs().map(|s| {
                Documentation::MarkupContent(MarkupContent {
                    kind: MarkupKind::Markdown,
                    value: remove_md_links(&s),
                })
            }),
            deprecated: Some(self.properties.deprecated),
            preselect: None,
            sort_text: None,
            filter_text: None,
            insert_text: Some(self.preferred_name.clone()),
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
}

fn remove_md_links(s: &str) -> String {
    let re = Regex::new(r"\[([^\]]*)\]\([^\)]*\)").unwrap();
    re.replace_all(s, "$1").to_string()
}

trait ApplyMeta {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        examples: Vec<(String, ExampleProperties)>,
    );
    fn deprecated(&mut self, deprecated: bool);
    fn doc_hidden(&mut self, doc_hidden: bool);
    fn impl_kind(&mut self, impl_kind: annotations::Impl);

    fn with_comments(&mut self, comments: &[String]) {
        if comments.iter().all(|s| s.is_empty()) {
            return;
        }

        let mut summary = None;
        let mut description = None;
        let mut example: Option<(String, ExampleProperties)> = None;
        let mut examples = Vec::new();
        for l in comments.iter().filter(|l| l.starts_with("///")).map(|l| {
            if let Some(ll) = l.strip_prefix("/// ") {
                ll
            } else {
                &l[3..]
            }
        }) {
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
            #[allow(clippy::manual_strip)]
            if l.starts_with("```") {
                if let Some((e, p)) = example {
                    if p.inline {
                        description.as_mut().unwrap().push_str("```\n");
                    }

                    examples.push((e.trim().to_owned(), p));
                    example = None;
                } else {
                    let args = l[3..].split(',');
                    let mut inline = false;
                    let mut norun = false;
                    for a in args {
                        match a.trim() {
                            "inline" => inline = true,
                            "norun" | "no_run" => norun = true,
                            _ => {}
                        }
                    }
                    example = Some((String::new(), ExampleProperties { norun, inline }));

                    if inline {
                        description.as_mut().unwrap().push_str("```js\n");
                    }
                }
                continue;
            }
            if let Some((e, p)) = &mut example {
                e.push_str(l);
                e.push('\n');
                if !p.inline {
                    continue;
                }
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

    fn with_meta(&mut self, attrs: &[Node<Annotation>]) {
        for attr in attrs {
            if let Annotation {
                name: None,
                properties: Some(props),
                ..
            } = &attr.inner
            {
                for p in props {
                    match &*p.key.name {
                        annotations::IMPL => {
                            if let Some(s) = p.value.ident_name() {
                                self.impl_kind(annotations::Impl::from_str(s).unwrap());
                            }
                        }
                        "deprecated" => {
                            if let Some(b) = p.value.literal_bool() {
                                self.deprecated(b);
                            }
                        }
                        "doc_hidden" => {
                            if let Some(b) = p.value.literal_bool() {
                                self.doc_hidden(b);
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
    }
}

impl ApplyMeta for ConstData {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        examples: Vec<(String, ExampleProperties)>,
    ) {
        self.summary = summary;
        self.description = description;
        self.examples = examples;
    }

    fn deprecated(&mut self, deprecated: bool) {
        self.properties.deprecated = deprecated;
    }

    fn doc_hidden(&mut self, doc_hidden: bool) {
        self.properties.doc_hidden = doc_hidden;
    }

    fn impl_kind(&mut self, _impl_kind: annotations::Impl) {}
}

impl ApplyMeta for FnData {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        examples: Vec<(String, ExampleProperties)>,
    ) {
        self.summary = summary;
        self.description = description;
        self.examples = examples;
    }

    fn deprecated(&mut self, deprecated: bool) {
        self.properties.deprecated = deprecated;
    }

    fn doc_hidden(&mut self, doc_hidden: bool) {
        self.properties.doc_hidden = doc_hidden;
    }

    fn impl_kind(&mut self, impl_kind: annotations::Impl) {
        self.properties.impl_kind = impl_kind;
    }
}

impl ApplyMeta for TyData {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        examples: Vec<(String, ExampleProperties)>,
    ) {
        self.summary = summary;
        self.description = description;
        self.examples = examples;
    }

    fn deprecated(&mut self, deprecated: bool) {
        self.properties.deprecated = deprecated;
    }

    fn doc_hidden(&mut self, doc_hidden: bool) {
        self.properties.doc_hidden = doc_hidden;
    }

    fn impl_kind(&mut self, impl_kind: annotations::Impl) {
        self.properties.impl_kind = impl_kind;
    }
}

impl ApplyMeta for ArgData {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        _examples: Vec<(String, ExampleProperties)>,
    ) {
        let Some(mut docs) = summary else {
            return;
        };
        if let Some(desc) = description {
            docs.push_str("\n\n");
            docs.push_str(&desc);
        }

        self.docs = Some(docs);
    }

    fn deprecated(&mut self, _deprecated: bool) {
        unreachable!();
    }

    fn doc_hidden(&mut self, _doc_hidden: bool) {
        unreachable!();
    }

    fn impl_kind(&mut self, _impl_kind: annotations::Impl) {
        unreachable!();
    }
}

fn collect_type_names(acc: &mut HashSet<String>, ty: &Type) {
    match ty {
        Type::Primitive(primitive_type) => {
            acc.insert(collect_type_names_from_primitive(primitive_type));
        }
        Type::Array { ty, .. } => {
            acc.insert(collect_type_names_from_primitive(ty));
        }
        Type::Union { tys } => tys.iter().for_each(|t| {
            acc.insert(collect_type_names_from_primitive(t));
        }),
        Type::Object { properties } => properties.iter().for_each(|p| {
            if let Some(t) = &p.type_ {
                collect_type_names(acc, t)
            }
        }),
    }
}

fn collect_type_names_from_primitive(ty: &PrimitiveType) -> String {
    match ty {
        PrimitiveType::String => "string".to_owned(),
        PrimitiveType::Number(_) => "number".to_owned(),
        PrimitiveType::Boolean => "bool".to_owned(),
        PrimitiveType::Tag => "tag".to_owned(),
        PrimitiveType::Named(id) => id.name.clone(),
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

    #[test]
    fn test_remove_md_links() {
        assert_eq!(
            remove_md_links("sdf dsf sd fj sdk fasdfs. asad[sdfs] dfsdf(dsfs, dsf)"),
            "sdf dsf sd fj sdk fasdfs. asad[sdfs] dfsdf(dsfs, dsf)".to_owned()
        );
        assert_eq!(remove_md_links("[]()"), "".to_owned());
        assert_eq!(remove_md_links("[foo](bar)"), "foo".to_owned());
        assert_eq!(
            remove_md_links("asdasda dsa[foo](http://www.bar/baz/qux.md). asdasdasdas asdas"),
            "asdasda dsafoo. asdasdasdas asdas".to_owned()
        );
        assert_eq!(
            remove_md_links("a [foo](bar) b [2](bar) c [_](bar)"),
            "a foo b 2 c _".to_owned()
        );
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 5)]
    async fn test_examples() -> miette::Result<()> {
        let std = walk_prelude();
        for d in std {
            for (i, eg) in d.examples().enumerate() {
                let result =
                    match crate::test_server::execute_and_snapshot(eg, crate::settings::types::UnitLength::Mm, None)
                        .await
                    {
                        Err(crate::errors::ExecError::Kcl(e)) => {
                            return Err(miette::Report::new(crate::errors::Report {
                                error: e.error,
                                filename: format!("{}{i}", d.name()),
                                kcl_source: eg.to_string(),
                            }));
                        }
                        Err(other_err) => panic!("{}", other_err),
                        Ok(img) => img,
                    };
                twenty_twenty::assert_image(
                    format!("tests/outputs/serial_test_example_{}{i}.png", d.example_name()),
                    &result,
                    0.99,
                );
            }
        }

        Ok(())
    }
}
