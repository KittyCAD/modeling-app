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

    /// Called when entering a node, before any of its children. Each node in
    /// the traversal is visited exactly once.
    fn visit(&mut self, node: NodeMut) -> TraversalReturn<Self::Break, Self::Continue>;

    /// Called when leaving a node, after all of its children have been
    /// visited. This is paired with [`Visitor::visit`] so that state can be
    /// set up when entering a node and torn down when leaving it.
    ///
    /// If the traversal stops early due to a `ControlFlow::Break`, it aborts
    /// immediately, and `finish` is not called for the node that broke or for
    /// any nodes that were entered but not yet left.
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

/// DFS traversal of the AST. Each node is visited exactly once with
/// [`Visitor::visit`], pre-order, before its children, and
/// [`Visitor::finish`] is called on it, post-order, after all of its children
/// have been visited. If `visit` returns `ControlFlow::Break`, the traversal
/// is stopped immediately and the `ControlFlow` value is returned.
///
/// A [`MutateBodyItem`] returned from `visit` applies to the nearest
/// enclosing body item.
pub(super) fn dfs_mut<V: Visitor>(
    program: &mut ast::Node<ast::Program>,
    visitor: &mut V,
) -> ControlFlow<V::Break, V::Continue> {
    dfs_mut_program(program, visitor).control_flow
}

/// Traverse a program node: visit it, traverse its body items, then finish
/// it.
fn dfs_mut_program<V: Visitor>(
    program: &mut ast::Node<ast::Program>,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    let mut ret = visitor.visit(NodeMut::from(&mut *program));
    if ret.is_break() {
        return ret;
    }
    // A body item mutation returned from visiting the program node itself is
    // meaningless since a program is not a body item. Drop it rather than
    // letting it escape to an enclosing body item.
    ret.mutate_body_item = MutateBodyItem::None;
    let inner = &mut program.inner;
    ret = dfs_mut_body(&mut inner.body, &mut inner.non_code_meta, visitor, ret);
    if ret.is_break() {
        return ret;
    }
    visitor.finish(NodeMut::from(&mut *program));
    ret
}

