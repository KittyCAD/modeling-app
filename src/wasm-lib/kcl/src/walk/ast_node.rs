use crate::{
    ast::{types, types::ValueMeta},
    executor::SourceRange,
};

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Clone, Debug)]
pub enum Node<'a> {
    Program(&'a types::Program),

    ImportStatement(&'a types::ImportStatement),
    ExpressionStatement(&'a types::ExpressionStatement),
    VariableDeclaration(&'a types::VariableDeclaration),
    ReturnStatement(&'a types::ReturnStatement),

    VariableDeclarator(&'a types::VariableDeclarator),

    Literal(&'a types::Literal),
    TagDeclarator(&'a types::TagDeclarator),
    Identifier(&'a types::Identifier),
    BinaryExpression(&'a types::BinaryExpression),
    FunctionExpression(&'a types::FunctionExpression),
    CallExpression(&'a types::CallExpression),
    PipeExpression(&'a types::PipeExpression),
    PipeSubstitution(&'a types::PipeSubstitution),
    ArrayExpression(&'a types::ArrayExpression),
    ArrayRangeExpression(&'a types::ArrayRangeExpression),
    ObjectExpression(&'a types::ObjectExpression),
    MemberExpression(&'a types::MemberExpression),
    UnaryExpression(&'a types::UnaryExpression),
    IfExpression(&'a types::IfExpression),

    Parameter(&'a types::Parameter),

    ObjectProperty(&'a types::ObjectProperty),

    MemberObject(&'a types::MemberObject),
    LiteralIdentifier(&'a types::LiteralIdentifier),
}

impl From<&Node<'_>> for SourceRange {
    fn from(node: &Node) -> Self {
        match node {
            Node::Program(p) => SourceRange([p.start, p.end]),
            Node::ImportStatement(e) => SourceRange([e.start(), e.end()]),
            Node::ExpressionStatement(e) => SourceRange([e.start(), e.end()]),
            Node::VariableDeclaration(v) => SourceRange([v.start(), v.end()]),
            Node::ReturnStatement(r) => SourceRange([r.start(), r.end()]),
            Node::VariableDeclarator(v) => SourceRange([v.start(), v.end()]),
            Node::Literal(l) => SourceRange([l.start(), l.end()]),
            Node::TagDeclarator(t) => SourceRange([t.start(), t.end()]),
            Node::Identifier(i) => SourceRange([i.start(), i.end()]),
            Node::BinaryExpression(b) => SourceRange([b.start(), b.end()]),
            Node::FunctionExpression(f) => SourceRange([f.start(), f.end()]),
            Node::CallExpression(c) => SourceRange([c.start(), c.end()]),
            Node::PipeExpression(p) => SourceRange([p.start(), p.end()]),
            Node::PipeSubstitution(p) => SourceRange([p.start(), p.end()]),
            Node::ArrayExpression(a) => SourceRange([a.start(), a.end()]),
            Node::ArrayRangeExpression(a) => SourceRange([a.start(), a.end()]),
            Node::ObjectExpression(o) => SourceRange([o.start(), o.end()]),
            Node::MemberExpression(m) => SourceRange([m.start(), m.end()]),
            Node::UnaryExpression(u) => SourceRange([u.start(), u.end()]),
            Node::Parameter(p) => SourceRange([p.identifier.start(), p.identifier.end()]),
            Node::ObjectProperty(o) => SourceRange([o.start(), o.end()]),
            Node::MemberObject(m) => SourceRange([m.start(), m.end()]),
            Node::IfExpression(m) => SourceRange([m.start(), m.end()]),
            Node::LiteralIdentifier(l) => SourceRange([l.start(), l.end()]),
        }
    }
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
impl_from!(Node, Parameter);
impl_from!(Node, ObjectProperty);
impl_from!(Node, MemberObject);
impl_from!(Node, IfExpression);
impl_from!(Node, LiteralIdentifier);
