use serde::Serialize;

#[cfg(feature = "artifact-graph")]
use super::BinaryPart;
#[cfg(feature = "artifact-graph")]
use super::BodyItem;
#[cfg(feature = "artifact-graph")]
use super::Expr;
#[cfg(feature = "artifact-graph")]
use crate::SourceRange;
#[cfg(feature = "artifact-graph")]
use crate::execution::ProgramLookup;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Node;
#[cfg(feature = "artifact-graph")]
use crate::parsing::ast::types::Program;

/// A traversal path through the AST to a node.
///
/// Similar to the idea of a `NodeId`, a `NodePath` uniquely identifies a node,
/// assuming you know the root node.
///
/// The implementation doesn't cover all parts of the tree. It currently only
/// works on parts of the tree that the frontend uses.
#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[ts(export_to = "NodePath.ts")]
pub struct NodePath {
    pub steps: Vec<Step>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq, Hash, ts_rs::TS)]
#[ts(export_to = "NodePath.ts")]
#[serde(tag = "type")]
pub enum Step {
    ProgramBodyItem { index: usize },
    CallCallee,
    CallArg { index: usize },
    CallKwCallee,
    CallKwUnlabeledArg,
    CallKwArg { index: usize },
    BinaryLeft,
    BinaryRight,
    UnaryArg,
    PipeBodyItem { index: usize },
    ArrayElement { index: usize },
    ArrayRangeStart,
    ArrayRangeEnd,
    ObjectProperty { index: usize },
    ObjectPropertyKey,
    ObjectPropertyValue,
    ExpressionStatementExpr,
    VariableDeclarationDeclaration,
    VariableDeclarationInit,
    FunctionExpressionName,
    FunctionExpressionParam { index: usize },
    FunctionExpressionBody,
    FunctionExpressionBodyItem { index: usize },
    ReturnStatementArg,
    MemberExpressionObject,
    MemberExpressionProperty,
    IfExpressionCondition,
    IfExpressionThen,
    IfExpressionElseIf { index: usize },
    IfExpressionElseIfCond,
    IfExpressionElseIfBody,
    IfExpressionElse,
    ImportStatementItem { index: usize },
    ImportStatementItemName,
    ImportStatementItemAlias,
    LabeledExpressionExpr,
    LabeledExpressionLabel,
    AscribedExpressionExpr,
    SketchBlockArgs,
    SketchBlockBody,
    SketchBlockBodyItem { index: usize },
    SketchVar,
}