/// Traverse the body items of a block, applying any body item mutations
/// requested by the visitor. `ret` is the traversal state to return when the
/// body is empty.
fn dfs_mut_body<V: Visitor>(
    body: &mut Vec<ast::BodyItem>,
    non_code_meta: &mut ast::NonCodeMeta,
    visitor: &mut V,
    mut ret: TraversalReturn<V::Break, V::Continue>,
) -> TraversalReturn<V::Break, V::Continue> {
    let mut remove_index = None;
    for (i, body_item) in body.iter_mut().enumerate() {
        ret = dfs_mut_body_item(body_item, visitor);
        match ret.mutate_body_item.take() {
            MutateBodyItem::None => {}
            MutateBodyItem::Mutate(new_body_item) => {
                // Allow the visitor to mutate the body item to a different
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
        delete_body_item_preserving_pre_comments(body, non_code_meta, index);
    }
    ret
}

fn dfs_mut_body_item<V: Visitor>(
    body_item: &mut ast::BodyItem,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    let mut ret = visitor.visit(NodeMut::from(&mut *body_item));
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
        // This traversal descends into expressions, and a type declaration holds
        // none: an alias holds a `Type`, and enum variants are identifiers. The
        // visitor has already seen the statement itself above. `crate::walk` is the
        // traversal that reaches variants, and it does.
        ast::BodyItem::TypeDeclaration(_) => {}
        ast::BodyItem::ReturnStatement(node) => {
            ret = dfs_mut_expr(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
    }
    visitor.finish(NodeMut::from(&mut *body_item));
    ret
}

fn dfs_mut_expr<V: Visitor>(expr: &mut ast::Expr, visitor: &mut V) -> TraversalReturn<V::Break, V::Continue> {
    // Note: This conversion dispatches to the node inside the enum variant,
    // e.g. an `Expr::Literal` is visited as a `NodeMut::Literal`.
    let mut ret = visitor.visit(NodeMut::from(&mut *expr));
    if ret.is_break() {
        return ret;
    }
    match expr {
        // Leaf nodes with no children to traverse.
        ast::Expr::Literal(_)
        | ast::Expr::Name(_)
        | ast::Expr::TagDeclarator(_)
        | ast::Expr::PipeSubstitution(_)
        | ast::Expr::None(_) => {}
        ast::Expr::BinaryExpression(node) => {
            ret = dfs_mut_binary_part(&mut node.left, visitor);
            if ret.is_break() {
                return ret;
            }
            ret = dfs_mut_binary_part(&mut node.right, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::FunctionExpression(node) => {
            let body = &mut node.body.inner;
            ret = dfs_mut_body(&mut body.body, &mut body.non_code_meta, visitor, ret);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::CallExpressionKw(node) => {
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::PipeExpression(node) => {
            for expr in &mut node.body {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::ArrayExpression(node) => {
            for expr in &mut node.elements {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::Expr::ArrayRangeExpression(node) => {
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
            ret = dfs_mut_object_properties(&mut node.properties, visitor, ret);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::MemberExpression(node) => {
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
            ret = dfs_mut_binary_part(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::IfExpression(node) => {
            ret = dfs_mut_if_expression(node, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::LabelledExpression(node) => {
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::AscribedExpression(node) => {
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::SketchBlock(node) => {
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
            let block = &mut node.body.inner;
            ret = dfs_mut_body(&mut block.items, &mut block.non_code_meta, visitor, ret);
            if ret.is_break() {
                return ret;
            }
        }
        ast::Expr::SketchVar(node) => {
            if let Some(initial) = &mut node.initial {
                ret = visitor.visit(NodeMut::from(&mut **initial));
                if ret.is_break() {
                    return ret;
                }
                visitor.finish(NodeMut::from(&mut **initial));
            }
        }
    }
    visitor.finish(NodeMut::from(&mut *expr));
    ret
}

fn dfs_mut_binary_part<V: Visitor>(
    binary_part: &mut ast::BinaryPart,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    // Note: This conversion dispatches to the node inside the enum variant,
    // e.g. a `BinaryPart::Literal` is visited as a `NodeMut::Literal`.
    let mut ret = visitor.visit(NodeMut::from(&mut *binary_part));
    if ret.is_break() {
        return ret;
    }
    match binary_part {
        // Leaf nodes with no children to traverse.
        ast::BinaryPart::Literal(_) | ast::BinaryPart::Name(_) | ast::BinaryPart::SketchVar(_) => {}
        ast::BinaryPart::BinaryExpression(node) => {
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
            for (_, arg) in &mut node.iter_arguments_mut() {
                ret = dfs_mut_expr(arg, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::BinaryPart::UnaryExpression(node) => {
            ret = dfs_mut_binary_part(&mut node.argument, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::MemberExpression(node) => {
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
            for expr in &mut node.elements {
                ret = dfs_mut_expr(expr, visitor);
                if ret.is_break() {
                    return ret;
                }
            }
        }
        ast::BinaryPart::ArrayRangeExpression(node) => {
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
            ret = dfs_mut_object_properties(&mut node.properties, visitor, ret);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::IfExpression(node) => {
            ret = dfs_mut_if_expression(node, visitor);
            if ret.is_break() {
                return ret;
            }
        }
        ast::BinaryPart::AscribedExpression(node) => {
            ret = dfs_mut_expr(&mut node.expr, visitor);
            if ret.is_break() {
                return ret;
            }
        }
    }
    visitor.finish(NodeMut::from(&mut *binary_part));
    ret
}

/// Traverse the children of an if-expression: its condition and each branch
/// block. The if-expression node itself has already been visited by the
/// caller.
fn dfs_mut_if_expression<V: Visitor>(
    node: &mut ast::Node<ast::IfExpression>,
    visitor: &mut V,
) -> TraversalReturn<V::Break, V::Continue> {
    let mut ret = dfs_mut_expr(&mut node.cond, visitor);
    if ret.is_break() {
        return ret;
    }
    ret = dfs_mut_program(&mut node.then_val, visitor);
    if ret.is_break() {
        return ret;
    }
    for else_if in &mut node.else_ifs {
        ret = dfs_mut_expr(&mut else_if.cond, visitor);
        if ret.is_break() {
            return ret;
        }
        ret = dfs_mut_program(&mut else_if.then_val, visitor);
        if ret.is_break() {
            return ret;
        }
    }
    dfs_mut_program(&mut node.final_else, visitor)
}

/// Traverse the properties of an object expression. Each property's key is a
/// leaf; its value is a full expression. `ret` is the traversal state to
/// return when there are no properties.
fn dfs_mut_object_properties<V: Visitor>(
    properties: &mut [ast::Node<ast::ObjectProperty>],
    visitor: &mut V,
    mut ret: TraversalReturn<V::Break, V::Continue>,
) -> TraversalReturn<V::Break, V::Continue> {
    for property in properties {
        ret = visitor.visit(NodeMut::from(&mut property.key));
        if ret.is_break() {
            return ret;
        }
        visitor.finish(NodeMut::from(&mut property.key));
        ret = dfs_mut_expr(&mut property.value, visitor);
        if ret.is_break() {
            return ret;
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
