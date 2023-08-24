//! Data types for the AST.

use std::collections::HashMap;

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use serde_json::Map;

use crate::{
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
    executor::{MemoryItem, Metadata, PipeInfo, ProgramMemory, SourceRange},
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Program {
    pub start: usize,
    pub end: usize,
    pub body: Vec<BodyItem>,
    pub non_code_meta: NoneCodeMeta,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BodyItem {
    ExpressionStatement(ExpressionStatement),
    VariableDeclaration(VariableDeclaration),
    ReturnStatement(ReturnStatement),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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

pub trait ValueMeta {
    fn start(&self) -> usize;

    fn end(&self) -> usize;
}

macro_rules! impl_value_meta {
    {$name:ident} => {
        impl ValueMeta for $name {
            fn start(&self) -> usize {
                self.start
            }

            fn end(&self) -> usize {
                self.end
            }
        }

        impl From<$name> for crate::executor::SourceRange {
            fn from(v: $name) -> Self {
                Self([v.start, v.end])
            }
        }

        impl From<&$name> for crate::executor::SourceRange {
            fn from(v: &$name) -> Self {
                Self([v.start, v.end])
            }
        }

        impl From<&Box<$name>> for crate::executor::SourceRange {
            fn from(v: &Box<$name>) -> Self {
                Self([v.start, v.end])
            }
        }
    };
}

impl Value {
    pub fn start(&self) -> usize {
        match self {
            Value::Literal(literal) => literal.start(),
            Value::Identifier(identifier) => identifier.start(),
            Value::BinaryExpression(binary_expression) => binary_expression.start(),
            Value::FunctionExpression(function_expression) => function_expression.start(),
            Value::CallExpression(call_expression) => call_expression.start(),
            Value::PipeExpression(pipe_expression) => pipe_expression.start(),
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution.start(),
            Value::ArrayExpression(array_expression) => array_expression.start(),
            Value::ObjectExpression(object_expression) => object_expression.start(),
            Value::MemberExpression(member_expression) => member_expression.start(),
            Value::UnaryExpression(unary_expression) => unary_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            Value::Literal(literal) => literal.end(),
            Value::Identifier(identifier) => identifier.end(),
            Value::BinaryExpression(binary_expression) => binary_expression.end(),
            Value::FunctionExpression(function_expression) => function_expression.end(),
            Value::CallExpression(call_expression) => call_expression.end(),
            Value::PipeExpression(pipe_expression) => pipe_expression.end(),
            Value::PipeSubstitution(pipe_substitution) => pipe_substitution.end(),
            Value::ArrayExpression(array_expression) => array_expression.end(),
            Value::ObjectExpression(object_expression) => object_expression.end(),
            Value::MemberExpression(member_expression) => member_expression.end(),
            Value::UnaryExpression(unary_expression) => unary_expression.end(),
        }
    }
}

impl From<Value> for crate::executor::SourceRange {
    fn from(value: Value) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&Value> for crate::executor::SourceRange {
    fn from(value: &Value) -> Self {
        Self([value.start(), value.end()])
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum BinaryPart {
    Literal(Box<Literal>),
    Identifier(Box<Identifier>),
    BinaryExpression(Box<BinaryExpression>),
    CallExpression(Box<CallExpression>),
    UnaryExpression(Box<UnaryExpression>),
}
impl From<BinaryPart> for crate::executor::SourceRange {
    fn from(value: BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl From<&BinaryPart> for crate::executor::SourceRange {
    fn from(value: &BinaryPart) -> Self {
        Self([value.start(), value.end()])
    }
}

impl BinaryPart {
    pub fn start(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.start(),
            BinaryPart::Identifier(identifier) => identifier.start(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.start(),
            BinaryPart::CallExpression(call_expression) => call_expression.start(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.start(),
        }
    }

    pub fn end(&self) -> usize {
        match self {
            BinaryPart::Literal(literal) => literal.end(),
            BinaryPart::Identifier(identifier) => identifier.end(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.end(),
            BinaryPart::CallExpression(call_expression) => call_expression.end(),
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.end(),
        }
    }

    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        pipe_info.is_in_pipe = false;
        match self {
            BinaryPart::Literal(literal) => Ok(literal.into()),
            BinaryPart::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                Ok(value.clone())
            }
            BinaryPart::BinaryExpression(binary_expression) => {
                binary_expression.get_result(memory, pipe_info, engine)
            }
            BinaryPart::CallExpression(call_expression) => {
                call_expression.execute(memory, pipe_info, engine)
            }
            BinaryPart::UnaryExpression(unary_expression) => {
                // Return an error this should not happen.
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "UnaryExpression should not be a BinaryPart: {:?}",
                        unary_expression
                    ),
                    source_ranges: vec![unary_expression.into()],
                }))
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct NoneCodeNode {
    pub start: usize,
    pub end: usize,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
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

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ExpressionStatement {
    pub start: usize,
    pub end: usize,
    pub expression: Value,
}

impl_value_meta!(ExpressionStatement);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct CallExpression {
    pub start: usize,
    pub end: usize,
    pub callee: Identifier,
    pub arguments: Vec<Value>,
    pub optional: bool,
}

impl_value_meta!(CallExpression);

impl CallExpression {
    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let fn_name = self.callee.name.clone();

        let mut fn_args: Vec<MemoryItem> = Vec::with_capacity(self.arguments.len());

        for arg in &self.arguments {
            let result: MemoryItem = match arg {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => {
                    unary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::ObjectExpression(object_expression) => {
                    object_expression.execute(memory, pipe_info, engine)?
                }
                Value::ArrayExpression(array_expression) => {
                    array_expression.execute(memory, pipe_info, engine)?
                }
                Value::PipeExpression(pipe_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "PipeExpression not implemented here: {:?}",
                            pipe_expression
                        ),
                        source_ranges: vec![pipe_expression.into()],
                    }));
                }
                Value::PipeSubstitution(pipe_substitution) => pipe_info
                    .previous_results
                    .get(&pipe_info.index - 1)
                    .ok_or_else(|| {
                        KclError::Semantic(KclErrorDetails {
                            message: format!(
                                "PipeSubstitution index out of bounds: {:?}",
                                pipe_info
                            ),
                            source_ranges: vec![pipe_substitution.into()],
                        })
                    })?
                    .clone(),
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "MemberExpression not implemented here: {:?}",
                            member_expression
                        ),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "FunctionExpression not implemented here: {:?}",
                            function_expression
                        ),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            };

            fn_args.push(result);
        }

        if let Some(func) = crate::std::INTERNAL_FNS.get(&fn_name) {
            // Attempt to call the function.
            let mut args = crate::std::Args::new(fn_args, self.into(), engine);
            let result = func(&mut args)?;
            if pipe_info.is_in_pipe {
                pipe_info.index += 1;
                pipe_info.previous_results.push(result);
                execute_pipe_body(
                    memory,
                    &pipe_info.body.clone(),
                    pipe_info,
                    self.into(),
                    engine,
                )
            } else {
                Ok(result)
            }
        } else {
            let mem = memory.clone();
            let func = mem.get(&fn_name, self.into())?;
            let result = func.call_fn(&fn_args, memory, engine)?.ok_or_else(|| {
                KclError::UndefinedValue(KclErrorDetails {
                    message: format!("Result of function {} is undefined", fn_name),
                    source_ranges: vec![self.into()],
                })
            })?;

            let result = result.get_value()?;

            if pipe_info.is_in_pipe {
                pipe_info.index += 1;
                pipe_info.previous_results.push(result);

                execute_pipe_body(
                    memory,
                    &pipe_info.body.clone(),
                    pipe_info,
                    self.into(),
                    engine,
                )
            } else {
                Ok(result)
            }
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclaration {
    pub start: usize,
    pub end: usize,
    pub declarations: Vec<VariableDeclarator>,
    pub kind: String, // Change to enum if there are specific values
}

impl_value_meta!(VariableDeclaration);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct VariableDeclarator {
    pub start: usize,
    pub end: usize,
    pub id: Identifier,
    pub init: Value,
}

impl_value_meta!(VariableDeclarator);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Literal {
    pub start: usize,
    pub end: usize,
    pub value: serde_json::Value,
    pub raw: String,
}

impl_value_meta!(Literal);

impl From<Literal> for MemoryItem {
    fn from(literal: Literal) -> Self {
        MemoryItem::UserVal {
            value: literal.value.clone(),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        }
    }
}

impl From<&Box<Literal>> for MemoryItem {
    fn from(literal: &Box<Literal>) -> Self {
        MemoryItem::UserVal {
            value: literal.value.clone(),
            meta: vec![Metadata {
                source_range: literal.into(),
            }],
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct Identifier {
    pub start: usize,
    pub end: usize,
    pub name: String,
}

impl_value_meta!(Identifier);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct PipeSubstitution {
    pub start: usize,
    pub end: usize,
}

impl_value_meta!(PipeSubstitution);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ArrayExpression {
    pub start: usize,
    pub end: usize,
    pub elements: Vec<Value>,
}

impl_value_meta!(ArrayExpression);

impl ArrayExpression {
    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let result = match element {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => {
                    unary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::ObjectExpression(object_expression) => {
                    object_expression.execute(memory, pipe_info, engine)?
                }
                Value::ArrayExpression(array_expression) => {
                    array_expression.execute(memory, pipe_info, engine)?
                }
                Value::PipeExpression(pipe_expression) => {
                    pipe_expression.get_result(memory, pipe_info, engine)?
                }
                Value::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "PipeSubstitution not implemented here: {:?}",
                            pipe_substitution
                        ),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "MemberExpression not implemented here: {:?}",
                            member_expression
                        ),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "FunctionExpression not implemented here: {:?}",
                            function_expression
                        ),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            }
            .get_json_value()?;

            results.push(result);
        }

        Ok(MemoryItem::UserVal {
            value: results.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectExpression {
    pub start: usize,
    pub end: usize,
    pub properties: Vec<ObjectProperty>,
}

impl ObjectExpression {
    pub fn execute(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        let mut object = Map::new();
        for property in &self.properties {
            let result = match &property.value {
                Value::Literal(literal) => literal.into(),
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?;
                    value.clone()
                }
                Value::BinaryExpression(binary_expression) => {
                    binary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::CallExpression(call_expression) => {
                    pipe_info.is_in_pipe = false;
                    call_expression.execute(memory, pipe_info, engine)?
                }
                Value::UnaryExpression(unary_expression) => {
                    unary_expression.get_result(memory, pipe_info, engine)?
                }
                Value::ObjectExpression(object_expression) => {
                    object_expression.execute(memory, pipe_info, engine)?
                }
                Value::ArrayExpression(array_expression) => {
                    array_expression.execute(memory, pipe_info, engine)?
                }
                Value::PipeExpression(pipe_expression) => {
                    pipe_expression.get_result(memory, pipe_info, engine)?
                }
                Value::PipeSubstitution(pipe_substitution) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "PipeSubstitution not implemented here: {:?}",
                            pipe_substitution
                        ),
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                Value::MemberExpression(member_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "MemberExpression not implemented here: {:?}",
                            member_expression
                        ),
                        source_ranges: vec![member_expression.into()],
                    }));
                }
                Value::FunctionExpression(function_expression) => {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "FunctionExpression not implemented here: {:?}",
                            function_expression
                        ),
                        source_ranges: vec![function_expression.into()],
                    }));
                }
            };

            object.insert(property.key.name.clone(), result.get_json_value()?);
        }

        Ok(MemoryItem::UserVal {
            value: object.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        })
    }
}

