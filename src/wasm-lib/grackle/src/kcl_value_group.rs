use kcl_lib::ast::{self, types::BinaryPart};

/// Basically the same enum as `kcl_lib::ast::types::Value`, but grouped according to whether the
/// value is singular or composite.
/// You can convert losslessly between KclValueGroup and `kcl_lib::ast::types::Value` with From/Into.
pub enum KclValueGroup {
    Single(SingleValue),
    ArrayExpression(Box<ast::types::ArrayExpression>),
    ObjectExpression(Box<ast::types::ObjectExpression>),
}

pub enum SingleValue {
    Literal(Box<ast::types::Literal>),
    Identifier(Box<ast::types::Identifier>),
    BinaryExpression(Box<ast::types::BinaryExpression>),
    CallExpression(Box<ast::types::CallExpression>),
    PipeExpression(Box<ast::types::PipeExpression>),
    UnaryExpression(Box<ast::types::UnaryExpression>),
    KclNoneExpression(ast::types::KclNone),
    MemberExpression(Box<ast::types::MemberExpression>),
}

impl From<ast::types::BinaryPart> for KclValueGroup {
    fn from(value: ast::types::BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(e) => Self::Single(SingleValue::Literal(e)),
            BinaryPart::Identifier(e) => Self::Single(SingleValue::Identifier(e)),
            BinaryPart::BinaryExpression(e) => Self::Single(SingleValue::BinaryExpression(e)),
            BinaryPart::CallExpression(e) => Self::Single(SingleValue::CallExpression(e)),
            BinaryPart::UnaryExpression(e) => Self::Single(SingleValue::UnaryExpression(e)),
            BinaryPart::MemberExpression(e) => Self::Single(SingleValue::MemberExpression(e)),
        }
    }
}

impl From<ast::types::BinaryPart> for SingleValue {
    fn from(value: ast::types::BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(e) => Self::Literal(e),
            BinaryPart::Identifier(e) => Self::Identifier(e),
            BinaryPart::BinaryExpression(e) => Self::BinaryExpression(e),
            BinaryPart::CallExpression(e) => Self::CallExpression(e),
            BinaryPart::UnaryExpression(e) => Self::UnaryExpression(e),
            BinaryPart::MemberExpression(e) => Self::MemberExpression(e),
        }
    }
}

impl From<ast::types::Value> for KclValueGroup {
    fn from(value: ast::types::Value) -> Self {
        match value {
            ast::types::Value::Literal(e) => Self::Single(SingleValue::Literal(e)),
            ast::types::Value::Identifier(e) => Self::Single(SingleValue::Identifier(e)),
            ast::types::Value::BinaryExpression(e) => Self::Single(SingleValue::BinaryExpression(e)),
            ast::types::Value::CallExpression(e) => Self::Single(SingleValue::CallExpression(e)),
            ast::types::Value::PipeExpression(e) => Self::Single(SingleValue::PipeExpression(e)),
            ast::types::Value::None(e) => Self::Single(SingleValue::KclNoneExpression(e)),
            ast::types::Value::UnaryExpression(e) => Self::Single(SingleValue::UnaryExpression(e)),
            ast::types::Value::ArrayExpression(e) => Self::ArrayExpression(e),
            ast::types::Value::ObjectExpression(e) => Self::ObjectExpression(e),
            ast::types::Value::PipeSubstitution(_)
            | ast::types::Value::FunctionExpression(_)
            | ast::types::Value::MemberExpression(_) => todo!(),
        }
    }
}

impl From<KclValueGroup> for ast::types::Value {
    fn from(value: KclValueGroup) -> Self {
        match value {
            KclValueGroup::Single(e) => match e {
                SingleValue::Literal(e) => ast::types::Value::Literal(e),
                SingleValue::Identifier(e) => ast::types::Value::Identifier(e),
                SingleValue::BinaryExpression(e) => ast::types::Value::BinaryExpression(e),
                SingleValue::CallExpression(e) => ast::types::Value::CallExpression(e),
                SingleValue::PipeExpression(e) => ast::types::Value::PipeExpression(e),
                SingleValue::UnaryExpression(e) => ast::types::Value::UnaryExpression(e),
                SingleValue::KclNoneExpression(e) => ast::types::Value::None(e),
                SingleValue::MemberExpression(e) => ast::types::Value::MemberExpression(e),
            },
            KclValueGroup::ArrayExpression(e) => ast::types::Value::ArrayExpression(e),
            KclValueGroup::ObjectExpression(e) => ast::types::Value::ObjectExpression(e),
        }
    }
}
