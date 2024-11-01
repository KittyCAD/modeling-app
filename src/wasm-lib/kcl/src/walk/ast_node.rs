use crate::{
    ast::types::{self, NodeRef},
    executor::SourceRange,
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
            Node::Program(p) => SourceRange([p.start, p.end]),
            Node::ImportStatement(e) => SourceRange([e.start, e.end]),
            Node::ExpressionStatement(e) => SourceRange([e.start, e.end]),
            Node::VariableDeclaration(v) => SourceRange([v.start, v.end]),
            Node::ReturnStatement(r) => SourceRange([r.start, r.end]),
            Node::VariableDeclarator(v) => SourceRange([v.start, v.end]),
            Node::Literal(l) => SourceRange([l.start, l.end]),
            Node::TagDeclarator(t) => SourceRange([t.start, t.end]),
            Node::Identifier(i) => SourceRange([i.start, i.end]),
            Node::BinaryExpression(b) => SourceRange([b.start, b.end]),
            Node::FunctionExpression(f) => SourceRange([f.start, f.end]),
            Node::CallExpression(c) => SourceRange([c.start, c.end]),
            Node::PipeExpression(p) => SourceRange([p.start, p.end]),
            Node::PipeSubstitution(p) => SourceRange([p.start, p.end]),
            Node::ArrayExpression(a) => SourceRange([a.start, a.end]),
            Node::ArrayRangeExpression(a) => SourceRange([a.start, a.end]),
            Node::ObjectExpression(o) => SourceRange([o.start, o.end]),
            Node::MemberExpression(m) => SourceRange([m.start, m.end]),
            Node::UnaryExpression(u) => SourceRange([u.start, u.end]),
            Node::Parameter(p) => SourceRange([p.identifier.start, p.identifier.end]),
            Node::ObjectProperty(o) => SourceRange([o.start, o.end]),
            Node::MemberObject(m) => SourceRange([m.start(), m.end()]),
            Node::IfExpression(m) => SourceRange([m.start, m.end]),
            Node::LiteralIdentifier(l) => SourceRange([l.start(), l.end()]),
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
