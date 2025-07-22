use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::Range as LspRange;

use crate::{SourceRange, parsing::ast::types::*};

/// Describes information about a hover.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(super) enum Hover {
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
    Variable {
        name: String,
        ty: Option<String>,
        range: LspRange,
    },
    KwArg {
        name: String,
        callee_name: String,
        range: LspRange,
    },
    Type {
        name: String,
        range: LspRange,
    },
}

#[derive(Debug, Clone)]
pub(super) struct HoverOpts {
    vars: Option<HashMap<String, Option<String>>>,
    prefer_sig: bool,
}

impl HoverOpts {
    pub fn default_for_signature_help() -> Self {
        HoverOpts {
            vars: None,
            prefer_sig: true,
        }
    }

    pub fn default_for_hover() -> Self {
        HoverOpts {
            vars: None,
            prefer_sig: false,
        }
    }
}

impl Program {
    /// Returns a hover value that includes the given character position.
    /// This is really recursive so keep that in mind.
    pub(super) fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
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
        value.get_hover_value_for_position(pos, code, opts)
    }
}

impl Expr {
    pub(super) fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        match self {
            Expr::BinaryExpression(binary_expression) => {
                binary_expression.get_hover_value_for_position(pos, code, opts)
            }
            Expr::FunctionExpression(function_expression) => {
                function_expression.get_hover_value_for_position(pos, code, opts)
            }
            Expr::CallExpressionKw(call_expression) => call_expression.get_hover_value_for_position(pos, code, opts),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_hover_value_for_position(pos, code, opts),
            Expr::ArrayExpression(array_expression) => array_expression.get_hover_value_for_position(pos, code, opts),
            Expr::ArrayRangeExpression(array_range) => array_range.get_hover_value_for_position(pos, code, opts),
            Expr::ObjectExpression(object_expression) => {
                object_expression.get_hover_value_for_position(pos, code, opts)
            }
            Expr::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code, opts)
            }
            Expr::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code, opts),
            Expr::IfExpression(expr) => expr.get_hover_value_for_position(pos, code, opts),
            // TODO: LSP hover information for values/types. https://github.com/KittyCAD/modeling-app/issues/1126
            Expr::None(_) => None,
            Expr::Literal(_) => None,
            Expr::Name(name) => {
                if name.contains(pos) {
                    let ty = if let Some(name) = name.local_ident() {
                        opts.vars
                            .as_ref()
                            .and_then(|vars| vars.get(&**name).and_then(Clone::clone))
                    } else {
                        None
                    };
                    Some(Hover::Variable {
                        ty,
                        name: name.to_string(),
                        range: name.as_source_range().to_lsp_range(code),
                    })
                } else {
                    None
                }
            }
            Expr::TagDeclarator(_) => None,
            // TODO LSP hover info for tag
            Expr::LabelledExpression(expr) => expr.expr.get_hover_value_for_position(pos, code, opts),
            Expr::AscribedExpression(expr) => expr
                .ty
                .get_hover_value_for_position(pos, code, opts)
                .or_else(|| expr.expr.get_hover_value_for_position(pos, code, opts)),
            // TODO: LSP hover information for symbols. https://github.com/KittyCAD/modeling-app/issues/1127
            Expr::PipeSubstitution(_) => None,
        }
    }
}

impl BinaryPart {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        match self {
            BinaryPart::Literal(_literal) => None,
            BinaryPart::Name(_identifier) => None,
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.get_hover_value_for_position(pos, code, opts)
            }
            BinaryPart::CallExpressionKw(call_expression) => {
                call_expression.get_hover_value_for_position(pos, code, opts)
            }
            BinaryPart::UnaryExpression(unary_expression) => {
                unary_expression.get_hover_value_for_position(pos, code, opts)
            }
            BinaryPart::ArrayExpression(e) => e.get_hover_value_for_position(pos, code, opts),
            BinaryPart::ArrayRangeExpression(e) => e.get_hover_value_for_position(pos, code, opts),
            BinaryPart::ObjectExpression(e) => e.get_hover_value_for_position(pos, code, opts),
            BinaryPart::IfExpression(e) => e.get_hover_value_for_position(pos, code, opts),
            BinaryPart::AscribedExpression(e) => e.expr.get_hover_value_for_position(pos, code, opts),
            BinaryPart::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code, opts)
            }
        }
    }
}

impl CallExpressionKw {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        let callee_source_range: SourceRange = self.callee.clone().into();
        if callee_source_range.contains(pos) {
            return Some(Hover::Function {
                name: self.callee.to_string(),
                range: callee_source_range.to_lsp_range(code),
            });
        }

