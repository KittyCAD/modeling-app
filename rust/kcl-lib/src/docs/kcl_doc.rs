use std::{fmt, str::FromStr};

use indexmap::IndexMap;
use regex::Regex;
use tower_lsp::lsp_types::{
    CompletionItem, CompletionItemKind, CompletionItemLabelDetails, Documentation, InsertTextFormat, MarkupContent,
    MarkupKind, ParameterInformation, ParameterLabel, SignatureHelp, SignatureInformation,
};

use crate::{
    ModuleId,
    execution::annotations,
    parsing::{
        ast::types::{
            Annotation, Expr, ImportSelector, ItemVisibility, LiteralValue, Node, NonCodeValue, VariableKind,
        },
        token::NumericSuffix,
    },
};

pub fn walk_prelude() -> ModData {
    visit_module("prelude", "", WalkForNames::All).unwrap()
}

#[derive(Clone, Debug)]
enum WalkForNames<'a> {
    All,
    Selected(Vec<&'a str>),
}

impl<'a> WalkForNames<'a> {
    fn contains(&self, name: &str) -> bool {
        match self {
            WalkForNames::All => true,
            WalkForNames::Selected(names) => names.contains(&name),
        }
    }

    fn intersect(&self, names: impl Iterator<Item = &'a str>) -> Self {
        match self {
            WalkForNames::All => WalkForNames::Selected(names.collect()),
            WalkForNames::Selected(mine) => WalkForNames::Selected(names.filter(|n| mine.contains(n)).collect()),
        }
    }
}

fn visit_module(name: &str, preferred_prefix: &str, names: WalkForNames) -> Result<ModData, String> {
    let mut result = ModData::new(name, preferred_prefix);

    let source = crate::modules::read_std(name).unwrap();
    let parsed = crate::parsing::parse_str(source, ModuleId::from_usize(0))
        .parse_errs_as_err()
        .unwrap();

    // TODO handle examples; use with_comments
    let mut summary = String::new();
    let mut description = None;
    for n in &parsed.non_code_meta.start_nodes {
        match &n.value {
            NonCodeValue::BlockComment { value, .. } if value.starts_with('/') => {
                let line = value[1..].trim();
                if line.is_empty() {
                    match &mut description {
                        None => description = Some(String::new()),
                        Some(d) => d.push_str("\n\n"),
                    }
                } else {
                    match &mut description {
                        None => {
                            summary.push_str(line);
                            summary.push(' ');
                        }
                        Some(d) => {
                            d.push_str(line);
                            d.push(' ');
                        }
                    }
                }
            }
            _ => break,
        }
    }
    if !summary.is_empty() {
        result.summary = Some(summary);
    }
    result.description = description;

    for n in &parsed.body {
        if n.visibility() != ItemVisibility::Export {
            continue;
        }
        match n {
            crate::parsing::ast::types::BodyItem::ImportStatement(import) => match &import.path {
                crate::parsing::ast::types::ImportPath::Std { path } => {
                    let m = match &import.selector {
                        ImportSelector::Glob(..) => Some(visit_module(&path[1], "", names.clone())?),
                        ImportSelector::None { .. } => {
                            let name = import.module_name().unwrap();
                            if names.contains(&name) {
                                Some(visit_module(&path[1], &format!("{name}::"), WalkForNames::All)?)
                            } else {
                                None
                            }
                        }
                        ImportSelector::List { items } => Some(visit_module(
                            &path[1],
                            "",
                            names.intersect(items.iter().map(|n| &*n.name.name)),
                        )?),
                    };
                    if let Some(m) = m {
                        result.children.insert(format!("M:{}", m.qual_name), DocData::Mod(m));
                    }
                }
                p => return Err(format!("Unexpected import: `{p}`")),
            },
            crate::parsing::ast::types::BodyItem::VariableDeclaration(var) => {
                if !names.contains(var.name()) {
                    continue;
                }
                let qual = format!("{}::", &result.qual_name);
                let mut dd = match var.kind {
                    VariableKind::Fn => DocData::Fn(FnData::from_ast(var, qual, preferred_prefix, &result.name)),
                    VariableKind::Const => {
                        DocData::Const(ConstData::from_ast(var, qual, preferred_prefix, &result.name))
                    }
                };
                let key = format!("I:{}", dd.qual_name());
                if result.children.contains_key(&key) {
                    continue;
                }

                dd.with_meta(&var.outer_attrs);
                for a in &var.outer_attrs {
                    dd.with_comments(&a.pre_comments);
                }
                dd.with_comments(n.get_comments());

                result.children.insert(key, dd);
            }
            crate::parsing::ast::types::BodyItem::TypeDeclaration(ty) => {
                if !names.contains(ty.name()) {
                    continue;
                }
                let qual = format!("{}::", &result.qual_name);
                let mut dd = DocData::Ty(TyData::from_ast(ty, qual, preferred_prefix, &result.name));
                let key = format!("T:{}", dd.qual_name());
                if result.children.contains_key(&key) {
                    continue;
                }

                dd.with_meta(&ty.outer_attrs);
                for a in &ty.outer_attrs {
                    dd.with_comments(&a.pre_comments);
                }
                dd.with_comments(n.get_comments());

                result.children.insert(key, dd);
            }
            _ => {}
        }
    }

    Ok(result)
}