impl NodePath {
    /// Placeholder for when the AST isn't available to create a real path.  It
    /// will be filled in later.
    pub(crate) fn placeholder() -> Self {
        Self::default()
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn fill_placeholder(&mut self, programs: &ProgramLookup, cached_body_items: usize, range: SourceRange) {
        if !self.is_empty() {
            return;
        }
        *self = Self::from_range(programs, cached_body_items, range).unwrap_or_default();
    }

    /// Given a program and a [`SourceRange`], return the path to the node that
    /// contains the range.
    #[cfg(feature = "artifact-graph")]
    pub(crate) fn from_range(
        programs: &crate::execution::ProgramLookup,
        cached_body_items: usize,
        range: SourceRange,
    ) -> Option<Self> {
        let program = programs.program_for_module(range.module_id())?;
        Self::from_body(&program.body, cached_body_items, range, NodePath::default())
    }

    #[cfg(feature = "artifact-graph")]
    fn from_body(
        body: &[BodyItem],
        cached_body_items: usize,
        range: SourceRange,
        mut path: NodePath,
    ) -> Option<NodePath> {
        for (i, item) in body.iter().enumerate() {
            if item.contains_range(&range) {
                path.push(Step::ProgramBodyItem {
                    index: cached_body_items + i,
                });
                return Self::from_body_item(item, range, path);
            }
        }

        None
    }

    #[cfg(feature = "artifact-graph")]
    fn from_body_item(body_item: &BodyItem, range: SourceRange, mut path: NodePath) -> Option<NodePath> {
        match body_item {
            BodyItem::ImportStatement(node) => match &node.selector {
                super::ImportSelector::List { items } => {
                    for (i, item) in items.iter().enumerate() {
                        if item.contains_range(&range) {
                            path.push(Step::ImportStatementItem { index: i });
                            if item.name.contains_range(&range) {
                                path.push(Step::ImportStatementItemName);
                                return Some(path);
                            }
                            if let Some(alias) = &item.alias
                                && alias.contains_range(&range)
                            {
                                path.push(Step::ImportStatementItemAlias);
                                return Some(path);
                            }
                            return Some(path);
                        }
                    }
                }
                super::ImportSelector::Glob(_) => {
                    // TODO: Handle glob imports.
                }
                super::ImportSelector::None { .. } => {
                    // TODO: Handle whole-module imports.
                }
            },
            BodyItem::ExpressionStatement(node) => {
                path.push(Step::ExpressionStatementExpr);
                return Self::from_expr(&node.expression, range, path);
            }
            BodyItem::VariableDeclaration(node) => {
                if node.declaration.contains_range(&range) {
                    path.push(Step::VariableDeclarationDeclaration);
                    if node.declaration.init.contains_range(&range) {
                        path.push(Step::VariableDeclarationInit);
                        return Self::from_expr(&node.declaration.init, range, path);
                    }
                }
            }
            BodyItem::TypeDeclaration(_) => {}
            BodyItem::ReturnStatement(node) => {
                if node.argument.contains_range(&range) {
                    path.push(Step::ReturnStatementArg);
                    return Self::from_expr(&node.argument, range, path);
                }
            }
        }

        Some(path)
    }

    #[cfg(feature = "artifact-graph")]
    fn from_expr(expr: &Expr, range: SourceRange, mut path: NodePath) -> Option<NodePath> {
        match expr {
            Expr::Literal(node) => {
                if node.contains_range(&range) {
                    return Some(path);
                }
            }
            Expr::Name(node) => {
                if node.contains_range(&range) {
                    return Some(path);
                }
            }
            Expr::TagDeclarator(node) => {
                if node.contains_range(&range) {
                    return Some(path);
                }
            }
            Expr::BinaryExpression(node) => {
                let left = Expr::from(&node.left);
                if left.contains_range(&range) {
                    path.push(Step::BinaryLeft);
                    return Self::from_expr(&left, range, path);
                }
                let right = Expr::from(&node.right);
                if right.contains_range(&range) {
                    path.push(Step::BinaryRight);
                    return Self::from_expr(&right, range, path);
                }
            }
            Expr::FunctionExpression(node) => {
                if let Some(name) = &node.name
                    && name.contains_range(&range)
                {
                    path.push(Step::FunctionExpressionName);
                    return Some(path);
                }
                for (i, param) in node.params.iter().enumerate() {
                    // TODO: Check the type annotation and default value.
                    if param.contains_range(&range) {
                        path.push(Step::FunctionExpressionParam { index: i });
                        return Some(path);
                    }
                }
                if node.body.contains_range(&range) {
                    path.push(Step::FunctionExpressionBody);
                    for (i, item) in node.body.body.iter().enumerate() {
                        if item.contains_range(&range) {
                            path.push(Step::FunctionExpressionBodyItem { index: i });
                            return Self::from_body_item(item, range, path);
                        }
                    }
                }
            }
            Expr::CallExpressionKw(node) => {
                if node.callee.contains_range(&range) {
                    path.push(Step::CallKwCallee);
                    return Some(path);
                }
                if let Some(unlabeled) = &node.unlabeled
                    && unlabeled.contains_range(&range)
                {
                    path.push(Step::CallKwUnlabeledArg);
                    return Self::from_expr(unlabeled, range, path);
                }
                for (i, arg) in node.arguments.iter().enumerate() {
                    if arg.arg.contains_range(&range) {
                        path.push(Step::CallKwArg { index: i });
                        return Self::from_expr(&arg.arg, range, path);
                    }
                }
            }
            Expr::PipeExpression(node) => {
                for (i, expr) in node.body.iter().enumerate() {
                    if expr.contains_range(&range) {
                        path.push(Step::PipeBodyItem { index: i });
                        return Self::from_expr(expr, range, path);
                    }
                }
            }
            Expr::PipeSubstitution(_) => {}
            Expr::ArrayExpression(node) => {
                for (i, element) in node.elements.iter().enumerate() {
                    if element.contains_range(&range) {
                        path.push(Step::ArrayElement { index: i });
                        return Self::from_expr(element, range, path);
                    }
                }
            }
            Expr::ArrayRangeExpression(node) => {
                if node.start_element.contains_range(&range) {
                    path.push(Step::ArrayRangeStart);
                    return Self::from_expr(&node.start_element, range, path);
                }
                if node.end_element.contains_range(&range) {
                    path.push(Step::ArrayRangeEnd);
                    return Self::from_expr(&node.end_element, range, path);
                }
            }
            Expr::ObjectExpression(node) => {
                for (i, property) in node.properties.iter().enumerate() {
                    if property.contains_range(&range) {
                        path.push(Step::ObjectProperty { index: i });
                        if property.key.contains_range(&range) {
                            path.push(Step::ObjectPropertyKey);
                            return Some(path);
                        }
                        if property.value.contains_range(&range) {
                            path.push(Step::ObjectPropertyValue);
                            return Self::from_expr(&property.value, range, path);
                        }
                        return Some(path);
                    }
                }
            }
            Expr::MemberExpression(node) => {
                if node.object.contains_range(&range) {
                    path.push(Step::MemberExpressionObject);
                    return NodePath::from_expr(&node.object, range, path);
                }
                if node.property.contains_range(&range) {
                    path.push(Step::MemberExpressionProperty);
                    return NodePath::from_expr(&node.property, range, path);
                }
            }
            Expr::UnaryExpression(node) => {
                let arg = Expr::from(&node.argument);
                if arg.contains_range(&range) {
                    path.push(Step::UnaryArg);
                    return Self::from_expr(&arg, range, path);
                }
            }
            Expr::IfExpression(node) => {
                if node.cond.contains_range(&range) {
                    path.push(Step::IfExpressionCondition);
                    return Self::from_expr(&node.cond, range, path);
                }
                if node.then_val.contains_range(&range) {
                    path.push(Step::IfExpressionThen);
                    return Self::from_body(&node.then_val.body, 0, range, path);
                }
                for (i, else_if) in node.else_ifs.iter().enumerate() {
                    if else_if.contains_range(&range) {
                        path.push(Step::IfExpressionElseIf { index: i });
                        if else_if.cond.contains_range(&range) {
                            path.push(Step::IfExpressionElseIfCond);
                            return Self::from_expr(&else_if.cond, range, path);
                        }
                        if else_if.then_val.contains_range(&range) {
                            path.push(Step::IfExpressionElseIfBody);
                            return Self::from_body(&else_if.then_val.body, 0, range, path);
                        }
                        return Some(path);
                    }
                }
                if node.final_else.contains_range(&range) {
                    path.push(Step::IfExpressionElse);
                    return Self::from_body(&node.final_else.body, 0, range, path);
                }
            }
            Expr::LabelledExpression(node) => {
                if node.expr.contains_range(&range) {
                    path.push(Step::LabeledExpressionExpr);
                    return Self::from_expr(&node.expr, range, path);
                }
                if node.label.contains_range(&range) {
                    path.push(Step::LabeledExpressionLabel);
                    return Some(path);
                }
            }
            Expr::AscribedExpression(node) => {
                if node.expr.contains_range(&range) {
                    path.push(Step::AscribedExpressionExpr);
                    return Self::from_expr(&node.expr, range, path);
                }
                // TODO: Check the type annotation.
            }
            Expr::SketchBlock(node) => {
                if node.iter_arguments().any(|(label, arg)| {
                    label.map(|label| label.contains_range(&range)).unwrap_or(false) || arg.contains_range(&range)
                }) {
                    path.push(Step::SketchBlockArgs);
                    // TODO: Should we dig deeper into the arguments?
                    return Some(path);
                }
                if node.body.contains_range(&range) {
                    path.push(Step::SketchBlockBody);
                    for (i, item) in node.body.items.iter().enumerate() {
                        if item.contains_range(&range) {
                            path.push(Step::SketchBlockBodyItem { index: i });
                            return Self::from_body_item(item, range, path);
                        }
                    }
                    return Some(path);
                }
            }
            Expr::SketchVar(node) => {
                if node.contains_range(&range) {
                    path.push(Step::SketchVar);
                    return Some(path);
                }
            }
            Expr::None(_) => {}
        }

        Some(path)
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    #[cfg(feature = "artifact-graph")]
    fn push(&mut self, step: Step) {
        self.steps.push(step);
    }
}

/// Given a program and a [`SourceRange`], return the path to the node that
/// contains the range.
#[cfg(feature = "artifact-graph")]
pub(crate) fn fill_node_paths(program: &mut Node<Program>) {
    for (i, item) in program.body.iter_mut().enumerate() {
        let mut path = NodePath::default();
        path.push(Step::ProgramBodyItem { index: i });
        fill_node_paths_body_item(item, path);
    }
}

#[cfg(feature = "artifact-graph")]
fn fill_node_paths_body_item(item: &mut BodyItem, mut path: NodePath) {
    match item {
        BodyItem::ImportStatement(node) => {
            node.node_path = Some(path);
            // TODO: Traverse imports.
        }
        BodyItem::ExpressionStatement(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::ExpressionStatementExpr);
            fill_node_paths_expr(&mut node.expression, path);
        }
        BodyItem::VariableDeclaration(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::VariableDeclarationDeclaration);
            node.declaration.node_path = Some(path.clone());
            path.push(Step::VariableDeclarationInit);
            fill_node_paths_expr(&mut node.declaration.init, path);
        }
        BodyItem::TypeDeclaration(node) => {
            node.node_path = Some(path);
        }
        BodyItem::ReturnStatement(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::ReturnStatementArg);
            fill_node_paths_expr(&mut node.argument, path);
        }
    }
}

