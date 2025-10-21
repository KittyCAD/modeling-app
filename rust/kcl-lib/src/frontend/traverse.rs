//! Traversal of the AST. We couldn't use a mutable variation of
//! [`crate::walk::Visitable`] because we can't collect multiple mutable child
//! references.
use std::ops::ControlFlow;

use crate::{parsing::ast::types as ast, walk::NodeMut};

/// Pre-order DFS traversal of the AST, applying `f` to each node. If `f`
/// returns `ControlFlow::Break`, the traversal is stopped and the `ControlFlow`
/// value is returned.
pub(super) fn dfs_mut<B, C, Ctx>(
    program: &mut ast::Node<ast::Program>,
    context: &Ctx,
    f: fn(&Ctx, NodeMut) -> ControlFlow<B, C>,
) -> ControlFlow<B, C> {
    let node = NodeMut::from(&mut *program);
    let mut control = f(context, node);
    if control.is_break() {
        return control;
    }
    for body_item in &mut program.body {
        control = dfs_mut_body_item(body_item, context, f);
        if control.is_break() {
            return control;
        }
    }
    control
}

fn dfs_mut_body_item<B, C, Ctx>(
    body_item: &mut ast::BodyItem,
    context: &Ctx,
    f: fn(&Ctx, NodeMut) -> ControlFlow<B, C>,
) -> ControlFlow<B, C> {
    let node = NodeMut::from(&mut *body_item);
    let mut control = f(context, node);
    if control.is_break() {
        return control;
    }
    match body_item {
        ast::BodyItem::ImportStatement(_) => {}
        ast::BodyItem::ExpressionStatement(node) => {
            control = dfs_mut_expr(&mut node.expression, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BodyItem::VariableDeclaration(node) => {
            control = dfs_mut_expr(&mut node.declaration.init, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            control = dfs_mut_expr(&mut node.argument, context, f);
            if control.is_break() {
                return control;
            }
        }
    }
    control
}

fn dfs_mut_expr<B, C, Ctx>(
    expr: &mut ast::Expr,
    context: &Ctx,
    f: fn(&Ctx, NodeMut) -> ControlFlow<B, C>,
) -> ControlFlow<B, C> {
    let node = NodeMut::from(&mut *expr);
    let mut control = f(context, node);
    if control.is_break() {
        return control;
    }
    match expr {
        ast::Expr::Literal(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::Expr::Name(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::Expr::TagDeclarator(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::Expr::BinaryExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.left, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.right, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::FunctionExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.body.body {
                control = dfs_mut_body_item(body_item, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::CallExpressionKw(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::PipeExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.body {
                control = dfs_mut_expr(expr, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::PipeSubstitution(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::Expr::ArrayExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.elements {
                control = dfs_mut_expr(expr, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::ArrayRangeExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.start_element, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.end_element, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::ObjectExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for property in &mut node.properties {
                control = f(context, NodeMut::from(&mut property.key));
                if control.is_break() {
                    return control;
                }
                control = dfs_mut_expr(&mut property.value, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::MemberExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.object, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.property, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::UnaryExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.argument, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::IfExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.cond, context, f);
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.then_val.body {
                control = dfs_mut_body_item(body_item, context, f);
                if control.is_break() {
                    return control;
                }
            }
            for else_if in &mut node.else_ifs {
                control = dfs_mut_expr(&mut else_if.cond, context, f);
                if control.is_break() {
                    return control;
                }
                for body_item in &mut else_if.then_val.body {
                    control = dfs_mut_body_item(body_item, context, f);
                    if control.is_break() {
                        return control;
                    }
                }
            }
        }
        ast::Expr::LabelledExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::AscribedExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::SketchBlock(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, context, f);
                if control.is_break() {
                    return control;
                }
            }
            for body_item in &mut node.body.items {
                control = dfs_mut_body_item(body_item, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::SketchVar(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::Expr::None(_) => {}
    }
    control
}

fn dfs_mut_binary_part<B, C, Ctx>(
    binary_part: &mut ast::BinaryPart,
    context: &Ctx,
    f: fn(&Ctx, NodeMut) -> ControlFlow<B, C>,
) -> ControlFlow<B, C> {
    let node = NodeMut::from(&mut *binary_part);
    let mut control = f(context, node);
    if control.is_break() {
        return control;
    }
    match binary_part {
        ast::BinaryPart::Literal(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::BinaryPart::Name(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
        ast::BinaryPart::BinaryExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.left, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.right, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::CallExpressionKw(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::UnaryExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.argument, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::MemberExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.object, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.property, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::ArrayExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.elements {
                control = dfs_mut_expr(expr, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.start_element, context, f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.end_element, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::ObjectExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for property in &mut node.properties {
                control = f(context, NodeMut::from(&mut property.key));
                if control.is_break() {
                    return control;
                }
                control = dfs_mut_expr(&mut property.value, context, f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::IfExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.cond, context, f);
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.then_val.body {
                control = dfs_mut_body_item(body_item, context, f);
                if control.is_break() {
                    return control;
                }
            }
            for else_if in &mut node.else_ifs {
                control = dfs_mut_expr(&mut else_if.cond, context, f);
                if control.is_break() {
                    return control;
                }
                for body_item in &mut else_if.then_val.body {
                    control = dfs_mut_body_item(body_item, context, f);
                    if control.is_break() {
                        return control;
                    }
                }
            }
        }
        ast::BinaryPart::AscribedExpression(node) => {
            control = f(context, NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, context, f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::SketchVar(node) => {
            control = f(context, NodeMut::from(&mut **node));
        }
    }
    control
}
