//! Traversal of the AST. We couldn't use a mutable variation of
//! [`crate::walk::Visitable`] because we can't collect multiple mutable child
//! references.
use std::ops::ControlFlow;

use crate::parsing::ast::types as ast;
use crate::walk::NodeMut;

pub(super) struct TraversalReturn<B, C = ()> {
    pub mutate_body_item: MutateBodyItem,
    pub control_flow: ControlFlow<B, C>,
}

#[derive(Default)]
pub(super) enum MutateBodyItem {
    #[default]
    None,
    Mutate(Box<ast::BodyItem>),
    Delete,
}

impl MutateBodyItem {
    fn take(&mut self) -> Self {
        std::mem::take(self)
    }
}

pub(super) trait Visitor {
    type Break;
    type Continue;

    /// Called when encountering a node for the first time, before its children.
    fn visit(&mut self, node: NodeMut) -> TraversalReturn<Self::Break, Self::Continue>;

    /// Called after all children of the node have been visited and the
    /// traversal has completed this subtree.
    fn finish(&mut self, node: NodeMut);
}

impl<B, C> TraversalReturn<B, C> {
    pub fn new_break(b: B) -> Self {
        TraversalReturn {
            mutate_body_item: MutateBodyItem::None,
            control_flow: ControlFlow::Break(b),
        }
    }

    pub fn new_continue(c: C) -> Self {
        TraversalReturn {
            mutate_body_item: MutateBodyItem::None,
            control_flow: ControlFlow::Continue(c),
        }
    }

    pub fn is_break(&self) -> bool {
        self.control_flow.is_break()
    }

    pub fn map_break<D>(self, f: impl FnOnce(B) -> D) -> TraversalReturn<D, C> {
        let control_flow = self.control_flow.map_break(f);
        TraversalReturn {
            mutate_body_item: self.mutate_body_item,
            control_flow,
        }
    }
}

/// Pre-order DFS traversal of the AST, applying `f` to each node. If `f`
/// returns `ControlFlow::Break`, the traversal is stopped and the `ControlFlow`
/// value is returned.
pub(super) fn dfs_mut<V: Visitor>(
    program: &mut ast::Node<ast::Program>,
    visitor: &mut V,
) -> ControlFlow<V::Break, V::Continue> {
    let node = NodeMut::from(&mut *program);
    let mut ret = visitor.visit(node);
    if ret.is_break() {
        return ret.control_flow;
    }
    let mut remove_index = None;
    for (i, body_item) in program.body.iter_mut().enumerate() {
        ret = dfs_mut_body_item(body_item, visitor);
        match ret.mutate_body_item.take() {
            MutateBodyItem::None => {}
            MutateBodyItem::Mutate(new_body_item) => {
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                *body_item = *new_body_item;
            }
            MutateBodyItem::Delete => remove_index = Some(i),
        }
        if ret.is_break() {
            break;
        }
    }
    if let Some(index) = remove_index {
        let inner = &mut program.inner;
        delete_body_item_preserving_pre_comments(&mut inner.body, &mut inner.non_code_meta, index);
    }
    if ret.is_break() {
        return ret.control_flow;
    }
    let node = NodeMut::from(&mut *program);
    visitor.finish(node);

    ret.control_flow
}

