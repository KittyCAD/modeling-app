use serde::Serialize;

use super::{BodyItem, Expr, Node, Program};
use crate::SourceRange;

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
}

impl NodePath {
    /// Placeholder for when the AST isn't available to create a real path.  It
    /// will be filled in later.
    pub(crate) fn placeholder() -> Self {
        Self::default()
    }

    #[cfg(feature = "artifact-graph")]
    pub(crate) fn fill_placeholder(&mut self, program: &Node<Program>, cached_body_items: usize, range: SourceRange) {
        if !self.is_empty() {
            return;
        }
        *self = Self::from_range(program, cached_body_items, range).unwrap_or_default();
    }

    /// Given a program and a [`SourceRange`], return the path to the node that
    /// contains the range.
    pub(crate) fn from_range(program: &Node<Program>, cached_body_items: usize, range: SourceRange) -> Option<Self> {
        Self::from_body(&program.body, cached_body_items, range, NodePath::default())
    }

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
                            if let Some(alias) = &item.alias {
                                if alias.contains_range(&range) {
                                    path.push(Step::ImportStatementItemAlias);
                                    return Some(path);
                                }
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
                if let Some(unlabeled) = &node.unlabeled {
                    if unlabeled.contains_range(&range) {
                        path.push(Step::CallKwUnlabeledArg);
                        return Self::from_expr(unlabeled, range, path);
                    }
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
                    return Some(path);
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
                for else_if in &node.else_ifs {
                    if else_if.contains_range(&range) {
                        path.push(Step::IfExpressionElseIf { index: 0 });
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
            Expr::None(_) => {}
        }

        Some(path)
    }

    pub fn is_empty(&self) -> bool {
        self.steps.is_empty()
    }

    fn push(&mut self, step: Step) {
        self.steps.push(step);
    }
}

#[cfg(test)]
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

        // fn cube(sideLength, center) {
        //    ^^^^
        assert_eq!(
            NodePath::from_range(&program.ast, 0, range(38, 42)).unwrap(),
            NodePath {
                steps: vec![Step::ProgramBodyItem { index: 0 }, Step::VariableDeclarationDeclaration],
            }
        );
        // fn cube(sideLength, center) {
        //                     ^^^^^^
        assert_eq!(
            NodePath::from_range(&program.ast, 0, range(55, 61)).unwrap(),
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
            NodePath::from_range(&program.ast, 0, range(293, 295)).unwrap(),
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
            NodePath::from_range(&program.ast, 0, range(485, 486)).unwrap(),
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
    fn test_node_path_from_range_import() {
        let code = r#"import "cube.step" as cube
import "cylinder.kcl" as cylinder
"#;
        let program = crate::Program::parse_no_errs(code).unwrap();
        // The entire cylinder import statement.
        assert_eq!(
            NodePath::from_range(&program.ast, 0, range(27, 60)).unwrap(),
            NodePath {
                steps: vec![Step::ProgramBodyItem { index: 1 }],
            }
        );
    }
}