#[cfg(feature = "artifact-graph")]
fn fill_node_paths_expr(expr: &mut Expr, mut path: NodePath) {
    match expr {
        Expr::Literal(node) => {
            node.node_path = Some(path);
        }
        Expr::Name(node) => {
            node.node_path = Some(path);
        }
        Expr::TagDeclarator(node) => {
            node.node_path = Some(path);
        }
        Expr::BinaryExpression(node) => {
            node.node_path = Some(path.clone());
            let mut left_path = path.clone();
            left_path.push(Step::BinaryLeft);
            fill_node_paths_binary_part(&mut node.left, left_path);
            path.push(Step::BinaryRight);
            fill_node_paths_binary_part(&mut node.right, path);
        }
        Expr::FunctionExpression(node) => {
            node.node_path = Some(path.clone());
            if let Some(name) = &mut node.name {
                let mut name_path = path.clone();
                name_path.push(Step::FunctionExpressionName);
                name.node_path = Some(name_path);
            }
            for (i, param) in node.params.iter_mut().enumerate() {
                let mut param_path = path.clone();
                param_path.push(Step::FunctionExpressionParam { index: i });
                param.identifier.node_path = Some(param_path);
            }
            path.push(Step::FunctionExpressionBody);
            node.body.node_path = Some(path.clone());
            for (i, item) in node.body.body.iter_mut().enumerate() {
                let mut item_path = path.clone();
                item_path.push(Step::FunctionExpressionBodyItem { index: i });
                fill_node_paths_body_item(item, item_path);
            }
        }
        Expr::CallExpressionKw(node) => {
            node.node_path = Some(path.clone());
            let mut callee_path = path.clone();
            callee_path.push(Step::CallKwCallee);
            node.callee.node_path = Some(callee_path);
            if let Some(unlabeled) = &mut node.unlabeled {
                let mut unlabeled_path = path.clone();
                unlabeled_path.push(Step::CallKwUnlabeledArg);
                fill_node_paths_expr(unlabeled, unlabeled_path);
            }
            for (i, arg) in node.arguments.iter_mut().enumerate() {
                let mut arg_path = path.clone();
                arg_path.push(Step::CallKwArg { index: i });
                fill_node_paths_expr(&mut arg.arg, arg_path);
            }
        }
        Expr::PipeExpression(node) => {
            node.node_path = Some(path.clone());
            for (i, item) in node.body.iter_mut().enumerate() {
                let mut item_path = path.clone();
                item_path.push(Step::PipeBodyItem { index: i });
                fill_node_paths_expr(item, item_path);
            }
        }
        Expr::PipeSubstitution(node) => {
            node.node_path = Some(path);
        }
        Expr::ArrayExpression(node) => {
            node.node_path = Some(path.clone());
            for (i, element) in node.elements.iter_mut().enumerate() {
                let mut elem_path = path.clone();
                elem_path.push(Step::ArrayElement { index: i });
                fill_node_paths_expr(element, elem_path);
            }
        }
        Expr::ArrayRangeExpression(node) => {
            node.node_path = Some(path.clone());
            let mut start_path = path.clone();
            start_path.push(Step::ArrayRangeStart);
            fill_node_paths_expr(&mut node.start_element, start_path);
            path.push(Step::ArrayRangeEnd);
            fill_node_paths_expr(&mut node.end_element, path);
        }
        Expr::ObjectExpression(node) => {
            node.node_path = Some(path.clone());
            for (i, property) in node.properties.iter_mut().enumerate() {
                let mut prop_path = path.clone();
                prop_path.push(Step::ObjectProperty { index: i });
                property.node_path = Some(prop_path.clone());
                let mut key_path = prop_path.clone();
                key_path.push(Step::ObjectPropertyKey);
                property.key.node_path = Some(key_path);
                prop_path.push(Step::ObjectPropertyValue);
                fill_node_paths_expr(&mut property.value, prop_path);
            }
        }
        Expr::MemberExpression(node) => {
            node.node_path = Some(path.clone());
            let mut obj_path = path.clone();
            obj_path.push(Step::MemberExpressionObject);
            fill_node_paths_expr(&mut node.object, obj_path);
            path.push(Step::MemberExpressionProperty);
            fill_node_paths_expr(&mut node.property, path);
        }
        Expr::UnaryExpression(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::UnaryArg);
            fill_node_paths_binary_part(&mut node.argument, path);
        }
        Expr::IfExpression(node) => {
            node.node_path = Some(path.clone());
            let mut cond_path = path.clone();
            cond_path.push(Step::IfExpressionCondition);
            fill_node_paths_expr(&mut node.cond, cond_path);
            let mut then_path = path.clone();
            then_path.push(Step::IfExpressionThen);
            node.then_val.node_path = Some(then_path.clone());
            fill_node_paths_body(&mut node.then_val.body, then_path);
            for (i, else_if) in node.else_ifs.iter_mut().enumerate() {
                let mut else_if_path = path.clone();
                else_if_path.push(Step::IfExpressionElseIf { index: i });
                else_if.node_path = Some(else_if_path.clone());
                let mut cond_path = else_if_path.clone();
                cond_path.push(Step::IfExpressionElseIfCond);
                fill_node_paths_expr(&mut else_if.cond, cond_path);
                else_if_path.push(Step::IfExpressionElseIfBody);
                else_if.then_val.node_path = Some(else_if_path.clone());
                fill_node_paths_body(&mut else_if.then_val.body, else_if_path);
            }
            path.push(Step::IfExpressionElse);
            node.final_else.node_path = Some(path.clone());
            fill_node_paths_body(&mut node.final_else.body, path);
        }
        Expr::LabelledExpression(node) => {
            node.node_path = Some(path.clone());
            let mut expr_path = path.clone();
            expr_path.push(Step::LabeledExpressionExpr);
            fill_node_paths_expr(&mut node.expr, expr_path);
            path.push(Step::LabeledExpressionLabel);
            node.label.node_path = Some(path);
        }
        Expr::AscribedExpression(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::AscribedExpressionExpr);
            fill_node_paths_expr(&mut node.expr, path);
        }
        Expr::SketchBlock(node) => {
            node.node_path = Some(path.clone());
            for (label, arg) in node.iter_arguments_mut() {
                let mut path = path.clone();
                path.push(Step::SketchBlockArgs);
                if let Some(label) = label {
                    label.node_path = Some(path.clone());
                }
                fill_node_paths_expr(arg, path);
            }
            path.push(Step::SketchBlockBody);
            node.body.node_path = Some(path.clone());
            for (i, item) in node.body.items.iter_mut().enumerate() {
                let mut item_path = path.clone();
                item_path.push(Step::SketchBlockBodyItem { index: i });
                fill_node_paths_body_item(item, item_path);
            }
        }
        Expr::SketchVar(node) => {
            path.push(Step::SketchVar);
            node.node_path = Some(path);
        }
        Expr::None(node) => {
            node.node_path = Some(path);
        }
    }
}

