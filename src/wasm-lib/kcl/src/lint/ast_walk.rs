use super::Node;
use crate::ast::types::{
    BinaryPart, BodyItem, LiteralIdentifier, MemberExpression, MemberObject, ObjectExpression, ObjectProperty,
    Parameter, Program, UnaryExpression, Value, VariableDeclarator,
};
use anyhow::Result;

/// Walker is implemented by things that are able to walk an AST tree to
/// produce lints. This trait is implemented automatically for a few of the
/// common types, but can be manually implemented too.
pub trait Walker<'a> {
    /// Walk will visit every element of the AST.
    fn walk(&self, n: Node<'a>) -> Result<bool>;
}

impl<'a, FnT> Walker<'a> for FnT
where
    FnT: Fn(Node<'a>) -> Result<bool>,
{
    fn walk(&self, n: Node<'a>) -> Result<bool> {
        self(n)
    }
}

/// Run the Walker against all [Node]s in a [Program].
pub fn walk<'a, WalkT>(prog: &'a Program, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(prog.into())?;

    for bi in &prog.body {
        walk_body_item(bi, f)?;
    }
    Ok(())
}

fn walk_variable_declarator<'a, WalkT>(node: &'a VariableDeclarator, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    f.walk((&node.id).into())?;
    walk_value(&node.init, f)?;
    Ok(())
}

fn walk_parameter<'a, WalkT>(node: &'a Parameter, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    f.walk((&node.identifier).into())?;
    Ok(())
}

fn walk_member_object<'a, WalkT>(node: &'a MemberObject, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    Ok(())
}

fn walk_literal_identifier<'a, WalkT>(node: &'a LiteralIdentifier, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    Ok(())
}

fn walk_member_expression<'a, WalkT>(node: &'a MemberExpression, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;

    walk_member_object(&node.object, f)?;
    walk_literal_identifier(&node.property, f)?;

    Ok(())
}

fn walk_binary_part<'a, WalkT>(node: &'a BinaryPart, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    match node {
        BinaryPart::Literal(lit) => f.walk(lit.as_ref().into())?,
        BinaryPart::Identifier(id) => f.walk(id.as_ref().into())?,
        BinaryPart::BinaryExpression(be) => f.walk(be.as_ref().into())?,
        BinaryPart::CallExpression(ce) => f.walk(ce.as_ref().into())?,
        BinaryPart::UnaryExpression(ue) => {
            walk_unary_expression(ue, f)?;
            true
        }
        BinaryPart::MemberExpression(me) => {
            walk_member_expression(me, f)?;
            true
        }
    };

    Ok(())
}

fn walk_value<'a, WalkT>(node: &'a Value, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    match node {
        Value::Literal(lit) => {
            f.walk(lit.as_ref().into())?;
        }

        Value::Identifier(id) => {
            // sometimes there's a bare Identifier without a Value::Identifier.
            f.walk(id.as_ref().into())?;
        }

        Value::BinaryExpression(be) => {
            f.walk(be.as_ref().into())?;

            walk_binary_part(&be.left, f)?;
            walk_binary_part(&be.right, f)?;
        }
        Value::FunctionExpression(fe) => {
            f.walk(fe.as_ref().into())?;

            for arg in &fe.params {
                walk_parameter(arg, f)?;
            }
            walk(&fe.body, f)?;
        }
        Value::CallExpression(ce) => {
            f.walk(ce.as_ref().into())?;
            f.walk((&ce.callee).into())?;
            for e in &ce.arguments {
                walk_value::<WalkT>(e, f)?;
            }
        }
        Value::PipeExpression(pe) => {
            f.walk(pe.as_ref().into())?;

            for e in &pe.body {
                walk_value::<WalkT>(e, f)?;
            }
        }
        Value::PipeSubstitution(ps) => {
            f.walk(ps.as_ref().into())?;
        }
        Value::ArrayExpression(ae) => {
            f.walk(ae.as_ref().into())?;
            for e in &ae.elements {
                walk_value::<WalkT>(e, f)?;
            }
        }
        Value::ObjectExpression(oe) => {
            walk_object_expression(oe, f)?;
        }
        Value::MemberExpression(me) => {
            walk_member_expression(me, f)?;
        }
        Value::UnaryExpression(ue) => {
            walk_unary_expression(ue, f)?;
        }
        _ => {
            println!("{:?}", node);
            unimplemented!()
        }
    }

    Ok(())
}

/// Walk through an [ObjectProperty].
fn walk_object_property<'a, WalkT>(node: &'a ObjectProperty, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    walk_value(&node.value, f)?;
    Ok(())
}

/// Walk through an [ObjectExpression].
fn walk_object_expression<'a, WalkT>(node: &'a ObjectExpression, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    for prop in &node.properties {
        walk_object_property(prop, f)?;
    }
    Ok(())
}

/// walk through an [UnaryExpression].
fn walk_unary_expression<'a, WalkT>(node: &'a UnaryExpression, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())?;
    walk_binary_part(&node.argument, f)?;
    Ok(())
}

/// walk through a [BodyItem].
fn walk_body_item<'a, WalkT>(node: &'a BodyItem, f: &WalkT) -> Result<()>
where
    WalkT: Walker<'a>,
{
    // We don't walk a BodyItem since it's an enum itself.

    match node {
        BodyItem::ExpressionStatement(xs) => {
            f.walk(xs.into())?;
            walk_value(&xs.expression, f)?;
        }
        BodyItem::VariableDeclaration(vd) => {
            f.walk(vd.into())?;
            for dec in &vd.declarations {
                walk_variable_declarator(dec, f)?;
            }
        }
        BodyItem::ReturnStatement(rs) => {
            f.walk(rs.into())?;
            walk_value(&rs.argument, f)?;
        }
    }

    Ok(())
}
