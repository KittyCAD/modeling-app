use anyhow::Result;

use crate::{
    ast::types::{
        BinaryPart, BodyItem, Expr, IfExpression, LiteralIdentifier, MemberExpression, MemberObject, ObjectExpression,
        ObjectProperty, Parameter, Program, UnaryExpression, VariableDeclarator,
    },
    walk::Node,
};

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
pub fn walk<'a, WalkT>(prog: &'a Program, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(prog.into())? {
        return Ok(false);
    }

    for bi in &prog.body {
        if !walk_body_item(bi, f)? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn walk_variable_declarator<'a, WalkT>(node: &'a VariableDeclarator, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }
    if !f.walk((&node.id).into())? {
        return Ok(false);
    }
    walk_value(&node.init, f)
}

fn walk_parameter<'a, WalkT>(node: &'a Parameter, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }
    f.walk((&node.identifier).into())
}

fn walk_member_object<'a, WalkT>(node: &'a MemberObject, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())
}

fn walk_literal_identifier<'a, WalkT>(node: &'a LiteralIdentifier, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    f.walk(node.into())
}

fn walk_member_expression<'a, WalkT>(node: &'a MemberExpression, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }

    if !walk_member_object(&node.object, f)? {
        return Ok(false);
    }

    walk_literal_identifier(&node.property, f)
}

fn walk_binary_part<'a, WalkT>(node: &'a BinaryPart, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    match node {
        BinaryPart::Literal(lit) => f.walk(lit.as_ref().into()),
        BinaryPart::Identifier(id) => f.walk(id.as_ref().into()),
        BinaryPart::BinaryExpression(be) => f.walk(be.as_ref().into()),
        BinaryPart::CallExpression(ce) => f.walk(ce.as_ref().into()),
        BinaryPart::UnaryExpression(ue) => walk_unary_expression(ue, f),
        BinaryPart::MemberExpression(me) => walk_member_expression(me, f),
        BinaryPart::IfExpression(e) => walk_if_expression(e, f),
    }
}

// TODO: Rename this to walk_expr
fn walk_value<'a, WalkT>(node: &'a Expr, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    match node {
        Expr::Literal(lit) => f.walk(lit.as_ref().into()),
        Expr::TagDeclarator(tag) => f.walk(tag.as_ref().into()),

        Expr::Identifier(id) => {
            // sometimes there's a bare Identifier without a Value::Identifier.
            f.walk(id.as_ref().into())
        }

        Expr::BinaryExpression(be) => {
            if !f.walk(be.as_ref().into())? {
                return Ok(false);
            }
            if !walk_binary_part(&be.left, f)? {
                return Ok(false);
            }
            walk_binary_part(&be.right, f)
        }
        Expr::FunctionExpression(fe) => {
            if !f.walk(fe.as_ref().into())? {
                return Ok(false);
            }

            for arg in &fe.params {
                if !walk_parameter(arg, f)? {
                    return Ok(false);
                }
            }
            walk(&fe.body, f)
        }
        Expr::CallExpression(ce) => {
            if !f.walk(ce.as_ref().into())? {
                return Ok(false);
            }

            if !f.walk((&ce.callee).into())? {
                return Ok(false);
            }
            for e in &ce.arguments {
                if !walk_value::<WalkT>(e, f)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Expr::PipeExpression(pe) => {
            if !f.walk(pe.as_ref().into())? {
                return Ok(false);
            }

            for e in &pe.body {
                if !walk_value::<WalkT>(e, f)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Expr::PipeSubstitution(ps) => f.walk(ps.as_ref().into()),
        Expr::ArrayExpression(ae) => {
            if !f.walk(ae.as_ref().into())? {
                return Ok(false);
            }
            for e in &ae.elements {
                if !walk_value::<WalkT>(e, f)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        Expr::ArrayRangeExpression(are) => {
            if !f.walk(are.as_ref().into())? {
                return Ok(false);
            }
            if !walk_value::<WalkT>(&are.start_element, f)? {
                return Ok(false);
            }
            if !walk_value::<WalkT>(&are.end_element, f)? {
                return Ok(false);
            }
            Ok(true)
        }
        Expr::ObjectExpression(oe) => walk_object_expression(oe, f),
        Expr::MemberExpression(me) => walk_member_expression(me, f),
        Expr::UnaryExpression(ue) => walk_unary_expression(ue, f),
        Expr::IfExpression(e) => walk_if_expression(e, f),
        Expr::None(_) => Ok(true),
    }
}

/// Walk through an [ObjectProperty].
fn walk_object_property<'a, WalkT>(node: &'a ObjectProperty, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }
    walk_value(&node.value, f)
}

/// Walk through an [ObjectExpression].
fn walk_object_expression<'a, WalkT>(node: &'a ObjectExpression, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }

    for prop in &node.properties {
        if !walk_object_property(prop, f)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// Walk through an [IfExpression].
fn walk_if_expression<'a, WalkT>(node: &'a IfExpression, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }
    if !walk_value(&node.cond, f)? {
        return Ok(false);
    }

    for else_if in &node.else_ifs {
        if !walk_value(&else_if.cond, f)? {
            return Ok(false);
        }
        if !walk(&else_if.then_val, f)? {
            return Ok(false);
        }
    }
    let final_else = &(*node.final_else);
    if !f.walk(final_else.into())? {
        return Ok(false);
    }
    Ok(true)
}

/// walk through an [UnaryExpression].
fn walk_unary_expression<'a, WalkT>(node: &'a UnaryExpression, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    if !f.walk(node.into())? {
        return Ok(false);
    }
    walk_binary_part(&node.argument, f)
}

/// walk through a [BodyItem].
fn walk_body_item<'a, WalkT>(node: &'a BodyItem, f: &WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    // We don't walk a BodyItem since it's an enum itself.

    match node {
        BodyItem::ImportStatement(xs) => {
            if !f.walk(xs.as_ref().into())? {
                return Ok(false);
            }
            Ok(true)
        }
        BodyItem::ExpressionStatement(xs) => {
            if !f.walk(xs.into())? {
                return Ok(false);
            }
            walk_value(&xs.expression, f)
        }
        BodyItem::VariableDeclaration(vd) => {
            if !f.walk(vd.as_ref().into())? {
                return Ok(false);
            }
            for dec in &vd.declarations {
                if !walk_variable_declarator(dec, f)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        BodyItem::ReturnStatement(rs) => {
            if !f.walk(rs.into())? {
                return Ok(false);
            }
            walk_value(&rs.argument, f)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! kcl {
        ( $kcl:expr ) => {{
            let tokens = $crate::token::lexer($kcl).unwrap();
            let parser = $crate::parser::Parser::new(tokens);
            parser.ast().unwrap()
        }};
    }

    #[test]
    fn stop_walking() {
        let program = kcl!(
            "
const foo = 1
const bar = 2
"
        );

        walk(&program, &|node| {
            if let Node::VariableDeclarator(vd) = node {
                if vd.id.name == "foo" {
                    return Ok(false);
                }
                panic!("walk didn't stop");
            }
            Ok(true)
        })
        .unwrap();
    }
}