        for (index, (label, arg)) in self.iter_arguments().enumerate() {
            let source_range: SourceRange = arg.into();
            if source_range.contains(pos) {
                return if opts.prefer_sig {
                    Some(Hover::Signature {
                        name: self.callee.to_string(),
                        parameter_index: index as u32,
                        range: source_range.to_lsp_range(code),
                    })
                } else {
                    arg.get_hover_value_for_position(pos, code, opts)
                };
            }

            if let Some(id) = label {
                if id.as_source_range().contains(pos) {
                    return Some(Hover::KwArg {
                        name: id.name.clone(),
                        callee_name: self.callee.to_string(),
                        range: id.as_source_range().to_lsp_range(code),
                    });
                }
            }
        }

        None
    }
}

impl ArrayExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        for element in &self.elements {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code, opts);
            }
        }

        None
    }
}

impl ArrayRangeExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        for element in [&self.start_element, &self.end_element] {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code, opts);
            }
        }

        None
    }
}

impl ObjectExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        for property in &self.properties {
            let property_source_range: SourceRange = property.into();
            if property_source_range.contains(pos) {
                return property.get_hover_value_for_position(pos, code, opts);
            }
        }

        None
    }
}

impl ObjectProperty {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        let value_source_range: SourceRange = self.value.clone().into();
        if value_source_range.contains(pos) {
            return self.value.get_hover_value_for_position(pos, code, opts);
        }

        None
    }
}

impl MemberExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        let object_source_range: SourceRange = self.object.clone().into();
        if object_source_range.contains(pos) {
            return self.object.get_hover_value_for_position(pos, code, opts);
        }

        None
    }
}

impl BinaryExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        let left_source_range: SourceRange = self.left.clone().into();
        let right_source_range: SourceRange = self.right.clone().into();

        if left_source_range.contains(pos) {
            return self.left.get_hover_value_for_position(pos, code, opts);
        }

        if right_source_range.contains(pos) {
            return self.right.get_hover_value_for_position(pos, code, opts);
        }

        None
    }
}

impl UnaryExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        let argument_source_range: SourceRange = self.argument.clone().into();
        if argument_source_range.contains(pos) {
            return self.argument.get_hover_value_for_position(pos, code, opts);
        }

        None
    }
}

impl PipeExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        for b in &self.body {
            let b_source_range: SourceRange = b.into();
            if b_source_range.contains(pos) {
                return b.get_hover_value_for_position(pos, code, opts);
            }
        }

        None
    }
}

impl Node<Type> {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, _opts: &HoverOpts) -> Option<Hover> {
        let range = self.as_source_range();
        if range.contains(pos) {
            match &self.inner {
                ty @ Type::Array { .. } | ty @ Type::Primitive(_) => {
                    let mut name = ty.to_string();
                    if name.ends_with(')') {
                        name.truncate(name.find('(').unwrap());
                    }
                    return Some(Hover::Type {
                        name,
                        range: range.to_lsp_range(code),
                    });
                }
                _ => {}
            }
        }

        None
    }
}

impl FunctionExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        if let Some(ty) = &self.return_type {
            if let Some(h) = ty.get_hover_value_for_position(pos, code, opts) {
                return Some(h);
            }
        }
        for arg in &self.params {
            if let Some(ty) = &arg.type_ {
                if let Some(h) = ty.get_hover_value_for_position(pos, code, opts) {
                    return Some(h);
                }
            }
        }
        if let Some(value) = self.body.get_expr_for_position(pos) {
            let mut vars = opts.vars.clone().unwrap_or_default();
            for arg in &self.params {
                let ty = arg.type_.as_ref().map(|ty| ty.to_string());
                vars.insert(arg.identifier.inner.name.clone(), ty);
            }
            return value.get_hover_value_for_position(
                pos,
                code,
                &HoverOpts {
                    vars: Some(vars),
                    prefer_sig: opts.prefer_sig,
                },
            );
        }

        None
    }
}

impl IfExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code, opts)
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code, opts))
            .or_else(|| {
                self.else_ifs
                    .iter()
                    .find_map(|else_if| else_if.get_hover_value_for_position(pos, code, opts))
            })
            .or_else(|| self.final_else.get_hover_value_for_position(pos, code, opts))
    }
}

impl ElseIf {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, opts: &HoverOpts) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code, opts)
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code, opts))
    }
}