impl_value_meta!(ObjectExpression);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ObjectProperty {
    pub start: usize,
    pub end: usize,
    pub key: Identifier,
    pub value: Value,
}

impl_value_meta!(ObjectProperty);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MemberObject {
    MemberExpression(Box<MemberExpression>),
    Identifier(Box<Identifier>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum LiteralIdentifier {
    Identifier(Box<Identifier>),
    Literal(Box<Literal>),
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct MemberExpression {
    pub start: usize,
    pub end: usize,
    pub object: MemberObject,
    pub property: LiteralIdentifier,
    pub computed: bool,
}

impl_value_meta!(MemberExpression);

impl MemberExpression {
    pub fn get_result(&self, memory: &mut ProgramMemory) -> Result<MemoryItem, KclError> {
        let property_name = match &self.property {
            LiteralIdentifier::Identifier(identifier) => identifier.name.to_string(),
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                // Parse this as a string.
                if let serde_json::Value::String(string) = value {
                    string
                } else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "Expected string literal for property name, found {:?}",
                            value
                        ),
                        source_ranges: vec![literal.into()],
                    }));
                }
            }
        };

        let object = match &self.object {
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(memory)?,
            MemberObject::Identifier(identifier) => {
                let value = memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        }
        .get_json_value()?;

        if let serde_json::Value::Object(map) = object {
            if let Some(value) = map.get(&property_name) {
                Ok(MemoryItem::UserVal {
                    value: value.clone(),
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                })
            } else {
                Err(KclError::UndefinedValue(KclErrorDetails {
                    message: format!("Property {} not found in object", property_name),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("MemberExpression object is not an object: {:?}", object),
                source_ranges: vec![self.clone().into()],
            }))
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct ObjectKeyInfo {
    pub key: LiteralIdentifier,
    pub index: usize,
    pub computed: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct BinaryExpression {
    pub start: usize,
    pub end: usize,
    // TODO: operator should be a type not a string.
    pub operator: String,
    pub left: BinaryPart,
    pub right: BinaryPart,
}

impl_value_meta!(BinaryExpression);

impl BinaryExpression {
    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        pipe_info.is_in_pipe = false;

        let left_json_value = self
            .left
            .get_result(memory, pipe_info, engine)?
            .get_json_value()?;
        let right_json_value = self
            .right
            .get_result(memory, pipe_info, engine)?
            .get_json_value()?;

        // First check if we are doing string concatenation.
        if self.operator == "+" {
            if let (Some(left), Some(right)) = (
                parse_json_value_as_string(&left_json_value),
                parse_json_value_as_string(&right_json_value),
            ) {
                let value = serde_json::Value::String(format!("{}{}", left, right));
                return Ok(MemoryItem::UserVal {
                    value,
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                });
            }
        }

        let left = parse_json_number_as_f64(&left_json_value, self.left.clone().into())?;
        let right = parse_json_number_as_f64(&right_json_value, self.right.clone().into())?;

        let value: serde_json::Value = match self.operator.as_str() {
            "+" => (left + right).into(),
            "-" => (left - right).into(),
            "*" => (left * right).into(),
            "/" => (left / right).into(),
            "%" => (left % right).into(),
            _ => {
                return Err(KclError::Syntax(KclErrorDetails {
                    source_ranges: vec![self.into()],
                    message: format!("Invalid operator: {}", self.operator),
                }))
            }
        };

        Ok(MemoryItem::UserVal {
            value,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        })
    }
}

pub fn parse_json_number_as_f64(
    j: &serde_json::Value,
    source_range: SourceRange,
) -> Result<f64, KclError> {
    if let serde_json::Value::Number(n) = &j {
        n.as_f64().ok_or_else(|| {
            KclError::Syntax(KclErrorDetails {
                source_ranges: vec![source_range],
                message: format!("Invalid number: {}", j),
            })
        })
    } else {
        Err(KclError::Syntax(KclErrorDetails {
            source_ranges: vec![source_range],
            message: format!("Invalid number: {}", j),
        }))
    }
}

pub fn parse_json_value_as_string(j: &serde_json::Value) -> Option<String> {
    if let serde_json::Value::String(n) = &j {
        Some(n.clone())
    } else {
        None
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct UnaryExpression {
    pub start: usize,
    pub end: usize,
    pub operator: String,
    pub argument: BinaryPart,
}

impl_value_meta!(UnaryExpression);

impl UnaryExpression {
    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        pipe_info.is_in_pipe = false;

        let num = parse_json_number_as_f64(
            &self
                .argument
                .get_result(memory, pipe_info, engine)?
                .get_json_value()?,
            self.into(),
        )?;
        Ok(MemoryItem::UserVal {
            value: (-(num)).into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        })
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", tag = "type")]
pub struct PipeExpression {
    pub start: usize,
    pub end: usize,
    pub body: Vec<Value>,
    pub non_code_meta: NoneCodeMeta,
}

impl_value_meta!(PipeExpression);

impl PipeExpression {
    pub fn get_result(
        &self,
        memory: &mut ProgramMemory,
        pipe_info: &mut PipeInfo,
        engine: &mut EngineConnection,
    ) -> Result<MemoryItem, KclError> {
        // Reset the previous results.
        pipe_info.previous_results = vec![];
        pipe_info.index = 0;
        execute_pipe_body(memory, &self.body, pipe_info, self.into(), engine)
    }
}

fn execute_pipe_body(
    memory: &mut ProgramMemory,
    body: &[Value],
    pipe_info: &mut PipeInfo,
    source_range: SourceRange,
    engine: &mut EngineConnection,
) -> Result<MemoryItem, KclError> {
    if pipe_info.index == body.len() {
        pipe_info.is_in_pipe = false;
        return Ok(pipe_info
            .previous_results
            .last()
            .ok_or_else(|| {
                KclError::Semantic(KclErrorDetails {
                    message: "Pipe body results should have at least one expression".to_string(),
                    source_ranges: vec![source_range],
                })
            })?
            .clone());
    }

    let expression = body.get(pipe_info.index).ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: format!("Invalid index for pipe: {}", pipe_info.index),
            source_ranges: vec![source_range],
        })
    })?;

    match expression {
        Value::BinaryExpression(binary_expression) => {
            let result = binary_expression.get_result(memory, pipe_info, engine)?;
            pipe_info.previous_results.push(result);
            pipe_info.index += 1;
            execute_pipe_body(memory, body, pipe_info, source_range, engine)
        }
        Value::CallExpression(call_expression) => {
            pipe_info.is_in_pipe = true;
            pipe_info.body = body.to_vec();
            call_expression.execute(memory, pipe_info, engine)
        }
        _ => {
            // Return an error this should not happen.
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("PipeExpression not implemented here: {:?}", expression),
                source_ranges: vec![expression.into()],
            }))
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct FunctionExpression {
    pub start: usize,
    pub end: usize,
    pub id: Option<Identifier>,
    pub params: Vec<Identifier>,
    pub body: Program,
}

impl_value_meta!(FunctionExpression);

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub struct ReturnStatement {
    pub start: usize,
    pub end: usize,
    pub argument: Value,
}

impl_value_meta!(ReturnStatement);
