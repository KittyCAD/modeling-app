//! Data types for the AST.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BodyItem {
    ExpressionStatement(ExpressionStatement),
    VariableDeclaration(VariableDeclaration),
    ReturnStatement(ReturnStatement),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum Value {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    FunctionExpression(Box<FunctionExpression>),
    CallExpression(Box<CallExpression>),
    PipeExpression(Box<PipeExpression>),
    PipeSubstitution(Box<PipeSubstitution>),
    ArrayExpression(Box<ArrayExpression>),
    ObjectExpression(Box<ObjectExpression>),
    MemberExpression(Box<MemberExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    CallExpression(Box<CallExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NoneCodeNode {
    pub start: usize,
    pub end: usize,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct NoneCodeMeta {
    pub none_code_nodes: HashMap<usize, NoneCodeNode>,
    pub start: Option<NoneCodeNode>,
}

// implement Deserialize manually because we to force the keys of none_code_nodes to be usize
// and by default the ts type { [statementIndex: number]: NoneCodeNode } serializes to a string i.e. "0", "1", etc.
impl<'de> Deserialize<'de> for NoneCodeMeta {
    fn deserialize<D>(deserializer: D) -> Result<NoneCodeMeta, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct NoneCodeMetaHelper {
            none_code_nodes: HashMap<String, NoneCodeNode>,
            start: Option<NoneCodeNode>,
        }

        let helper = NoneCodeMetaHelper::deserialize(deserializer)?;
        let mut none_code_nodes = HashMap::new();
        for (key, value) in helper.none_code_nodes {
            none_code_nodes.insert(key.parse().map_err(serde::de::Error::custom)?, value);
        }
        Ok(NoneCodeMeta {
            none_code_nodes,
            start: helper.start,
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub start: usize,
    pub end: usize,
    pub expression: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct CallExpression {
    pub start: usize,
    pub end: usize,
    pub callee: Identifier,
    pub arguments: Vec<Value>,
    pub optional: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclaration {
    pub start: usize,
    pub end: usize,
    pub declarations: Vec<VariableDeclarator>,
    pub kind: String, // Change to enum if there are specific values
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclarator {
    pub start: usize,
    pub end: usize,
    pub id: Identifier,
    pub init: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Literal {
    pub start: usize,
    pub end: usize,
    pub value: serde_json::Value,
    pub raw: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Identifier {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct PipeSubstitution {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ArrayExpression {
    pub start: usize,
    pub end: usize,
    pub elements: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectExpression {
    pub start: usize,
    pub end: usize,
    pub properties: Vec<ObjectProperty>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectProperty {
    pub start: usize,
    pub end: usize,
    pub key: Identifier,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MemberObject {
    MemberExpression(Box<MemberExpression>),
    Identifier(Box<Identifier>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LiteralIdentifier {
    Identifier(Box<Identifier>),
    Literal(Box<Literal>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub start: usize,
    pub end: usize,
    pub object: MemberObject,
    pub property: LiteralIdentifier,
    pub computed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
pub struct ObjectKeyInfo {
    pub key: LiteralIdentifier,
    pub index: usize,
    pub computed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct BinaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub left: BinaryPart,
    pub right: BinaryPart,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct UnaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub argument: BinaryPart,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct PipeExpression {
    pub start: usize,
    pub end: usize,
    pub body: Vec<Value>,
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    pub start: usize,
    pub end: usize,
    pub id: Option<Identifier>,
    pub params: Vec<Identifier>,
    pub body: BlockStatement,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct BlockStatement {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub start: usize,
    pub end: usize,
    pub argument: Value,
}
