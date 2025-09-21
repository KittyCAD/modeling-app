//! Traversal of the AST. We couldn't use a mutable variation of
//! [`crate::walk::Visitable`] because we can't collect multiple mutable child
//! references.
use std::ops::ControlFlow;

use crate::{parsing::ast::types as ast, walk::NodeMut};

/// Pre-order DFS traversal of the AST, applying `f` to each node. If `f`
/// returns `ControlFlow::Break`, the traversal is stopped and the `ControlFlow`
/// value is returned.
pub(super) fn dfs_mut<B, C, F>(program: &mut ast::Node<ast::Program>, f: F) -> ControlFlow<B, C>
where
    F: Fn(NodeMut) -> ControlFlow<B, C>,
{
    let node = NodeMut::from(&mut *program);
    let mut control = f(node);
    if control.is_break() {
        return control;
    }
    for body_item in &mut program.body {
        control = dfs_mut_body_item(body_item, &f);
        if control.is_break() {
            return control;
        }
    }
    control
}

fn dfs_mut_body_item<B, C, F>(body_item: &mut ast::BodyItem, f: F) -> ControlFlow<B, C>
where
    F: Fn(NodeMut) -> ControlFlow<B, C>,
{
    let node = NodeMut::from(&mut *body_item);
    let mut control = f(node);
    if control.is_break() {
        return control;
    }
    match body_item {
        ast::BodyItem::ImportStatement(_) => {}
        ast::BodyItem::ExpressionStatement(node) => {
            control = dfs_mut_expr(&mut node.expression, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BodyItem::VariableDeclaration(node) => {
            control = dfs_mut_expr(&mut node.declaration.init, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            control = dfs_mut_expr(&mut node.argument, &f);
            if control.is_break() {
                return control;
            }
        }
    }
    control
}

fn dfs_mut_expr<B, C, F>(expr: &mut ast::Expr, f: F) -> ControlFlow<B, C>
where
    F: Fn(NodeMut) -> ControlFlow<B, C>,
{
    let node = NodeMut::from(&mut *expr);
    let mut control = f(node);
    if control.is_break() {
        return control;
    }
    match expr {
        ast::Expr::Literal(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::Expr::Name(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::Expr::TagDeclarator(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::Expr::BinaryExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.left, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.right, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::FunctionExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.body.body {
                control = dfs_mut_body_item(body_item, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::CallExpressionKw(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::PipeExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.body {
                control = dfs_mut_expr(expr, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::PipeSubstitution(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::Expr::ArrayExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.elements {
                control = dfs_mut_expr(expr, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::ArrayRangeExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.start_element, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.end_element, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::ObjectExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for property in &mut node.properties {
                control = f(NodeMut::from(&mut property.key));
                if control.is_break() {
                    return control;
                }
                control = dfs_mut_expr(&mut property.value, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::MemberExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.object, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.property, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::UnaryExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.argument, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::IfExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.cond, &f);
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.then_val.body {
                control = dfs_mut_body_item(body_item, &f);
                if control.is_break() {
                    return control;
                }
            }
            for else_if in &mut node.else_ifs {
                control = dfs_mut_expr(&mut else_if.cond, &f);
                if control.is_break() {
                    return control;
                }
                for body_item in &mut else_if.then_val.body {
                    control = dfs_mut_body_item(body_item, &f);
                    if control.is_break() {
                        return control;
                    }
                }
            }
        }
        ast::Expr::LabelledExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::AscribedExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::Expr::SketchBlock(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, &f);
                if control.is_break() {
                    return control;
                }
            }
            for body_item in &mut node.body.items {
                control = dfs_mut_body_item(body_item, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::Expr::SketchVar(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::Expr::None(_) => {}
    }
    control
}

fn dfs_mut_binary_part<B, C, F>(binary_part: &mut ast::BinaryPart, f: F) -> ControlFlow<B, C>
where
    F: Fn(NodeMut) -> ControlFlow<B, C>,
{
    let node = NodeMut::from(&mut *binary_part);
    let mut control = f(node);
    if control.is_break() {
        return control;
    }
    match binary_part {
        ast::BinaryPart::Literal(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::BinaryPart::Name(node) => {
            control = f(NodeMut::from(&mut **node));
        }
        ast::BinaryPart::BinaryExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.left, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.right, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::CallExpressionKw(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                control = dfs_mut_expr(arg, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::UnaryExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_binary_part(&mut node.argument, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::MemberExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.object, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.property, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::ArrayExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for expr in &mut node.elements {
                control = dfs_mut_expr(expr, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.start_element, &f);
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.end_element, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::ObjectExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            for property in &mut node.properties {
                control = f(NodeMut::from(&mut property.key));
                if control.is_break() {
                    return control;
                }
                control = dfs_mut_expr(&mut property.value, &f);
                if control.is_break() {
                    return control;
                }
            }
        }
        ast::BinaryPart::IfExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.cond, &f);
            if control.is_break() {
                return control;
            }
            for body_item in &mut node.then_val.body {
                control = dfs_mut_body_item(body_item, &f);
                if control.is_break() {
                    return control;
                }
            }
            for else_if in &mut node.else_ifs {
                control = dfs_mut_expr(&mut else_if.cond, &f);
                if control.is_break() {
                    return control;
                }
                for body_item in &mut else_if.then_val.body {
                    control = dfs_mut_body_item(body_item, &f);
                    if control.is_break() {
                        return control;
                    }
                }
            }
        }
        ast::BinaryPart::AscribedExpression(node) => {
            control = f(NodeMut::from(&mut **node));
            if control.is_break() {
                return control;
            }
            control = dfs_mut_expr(&mut node.expr, &f);
            if control.is_break() {
                return control;
            }
        }
        ast::BinaryPart::SketchVar(node) => {
            control = f(NodeMut::from(&mut **node));
        }
    }
    control
}
