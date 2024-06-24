use crate::ast::types;

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Clone, Debug)]
pub enum Node<'a> {
    Program(&'a types::Program),

    ExpressionStatement(&'a types::ExpressionStatement),
    VariableDeclaration(&'a types::VariableDeclaration),
    ReturnStatement(&'a types::ReturnStatement),

    VariableDeclarator(&'a types::VariableDeclarator),

    Literal(&'a types::Literal),
    Tag(&'a types::Tag),
    Identifier(&'a types::Identifier),
    BinaryExpression(&'a types::BinaryExpression),
    FunctionExpression(&'a types::FunctionExpression),
    CallExpression(&'a types::CallExpression),
    PipeExpression(&'a types::PipeExpression),
    PipeSubstitution(&'a types::PipeSubstitution),
    ArrayExpression(&'a types::ArrayExpression),
    ObjectExpression(&'a types::ObjectExpression),
    MemberExpression(&'a types::MemberExpression),
    UnaryExpression(&'a types::UnaryExpression),

    Parameter(&'a types::Parameter),

    ObjectProperty(&'a types::ObjectProperty),

    MemberObject(&'a types::MemberObject),
    LiteralIdentifier(&'a types::LiteralIdentifier),
}

macro_rules! impl_from {
    ($node:ident, $t: ident) => {
        impl<'a> From<&'a types::$t> for Node<'a> {
            fn from(v: &'a types::$t) -> Self {
                Node::$t(v)
            }
        }
    };
}

impl_from!(Node, Program);
impl_from!(Node, ExpressionStatement);
impl_from!(Node, VariableDeclaration);
impl_from!(Node, ReturnStatement);
impl_from!(Node, VariableDeclarator);
impl_from!(Node, Literal);
impl_from!(Node, Tag);
impl_from!(Node, Identifier);
impl_from!(Node, BinaryExpression);
impl_from!(Node, FunctionExpression);
impl_from!(Node, CallExpression);
impl_from!(Node, PipeExpression);
impl_from!(Node, PipeSubstitution);
impl_from!(Node, ArrayExpression);
impl_from!(Node, ObjectExpression);
impl_from!(Node, MemberExpression);
impl_from!(Node, UnaryExpression);
impl_from!(Node, Parameter);
impl_from!(Node, ObjectProperty);
impl_from!(Node, MemberObject);
impl_from!(Node, LiteralIdentifier);
