use crate::parsing::ast::types;
use crate::walk::NodeMut;

/// Mutable AST visitor.
///
/// This is intentionally callback-based instead of exposing mutable child
/// iterators, since collecting multiple mutable descendants into a `Vec` would
/// violate Rust's aliasing rules.
pub(crate) trait VisitMut {
    type Error;

    /// Called before visiting a node's children. Return `false` to stop walking.
    fn visit_node_mut(&mut self, node: NodeMut) -> Result<bool, Self::Error>;
}

pub(crate) fn walk_mut<V>(program: &mut types::Program, visitor: &mut V) -> Result<bool, V::Error>
where
    V: VisitMut,
{
    for item in &mut program.body {
        if !walk_body_item_mut(item, visitor)? {
            return Ok(false);
        }
    }

    Ok(true)
}

pub(crate) fn walk_block_mut<V>(block: &mut types::Block, visitor: &mut V) -> Result<bool, V::Error>
where
    V: VisitMut,
{
    for item in &mut block.items {
        if !walk_body_item_mut(item, visitor)? {
            return Ok(false);
        }
    }

    Ok(true)
}

fn walk_body_item_mut<V>(body_item: &mut types::BodyItem, visitor: &mut V) -> Result<bool, V::Error>
where
    V: VisitMut,
{
    if !visitor.visit_node_mut(NodeMut::from(&mut *body_item))? {
        return Ok(false);
    }

    match body_item {
        types::BodyItem::ImportStatement(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::BodyItem::ExpressionStatement(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut *node))? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.expression, visitor)
        }
        types::BodyItem::VariableDeclaration(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.declaration))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.declaration.id))? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.declaration.init, visitor)
        }
        types::BodyItem::TypeDeclaration(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::BodyItem::ReturnStatement(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut *node))? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.argument, visitor)
        }
    }
}

fn walk_expr_mut<V>(expr: &mut types::Expr, visitor: &mut V) -> Result<bool, V::Error>
where
    V: VisitMut,
{
    match expr {
        types::Expr::Literal(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::Expr::TagDeclarator(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::Expr::Name(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            visitor.visit_node_mut(NodeMut::from(&mut node.name))
        }
        types::Expr::BinaryExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_binary_part_mut(&mut node.left, visitor)? {
                return Ok(false);
            }
            walk_binary_part_mut(&mut node.right, visitor)
        }
        types::Expr::FunctionExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for param in &mut node.params {
                if !visitor.visit_node_mut(NodeMut::from(&mut *param))? {
                    return Ok(false);
                }
                if !visitor.visit_node_mut(NodeMut::from(&mut param.identifier))? {
                    return Ok(false);
                }
            }
            walk_mut(&mut node.body, visitor)
        }
        types::Expr::CallExpressionKw(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.callee))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.callee.name))? {
                return Ok(false);
            }
            if let Some(unlabeled) = &mut node.unlabeled
                && !walk_expr_mut(unlabeled, visitor)?
            {
                return Ok(false);
            }
            for arg in &mut node.arguments {
                if let Some(label) = &mut arg.label
                    && !visitor.visit_node_mut(NodeMut::from(label))?
                {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut arg.arg, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::Expr::PipeExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for expr in &mut node.body {
                if !walk_expr_mut(expr, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::Expr::PipeSubstitution(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::Expr::ArrayExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for expr in &mut node.elements {
                if !walk_expr_mut(expr, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::Expr::ArrayRangeExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.start_element, visitor)? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.end_element, visitor)
        }
        types::Expr::ObjectExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for property in &mut node.properties {
                if !visitor.visit_node_mut(NodeMut::from(&mut *property))? {
                    return Ok(false);
                }
                if !visitor.visit_node_mut(NodeMut::from(&mut property.key))? {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut property.value, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::Expr::MemberExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.object, visitor)? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.property, visitor)
        }
        types::Expr::UnaryExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            walk_binary_part_mut(&mut node.argument, visitor)
        }
        types::Expr::IfExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.cond, visitor)? {
                return Ok(false);
            }
            if !walk_mut(&mut node.then_val, visitor)? {
                return Ok(false);
            }
            for else_if in &mut node.else_ifs {
                if !visitor.visit_node_mut(NodeMut::from(&mut *else_if))? {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut else_if.cond, visitor)? {
                    return Ok(false);
                }
                if !walk_mut(&mut else_if.then_val, visitor)? {
                    return Ok(false);
                }
            }
            walk_mut(&mut node.final_else, visitor)
        }
        types::Expr::LabelledExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.expr, visitor)? {
                return Ok(false);
            }
            visitor.visit_node_mut(NodeMut::from(&mut node.label))
        }
        types::Expr::AscribedExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.expr, visitor)
        }
        types::Expr::SketchBlock(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for arg in &mut node.arguments {
                if let Some(label) = &mut arg.label
                    && !visitor.visit_node_mut(NodeMut::from(label))?
                {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut arg.arg, visitor)? {
                    return Ok(false);
                }
            }
            walk_block_mut(&mut node.body, visitor)
        }
        types::Expr::SketchVar(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if let Some(initial) = &mut node.initial {
                return visitor.visit_node_mut(NodeMut::from(&mut **initial));
            }
            Ok(true)
        }
        types::Expr::None(node) => visitor.visit_node_mut(NodeMut::from(&mut *node)),
    }
}