#[cfg(feature = "artifact-graph")]
fn fill_node_paths_body(body: &mut [BodyItem], path: NodePath) {
    for (i, item) in body.iter_mut().enumerate() {
        let mut item_path = path.clone();
        item_path.push(Step::ProgramBodyItem { index: i });
        fill_node_paths_body_item(item, item_path);
    }
}

#[cfg(feature = "artifact-graph")]
fn fill_node_paths_binary_part(part: &mut BinaryPart, mut path: NodePath) {
    match part {
        BinaryPart::Literal(node) => {
            node.node_path = Some(path);
        }
        BinaryPart::Name(node) => {
            node.node_path = Some(path);
        }
        BinaryPart::BinaryExpression(node) => {
            node.node_path = Some(path.clone());
            let mut left_path = path.clone();
            left_path.push(Step::BinaryLeft);
            fill_node_paths_binary_part(&mut node.left, left_path);
            path.push(Step::BinaryRight);
            fill_node_paths_binary_part(&mut node.right, path);
        }
        BinaryPart::CallExpressionKw(node) => {
            node.node_path = Some(path.clone());
            let mut callee_path = path.clone();
            callee_path.push(Step::CallKwCallee);
            node.callee.node_path = Some(callee_path);
            if let Some(unlabeled) = &mut node.unlabeled {
                let mut unlabeled_path = path.clone();
                unlabeled_path.push(Step::CallKwUnlabeledArg);
                fill_node_paths_expr(unlabeled, unlabeled_path);
            }
            for (i, arg) in node.arguments.iter_mut().enumerate() {
                let mut arg_path = path.clone();
                arg_path.push(Step::CallKwArg { index: i });
                fill_node_paths_expr(&mut arg.arg, arg_path);
            }
        }
        BinaryPart::UnaryExpression(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::UnaryArg);
            fill_node_paths_binary_part(&mut node.argument, path);
        }
        BinaryPart::MemberExpression(node) => {
            node.node_path = Some(path.clone());
            let mut obj_path = path.clone();
            obj_path.push(Step::MemberExpressionObject);
            fill_node_paths_expr(&mut node.object, obj_path);
            path.push(Step::MemberExpressionProperty);
            fill_node_paths_expr(&mut node.property, path);
        }
        BinaryPart::ArrayExpression(node) => {
            node.node_path = Some(path.clone());
            for (i, element) in node.elements.iter_mut().enumerate() {
                let mut elem_path = path.clone();
                elem_path.push(Step::ArrayElement { index: i });
                fill_node_paths_expr(element, elem_path);
            }
        }
        BinaryPart::ArrayRangeExpression(node) => {
            node.node_path = Some(path.clone());
            let mut start_path = path.clone();
            start_path.push(Step::ArrayRangeStart);
            fill_node_paths_expr(&mut node.start_element, start_path);
            path.push(Step::ArrayRangeEnd);
            fill_node_paths_expr(&mut node.end_element, path);
        }
        BinaryPart::ObjectExpression(node) => {
            node.node_path = Some(path.clone());
            for (i, property) in node.properties.iter_mut().enumerate() {
                let mut prop_path = path.clone();
                prop_path.push(Step::ObjectProperty { index: i });
                property.node_path = Some(prop_path.clone());
                let mut key_path = prop_path.clone();
                key_path.push(Step::ObjectPropertyKey);
                property.key.node_path = Some(key_path);
                prop_path.push(Step::ObjectPropertyValue);
                fill_node_paths_expr(&mut property.value, prop_path);
            }
        }
        BinaryPart::IfExpression(node) => {
            node.node_path = Some(path.clone());
            let mut cond_path = path.clone();
            cond_path.push(Step::IfExpressionCondition);
            fill_node_paths_expr(&mut node.cond, cond_path);
            let mut then_path = path.clone();
            then_path.push(Step::IfExpressionThen);
            node.then_val.node_path = Some(then_path.clone());
            fill_node_paths_body(&mut node.then_val.body, then_path);
            for (i, else_if) in node.else_ifs.iter_mut().enumerate() {
                let mut else_if_path = path.clone();
                else_if_path.push(Step::IfExpressionElseIf { index: i });
                else_if.node_path = Some(else_if_path.clone());
                let mut cond_path = else_if_path.clone();
                cond_path.push(Step::IfExpressionElseIfCond);
                fill_node_paths_expr(&mut else_if.cond, cond_path);
                else_if_path.push(Step::IfExpressionElseIfBody);
                else_if.then_val.node_path = Some(else_if_path.clone());
                fill_node_paths_body(&mut else_if.then_val.body, else_if_path);
            }
            path.push(Step::IfExpressionElse);
            node.final_else.node_path = Some(path.clone());
            fill_node_paths_body(&mut node.final_else.body, path);
        }
        BinaryPart::AscribedExpression(node) => {
            node.node_path = Some(path.clone());
            path.push(Step::AscribedExpressionExpr);
            fill_node_paths_expr(&mut node.expr, path);
        }
        BinaryPart::SketchVar(node) => {
            path.push(Step::SketchVar);
            node.node_path = Some(path);
        }
    }
}

