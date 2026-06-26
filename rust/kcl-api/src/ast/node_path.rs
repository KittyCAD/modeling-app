use serde::Serialize;

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