fn dfs_mut_body_item<V: Visitor>(
    body_item: &mut ast::BodyItem,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    let node = NodeMut::from(&mut *body_item);
    let mut ret = visitor.visit(node);
    if ret.is_break() {
        return ret;
    }
    match body_item {
        ast::BodyItem::ImportStatement(_) => {}
        ast::BodyItem::ExpressionStatement(node) => {
            ret = dfs_mut_expr(&mut node.expression, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BodyItem::VariableDeclaration(node) => {
            ret = dfs_mut_expr(&mut node.declaration.init, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            ret = dfs_mut_expr(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
    }
    ret
}

fn dfs_mut_expr<V: Visitor>(expr: &mut ast::Expr, visitor: &mut V) -> TraversalReturn<V::Break, V::Continue> {
    let node = NodeMut::from(&mut *expr);
    let mut ret = visitor.visit(node);
    if ret.is_break() {
        return ret;
    }
    match expr {
        ast::Expr::Literal(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::Expr::Name(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::Expr::TagDeclarator(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::Expr::BinaryExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.left, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.right, visitor);
            if ret.is_break() {
                return ret;
            }
            let node = NodeMut::from(&mut **node);
            visitor.finish(node);
        }
        ast::Expr::FunctionExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for body_item in &mut node.body.body {
                ret = dfs_mut_body_item(body_item, visitor);
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                // TODO: sketch-api: handle MutateBodyItem::Delete.
                if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                    *body_item = *new_body_item;
                }
                if ret.is_break() {
                    return ret;
                }
            }
            let node = NodeMut::from(&mut **node);
            visitor.finish(node);
        }
        ast::Expr::CallExpressionKw(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::PipeExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for expr in &mut node.body {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::PipeSubstitution(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::Expr::ArrayExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for expr in &mut node.elements {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::ArrayRangeExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.start_element, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.end_element, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::ObjectExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for property in &mut node.properties {
                ret = visitor.visit(NodeMut::from(&mut property.key));
                if ret.is_break() {
                    return ret;
                }
                ret = dfs_mut_expr(&mut property.value, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::MemberExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.object, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.property, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::UnaryExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::IfExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.cond, visitor);
            if ret.is_break() {
                return ret;
            }
            visitor.visit(NodeMut::from(&mut *node.then_val));
            for body_item in &mut node.then_val.body {
                ret = dfs_mut_body_item(body_item, visitor);
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                // TODO: sketch-api: handle MutateBodyItem::Delete.
                if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                    *body_item = *new_body_item;
                }
                if ret.is_break() {
                    return ret;
                }
            }
            visitor.finish(NodeMut::from(&mut *node.then_val));
            for else_if in &mut node.else_ifs {
                ret = dfs_mut_expr(&mut else_if.cond, visitor);
                if ret.is_break() {
                    return ret;
                }
                visitor.visit(NodeMut::from(&mut *else_if.then_val));
                for body_item in &mut else_if.then_val.body {
                    ret = dfs_mut_body_item(body_item, visitor);
                    // Allow the function to mutate the body item to a different
                    // variant of the enum.
                    // TODO: sketch-api: handle MutateBodyItem::Delete.
                    if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                        *body_item = *new_body_item;
                    }
                    if ret.is_break() {
                        return ret;
                    }
                }
                visitor.finish(NodeMut::from(&mut *else_if.then_val));
            }
            visitor.visit(NodeMut::from(&mut *node.final_else));
            for body_item in &mut node.final_else.body {
                ret = dfs_mut_body_item(body_item, visitor);
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                // TODO: sketch-api: handle MutateBodyItem::Delete.
                if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                    *body_item = *new_body_item;
                }
                if ret.is_break() {
                    return ret;
                }
            }
            visitor.finish(NodeMut::from(&mut *node.final_else));
        }
        ast::Expr::LabelledExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::AscribedExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::SketchBlock(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
            let mut remove_index = None;
            for (i, body_item) in node.body.items.iter_mut().enumerate() {
                ret = dfs_mut_body_item(body_item, visitor);
                match ret.mutate_body_item.take() {
                    MutateBodyItem::None => {}
                    MutateBodyItem::Mutate(new_body_item) => {
                        // Allow the function to mutate the body item to a different
                        // variant of the enum.
                        *body_item = *new_body_item;
                    }
                    MutateBodyItem::Delete => remove_index = Some(i),
                }
                if ret.is_break() {
                    break;
                }
            }
            if let Some(index) = remove_index {
                let block = &mut node.body.inner;
                delete_body_item_preserving_pre_comments(&mut block.items, &mut block.non_code_meta, index);
            }
            if ret.is_break() {
                return ret;
            }
            let node = NodeMut::from(&mut **node);
            visitor.finish(node);
        }
        ast::Expr::SketchVar(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            if let Some(initial) = &mut node.initial {
                ret = dfs_mut_expr(initial, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::None(_) => {}
    }
    ret
}

fn dfs_mut_binary_part<V: Visitor>(
    binary_part: &mut ast::BinaryPart,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    let node = NodeMut::from(&mut *binary_part);
    let mut ret = visitor.visit(node);
    if ret.is_break() {
        return ret;
    }
    match binary_part {
        ast::BinaryPart::Literal(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::BinaryPart::Name(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
        ast::BinaryPart::BinaryExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.left, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.right, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::CallExpressionKw(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::BinaryPart::UnaryExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::MemberExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.object, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.property, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::ArrayExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for expr in &mut node.elements {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.start_element, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.end_element, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::ObjectExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            for property in &mut node.properties {
                ret = visitor.visit(NodeMut::from(&mut property.key));
                if ret.is_break() {
                    return ret;
                }
                ret = dfs_mut_expr(&mut property.value, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::BinaryPart::IfExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.cond, visitor);
            if ret.is_break() {
                return ret;
            }
            visitor.visit(NodeMut::from(&mut *node.then_val));
            for body_item in &mut node.then_val.body {
                ret = dfs_mut_body_item(body_item, visitor);
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                // TODO: sketch-api: handle MutateBodyItem::Delete.
                if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                    *body_item = *new_body_item;
                }
                if ret.is_break() {
                    return ret;
                }
            }
            visitor.finish(NodeMut::from(&mut *node.then_val));
            for else_if in &mut node.else_ifs {
                ret = dfs_mut_expr(&mut else_if.cond, visitor);
                if ret.is_break() {
                    return ret;
                }
                visitor.visit(NodeMut::from(&mut *else_if.then_val));
                for body_item in &mut else_if.then_val.body {
                    ret = dfs_mut_body_item(body_item, visitor);
                    // Allow the function to mutate the body item to a different
                    // variant of the enum.
                    // TODO: sketch-api: handle MutateBodyItem::Delete.
                    if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                        *body_item = *new_body_item;
                    }
                    if ret.is_break() {
                        return ret;
                    }
                }
                visitor.finish(NodeMut::from(&mut *else_if.then_val));
            }
            visitor.visit(NodeMut::from(&mut *node.final_else));
            for body_item in &mut node.final_else.body {
                ret = dfs_mut_body_item(body_item, visitor);
                // Allow the function to mutate the body item to a different
                // variant of the enum.
                // TODO: sketch-api: handle MutateBodyItem::Delete.
                if let MutateBodyItem::Mutate(new_body_item) = ret.mutate_body_item.take() {
                    *body_item = *new_body_item;
                }
                if ret.is_break() {
                    return ret;
                }
            }
            visitor.finish(NodeMut::from(&mut *node.final_else));
        }
        ast::BinaryPart::AscribedExpression(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::SketchVar(node) => {
            ret = visitor.visit(NodeMut::from(&mut **node));
        }
    }
    ret
}

/// Remove `body[index]` while preserving any line comments on the line(s)
/// immediately above it. Comments stored as `pre_comments` on the deleted body
/// item are migrated either to the next body item's `pre_comments` (if any), or
/// converted into [`ast::NonCodeNode`]s and inserted into `non_code_meta`.
///
/// Comments nested inside the deleted body item's expression, or inline on the
/// same line, are still discarded along with the deleted code.
pub(super) fn delete_body_item_preserving_pre_comments(
    body: &mut Vec<ast::BodyItem>,
    non_code_meta: &mut ast::NonCodeMeta,
    index: usize,
) {
    let removed = body.remove(index);

    // Migrate the deleted item's leading line comments.
    let pre_comments = removed.get_comments();
    let removed_comment_start = removed.comment_range().0;
    let leftover_pre_comment_nodes = if pre_comments.is_empty() {
        Vec::new()
    } else if let Some(next) = body.get_mut(index) {
        let mut combined = pre_comments.to_vec();
        combined.extend(next.get_comments().iter().cloned());
        next.set_comments(combined, removed_comment_start);
        Vec::new()
    } else {
        pre_comments_to_non_code_nodes(pre_comments)
    };

    // Re-key non_code_nodes so that entries originally tied to body items
    // beyond the deleted index slot into the correct position. Entries that
    // were tied to the deleted item itself (i.e. textually after it) are kept
    // unless they were inline same-line comments, which belong to the deleted
    // line and should be dropped.
    let old_nodes = std::mem::take(&mut non_code_meta.non_code_nodes);
    let mut new_nodes: std::collections::BTreeMap<usize, ast::NodeList<ast::NonCodeNode>> = Default::default();
    let mut after_deleted: ast::NodeList<ast::NonCodeNode> = Vec::new();
    for (k, v) in old_nodes {
        if k < index {
            new_nodes.insert(k, v);
        } else if k == index {
            after_deleted.extend(v.into_iter().filter(|n| !is_inline_comment(n)));
        } else {
            new_nodes.insert(k - 1, v);
        }
    }
    // The textual order is: original entries before the deleted item, then
    // entries originally after it, then the deleted item's pre_comments
    // (when there is no next body item to absorb them).
    let combined_after = {
        let mut v = after_deleted;
        v.extend(leftover_pre_comment_nodes);
        v
    };
    if !combined_after.is_empty() {
        if index == 0 {
            non_code_meta.start_nodes.extend(combined_after);
        } else {
            new_nodes.entry(index - 1).or_default().extend(combined_after);
        }
    }
    non_code_meta.non_code_nodes = new_nodes;
}

fn is_inline_comment(node: &ast::Node<ast::NonCodeNode>) -> bool {
    matches!(node.value, ast::NonCodeValue::InlineComment { .. })
}

/// Convert pre-rendered `pre_comments` strings (e.g. `"// foo"`,
/// `"/* foo */"`, or empty strings produced for blank-line markers) into
/// [`ast::NonCodeNode`] values suitable for placing in a [`ast::NonCodeMeta`].
fn pre_comments_to_non_code_nodes(comments: &[String]) -> Vec<ast::Node<ast::NonCodeNode>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < comments.len() {
        let raw = &comments[i];
        if raw.is_empty() {
            // The parser stores a blank line as two consecutive empty strings.
            // Collapse a pair into a single NewLine; tolerate a stray single
            // empty string by treating it as one as well.
            if matches!(comments.get(i + 1), Some(next) if next.is_empty()) {
                i += 2;
            } else {
                i += 1;
            }
            out.push(ast::Node::no_src(ast::NonCodeNode {
                value: ast::NonCodeValue::NewLine,
                digest: None,
            }));
            continue;
        }
        let trimmed = raw.trim_start();
        let (value, style) = if let Some(rest) = trimmed.strip_prefix("/*") {
            let body = rest.strip_suffix("*/").unwrap_or(rest).trim().to_string();
            (body, ast::CommentStyle::Block)
        } else if let Some(rest) = trimmed.strip_prefix("//") {
            (rest.trim().to_string(), ast::CommentStyle::Line)
        } else {
            // Unknown shape; treat as a raw line comment so the text isn't
            // lost.
            (trimmed.to_string(), ast::CommentStyle::Line)
        };
        out.push(ast::Node::no_src(ast::NonCodeNode {
            value: ast::NonCodeValue::BlockComment { value, style },
            digest: None,
        }));
        i += 1;
    }
    out
}