#[cfg(all(test, feature = "artifact-graph"))]
mod tests {
    use super::*;
    use crate::ModuleId;

    fn range(start: usize, end: usize) -> SourceRange {
        SourceRange::new(start, end, ModuleId::default())
    }

    #[test]
    fn test_node_path_from_range() {
        // Read the contents of the file.
        let contents = std::fs::read_to_string("tests/misc/cube.kcl").unwrap();
        let program = crate::Program::parse_no_errs(&contents).unwrap();
        let module_infos = indexmap::IndexMap::from([(
            ModuleId::default(),
            crate::modules::ModuleInfo {
                id: ModuleId::default(),
                path: crate::modules::ModulePath::Main,
                repr: crate::modules::ModuleRepr::Kcl(program.ast.clone(), None),
            },
        )]);
        let programs = crate::execution::ProgramLookup::new(program.ast, module_infos);

        // fn cube(sideLength, center) {
        //    ^^^^
        assert_eq!(
            NodePath::from_range(&programs, 0, range(38, 42)).unwrap(),
            NodePath {
                steps: vec![Step::ProgramBodyItem { index: 0 }, Step::VariableDeclarationDeclaration],
            }
        );
        // fn cube(sideLength, center) {
        //                     ^^^^^^
        assert_eq!(
            NodePath::from_range(&programs, 0, range(55, 61)).unwrap(),
            NodePath {
                steps: vec![
                    Step::ProgramBodyItem { index: 0 },
                    Step::VariableDeclarationDeclaration,
                    Step::VariableDeclarationInit,
                    Step::FunctionExpressionParam { index: 1 }
                ],
            }
        );
        // |> line(endAbsolute = p1)
        //                       ^^
        assert_eq!(
            NodePath::from_range(&programs, 0, range(293, 295)).unwrap(),
            NodePath {
                steps: vec![
                    Step::ProgramBodyItem { index: 0 },
                    Step::VariableDeclarationDeclaration,
                    Step::VariableDeclarationInit,
                    Step::FunctionExpressionBody,
                    Step::FunctionExpressionBodyItem { index: 7 },
                    Step::ReturnStatementArg,
                    Step::PipeBodyItem { index: 2 },
                    Step::CallKwArg { index: 0 },
                ],
            }
        );
        // myCube = cube(sideLength = 40, center = [0, 0])
        //                                             ^
        assert_eq!(
            NodePath::from_range(&programs, 0, range(485, 486)).unwrap(),
            NodePath {
                steps: vec![
                    Step::ProgramBodyItem { index: 1 },
                    Step::VariableDeclarationDeclaration,
                    Step::VariableDeclarationInit,
                    Step::CallKwArg { index: 1 },
                    Step::ArrayElement { index: 1 }
                ],
            }
        );
    }

