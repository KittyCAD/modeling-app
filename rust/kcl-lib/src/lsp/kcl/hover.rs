use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::Range as LspRange;

use crate::{parsing::ast::types::*, SourceRange};

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
}

#[derive(Debug, Clone, Default)]
pub(super) struct Scope {
    vars: HashMap<String, Option<String>>,
}

impl Program {
    /// Returns a hover value that includes the given character position.
    /// This is really recursive so keep that in mind.
    pub(super) fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
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

        value.get_hover_value_for_position(pos, code, scope)
    }
}

impl Expr {
    pub(super) fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        match self {
            Expr::BinaryExpression(binary_expression) => {
                binary_expression.get_hover_value_for_position(pos, code, scope)
            }
            Expr::FunctionExpression(function_expression) => {
                function_expression.get_hover_value_for_position(pos, code, scope)
            }
            Expr::CallExpression(call_expression) => call_expression.get_hover_value_for_position(pos, code, scope),
            Expr::CallExpressionKw(call_expression) => call_expression.get_hover_value_for_position(pos, code, scope),
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_hover_value_for_position(pos, code, scope),
            Expr::ArrayExpression(array_expression) => array_expression.get_hover_value_for_position(pos, code, scope),
            Expr::ArrayRangeExpression(array_range) => array_range.get_hover_value_for_position(pos, code, scope),
            Expr::ObjectExpression(object_expression) => {
                object_expression.get_hover_value_for_position(pos, code, scope)
            }
            Expr::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code, scope)
            }
            Expr::UnaryExpression(unary_expression) => unary_expression.get_hover_value_for_position(pos, code, scope),
            Expr::IfExpression(expr) => expr.get_hover_value_for_position(pos, code, scope),
            // TODO: LSP hover information for values/types. https://github.com/KittyCAD/modeling-app/issues/1126
            Expr::None(_) => None,
            Expr::Literal(_) => None,
            Expr::Identifier(id) => {
                if id.contains(pos) {
                    let name = id.name.clone();
                    Some(Hover::Variable {
                        ty: scope.and_then(|sc| sc.vars.get(&name).and_then(Clone::clone)),
                        name,
                        range: id.as_source_range().to_lsp_range(code),
                    })
                } else {
                    None
                }
            }
            Expr::TagDeclarator(_) => None,
            // TODO LSP hover info for tag
            Expr::LabelledExpression(expr) => expr.expr.get_hover_value_for_position(pos, code, scope),
            // TODO LSP hover info for type
            Expr::AscribedExpression(expr) => expr.expr.get_hover_value_for_position(pos, code, scope),
            // TODO: LSP hover information for symbols. https://github.com/KittyCAD/modeling-app/issues/1127
            Expr::PipeSubstitution(_) => None,
        }
    }
}

impl BinaryPart {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        match self {
            BinaryPart::Literal(_literal) => None,
            BinaryPart::Identifier(_identifier) => None,
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.get_hover_value_for_position(pos, code, scope)
            }
            BinaryPart::CallExpression(call_expression) => {
                call_expression.get_hover_value_for_position(pos, code, scope)
            }
            BinaryPart::CallExpressionKw(call_expression) => {
                call_expression.get_hover_value_for_position(pos, code, scope)
            }
            BinaryPart::UnaryExpression(unary_expression) => {
                unary_expression.get_hover_value_for_position(pos, code, scope)
            }
            BinaryPart::IfExpression(e) => e.get_hover_value_for_position(pos, code, scope),
            BinaryPart::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code, scope)
            }
        }
    }
}

impl CallExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, _scope: Option<Scope>) -> Option<Hover> {
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
}

impl CallExpressionKw {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, _scope: Option<Scope>) -> Option<Hover> {
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
}

impl ArrayExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        for element in &self.elements {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code, scope);
            }
        }

        None
    }
}

impl ArrayRangeExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        for element in [&self.start_element, &self.end_element] {
            let element_source_range: SourceRange = element.into();
            if element_source_range.contains(pos) {
                return element.get_hover_value_for_position(pos, code, scope);
            }
        }

        None
    }
}

impl ObjectExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        for property in &self.properties {
            let property_source_range: SourceRange = property.into();
            if property_source_range.contains(pos) {
                return property.get_hover_value_for_position(pos, code, scope);
            }
        }

        None
    }
}

impl ObjectProperty {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        let value_source_range: SourceRange = self.value.clone().into();
        if value_source_range.contains(pos) {
            return self.value.get_hover_value_for_position(pos, code, scope);
        }

        None
    }
}

impl MemberObject {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        match self {
            MemberObject::MemberExpression(member_expression) => {
                member_expression.get_hover_value_for_position(pos, code, scope)
            }
            MemberObject::Identifier(_identifier) => None,
        }
    }
}

impl MemberExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        let object_source_range: SourceRange = self.object.clone().into();
        if object_source_range.contains(pos) {
            return self.object.get_hover_value_for_position(pos, code, scope);
        }

        None
    }
}

impl BinaryExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        let left_source_range: SourceRange = self.left.clone().into();
        let right_source_range: SourceRange = self.right.clone().into();

        if left_source_range.contains(pos) {
            return self.left.get_hover_value_for_position(pos, code, scope);
        }

        if right_source_range.contains(pos) {
            return self.right.get_hover_value_for_position(pos, code, scope);
        }

        None
    }
}

impl UnaryExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        let argument_source_range: SourceRange = self.argument.clone().into();
        if argument_source_range.contains(pos) {
            return self.argument.get_hover_value_for_position(pos, code, scope);
        }

        None
    }
}

impl PipeExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        for b in &self.body {
            let b_source_range: SourceRange = b.into();
            if b_source_range.contains(pos) {
                return b.get_hover_value_for_position(pos, code, scope);
            }
        }

        None
    }
}

impl FunctionExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        if let Some(value) = self.body.get_expr_for_position(pos) {
            let mut scope = scope.unwrap_or_else(|| Scope::default());
            for arg in &self.params {
                let ty = arg.type_.as_ref().map(|ty| ty.recast(&FormatOptions::default(), 0));
                scope.vars.insert(arg.identifier.inner.name.clone(), ty);
            }
            return value.get_hover_value_for_position(pos, code, Some(scope));
        }

        None
    }
}

impl IfExpression {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code, scope.clone())
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code, scope.clone()))
            .or_else(|| {
                self.else_ifs
                    .iter()
                    .find_map(|else_if| else_if.get_hover_value_for_position(pos, code, scope.clone()))
            })
            .or_else(|| self.final_else.get_hover_value_for_position(pos, code, scope))
    }
}

impl ElseIf {
    fn get_hover_value_for_position(&self, pos: usize, code: &str, scope: Option<Scope>) -> Option<Hover> {
        self.cond
            .get_hover_value_for_position(pos, code, scope.clone())
            .or_else(|| self.then_val.get_hover_value_for_position(pos, code, scope))
    }
}
