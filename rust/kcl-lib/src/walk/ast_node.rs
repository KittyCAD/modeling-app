use crate::{
    SourceRange,
    parsing::ast::types::{self, NodeRef, NodeRefMut},
};

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Copy, Clone, Debug)]
pub enum Node<'a> {
    Program(NodeRef<'a, types::Program>),

    ImportStatement(NodeRef<'a, types::ImportStatement>),
    ExpressionStatement(NodeRef<'a, types::ExpressionStatement>),
    VariableDeclaration(NodeRef<'a, types::VariableDeclaration>),
    TypeDeclaration(NodeRef<'a, types::TypeDeclaration>),
    ReturnStatement(NodeRef<'a, types::ReturnStatement>),

    VariableDeclarator(NodeRef<'a, types::VariableDeclarator>),

    NumericLiteral(NodeRef<'a, types::NumericLiteral>),
    Literal(NodeRef<'a, types::Literal>),
    TagDeclarator(NodeRef<'a, types::TagDeclarator>),
    Identifier(NodeRef<'a, types::Identifier>),
    Name(NodeRef<'a, types::Name>),
    BinaryExpression(NodeRef<'a, types::BinaryExpression>),
    FunctionExpression(NodeRef<'a, types::FunctionExpression>),
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
    AscribedExpression(NodeRef<'a, types::AscribedExpression>),
    SketchBlock(NodeRef<'a, types::SketchBlock>),
    Block(NodeRef<'a, types::Block>),
    SketchVar(NodeRef<'a, types::SketchVar>),

    Parameter(&'a types::Parameter),

    ObjectProperty(NodeRef<'a, types::ObjectProperty>),

    KclNone(&'a types::KclNone),
}

/// The "Node" type wraps all the AST elements we're able to find in a KCL
/// file. Tokens we walk through will be one of these.
#[derive(Debug)]
pub enum NodeMut<'a> {
    Program(NodeRefMut<'a, types::Program>),

    ImportStatement(NodeRefMut<'a, types::ImportStatement>),
    ExpressionStatement(NodeRefMut<'a, types::ExpressionStatement>),
    VariableDeclaration(NodeRefMut<'a, types::VariableDeclaration>),
    TypeDeclaration(NodeRefMut<'a, types::TypeDeclaration>),
    ReturnStatement(NodeRefMut<'a, types::ReturnStatement>),

    VariableDeclarator(NodeRefMut<'a, types::VariableDeclarator>),

    NumericLiteral(NodeRefMut<'a, types::NumericLiteral>),
    Literal(NodeRefMut<'a, types::Literal>),
    TagDeclarator(NodeRefMut<'a, types::TagDeclarator>),
    Identifier(NodeRefMut<'a, types::Identifier>),
    Name(NodeRefMut<'a, types::Name>),
    BinaryExpression(NodeRefMut<'a, types::BinaryExpression>),
    FunctionExpression(NodeRefMut<'a, types::FunctionExpression>),
    CallExpressionKw(NodeRefMut<'a, types::CallExpressionKw>),
    PipeExpression(NodeRefMut<'a, types::PipeExpression>),
    PipeSubstitution(NodeRefMut<'a, types::PipeSubstitution>),
    ArrayExpression(NodeRefMut<'a, types::ArrayExpression>),
    ArrayRangeExpression(NodeRefMut<'a, types::ArrayRangeExpression>),
    ObjectExpression(NodeRefMut<'a, types::ObjectExpression>),
    MemberExpression(NodeRefMut<'a, types::MemberExpression>),
    UnaryExpression(NodeRefMut<'a, types::UnaryExpression>),
    IfExpression(NodeRefMut<'a, types::IfExpression>),
    ElseIf(&'a mut types::ElseIf),
    LabelledExpression(NodeRefMut<'a, types::LabelledExpression>),
    AscribedExpression(NodeRefMut<'a, types::AscribedExpression>),
    SketchBlock(NodeRefMut<'a, types::SketchBlock>),
    Block(NodeRefMut<'a, types::Block>),
    SketchVar(NodeRefMut<'a, types::SketchVar>),

    Parameter(&'a mut types::Parameter),

    ObjectProperty(NodeRefMut<'a, types::ObjectProperty>),

    KclNone(&'a mut types::KclNone),
}

impl Node<'_> {
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
            Node::TypeDeclaration(n) => n.digest,
            Node::ReturnStatement(n) => n.digest,
            Node::VariableDeclarator(n) => n.digest,
            Node::NumericLiteral(n) => n.digest,
            Node::Literal(n) => n.digest,
            Node::TagDeclarator(n) => n.digest,
            Node::Identifier(n) => n.digest,
            Node::Name(n) => n.digest,
            Node::BinaryExpression(n) => n.digest,
            Node::FunctionExpression(n) => n.digest,
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
            Node::AscribedExpression(n) => n.digest,
            Node::SketchBlock(n) => n.digest,
            Node::Block(n) => n.digest,
            Node::SketchVar(n) => n.digest,
        }
    }

    /// Check to see if this [Node] points to the same underlying specific
    /// borrowed object as another [Node]. This is not the same as `Eq` or
    /// even `PartialEq` -- anything that is `true` here is absolutely `Eq`,
    /// but it's possible this node is `Eq` to another with this being `false`.
    ///
    /// This merely indicates that this [Node] specifically is the exact same
    /// borrowed object as [Node].
    pub fn ptr_eq(&self, other: Node) -> bool {
        unsafe { std::ptr::eq(self.ptr(), other.ptr()) }
    }

    unsafe fn ptr(&self) -> *const () {
        match self {
            Node::Program(n) => *n as *const _ as *const (),
            Node::ImportStatement(n) => *n as *const _ as *const (),
            Node::ExpressionStatement(n) => *n as *const _ as *const (),
            Node::VariableDeclaration(n) => *n as *const _ as *const (),
            Node::TypeDeclaration(n) => *n as *const _ as *const (),
            Node::ReturnStatement(n) => *n as *const _ as *const (),
            Node::VariableDeclarator(n) => *n as *const _ as *const (),
            Node::NumericLiteral(n) => *n as *const _ as *const (),
            Node::Literal(n) => *n as *const _ as *const (),
            Node::TagDeclarator(n) => *n as *const _ as *const (),
            Node::Identifier(n) => *n as *const _ as *const (),
            Node::Name(n) => *n as *const _ as *const (),
            Node::BinaryExpression(n) => *n as *const _ as *const (),
            Node::FunctionExpression(n) => *n as *const _ as *const (),
            Node::CallExpressionKw(n) => *n as *const _ as *const (),
            Node::PipeExpression(n) => *n as *const _ as *const (),
            Node::PipeSubstitution(n) => *n as *const _ as *const (),
            Node::ArrayExpression(n) => *n as *const _ as *const (),
            Node::ArrayRangeExpression(n) => *n as *const _ as *const (),
            Node::ObjectExpression(n) => *n as *const _ as *const (),
            Node::MemberExpression(n) => *n as *const _ as *const (),
            Node::UnaryExpression(n) => *n as *const _ as *const (),
            Node::Parameter(p) => *p as *const _ as *const (),
            Node::ObjectProperty(n) => *n as *const _ as *const (),
            Node::IfExpression(n) => *n as *const _ as *const (),
            Node::ElseIf(n) => *n as *const _ as *const (),
            Node::KclNone(n) => *n as *const _ as *const (),
            Node::LabelledExpression(n) => *n as *const _ as *const (),
            Node::AscribedExpression(n) => *n as *const _ as *const (),
            Node::SketchBlock(n) => *n as *const _ as *const (),
            Node::Block(n) => *n as *const _ as *const (),
            Node::SketchVar(n) => *n as *const _ as *const (),
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
            Node::TypeDeclaration(n) => SourceRange::from(*n),
            Node::ReturnStatement(n) => SourceRange::from(*n),
            Node::VariableDeclarator(n) => SourceRange::from(*n),
            Node::NumericLiteral(n) => SourceRange::from(*n),
            Node::Literal(n) => SourceRange::from(*n),
            Node::TagDeclarator(n) => SourceRange::from(*n),
            Node::Identifier(n) => SourceRange::from(*n),
            Node::Name(n) => SourceRange::from(*n),
            Node::BinaryExpression(n) => SourceRange::from(*n),
            Node::FunctionExpression(n) => SourceRange::from(*n),
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
            Node::AscribedExpression(n) => SourceRange::from(*n),
            Node::SketchBlock(n) => SourceRange::from(*n),
            Node::Block(n) => SourceRange::from(*n),
            Node::SketchVar(n) => SourceRange::from(*n),

            // This is broken too
            Node::ElseIf(n) => SourceRange::new(n.cond.start(), n.cond.end(), n.cond.module_id()),

            // The KclNone type here isn't an actual node, so it has no
            // start/end information.
            Node::KclNone(_) => return Err(Self::Error::NoSourceForAKclNone),
        })
    }
}

impl TryFrom<&NodeMut<'_>> for SourceRange {
    type Error = AstNodeError;

    fn try_from(node: &NodeMut) -> Result<Self, Self::Error> {
        Ok(match node {
            NodeMut::Program(n) => SourceRange::from(&**n),
            NodeMut::ImportStatement(n) => SourceRange::from(&**n),
            NodeMut::ExpressionStatement(n) => SourceRange::from(&**n),
            NodeMut::VariableDeclaration(n) => SourceRange::from(&**n),
            NodeMut::TypeDeclaration(n) => SourceRange::from(&**n),
            NodeMut::ReturnStatement(n) => SourceRange::from(&**n),
            NodeMut::VariableDeclarator(n) => SourceRange::from(&**n),
            NodeMut::NumericLiteral(n) => SourceRange::from(&**n),
            NodeMut::Literal(n) => SourceRange::from(&**n),
            NodeMut::TagDeclarator(n) => SourceRange::from(&**n),
            NodeMut::Identifier(n) => SourceRange::from(&**n),
            NodeMut::Name(n) => SourceRange::from(&**n),
            NodeMut::BinaryExpression(n) => SourceRange::from(&**n),
            NodeMut::FunctionExpression(n) => SourceRange::from(&**n),
            NodeMut::CallExpressionKw(n) => SourceRange::from(&**n),
            NodeMut::PipeExpression(n) => SourceRange::from(&**n),
            NodeMut::PipeSubstitution(n) => SourceRange::from(&**n),
            NodeMut::ArrayExpression(n) => SourceRange::from(&**n),
            NodeMut::ArrayRangeExpression(n) => SourceRange::from(&**n),
            NodeMut::ObjectExpression(n) => SourceRange::from(&**n),
            NodeMut::MemberExpression(n) => SourceRange::from(&**n),
            NodeMut::UnaryExpression(n) => SourceRange::from(&**n),
            NodeMut::Parameter(p) => SourceRange::from(&p.identifier),
            NodeMut::ObjectProperty(n) => SourceRange::from(&**n),
            NodeMut::IfExpression(n) => SourceRange::from(&**n),
            NodeMut::LabelledExpression(n) => SourceRange::from(&**n),
            NodeMut::AscribedExpression(n) => SourceRange::from(&**n),
            NodeMut::SketchBlock(n) => SourceRange::from(&**n),
            NodeMut::Block(n) => SourceRange::from(&**n),
            NodeMut::SketchVar(n) => SourceRange::from(&**n),

            // Note: This is different from the immutable version.
            NodeMut::ElseIf(n) => SourceRange::new(n.cond.start(), n.then_val.end, n.then_val.module_id),

            // The KclNone type here isn't an actual node, so it has no
            // start/end information.
            NodeMut::KclNone(_) => return Err(Self::Error::NoSourceForAKclNone),
        })
    }
}

impl<'tree> From<&'tree types::BodyItem> for Node<'tree> {
    fn from(node: &'tree types::BodyItem) -> Self {
        match node {
            types::BodyItem::ImportStatement(v) => v.as_ref().into(),
            types::BodyItem::ExpressionStatement(v) => v.into(),
            types::BodyItem::VariableDeclaration(v) => v.as_ref().into(),
            types::BodyItem::TypeDeclaration(v) => v.as_ref().into(),
            types::BodyItem::ReturnStatement(v) => v.into(),
        }
    }
}

impl<'tree> From<&'tree mut types::BodyItem> for NodeMut<'tree> {
    fn from(node: &'tree mut types::BodyItem) -> Self {
        match node {
            types::BodyItem::ImportStatement(v) => v.as_mut().into(),
            types::BodyItem::ExpressionStatement(v) => v.into(),
            types::BodyItem::VariableDeclaration(v) => v.as_mut().into(),
            types::BodyItem::TypeDeclaration(v) => v.as_mut().into(),
            types::BodyItem::ReturnStatement(v) => v.into(),
        }
    }
}

impl<'tree> From<&'tree types::Expr> for Node<'tree> {
    fn from(node: &'tree types::Expr) -> Self {
        match node {
            types::Expr::Literal(lit) => lit.as_ref().into(),
            types::Expr::TagDeclarator(tag) => tag.as_ref().into(),
            types::Expr::Name(id) => id.as_ref().into(),
            types::Expr::BinaryExpression(be) => be.as_ref().into(),
            types::Expr::FunctionExpression(fe) => fe.as_ref().into(),
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
            types::Expr::AscribedExpression(e) => e.as_ref().into(),
            types::Expr::SketchBlock(e) => e.as_ref().into(),
            types::Expr::SketchVar(e) => e.as_ref().into(),
            types::Expr::None(n) => n.into(),
        }
    }
}

impl<'tree> From<&'tree mut types::Expr> for NodeMut<'tree> {
    fn from(node: &'tree mut types::Expr) -> Self {
        match node {
            types::Expr::Literal(lit) => lit.as_mut().into(),
            types::Expr::TagDeclarator(tag) => tag.as_mut().into(),
            types::Expr::Name(id) => id.as_mut().into(),
            types::Expr::BinaryExpression(be) => be.as_mut().into(),
            types::Expr::FunctionExpression(fe) => fe.as_mut().into(),
            types::Expr::CallExpressionKw(ce) => ce.as_mut().into(),
            types::Expr::PipeExpression(pe) => pe.as_mut().into(),
            types::Expr::PipeSubstitution(ps) => ps.as_mut().into(),
            types::Expr::ArrayExpression(ae) => ae.as_mut().into(),
            types::Expr::ArrayRangeExpression(are) => are.as_mut().into(),
            types::Expr::ObjectExpression(oe) => oe.as_mut().into(),
            types::Expr::MemberExpression(me) => me.as_mut().into(),
            types::Expr::UnaryExpression(ue) => ue.as_mut().into(),
            types::Expr::IfExpression(e) => e.as_mut().into(),
            types::Expr::LabelledExpression(e) => e.as_mut().into(),
            types::Expr::AscribedExpression(e) => e.as_mut().into(),
            types::Expr::SketchBlock(e) => e.as_mut().into(),
            types::Expr::SketchVar(e) => e.as_mut().into(),
            types::Expr::None(n) => n.into(),
        }
    }
}

impl<'tree> From<&'tree types::BinaryPart> for Node<'tree> {
    fn from(node: &'tree types::BinaryPart) -> Self {
        match node {
            types::BinaryPart::Literal(lit) => lit.as_ref().into(),
            types::BinaryPart::Name(id) => id.as_ref().into(),
            types::BinaryPart::BinaryExpression(be) => be.as_ref().into(),
            types::BinaryPart::CallExpressionKw(ce) => ce.as_ref().into(),
            types::BinaryPart::UnaryExpression(ue) => ue.as_ref().into(),
            types::BinaryPart::MemberExpression(me) => me.as_ref().into(),
            types::BinaryPart::ArrayExpression(e) => e.as_ref().into(),
            types::BinaryPart::ArrayRangeExpression(e) => e.as_ref().into(),
            types::BinaryPart::ObjectExpression(e) => e.as_ref().into(),
            types::BinaryPart::IfExpression(e) => e.as_ref().into(),
            types::BinaryPart::AscribedExpression(e) => e.as_ref().into(),
            types::BinaryPart::SketchVar(e) => e.as_ref().into(),
        }
    }
}

impl<'tree> From<&'tree mut types::BinaryPart> for NodeMut<'tree> {
    fn from(node: &'tree mut types::BinaryPart) -> Self {
        match node {
            types::BinaryPart::Literal(lit) => lit.as_mut().into(),
            types::BinaryPart::Name(id) => id.as_mut().into(),
            types::BinaryPart::BinaryExpression(be) => be.as_mut().into(),
            types::BinaryPart::CallExpressionKw(ce) => ce.as_mut().into(),
            types::BinaryPart::UnaryExpression(ue) => ue.as_mut().into(),
            types::BinaryPart::MemberExpression(me) => me.as_mut().into(),
            types::BinaryPart::ArrayExpression(e) => e.as_mut().into(),
            types::BinaryPart::ArrayRangeExpression(e) => e.as_mut().into(),
            types::BinaryPart::ObjectExpression(e) => e.as_mut().into(),
            types::BinaryPart::IfExpression(e) => e.as_mut().into(),
            types::BinaryPart::AscribedExpression(e) => e.as_mut().into(),
            types::BinaryPart::SketchVar(e) => e.as_mut().into(),
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

        impl<'a> From<NodeRefMut<'a, types::$t>> for NodeMut<'a> {
            fn from(v: NodeRefMut<'a, types::$t>) -> Self {
                NodeMut::$t(v)
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

        impl<'a> From<&'a mut types::$t> for NodeMut<'a> {
            fn from(v: &'a mut types::$t) -> Self {
                NodeMut::$t(v)
            }
        }
    };
}

impl_from!(Node, Program);
impl_from!(Node, ImportStatement);
impl_from!(Node, ExpressionStatement);
impl_from!(Node, VariableDeclaration);
impl_from!(Node, TypeDeclaration);
impl_from!(Node, ReturnStatement);
impl_from!(Node, VariableDeclarator);
impl_from!(Node, NumericLiteral);
impl_from!(Node, Literal);
impl_from!(Node, TagDeclarator);
impl_from!(Node, Identifier);
impl_from!(Node, Name);
impl_from!(Node, BinaryExpression);
impl_from!(Node, FunctionExpression);
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
impl_from!(Node, AscribedExpression);
impl_from!(Node, SketchBlock);
impl_from!(Node, Block);
impl_from!(Node, SketchVar);
impl_from!(Node, KclNone);

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! kcl {
        ( $kcl:expr_2021 ) => {{ $crate::parsing::top_level_parse($kcl).unwrap() }};
    }

    #[test]
    fn check_ptr_eq() {
        let program = kcl!(
            "
foo = 1
bar = foo + 1

fn myfn() {
    foo = 2
    sin(foo)
}
"
        );

        let foo: Node = (&program.body[0]).into();
        assert!(foo.ptr_eq((&program.body[0]).into()));
        assert!(!foo.ptr_eq((&program.body[1]).into()));
    }
}