    #[test]
    fn test_fill_node_paths_simple() {
        let code = "x = 5\n";
        let parsed = crate::Program::parse_no_errs(code).unwrap();
        let mut ast = parsed.ast;
        fill_node_paths(&mut ast);

        // VariableDeclaration
        let var_decl = match &ast.body[0] {
            BodyItem::VariableDeclaration(n) => n,
            _ => panic!("expected VariableDeclaration"),
        };
        assert_eq!(
            var_decl.node_path,
            Some(NodePath {
                steps: vec![Step::ProgramBodyItem { index: 0 }]
            })
        );
        // VariableDeclarator
        assert_eq!(
            var_decl.declaration.node_path,
            Some(NodePath {
                steps: vec![Step::ProgramBodyItem { index: 0 }, Step::VariableDeclarationDeclaration],
            })
        );
        // Init (Literal 5)
        match &var_decl.declaration.init {
            Expr::Literal(lit) => {
                assert_eq!(
                    lit.node_path,
                    Some(NodePath {
                        steps: vec![
                            Step::ProgramBodyItem { index: 0 },
                            Step::VariableDeclarationDeclaration,
                            Step::VariableDeclarationInit,
                        ],
                    })
                );
            }
            _ => panic!("expected Literal"),
        }
    }

    #[test]
    fn test_fill_node_paths_array() {
        let code = "x = [1, 2, 3]\n";
        let parsed = crate::Program::parse_no_errs(code).unwrap();
        let mut ast = parsed.ast;
        fill_node_paths(&mut ast);

        let var_decl = match &ast.body[0] {
            BodyItem::VariableDeclaration(n) => n,
            _ => panic!("expected VariableDeclaration"),
        };
        let arr = match &var_decl.declaration.init {
            Expr::ArrayExpression(n) => n,
            _ => panic!("expected ArrayExpression"),
        };
        assert_eq!(
            arr.node_path,
            Some(NodePath {
                steps: vec![
                    Step::ProgramBodyItem { index: 0 },
                    Step::VariableDeclarationDeclaration,
                    Step::VariableDeclarationInit,
                ],
            })
        );
        // Second element
        match &arr.elements[1] {
            Expr::Literal(lit) => {
                assert_eq!(
                    lit.node_path,
                    Some(NodePath {
                        steps: vec![
                            Step::ProgramBodyItem { index: 0 },
                            Step::VariableDeclarationDeclaration,
                            Step::VariableDeclarationInit,
                            Step::ArrayElement { index: 1 },
                        ],
                    })
                );
            }
            _ => panic!("expected Literal"),
        }
    }