#[derive(Debug, Clone)]
pub enum DocData {
    Fn(FnData),
    Const(ConstData),
    Ty(TyData),
    Mod(ModData),
}

impl DocData {
    pub fn name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.name,
            DocData::Const(c) => &c.name,
            DocData::Ty(t) => &t.name,
            DocData::Mod(m) => &m.name,
        }
    }

    #[allow(dead_code)]
    pub fn preferred_name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.preferred_name,
            DocData::Const(c) => &c.preferred_name,
            DocData::Ty(t) => &t.preferred_name,
            DocData::Mod(m) => &m.preferred_name,
        }
    }

    pub fn qual_name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.qual_name,
            DocData::Const(c) => &c.qual_name,
            DocData::Ty(t) => &t.qual_name,
            DocData::Mod(m) => &m.qual_name,
        }
    }

    /// The name of the module in which the item is declared, e.g., `sketch`
    #[allow(dead_code)]
    pub fn module_name(&self) -> &str {
        match self {
            DocData::Fn(f) => &f.module_name,
            DocData::Const(c) => &c.module_name,
            DocData::Ty(t) => &t.module_name,
            DocData::Mod(m) => &m.module_name,
        }
    }

    #[allow(dead_code)]
    pub fn file_name(&self) -> String {
        match self {
            DocData::Fn(f) => format!("functions/{}", f.qual_name.replace("::", "-")),
            DocData::Const(c) => format!("consts/{}", c.qual_name.replace("::", "-")),
            DocData::Ty(t) => format!("types/{}", t.qual_name.replace("::", "-")),
            DocData::Mod(m) => format!("modules/{}", m.qual_name.replace("::", "-")),
        }
    }

    #[allow(dead_code)]
    pub fn example_name(&self) -> String {
        match self {
            DocData::Fn(f) => format!("fn_{}", f.qual_name.replace("::", "-")),
            DocData::Const(c) => format!("const_{}", c.qual_name.replace("::", "-")),
            DocData::Ty(t) => format!("ty_{}", t.qual_name.replace("::", "-")),
            DocData::Mod(_) => unimplemented!(),
        }
    }

    /// The path to the module through which the item is accessed, e.g., `std::sketch`
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
            DocData::Mod(m) => &m.qual_name,
        };
        q[0..q.rfind("::").unwrap()].to_owned()
    }

    #[allow(dead_code)]
    pub fn hide(&self) -> bool {
        match self {
            DocData::Fn(f) => f.properties.doc_hidden || f.properties.deprecated,
            DocData::Const(c) => c.properties.doc_hidden || c.properties.deprecated,
            DocData::Ty(t) => t.properties.doc_hidden || t.properties.deprecated,
            DocData::Mod(_) => false,
        }
    }

    pub fn to_completion_item(&self) -> Option<CompletionItem> {
        match self {
            DocData::Fn(f) => Some(f.to_completion_item()),
            DocData::Const(c) => Some(c.to_completion_item()),
            DocData::Ty(t) => Some(t.to_completion_item()),
            DocData::Mod(_) => None,
        }
    }

    pub fn to_signature_help(&self) -> Option<SignatureHelp> {
        match self {
            DocData::Fn(f) => Some(f.to_signature_help()),
            DocData::Const(_) => None,
            DocData::Ty(_) => None,
            DocData::Mod(_) => None,
        }
    }

    fn with_meta(&mut self, attrs: &[Node<Annotation>]) {
        match self {
            DocData::Fn(f) => f.with_meta(attrs),
            DocData::Const(c) => c.with_meta(attrs),
            DocData::Ty(t) => t.with_meta(attrs),
            DocData::Mod(m) => m.with_meta(attrs),
        }
    }

    fn with_comments(&mut self, comments: &[String]) {
        match self {
            DocData::Fn(f) => f.with_comments(comments),
            DocData::Const(c) => c.with_comments(comments),
            DocData::Ty(t) => t.with_comments(comments),
            DocData::Mod(m) => m.with_comments(comments),
        }
    }

    fn expect_mod(&self) -> &ModData {
        match self {
            DocData::Mod(m) => m,
            _ => unreachable!(),
        }
    }

    #[allow(dead_code)]
    pub(super) fn summary(&self) -> Option<&String> {
        match self {
            DocData::Fn(f) => f.summary.as_ref(),
            DocData::Const(c) => c.summary.as_ref(),
            DocData::Ty(t) => t.summary.as_ref(),
            DocData::Mod(m) => m.summary.as_ref(),
        }
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

    pub module_name: String,
}