fn walk_binary_part_mut<V>(binary_part: &mut types::BinaryPart, visitor: &mut V) -> Result<bool, V::Error>
where
    V: VisitMut,
{
    match binary_part {
        types::BinaryPart::Literal(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
        types::BinaryPart::Name(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            visitor.visit_node_mut(NodeMut::from(&mut node.name))
        }
        types::BinaryPart::BinaryExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_binary_part_mut(&mut node.left, visitor)? {
                return Ok(false);
            }
            walk_binary_part_mut(&mut node.right, visitor)
        }
        types::BinaryPart::CallExpressionKw(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.callee))? {
                return Ok(false);
            }
            if !visitor.visit_node_mut(NodeMut::from(&mut node.callee.name))? {
                return Ok(false);
            }
            if let Some(unlabeled) = &mut node.unlabeled
                && !walk_expr_mut(unlabeled, visitor)?
            {
                return Ok(false);
            }
            for arg in &mut node.arguments {
                if let Some(label) = &mut arg.label
                    && !visitor.visit_node_mut(NodeMut::from(label))?
                {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut arg.arg, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::BinaryPart::UnaryExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            walk_binary_part_mut(&mut node.argument, visitor)
        }
        types::BinaryPart::MemberExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.object, visitor)? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.property, visitor)
        }
        types::BinaryPart::ArrayExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for expr in &mut node.elements {
                if !walk_expr_mut(expr, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::BinaryPart::ArrayRangeExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.start_element, visitor)? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.end_element, visitor)
        }
        types::BinaryPart::ObjectExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            for property in &mut node.properties {
                if !visitor.visit_node_mut(NodeMut::from(&mut *property))? {
                    return Ok(false);
                }
                if !visitor.visit_node_mut(NodeMut::from(&mut property.key))? {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut property.value, visitor)? {
                    return Ok(false);
                }
            }
            Ok(true)
        }
        types::BinaryPart::IfExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            if !walk_expr_mut(&mut node.cond, visitor)? {
                return Ok(false);
            }
            if !walk_mut(&mut node.then_val, visitor)? {
                return Ok(false);
            }
            for else_if in &mut node.else_ifs {
                if !visitor.visit_node_mut(NodeMut::from(&mut *else_if))? {
                    return Ok(false);
                }
                if !walk_expr_mut(&mut else_if.cond, visitor)? {
                    return Ok(false);
                }
                if !walk_mut(&mut else_if.then_val, visitor)? {
                    return Ok(false);
                }
            }
            walk_mut(&mut node.final_else, visitor)
        }
        types::BinaryPart::AscribedExpression(node) => {
            if !visitor.visit_node_mut(NodeMut::from(&mut **node))? {
                return Ok(false);
            }
            walk_expr_mut(&mut node.expr, visitor)
        }
        types::BinaryPart::SketchVar(node) => visitor.visit_node_mut(NodeMut::from(&mut **node)),
    }
}