    #[test]
    fn test_fill_node_paths_pipe_call() {
        let code = "x = startSketchOn(XY)\n  |> line(endAbsolute = [0, 1])\n";
        let parsed = crate::Program::parse_no_errs(code).unwrap();
        let mut ast = parsed.ast;
        fill_node_paths(&mut ast);

        let var_decl = match &ast.body[0] {
            BodyItem::VariableDeclaration(n) => n,
            _ => panic!("expected VariableDeclaration"),
        };
        let pipe = match &var_decl.declaration.init {
            Expr::PipeExpression(n) => n,
            _ => panic!("expected PipeExpression"),
        };
        let base_path = vec![
            Step::ProgramBodyItem { index: 0 },
            Step::VariableDeclarationDeclaration,
            Step::VariableDeclarationInit,
        ];
        assert_eq!(
            pipe.node_path,
            Some(NodePath {
                steps: base_path.clone()
            })
        );

        // Second pipe item (line call)
        let line_call = match &pipe.body[1] {
            Expr::CallExpressionKw(n) => n,
            _ => panic!("expected CallExpressionKw"),
        };
        let mut call_path = base_path;
        call_path.push(Step::PipeBodyItem { index: 1 });
        assert_eq!(
            line_call.node_path,
            Some(NodePath {
                steps: call_path.clone()
            })
        );

        // Callee
        let mut callee_path = call_path.clone();
        callee_path.push(Step::CallKwCallee);
        assert_eq!(line_call.callee.node_path, Some(NodePath { steps: callee_path }));

        // Argument value ([0, 1])
        let arr = match &line_call.arguments[0].arg {
            Expr::ArrayExpression(n) => n,
            _ => panic!("expected ArrayExpression"),
        };
        let mut arg_path = call_path.clone();
        arg_path.push(Step::CallKwArg { index: 0 });
        assert_eq!(
            arr.node_path,
            Some(NodePath {
                steps: arg_path.clone()
            })
        );

        // First array element (0)
        match &arr.elements[0] {
            Expr::Literal(lit) => {
                let mut elem_path = arg_path;
                elem_path.push(Step::ArrayElement { index: 0 });
                assert_eq!(lit.node_path, Some(NodePath { steps: elem_path }));
            }
            _ => panic!("expected Literal"),
        }
    }

