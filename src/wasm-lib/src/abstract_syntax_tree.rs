use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct Program {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    #[serde(rename = "nonCodeMeta")]
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum BodyItem {
    ExpressionStatement(ExpressionStatement),
    VariableDeclaration(VariableDeclaration),
    ReturnStatement(ReturnStatement),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
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

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    CallExpression(Box<CallExpression>),
    UnaryExpression(Box<UnaryExpression>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NoneCodeNode {
    pub start: usize,
    pub end: usize,
    pub value: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct NoneCodeMeta {
    #[serde(rename = "noneCodeNodes")]
    // TODO change to std::collections::HashMap<usize, NoneCodeNode>,
    // the typing in TS of `{ [statementIndex: number]: NoneCodeNode }` gets
    // serialized to `{ [statementIndex: string]: NoneCodeNode }`
    // using string here is the fix, but really it shouldn't be a string
    pub none_code_nodes: std::collections::HashMap<String, NoneCodeNode>,
    pub start: Option<NoneCodeNode>
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ExpressionStatement {
    pub start: usize,
    pub end: usize,
    pub expression: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CallExpression {
    pub start: usize,
    pub end: usize,
    pub callee: Identifier,
    pub arguments: Vec<Value>,
    pub optional: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VariableDeclaration {
    pub start: usize,
    pub end: usize,
    pub declarations: Vec<VariableDeclarator>,
    pub kind: String, // Change to enum if there are specific values
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct VariableDeclarator {
    pub start: usize,
    pub end: usize,
    pub id: Identifier,
    pub init: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Literal {
    pub start: usize,
    pub end: usize,
    pub value: serde_json::Value,
    pub raw: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct Identifier {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PipeSubstitution {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ArrayExpression {
    pub start: usize,
    pub end: usize,
    pub elements: Vec<Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ObjectExpression {
    pub start: usize,
    pub end: usize,
    pub properties: Vec<ObjectProperty>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ObjectProperty {
    pub start: usize,
    pub end: usize,
    pub key: Identifier,
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum MemberObject {
    MemberExpression(Box<MemberExpression>),
    Identifier(Box<Identifier>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum MemberProperty {
    Identifier(Box<Identifier>),
    Literal(Box<Literal>),
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct MemberExpression {
    pub start: usize,
    pub end: usize,
    pub object: MemberObject,
    pub property: MemberProperty,
    pub computed: bool,
}

#[derive(Debug)]
pub struct ObjectKeyInfo {
    pub key: Box<dyn std::any::Any>,
    pub index: usize,
    pub computed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BinaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub left: BinaryPart,
    pub right: BinaryPart,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct UnaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub argument: BinaryPart,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct PipeExpression {
    pub start: usize,
    pub end: usize,
    pub body: Vec<Value>,
    #[serde(rename = "nonCodeMeta")]
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct FunctionExpression {
    pub start: usize,
    pub end: usize,
    pub id: Option<Identifier>,
    pub params: Vec<Identifier>,
    pub body: BlockStatement,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct BlockStatement {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    #[serde(rename = "nonCodeMeta")]
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct ReturnStatement {
    pub start: usize,
    pub end: usize,
    pub argument: Value,
}
