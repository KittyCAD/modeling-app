use crate::{
    parsing::ast::types::{self, NodeRef},
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
    ElseIf(&'a types::ElseIf),

    Parameter(&'a types::Parameter),

    ObjectProperty(NodeRef<'a, types::ObjectProperty>),

    MemberObject(&'a types::MemberObject),
    LiteralIdentifier(&'a types::LiteralIdentifier),

    KclNone(&'a types::KclNone),
}

/// Returned during source_range conversion.
#[derive(Debug)]
pub enum AstNodeError {
    /// Returned if we try and [SourceRange] a [types::KclNone].
    NoSourceForAKclNone,
}

impl TryFrom<&Node<'_>> for SourceRange {
    type Error = AstNodeError;

    fn try_from(node: &Node) -> Result<Self, Self::Error> {
        Ok(match node {
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

            // This is broken too
            Node::ElseIf(n) => SourceRange::new(n.cond.start(), n.cond.end(), n.cond.module_id()),

            // The KclNone type here isn't an actual node, so it has no
            // start/end information.
            Node::KclNone(_) => return Err(Self::Error::NoSourceForAKclNone),
        })
    }
}

impl<'tree> From<&'tree types::BodyItem> for Node<'tree> {
    fn from(node: &'tree types::BodyItem) -> Self {
        match node {
            types::BodyItem::ImportStatement(v) => v.as_ref().into(),
            types::BodyItem::ExpressionStatement(v) => v.into(),
            types::BodyItem::VariableDeclaration(v) => v.as_ref().into(),
            types::BodyItem::ReturnStatement(v) => v.into(),
        }
    }
}

impl<'tree> From<&'tree types::Expr> for Node<'tree> {
    fn from(node: &'tree types::Expr) -> Self {
        match node {
            types::Expr::Literal(lit) => lit.as_ref().into(),
            types::Expr::TagDeclarator(tag) => tag.as_ref().into(),
            types::Expr::Identifier(id) => id.as_ref().into(),
            types::Expr::BinaryExpression(be) => be.as_ref().into(),
            types::Expr::FunctionExpression(fe) => fe.as_ref().into(),
            types::Expr::CallExpression(ce) => ce.as_ref().into(),
            types::Expr::CallExpressionKw(ce) => ce.as_ref().into(),
            types::Expr::PipeExpression(pe) => pe.as_ref().into(),
            types::Expr::PipeSubstitution(ps) => ps.as_ref().into(),
            types::Expr::ArrayExpression(ae) => ae.as_ref().into(),
            types::Expr::ArrayRangeExpression(are) => are.as_ref().into(),
            types::Expr::ObjectExpression(oe) => oe.as_ref().into(),
            types::Expr::MemberExpression(me) => me.as_ref().into(),
            types::Expr::UnaryExpression(ue) => ue.as_ref().into(),
            types::Expr::IfExpression(e) => e.as_ref().into(),
            types::Expr::None(n) => n.into(),
        }
    }
}

impl<'tree> From<&'tree types::BinaryPart> for Node<'tree> {
    fn from(node: &'tree types::BinaryPart) -> Self {
        match node {
            types::BinaryPart::Literal(lit) => lit.as_ref().into(),
            types::BinaryPart::Identifier(id) => id.as_ref().into(),
            types::BinaryPart::BinaryExpression(be) => be.as_ref().into(),
            types::BinaryPart::CallExpression(ce) => ce.as_ref().into(),
            types::BinaryPart::CallExpressionKw(ce) => ce.as_ref().into(),
            types::BinaryPart::UnaryExpression(ue) => ue.as_ref().into(),
            types::BinaryPart::MemberExpression(me) => me.as_ref().into(),
            types::BinaryPart::IfExpression(e) => e.as_ref().into(),
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
impl_from!(Node, ElseIf);
impl_from_ref!(Node, LiteralIdentifier);
impl_from!(Node, KclNone);
