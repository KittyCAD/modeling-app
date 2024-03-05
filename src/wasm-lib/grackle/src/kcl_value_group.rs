use kcl_lib::ast::{self, types::BinaryPart};

pub type SingleValue = kcl_lib::ast::types::Value;

pub fn into_single_value(value: ast::types::BinaryPart) -> SingleValue {
    match value {
        BinaryPart::Literal(e) => SingleValue::Literal(e),
        BinaryPart::Identifier(e) => SingleValue::Identifier(e),
        BinaryPart::BinaryExpression(e) => SingleValue::BinaryExpression(e),
        BinaryPart::CallExpression(e) => SingleValue::CallExpression(e),
        BinaryPart::UnaryExpression(e) => SingleValue::UnaryExpression(e),
        BinaryPart::MemberExpression(e) => SingleValue::MemberExpression(e),
    }
}