    /// Verify that fill_node_paths produces the same paths as from_range for
    /// leaf nodes in the cube.kcl test file.
    #[test]
    fn test_fill_node_paths_matches_from_range() {
        let contents = std::fs::read_to_string("tests/misc/cube.kcl").unwrap();
        let program = crate::Program::parse_no_errs(&contents).unwrap();
        let mut ast = program.ast.clone();
        fill_node_paths(&mut ast);

        let module_infos = indexmap::IndexMap::from([(
            ModuleId::default(),
            crate::modules::ModuleInfo {
                id: ModuleId::default(),
                path: crate::modules::ModulePath::Main,
                repr: crate::modules::ModuleRepr::Kcl(program.ast.clone(), None),
            },
        )]);
        let programs = crate::execution::ProgramLookup::new(program.ast, module_infos);

        // Navigate to: myCube = cube(sideLength = 40, center = [0, 0])
        //                                                          ^
        // body[1] -> VarDecl -> declaration -> init -> CallKw -> args[1] -> arr -> elements[1]
        let var_decl = match &ast.body[1] {
            BodyItem::VariableDeclaration(n) => n,
            _ => panic!("expected VariableDeclaration"),
        };
        let call = match &var_decl.declaration.init {
            Expr::CallExpressionKw(n) => n,
            _ => panic!("expected CallExpressionKw"),
        };
        let arr = match &call.arguments[1].arg {
            Expr::ArrayExpression(n) => n,
            _ => panic!("expected ArrayExpression"),
        };
        let elem = match &arr.elements[1] {
            Expr::Literal(n) => n,
            _ => panic!("expected Literal"),
        };
        // Compare fill_node_paths result with from_range result for this leaf.
        let from_range_path = NodePath::from_range(&programs, 0, elem.as_source_range()).unwrap();
        assert_eq!(elem.node_path.as_ref().unwrap(), &from_range_path);

        // Navigate to: fn cube(sideLength, center) { ... }
        //                                  ^^^^^^
        // body[0] -> VarDecl -> declaration -> init -> FunctionExpr -> params[1]
        let fn_decl = match &ast.body[0] {
            BodyItem::VariableDeclaration(n) => n,
            _ => panic!("expected VariableDeclaration"),
        };
        let func = match &fn_decl.declaration.init {
            Expr::FunctionExpression(n) => n,
            _ => panic!("expected FunctionExpression"),
        };
        let param_ident = &func.params[1].identifier;
        let from_range_path = NodePath::from_range(&programs, 0, param_ident.as_source_range()).unwrap();
        assert_eq!(param_ident.node_path.as_ref().unwrap(), &from_range_path);

        // Navigate deep into pipe: |> line(endAbsolute = p1)
        //                                                ^^
        // body[0] -> VarDecl -> decl -> init -> FuncExpr -> body.body[7] -> ReturnStmt -> arg
        //   -> PipeExpr -> body[2] -> CallKw -> args[0] -> arg (Name "p1")
        let ret_stmt = match &func.body.body[7] {
            BodyItem::ReturnStatement(n) => n,
            _ => panic!("expected ReturnStatement"),
        };
        let pipe = match &ret_stmt.argument {
            Expr::PipeExpression(n) => n,
            _ => panic!("expected PipeExpression"),
        };
        let line_call = match &pipe.body[2] {
            Expr::CallExpressionKw(n) => n,
            _ => panic!("expected CallExpressionKw"),
        };
        let p1_arg = &line_call.arguments[0].arg;
        let p1_range = match p1_arg {
            Expr::Name(n) => n.as_source_range(),
            _ => panic!("expected Name"),
        };
        let from_range_path = NodePath::from_range(&programs, 0, p1_range).unwrap();
        let fill_path = match p1_arg {
            Expr::Name(n) => n.node_path.as_ref().unwrap(),
            _ => unreachable!(),
        };
        assert_eq!(fill_path, &from_range_path);
    }

    #[test]
    fn test_node_path_from_range_import() {
        let code = r#"import "cube.step" as cube
import "cylinder.kcl" as cylinder
"#;
        let program = crate::Program::parse_no_errs(code).unwrap();
        let module_infos = indexmap::IndexMap::from([(
            ModuleId::default(),
            crate::modules::ModuleInfo {
                id: ModuleId::default(),
                path: crate::modules::ModulePath::Main,
                repr: crate::modules::ModuleRepr::Kcl(program.ast.clone(), None),
            },
        )]);
        let programs = crate::execution::ProgramLookup::new(program.ast, module_infos);
        // The entire cylinder import statement.
        assert_eq!(
            NodePath::from_range(&programs, 0, range(27, 60)).unwrap(),
            NodePath {
                steps: vec![Step::ProgramBodyItem { index: 1 }],
            }
        );
    }
}