impl ConstData {
    fn from_ast(
        var: &crate::parsing::ast::types::VariableDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
        module_name: &str,
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
            crate::parsing::ast::types::Expr::AscribedExpression(e) => (None, Some(e.ty.to_string())),
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
            module_name: module_name.to_owned(),
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
pub struct ModData {
    pub name: String,
    /// How the module is indexed, etc.
    pub preferred_name: String,
    /// The fully qualified name.
    pub qual_name: String,
    /// The summary of the module.
    pub summary: Option<String>,
    /// The description of the module.
    pub description: Option<String>,
    pub module_name: String,

    pub children: IndexMap<String, DocData>,
}

impl ModData {
    fn new(name: &str, preferred_prefix: &str) -> Self {
        let (name, qual_name, module_name) = if name == "prelude" {
            ("std", "std".to_owned(), String::new())
        } else {
            (name, format!("std::{name}"), "std".to_owned())
        };
        Self {
            preferred_name: format!("{preferred_prefix}{name}"),
            name: name.to_owned(),
            qual_name,
            summary: None,
            description: None,
            children: IndexMap::new(),
            module_name,
        }
    }

    #[allow(dead_code)]
    pub fn find_by_name(&self, name: &str) -> Option<&DocData> {
        if let Some(result) = self
            .children
            .values()
            .find(|dd| dd.name() == name && !matches!(dd, DocData::Mod(_)))
        {
            return Some(result);
        }

        #[allow(clippy::iter_over_hash_type)]
        for (k, v) in &self.children {
            if k.starts_with("M:") {
                if let Some(result) = v.expect_mod().find_by_name(name) {
                    return Some(result);
                }
            }
        }

        None
    }

    pub fn all_docs(&self) -> impl Iterator<Item = &DocData> {
        let result = self.children.values();
        // TODO really this should be recursive, currently assume std is only one module deep.
        result.chain(
            self.children
                .iter()
                .filter(|(k, _)| k.starts_with("M:"))
                .flat_map(|(_, d)| d.expect_mod().children.values()),
        )
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

    pub module_name: String,
}

impl FnData {
    fn from_ast(
        var: &crate::parsing::ast::types::VariableDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
        module_name: &str,
    ) -> Self {
        assert_eq!(var.kind, crate::parsing::ast::types::VariableKind::Fn);
        let crate::parsing::ast::types::Expr::FunctionExpression(expr) = &var.declaration.init else {
            unreachable!();
        };
        let name = var.declaration.id.name.clone();
        qual_name.push_str(&name);

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
            module_name: module_name.to_owned(),
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

        if self.args.is_empty() {
            signature.push_str("()");
        } else if self.args.len() == 1 {
            signature.push('(');
            signature.push_str(&self.args[0].to_string());
            signature.push(')');
        } else {
            signature.push('(');
            for a in &self.args {
                signature.push_str("\n  ");
                signature.push_str(&a.to_string());
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

    pub(super) fn to_autocomplete_snippet(&self) -> String {
        if self.name == "loft" {
            return "loft([${0:sketch000}, ${1:sketch001}])".to_owned();
        } else if self.name == "union" {
            return "union([${0:extrude001}, ${1:extrude002}])".to_owned();
        } else if self.name == "subtract" {
            return "subtract([${0:extrude001}], tools = [${1:extrude002}])".to_owned();
        } else if self.name == "intersect" {
            return "intersect([${0:extrude001}, ${1:extrude002}])".to_owned();
        } else if self.name == "clone" {
            return "clone(${0:part001})".to_owned();
        } else if self.name == "hole" {
            return "hole(${0:holeSketch}, ${1:%})".to_owned();
        }
        let mut args = Vec::new();
        let mut index = 0;
        for arg in self.args.iter() {
            if let Some((i, arg_str)) = arg.get_autocomplete_snippet(index) {
                index = i + 1;
                args.push(arg_str);
            }
        }
        format!("{}({})", self.preferred_name, args.join(", "))
    }

    pub(crate) fn to_signature_help(&self) -> SignatureHelp {
        // TODO Fill this in based on the current position of the cursor.
        let active_parameter = None;

        SignatureHelp {
            signatures: vec![SignatureInformation {
                label: self.preferred_name.clone() + &self.fn_signature(),
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
    pub override_in_snippet: Option<bool>,
    /// Additional information that could be used instead of the type's description.
    /// This is helpful if the type is really basic, like "number" -- that won't tell the user much about
    /// how this argument is meant to be used.
    pub docs: Option<String>,
    /// If given, LSP should use these as completion items.
    pub snippet_array: Option<Vec<String>>,
}

impl fmt::Display for ArgData {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.kind {
            ArgKind::Special => write!(f, "@{}", self.name)?,
            ArgKind::Labelled(false) => f.write_str(&self.name)?,
            ArgKind::Labelled(true) => write!(f, "{}?", self.name)?,
        }
        if let Some(ty) = &self.ty {
            write!(f, ": {ty}")?;
        }
        Ok(())
    }
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
            snippet_array: Default::default(),
            name: arg.identifier.name.clone(),
            ty: arg.type_.as_ref().map(|t| t.to_string()),
            docs: None,
            override_in_snippet: None,
            kind: if arg.labeled {
                ArgKind::Labelled(arg.optional())
            } else {
                ArgKind::Special
            },
        };

        for attr in &arg.identifier.outer_attrs {
            if let Annotation {
                name: None,
                properties: Some(props),
                ..
            } = &attr.inner
            {
                for p in props {
                    if p.key.name == "includeInSnippet" {
                        if let Some(b) = p.value.literal_bool() {
                            result.override_in_snippet = Some(b);
                        } else {
                            panic!(
                                "Invalid value for `includeInSnippet`, expected bool literal, found {:?}",
                                p.value
                            );
                        }
                    } else if p.key.name == "snippetArray" {
                        let Expr::ArrayExpression(arr) = &p.value else {
                            panic!(
                                "Invalid value for `snippetArray`, expected array literal, found {:?}",
                                p.value
                            );
                        };
                        let mut items = Vec::new();
                        for s in &arr.elements {
                            let Expr::Literal(lit) = s else {
                                panic!(
                                    "Invalid value in `snippetArray`, all items must be string literals but found {s:?}"
                                );
                            };
                            let LiteralValue::String(litstr) = &lit.inner.value else {
                                panic!(
                                    "Invalid value in `snippetArray`, all items must be string literals but found {s:?}"
                                );
                            };
                            items.push(litstr.to_owned());
                        }
                        result.snippet_array = Some(items);
                    }
                }
            }
        }

        result.with_comments(&arg.identifier.pre_comments);
        result
    }

    pub fn get_autocomplete_snippet(&self, index: usize) -> Option<(usize, String)> {
        match self.override_in_snippet {
            Some(false) => return None,
            None if !self.kind.required() => return None,
            _ => {}
        }

        let label = if self.kind == ArgKind::Special {
            String::new()
        } else {
            format!("{} = ", self.name)
        };
        if let Some(vals) = &self.snippet_array {
            let mut snippet = label.to_owned();
            snippet.push('[');
            let n = vals.len();
            for (i, val) in vals.iter().enumerate() {
                snippet.push_str(&format!("${{{}:{}}}", index + i, val));
                if i != n - 1 {
                    snippet.push_str(", ");
                }
            }
            snippet.push(']');
            return Some((index + n - 1, snippet));
        }
        match self.ty.as_deref() {
            Some("Sketch") if self.kind == ArgKind::Special => None,
            Some(s) if s.starts_with("number") => Some((index, format!(r#"{label}${{{index}:10}}"#))),
            Some("Point2d") => Some((index + 1, format!(r#"{label}[${{{}:0}}, ${{{}:0}}]"#, index, index + 1))),
            Some("Point3d") => Some((
                index + 2,
                format!(
                    r#"{label}[${{{}:0}}, ${{{}:0}}, ${{{}:0}}]"#,
                    index,
                    index + 1,
                    index + 2
                ),
            )),
            Some("Axis2d | Edge") | Some("Axis3d | Edge") => Some((index, format!(r#"{label}${{{index}:X}}"#))),
            Some("Sketch") | Some("Sketch | Helix") => Some((index, format!(r#"{label}${{{index}:sketch000}}"#))),
            Some("Edge") => Some((index, format!(r#"{label}${{{index}:tag_or_edge_fn}}"#))),
            Some("[Edge; 1+]") => Some((index, format!(r#"{label}[${{{index}:tag_or_edge_fn}}]"#))),
            Some("Plane") | Some("Solid | Plane") => Some((index, format!(r#"{label}${{{index}:XY}}"#))),
            Some("[TaggedFace; 2]") => Some((
                index + 1,
                format!(r#"{label}[${{{}:tag}}, ${{{}:tag}}]"#, index, index + 1),
            )),

            Some("string") => {
                if self.name == "color" {
                    Some((index, format!(r"{label}${{{}:{}}}", index, "\"#ff0000\"")))
                } else {
                    Some((index, format!(r#"{label}${{{index}:"string"}}"#)))
                }
            }
            Some("bool") => Some((index, format!(r#"{label}${{{index}:false}}"#))),
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

    pub module_name: String,
}

impl TyData {
    fn from_ast(
        ty: &crate::parsing::ast::types::TypeDeclaration,
        mut qual_name: String,
        preferred_prefix: &str,
        module_name: &str,
    ) -> Self {
        let name = ty.name.name.clone();
        qual_name.push_str(&name);

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
            module_name: module_name.to_owned(),
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
        let mut description: Option<String> = None;
        let mut example: Option<(String, ExampleProperties)> = None;
        let mut examples = Vec::new();
        for l in comments.iter().filter(|l| l.starts_with("///")).map(|l| {
            if let Some(ll) = l.strip_prefix("/// ") {
                ll
            } else {
                &l[3..]
            }
        }) {
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

            // An empty line outside of an example. This either starts the description (with or
            // without a summary) or adds a blank line to the description.
            if l.is_empty() {
                match &mut description {
                    Some(d) => {
                        d.push('\n');
                    }
                    None => description = Some(String::new()),
                }
                continue;
            }

            // Our first line, start the summary.
            if description.is_none() && summary.is_none() {
                summary = Some(l.to_owned());
                continue;
            }

            // Append the line to either the description or summary.
            match &mut description {
                Some(d) => {
                    d.push_str(l);
                    d.push('\n');
                }
                None => {
                    let s = summary.as_mut().unwrap();
                    s.push(' ');
                    s.push_str(l);
                }
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
                        annotations::DEPRECATED => {
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

impl ApplyMeta for ModData {
    fn apply_docs(
        &mut self,
        summary: Option<String>,
        description: Option<String>,
        examples: Vec<(String, ExampleProperties)>,
    ) {
        self.summary = summary;
        self.description = description;
        assert!(examples.is_empty());
    }

    fn deprecated(&mut self, deprecated: bool) {
        assert!(!deprecated);
    }

    fn doc_hidden(&mut self, doc_hidden: bool) {
        assert!(!doc_hidden);
    }

    fn impl_kind(&mut self, _: annotations::Impl) {}
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

#[cfg(test)]
mod test {
    use kcl_derive_docs::{for_all_example_test, for_each_example_test};

    use super::*;

    #[test]
    fn smoke() {
        let result = walk_prelude();
        if let DocData::Const(d) = result.find_by_name("PI").unwrap() {
            if d.name == "PI" {
                assert!(d.value.as_ref().unwrap().starts_with('3'));
                assert_eq!(d.ty, Some("number(_?)".to_owned()));
                assert_eq!(d.qual_name, "std::math::PI");
                assert!(d.summary.is_some());
                assert!(!d.examples.is_empty());
                return;
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

    #[for_all_example_test]
    #[tokio::test(flavor = "multi_thread")]
    async fn missing_test_examples() {
        fn check_mod(m: &ModData) {
            for d in m.children.values() {
                let DocData::Fn(f) = d else {
                    continue;
                };

                for (i, (_, props)) in f.examples.iter().enumerate() {
                    if props.norun {
                        continue;
                    }
                    let name = format!("{}-{i}", f.qual_name.replace("::", "-"));
                    assert!(
                        TEST_NAMES.contains(&&*name),
                        "Missing test for example \"{name}\", maybe need to update kcl-derive-docs/src/example_tests.rs?"
                    )
                }
            }
        }

        let data = walk_prelude();

        check_mod(&data);
        for m in data.children.values() {
            if let DocData::Mod(m) = m {
                check_mod(m);
            }
        }
    }

    #[for_each_example_test]
    #[tokio::test(flavor = "multi_thread")]
    async fn kcl_test_examples() {
        let std = walk_prelude();

        let names = NAME.split('-');
        let mut mods: Vec<_> = names.collect();
        let number = mods.pop().unwrap();
        let number: usize = number.parse().unwrap();
        let name = mods.pop().unwrap();
        let mut qualname = mods.join("::");
        qualname.push_str("::");
        qualname.push_str(name);

        let data = if mods.len() == 1 {
            &std
        } else {
            std.children.get(&format!("M:std::{}", mods[1])).unwrap().expect_mod()
        };

        let Some(DocData::Fn(d)) = data.children.get(&format!("I:{qualname}")) else {
            panic!(
                "Could not find data for {NAME} (missing a child entry for {qualname}), maybe need to update kcl-derive-docs/src/example_tests.rs?"
            );
        };

        for (i, eg) in d.examples.iter().enumerate() {
            if i != number {
                continue;
            }
            let result = match crate::test_server::execute_and_snapshot(&eg.0, None).await {
                Err(crate::errors::ExecError::Kcl(e)) => {
                    panic!("Error testing example {}{i}: {}", d.name, e.error.message());
                }
                Err(other_err) => panic!("{}", other_err),
                Ok(img) => img,
            };
            if eg.1.norun {
                return;
            }
            twenty_twenty::assert_image(
                format!(
                    "tests/outputs/serial_test_example_fn_{}{i}.png",
                    qualname.replace("::", "-")
                ),
                &result,
                0.99,
            );
            return;
        }

        panic!(
            "Could not find data for {NAME} (no example {number}), maybe need to update kcl-derive-docs/src/example_tests.rs?"
        );
    }
}
