use crate::{
    parsing::ast::types::{self, NodeRef},
    source_range::SourceRange,
};

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Copy, Clone, Debug)]
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
    LabelledExpression(NodeRef<'a, types::LabelledExpression>),

    Parameter(&'a types::Parameter),

    ObjectProperty(NodeRef<'a, types::ObjectProperty>),

    KclNone(&'a types::KclNone),
}

impl<'tree> Node<'tree> {
    /// Return the digest of the [Node], pulling the underlying Digest from
    /// the AST types.
    ///
    /// The Digest type may change over time.
    pub fn digest(&self) -> Option<[u8; 32]> {
        match self {
            Node::Program(n) => n.digest,
            Node::ImportStatement(n) => n.digest,
            Node::ExpressionStatement(n) => n.digest,
            Node::VariableDeclaration(n) => n.digest,
            Node::ReturnStatement(n) => n.digest,
            Node::VariableDeclarator(n) => n.digest,
            Node::Literal(n) => n.digest,
            Node::TagDeclarator(n) => n.digest,
            Node::Identifier(n) => n.digest,
            Node::BinaryExpression(n) => n.digest,
            Node::FunctionExpression(n) => n.digest,
            Node::CallExpression(n) => n.digest,
            Node::CallExpressionKw(n) => n.digest,
            Node::PipeExpression(n) => n.digest,
            Node::PipeSubstitution(n) => n.digest,
            Node::ArrayExpression(n) => n.digest,
            Node::ArrayRangeExpression(n) => n.digest,
            Node::ObjectExpression(n) => n.digest,
            Node::MemberExpression(n) => n.digest,
            Node::UnaryExpression(n) => n.digest,
            Node::Parameter(p) => p.digest,
            Node::ObjectProperty(n) => n.digest,
            Node::IfExpression(n) => n.digest,
            Node::ElseIf(n) => n.digest,
            Node::KclNone(n) => n.digest,
            Node::LabelledExpression(n) => n.digest,
        }
    }
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
            Node::IfExpression(n) => SourceRange::from(*n),
            Node::LabelledExpression(n) => SourceRange::from(*n),

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
            types::Expr::LabelledExpression(e) => e.as_ref().into(),
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

impl<'tree> From<&'tree types::MemberObject> for Node<'tree> {
    fn from(node: &'tree types::MemberObject) -> Self {
        match node {
            types::MemberObject::MemberExpression(me) => me.as_ref().into(),
            types::MemberObject::Identifier(id) => id.as_ref().into(),
        }
    }
}

impl<'tree> From<&'tree types::LiteralIdentifier> for Node<'tree> {
    fn from(node: &'tree types::LiteralIdentifier) -> Self {
        match node {
            types::LiteralIdentifier::Identifier(id) => id.as_ref().into(),
            types::LiteralIdentifier::Literal(lit) => lit.as_ref().into(),
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
impl_from!(Node, IfExpression);
impl_from!(Node, ElseIf);
impl_from!(Node, LabelledExpression);
impl_from!(Node, KclNone);
