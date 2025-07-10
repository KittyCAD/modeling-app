pub(crate) mod digest;
pub mod types;

use crate::{
    ModuleId,
    parsing::ast::types::{BinaryPart, BodyItem, Expr, LiteralIdentifier},
};

impl BodyItem {
    pub fn module_id(&self) -> ModuleId {
        match self {
            BodyItem::ImportStatement(stmt) => stmt.module_id,
            BodyItem::ExpressionStatement(expression_statement) => expression_statement.module_id,
            BodyItem::VariableDeclaration(variable_declaration) => variable_declaration.module_id,
            BodyItem::TypeDeclaration(ty_declaration) => ty_declaration.module_id,
            BodyItem::ReturnStatement(return_statement) => return_statement.module_id,
        }
    }
}

impl Expr {
    pub fn module_id(&self) -> ModuleId {
        match self {
            Expr::Literal(literal) => literal.module_id,
            Expr::Name(identifier) => identifier.module_id,
            Expr::TagDeclarator(tag) => tag.module_id,
            Expr::BinaryExpression(binary_expression) => binary_expression.module_id,
            Expr::FunctionExpression(function_expression) => function_expression.module_id,
            Expr::CallExpressionKw(call_expression) => call_expression.module_id,
            Expr::PipeExpression(pipe_expression) => pipe_expression.module_id,
            Expr::PipeSubstitution(pipe_substitution) => pipe_substitution.module_id,
            Expr::ArrayExpression(array_expression) => array_expression.module_id,
            Expr::ArrayRangeExpression(array_range) => array_range.module_id,
            Expr::ObjectExpression(object_expression) => object_expression.module_id,
            Expr::MemberExpression(member_expression) => member_expression.module_id,
            Expr::UnaryExpression(unary_expression) => unary_expression.module_id,
            Expr::IfExpression(expr) => expr.module_id,
            Expr::LabelledExpression(expr) => expr.expr.module_id(),
            Expr::AscribedExpression(expr) => expr.expr.module_id(),
            Expr::None(none) => none.module_id,
        }
    }
}

impl BinaryPart {
    pub fn module_id(&self) -> ModuleId {
        match self {
            BinaryPart::Literal(literal) => literal.module_id,
            BinaryPart::Name(identifier) => identifier.module_id,
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.module_id,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.module_id,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.module_id,
            BinaryPart::MemberExpression(member_expression) => member_expression.module_id,
            BinaryPart::ArrayExpression(e) => e.module_id,
            BinaryPart::ArrayRangeExpression(e) => e.module_id,
            BinaryPart::ObjectExpression(e) => e.module_id,
            BinaryPart::IfExpression(e) => e.module_id,
            BinaryPart::AscribedExpression(e) => e.module_id,
        }
    }
}

impl LiteralIdentifier {
    pub fn module_id(&self) -> ModuleId {
        match self {
            LiteralIdentifier::Identifier(identifier) => identifier.module_id,
            LiteralIdentifier::Literal(literal) => literal.module_id,
        }
    }
}
