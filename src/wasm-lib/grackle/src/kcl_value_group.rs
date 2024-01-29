use kcl_lib::ast::{self, types::BinaryPart};

#[derive(Debug)]
pub enum SingleValue {
    Literal(Box<ast::types::Literal>),
    Identifier(Box<ast::types::Identifier>),
    BinaryExpression(Box<ast::types::BinaryExpression>),
    CallExpression(Box<ast::types::CallExpression>),
    PipeExpression(Box<ast::types::PipeExpression>),
    UnaryExpression(Box<ast::types::UnaryExpression>),
    KclNoneExpression(ast::types::KclNone),
    MemberExpression(Box<ast::types::MemberExpression>),
    FunctionExpression(Box<ast::types::FunctionExpression>),
    PipeSubstitution(Box<ast::types::PipeSubstitution>),
    ArrayExpression(Box<ast::types::ArrayExpression>),
    ObjectExpression(Box<ast::types::ObjectExpression>),
}

impl From<ast::types::BinaryPart> for SingleValue {
    fn from(value: ast::types::BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(e) => SingleValue::Literal(e),
            BinaryPart::Identifier(e) => SingleValue::Identifier(e),
            BinaryPart::BinaryExpression(e) => SingleValue::BinaryExpression(e),
            BinaryPart::CallExpression(e) => SingleValue::CallExpression(e),
            BinaryPart::UnaryExpression(e) => SingleValue::UnaryExpression(e),
            BinaryPart::MemberExpression(e) => SingleValue::MemberExpression(e),
        }
    }
}

impl From<ast::types::Value> for SingleValue {
    fn from(value: ast::types::Value) -> Self {
        match value {
            ast::types::Value::Literal(e) => SingleValue::Literal(e),
            ast::types::Value::Identifier(e) => SingleValue::Identifier(e),
            ast::types::Value::BinaryExpression(e) => SingleValue::BinaryExpression(e),
            ast::types::Value::CallExpression(e) => SingleValue::CallExpression(e),
            ast::types::Value::PipeExpression(e) => SingleValue::PipeExpression(e),
            ast::types::Value::None(e) => SingleValue::KclNoneExpression(e),
            ast::types::Value::UnaryExpression(e) => SingleValue::UnaryExpression(e),
            ast::types::Value::ArrayExpression(e) => SingleValue::ArrayExpression(e),
            ast::types::Value::ObjectExpression(e) => SingleValue::ObjectExpression(e),
            ast::types::Value::MemberExpression(e) => SingleValue::MemberExpression(e),
            ast::types::Value::FunctionExpression(e) => SingleValue::FunctionExpression(e),
            ast::types::Value::PipeSubstitution(e) => SingleValue::PipeSubstitution(e),
        }
    }
}

impl From<SingleValue> for ast::types::Value {
    fn from(value: SingleValue) -> Self {
        match value {
            SingleValue::Literal(e) => ast::types::Value::Literal(e),
            SingleValue::Identifier(e) => ast::types::Value::Identifier(e),
            SingleValue::BinaryExpression(e) => ast::types::Value::BinaryExpression(e),
            SingleValue::CallExpression(e) => ast::types::Value::CallExpression(e),
            SingleValue::PipeExpression(e) => ast::types::Value::PipeExpression(e),
            SingleValue::UnaryExpression(e) => ast::types::Value::UnaryExpression(e),
            SingleValue::KclNoneExpression(e) => ast::types::Value::None(e),
            SingleValue::MemberExpression(e) => ast::types::Value::MemberExpression(e),
            SingleValue::FunctionExpression(e) => ast::types::Value::FunctionExpression(e),
            SingleValue::PipeSubstitution(e) => ast::types::Value::PipeSubstitution(e),
            SingleValue::ArrayExpression(e) => ast::types::Value::ArrayExpression(e),
            SingleValue::ObjectExpression(e) => ast::types::Value::ObjectExpression(e),
        }
    }
}
