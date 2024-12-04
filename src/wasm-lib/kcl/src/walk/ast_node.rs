use crate::{
    ast::types::{self, NodeRef},
    source_range::SourceRange,
};

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Clone, Debug)]
pub enum Node<'a> {
    Program(NodeRef<'a, types::Program>),

    ImportStatement(NodeRef<'a, types::ImportStatement>),
    ExpressionStatement(NodeRef<'a, types::ExpressionStatement>),
    VariableDeclaration(NodeRef<'a, types::VariableDeclaration>),
    ReturnStatement(NodeRef<'a, types::ReturnStatement>),

    VariableDeclarator(NodeRef<'a, types::VariableDeclarator>),

    Literal(NodeRef<'a, types::Literal>),
    TagDeclarator(NodeRef<'a, types::TagDeclarator>),
    Identifier(NodeRef<'a, types::Identifier>),
    BinaryExpression(NodeRef<'a, types::BinaryExpression>),
    FunctionExpression(NodeRef<'a, types::FunctionExpression>),
    CallExpression(NodeRef<'a, types::CallExpression>),
    CallExpressionKw(NodeRef<'a, types::CallExpressionKw>),
    PipeExpression(NodeRef<'a, types::PipeExpression>),
    PipeSubstitution(NodeRef<'a, types::PipeSubstitution>),
    ArrayExpression(NodeRef<'a, types::ArrayExpression>),
    ArrayRangeExpression(NodeRef<'a, types::ArrayRangeExpression>),
    ObjectExpression(NodeRef<'a, types::ObjectExpression>),
    MemberExpression(NodeRef<'a, types::MemberExpression>),
    UnaryExpression(NodeRef<'a, types::UnaryExpression>),
    IfExpression(NodeRef<'a, types::IfExpression>),

    Parameter(&'a types::Parameter),

    ObjectProperty(NodeRef<'a, types::ObjectProperty>),

    MemberObject(&'a types::MemberObject),
    LiteralIdentifier(&'a types::LiteralIdentifier),
}

impl From<&Node<'_>> for SourceRange {
    fn from(node: &Node) -> Self {
        match node {
            Node::Program(n) => SourceRange::from(*n),
            Node::ImportStatement(n) => SourceRange::from(*n),
            Node::ExpressionStatement(n) => SourceRange::from(*n),
            Node::VariableDeclaration(n) => SourceRange::from(*n),
            Node::ReturnStatement(n) => SourceRange::from(*n),
            Node::VariableDeclarator(n) => SourceRange::from(*n),
            Node::Literal(n) => SourceRange::from(*n),
            Node::TagDeclarator(n) => SourceRange::from(*n),
            Node::Identifier(n) => SourceRange::from(*n),
            Node::BinaryExpression(n) => SourceRange::from(*n),
            Node::FunctionExpression(n) => SourceRange::from(*n),
            Node::CallExpression(n) => SourceRange::from(*n),
            Node::CallExpressionKw(n) => SourceRange::from(*n),
            Node::PipeExpression(n) => SourceRange::from(*n),
            Node::PipeSubstitution(n) => SourceRange::from(*n),
            Node::ArrayExpression(n) => SourceRange::from(*n),
            Node::ArrayRangeExpression(n) => SourceRange::from(*n),
            Node::ObjectExpression(n) => SourceRange::from(*n),
            Node::MemberExpression(n) => SourceRange::from(*n),
            Node::UnaryExpression(n) => SourceRange::from(*n),
            Node::Parameter(p) => SourceRange::from(&p.identifier),
            Node::ObjectProperty(n) => SourceRange::from(*n),
            Node::MemberObject(m) => SourceRange::new(m.start(), m.end(), m.module_id()),
            Node::IfExpression(n) => SourceRange::from(*n),
            Node::LiteralIdentifier(l) => SourceRange::new(l.start(), l.end(), l.module_id()),
        }
    }
}

macro_rules! impl_from {
    ($node:ident, $t: ident) => {
        impl<'a> From<NodeRef<'a, types::$t>> for Node<'a> {
            fn from(v: NodeRef<'a, types::$t>) -> Self {
                Node::$t(v)
            }
        }
    };
}

macro_rules! impl_from_ref {
    ($node:ident, $t: ident) => {
        impl<'a> From<&'a types::$t> for Node<'a> {
            fn from(v: &'a types::$t) -> Self {
                Node::$t(v)
            }
        }
    };
}

impl_from!(Node, Program);
impl_from!(Node, ImportStatement);
impl_from!(Node, ExpressionStatement);
impl_from!(Node, VariableDeclaration);
impl_from!(Node, ReturnStatement);
impl_from!(Node, VariableDeclarator);
impl_from!(Node, Literal);
impl_from!(Node, TagDeclarator);
impl_from!(Node, Identifier);
impl_from!(Node, BinaryExpression);
impl_from!(Node, FunctionExpression);
impl_from!(Node, CallExpression);
impl_from!(Node, CallExpressionKw);
impl_from!(Node, PipeExpression);
impl_from!(Node, PipeSubstitution);
impl_from!(Node, ArrayExpression);
impl_from!(Node, ArrayRangeExpression);
impl_from!(Node, ObjectExpression);
impl_from!(Node, MemberExpression);
impl_from!(Node, UnaryExpression);
impl_from!(Node, ObjectProperty);
impl_from_ref!(Node, Parameter);
impl_from_ref!(Node, MemberObject);
impl_from!(Node, IfExpression);
impl_from_ref!(Node, LiteralIdentifier);
