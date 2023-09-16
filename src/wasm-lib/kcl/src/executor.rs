//! The executor for the AST.

use std::collections::HashMap;

use anyhow::Result;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use tower_lsp::lsp_types::{Position as LspPosition, Range as LspRange};

use crate::{
    abstract_syntax_tree_types::{BodyItem, Function, FunctionExpression, Value},
    engine::EngineConnection,
    errors::{KclError, KclErrorDetails},
};

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProgramMemory {
    pub root: HashMap<String, MemoryItem>,
    #[serde(rename = "return")]
    pub return_: Option<ProgramReturn>,
}

impl ProgramMemory {
    pub fn new() -> Self {
        Self {
            root: HashMap::new(),
            return_: None,
        }
    }

    /// Add to the program memory.
    pub fn add(&mut self, key: &str, value: MemoryItem, source_range: SourceRange) -> Result<(), KclError> {
        if self.root.get(key).is_some() {
            return Err(KclError::ValueAlreadyDefined(KclErrorDetails {
                message: format!("Cannot redefine {}", key),
                source_ranges: vec![source_range],
            }));
        }

        self.root.insert(key.to_string(), value);

        Ok(())
    }

    /// Get a value from the program memory.
    pub fn get(&self, key: &str, source_range: SourceRange) -> Result<&MemoryItem, KclError> {
        self.root.get(key).ok_or_else(|| {
            KclError::UndefinedValue(KclErrorDetails {
                message: format!("memory item key `{}` is not defined", key),
                source_ranges: vec![source_range],
            })
        })
    }
}

impl Default for ProgramMemory {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase", untagged)]
pub enum ProgramReturn {
    Arguments(Vec<Value>),
    Value(MemoryItem),
}

impl From<ProgramReturn> for Vec<SourceRange> {
    fn from(item: ProgramReturn) -> Self {
        match item {
            ProgramReturn::Arguments(args) => args
                .iter()
                .map(|arg| {
                    let r: SourceRange = arg.into();
                    r
                })
                .collect(),
            ProgramReturn::Value(v) => v.into(),
        }
    }
}

impl ProgramReturn {
    pub fn get_value(&self) -> Result<MemoryItem, KclError> {
        match self {
            ProgramReturn::Value(v) => Ok(v.clone()),
            ProgramReturn::Arguments(args) => Err(KclError::Semantic(KclErrorDetails {
                message: format!("Cannot get value from arguments: {:?}", args),
                source_ranges: self.clone().into(),
            })),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type")]
pub enum MemoryItem {
    UserVal(UserVal),
    SketchGroup(SketchGroup),
    ExtrudeGroup(ExtrudeGroup),
    #[ts(skip)]
    ExtrudeTransform(ExtrudeTransform),
    #[ts(skip)]
    Function {
        #[serde(skip)]
        func: Option<MemoryFunction>,
        expression: Box<FunctionExpression>,
        #[serde(rename = "__meta")]
        meta: Vec<Metadata>,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct UserVal {
    pub value: serde_json::Value,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct ExtrudeTransform {
    pub position: Position,
    pub rotation: Rotation,
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

pub type MemoryFunction = fn(
    s: &[MemoryItem],
    memory: &ProgramMemory,
    expression: &FunctionExpression,
    metadata: &[Metadata],
    engine: &mut EngineConnection,
) -> Result<Option<ProgramReturn>, KclError>;

impl From<MemoryItem> for Vec<SourceRange> {
    fn from(item: MemoryItem) -> Self {
        match item {
            MemoryItem::UserVal(u) => u.meta.iter().map(|m| m.source_range).collect(),
            MemoryItem::SketchGroup(s) => s.meta.iter().map(|m| m.source_range).collect(),
            MemoryItem::ExtrudeGroup(e) => e.meta.iter().map(|m| m.source_range).collect(),
            MemoryItem::ExtrudeTransform(e) => e.meta.iter().map(|m| m.source_range).collect(),
            MemoryItem::Function { meta, .. } => meta.iter().map(|m| m.source_range).collect(),
        }
    }
}

impl MemoryItem {
    pub fn get_json_value(&self) -> Result<serde_json::Value, KclError> {
        if let MemoryItem::UserVal(user_val) = self {
            Ok(user_val.value.clone())
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("Not a user value: {:?}", self),
                source_ranges: self.clone().into(),
            }))
        }
    }

    pub fn call_fn(
        &self,
        args: &[MemoryItem],
        memory: &ProgramMemory,
        engine: &mut EngineConnection,
    ) -> Result<Option<ProgramReturn>, KclError> {
        if let MemoryItem::Function { func, expression, meta } = self {
            if let Some(func) = func {
                func(args, memory, expression, meta, engine)
            } else {
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!("Not a function: {:?}", self),
                    source_ranges: vec![],
                }))
            }
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("not a function: {:?}", self),
                source_ranges: vec![],
            }))
        }
    }
}

/// A sketch group is a collection of paths.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct SketchGroup {
    /// The id of the sketch group.
    pub id: uuid::Uuid,
    /// The paths in the sketch group.
    pub value: Vec<Path>,
    /// The starting path.
    pub start: BasePath,
    /// The position of the sketch group.
    pub position: Position,
    /// The rotation of the sketch group.
    pub rotation: Rotation,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl SketchGroup {
    pub fn get_path_by_id(&self, id: &uuid::Uuid) -> Option<&Path> {
        self.value.iter().find(|p| p.get_id() == *id)
    }

    pub fn get_path_by_name(&self, name: &str) -> Option<&Path> {
        self.value.iter().find(|p| p.get_name() == name)
    }

    pub fn get_base_by_name_or_start(&self, name: &str) -> Option<&BasePath> {
        if self.start.name == name {
            Some(&self.start)
        } else {
            self.value.iter().find(|p| p.get_name() == name).map(|p| p.get_base())
        }
    }

    pub fn get_coords_from_paths(&self) -> Result<Point2d, KclError> {
        if self.value.is_empty() {
            return Ok(self.start.to.into());
        }

        let index = self.value.len() - 1;
        if let Some(path) = self.value.get(index) {
            let base = path.get_base();
            Ok(base.to.into())
        } else {
            Ok(self.start.to.into())
        }
    }
}

/// An extrude group is a collection of extrude surfaces.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub struct ExtrudeGroup {
    /// The id of the extrude group.
    pub id: uuid::Uuid,
    /// The extrude surfaces.
    pub value: Vec<ExtrudeSurface>,
    /// The height of the extrude group.
    pub height: f64,
    /// The position of the extrude group.
    pub position: Position,
    /// The rotation of the extrude group.
    pub rotation: Rotation,
    /// Metadata.
    #[serde(rename = "__meta")]
    pub meta: Vec<Metadata>,
}

impl ExtrudeGroup {
    pub fn get_path_by_id(&self, id: &uuid::Uuid) -> Option<&ExtrudeSurface> {
        self.value.iter().find(|p| p.get_id() == *id)
    }

    pub fn get_path_by_name(&self, name: &str) -> Option<&ExtrudeSurface> {
        self.value.iter().find(|p| p.get_name() == name)
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub enum BodyType {
    Root,
    Sketch,
    Block,
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Position(#[ts(type = "[number, number, number]")] pub [f64; 3]);

#[derive(Debug, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Rotation(#[ts(type = "[number, number, number, number]")] pub [f64; 4]);

#[derive(Debug, Default, Deserialize, Serialize, PartialEq, Copy, Clone, ts_rs::TS, JsonSchema, Hash, Eq)]
#[ts(export)]
pub struct SourceRange(#[ts(type = "[number, number]")] pub [usize; 2]);

impl SourceRange {
    /// Create a new source range.
    pub fn new(start: usize, end: usize) -> Self {
        Self([start, end])
    }

    /// Get the start of the range.
    pub fn start(&self) -> usize {
        self.0[0]
    }

    /// Get the end of the range.
    pub fn end(&self) -> usize {
        self.0[1]
    }

    /// Check if the range contains a position.
    pub fn contains(&self, pos: usize) -> bool {
        pos >= self.start() && pos <= self.end()
    }

    pub fn start_to_lsp_position(&self, code: &str) -> LspPosition {
        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let mut line = code[..self.start()].lines().count();
        if line > 0 {
            line = line.saturating_sub(1);
        }
        let column = code[..self.start()].lines().last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn end_to_lsp_position(&self, code: &str) -> LspPosition {
        // Calculate the line and column of the error from the source range.
        // Lines are zero indexed in vscode so we need to subtract 1.
        let line = code[..self.end()].lines().count() - 1;
        let column = code[..self.end()].lines().last().map(|l| l.len()).unwrap_or_default();

        LspPosition {
            line: line as u32,
            character: column as u32,
        }
    }

    pub fn to_lsp_range(&self, code: &str) -> LspRange {
        let start = self.start_to_lsp_position(code);
        let end = self.end_to_lsp_position(code);
        LspRange { start, end }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, Copy, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Point2d {
    pub x: f64,
    pub y: f64,
}

impl From<[f64; 2]> for Point2d {
    fn from(p: [f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<&[f64; 2]> for Point2d {
    fn from(p: &[f64; 2]) -> Self {
        Self { x: p[0], y: p[1] }
    }
}

impl From<Point2d> for [f64; 2] {
    fn from(p: Point2d) -> Self {
        [p.x, p.y]
    }
}

impl From<Point2d> for kittycad::types::Point2D {
    fn from(p: Point2d) -> Self {
        Self { x: p.x, y: p.y }
    }
}

impl Point2d {
    pub const ZERO: Self = Self { x: 0.0, y: 0.0 };
    pub fn scale(self, scalar: f64) -> Self {
        Self {
            x: self.x * scalar,
            y: self.y * scalar,
        }
    }
}

#[derive(Debug, Deserialize, Serialize, PartialEq, Clone, ts_rs::TS, JsonSchema)]
#[ts(export)]
pub struct Point3d {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

/// Metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct Metadata {
    /// The source range.
    pub source_range: SourceRange,
}

impl From<SourceRange> for Metadata {
    fn from(source_range: SourceRange) -> Self {
        Self { source_range }
    }
}

/// A base path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct BasePath {
    /// The from point.
    #[ts(type = "[number, number]")]
    pub from: [f64; 2],
    /// The to point.
    #[ts(type = "[number, number]")]
    pub to: [f64; 2],
    /// The name of the path.
    pub name: String,
    /// Metadata.
    #[serde(rename = "__geoMeta")]
    pub geo_meta: GeoMeta,
}

/// Geometry metadata.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct GeoMeta {
    /// The id of the geometry.
    pub id: uuid::Uuid,
    /// Metadata.
    #[serde(flatten)]
    pub metadata: Metadata,
}

/// A path.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum Path {
    /// A path that goes to a point.
    ToPoint {
        #[serde(flatten)]
        base: BasePath,
    },
    /// A path that is horizontal.
    Horizontal {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: f64,
    },
    /// An angled line to.
    AngledLineTo {
        #[serde(flatten)]
        base: BasePath,
        /// The x coordinate.
        x: Option<f64>,
        /// The y coordinate.
        y: Option<f64>,
    },
    /// A base path.
    Base {
        #[serde(flatten)]
        base: BasePath,
    },
}

impl Path {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            Path::ToPoint { base } => base.geo_meta.id,
            Path::Horizontal { base, .. } => base.geo_meta.id,
            Path::AngledLineTo { base, .. } => base.geo_meta.id,
            Path::Base { base } => base.geo_meta.id,
        }
    }

    pub fn get_name(&self) -> String {
        match self {
            Path::ToPoint { base } => base.name.clone(),
            Path::Horizontal { base, .. } => base.name.clone(),
            Path::AngledLineTo { base, .. } => base.name.clone(),
            Path::Base { base } => base.name.clone(),
        }
    }

    pub fn get_base(&self) -> &BasePath {
        match self {
            Path::ToPoint { base } => base,
            Path::Horizontal { base, .. } => base,
            Path::AngledLineTo { base, .. } => base,
            Path::Base { base } => base,
        }
    }
}

/// An extrude surface.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ExtrudeSurface {
    /// An extrude plane.
    ExtrudePlane {
        /// The position.
        position: Position,
        /// The rotation.
        rotation: Rotation,
        /// The name.
        name: String,
        /// Metadata.
        #[serde(flatten)]
        geo_meta: GeoMeta,
    },
}

impl ExtrudeSurface {
    pub fn get_id(&self) -> uuid::Uuid {
        match self {
            ExtrudeSurface::ExtrudePlane { geo_meta, .. } => geo_meta.id,
        }
    }

    pub fn get_name(&self) -> String {
        match self {
            ExtrudeSurface::ExtrudePlane { name, .. } => name.clone(),
        }
    }

    pub fn get_position(&self) -> Position {
        match self {
            ExtrudeSurface::ExtrudePlane { position, .. } => *position,
        }
    }

    pub fn get_rotation(&self) -> Rotation {
        match self {
            ExtrudeSurface::ExtrudePlane { rotation, .. } => *rotation,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PipeInfo {
    pub previous_results: Vec<MemoryItem>,
    pub is_in_pipe: bool,
    pub index: usize,
    pub body: Vec<Value>,
}

impl PipeInfo {
    pub fn new() -> Self {
        Self {
            previous_results: Vec::new(),
            is_in_pipe: false,
            index: 0,
            body: Vec::new(),
        }
    }
}

impl Default for PipeInfo {
    fn default() -> Self {
        Self::new()
    }
}

/// Execute a AST's program.
pub fn execute(
    program: crate::abstract_syntax_tree_types::Program,
    memory: &mut ProgramMemory,
    options: BodyType,
    engine: &mut EngineConnection,
) -> Result<ProgramMemory, KclError> {
    let mut pipe_info = PipeInfo::default();

    // Iterate over the body of the program.
    for statement in &program.body {
        match statement {
            BodyItem::ExpressionStatement(expression_statement) => {
                if let Value::CallExpression(call_expr) = &expression_statement.expression {
                    let fn_name = call_expr.callee.name.to_string();
                    let mut args: Vec<MemoryItem> = Vec::new();
                    for arg in &call_expr.arguments {
                        match arg {
                            Value::Literal(literal) => args.push(literal.into()),
                            Value::Identifier(identifier) => {
                                let memory_item = memory.get(&identifier.name, identifier.into())?;
                                args.push(memory_item.clone());
                            }
                            // We do nothing for the rest.
                            _ => (),
                        }
                    }
                    let _show_fn = Box::new(crate::std::Show);
                    if let Function::StdLib { func: _show_fn } = &call_expr.function {
                        if options != BodyType::Root {
                            return Err(KclError::Semantic(KclErrorDetails {
                                message: "Cannot call show outside of a root".to_string(),
                                source_ranges: vec![call_expr.into()],
                            }));
                        }

                        memory.return_ = Some(ProgramReturn::Arguments(call_expr.arguments.clone()));
                    } else if let Some(func) = memory.clone().root.get(&fn_name) {
                        let result = func.call_fn(&args, memory, engine)?;

                        memory.return_ = result;
                    } else {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: format!("No such name {} defined", fn_name),
                            source_ranges: vec![call_expr.into()],
                        }));
                    }
                }
            }
            BodyItem::VariableDeclaration(variable_declaration) => {
                for declaration in &variable_declaration.declarations {
                    let var_name = declaration.id.name.to_string();
                    let source_range: SourceRange = declaration.init.clone().into();
                    let metadata = Metadata { source_range };

                    match &declaration.init {
                        Value::Literal(literal) => {
                            memory.add(&var_name, literal.into(), source_range)?;
                        }
                        Value::Identifier(identifier) => {
                            let value = memory.get(&identifier.name, identifier.into())?;
                            memory.add(&var_name, value.clone(), source_range)?;
                        }
                        Value::BinaryExpression(binary_expression) => {
                            let result = binary_expression.get_result(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::FunctionExpression(function_expression) => {
                            memory.add(
                                &var_name,
                                MemoryItem::Function{
                                    expression: function_expression.clone(),
                                    meta: vec![metadata],
                                    func: Some(|args: &[MemoryItem], memory: &ProgramMemory, function_expression: &FunctionExpression, _metadata: &[Metadata], engine: &mut EngineConnection| -> Result<Option<ProgramReturn>, KclError> {
                                        let mut fn_memory = memory.clone();

                                        if args.len() != function_expression.params.len() {
                                            return Err(KclError::Semantic(KclErrorDetails {
                                                message: format!("Expected {} arguments, got {}", function_expression.params.len(), args.len()),
                                                source_ranges: vec![function_expression.into()],
                                            }));
                                        }

                                        // Add the arguments to the memory.
                                        for (index, param) in function_expression.params.iter().enumerate() {
                                            fn_memory.add(
                                                &param.name,
                                                args.get(index).unwrap().clone(),
                                                param.into(),
                                            )?;
                                        }

                                        let result = execute(function_expression.body.clone(), &mut fn_memory, BodyType::Block, engine)?;

                                        Ok(result.return_)
                                    })
                                },
                                source_range,
                            )?;
                        }
                        Value::CallExpression(call_expression) => {
                            let result = call_expression.execute(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::PipeExpression(pipe_expression) => {
                            let result = pipe_expression.get_result(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::PipeSubstitution(pipe_substitution) => {
                            return Err(KclError::Semantic(KclErrorDetails {
                                message: format!(
                                    "pipe substitution not implemented for declaration of variable {}",
                                    var_name
                                ),
                                source_ranges: vec![pipe_substitution.into()],
                            }));
                        }
                        Value::ArrayExpression(array_expression) => {
                            let result = array_expression.execute(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::ObjectExpression(object_expression) => {
                            let result = object_expression.execute(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::MemberExpression(member_expression) => {
                            let result = member_expression.get_result(memory)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                        Value::UnaryExpression(unary_expression) => {
                            let result = unary_expression.get_result(memory, &mut pipe_info, engine)?;
                            memory.add(&var_name, result, source_range)?;
                        }
                    }
                }
            }
            BodyItem::ReturnStatement(return_statement) => match &return_statement.argument {
                Value::BinaryExpression(bin_expr) => {
                    let result = bin_expr.get_result(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::UnaryExpression(unary_expr) => {
                    let result = unary_expr.get_result(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::Identifier(identifier) => {
                    let value = memory.get(&identifier.name, identifier.into())?.clone();
                    memory.return_ = Some(ProgramReturn::Value(value));
                }
                Value::Literal(literal) => {
                    memory.return_ = Some(ProgramReturn::Value(literal.into()));
                }
                Value::ArrayExpression(array_expr) => {
                    let result = array_expr.execute(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::ObjectExpression(obj_expr) => {
                    let result = obj_expr.execute(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::CallExpression(call_expr) => {
                    let result = call_expr.execute(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::MemberExpression(member_expr) => {
                    let result = member_expr.get_result(memory)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::PipeExpression(pipe_expr) => {
                    let result = pipe_expr.get_result(memory, &mut pipe_info, engine)?;
                    memory.return_ = Some(ProgramReturn::Value(result));
                }
                Value::PipeSubstitution(_) => {}
                Value::FunctionExpression(_) => {}
            },
        }
    }

    Ok(memory.clone())
}

#[cfg(test)]
mod tests {
    use pretty_assertions::assert_eq;

    use super::*;

    pub async fn parse_execute(code: &str) -> Result<ProgramMemory> {
        let tokens = crate::tokeniser::lexer(code);
        let parser = crate::parser::Parser::new(tokens);
        let program = parser.ast()?;
        let mut mem: ProgramMemory = Default::default();
        let mut engine = EngineConnection::new().await?;
        let memory = execute(program, &mut mem, BodyType::Root, &mut engine)?;

        Ok(memory)
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_assign_two_variables() {
        let ast = r#"const myVar = 5
const newVar = myVar + 1"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(5),
            memory.root.get("myVar").unwrap().get_json_value().unwrap()
        );
        assert_eq!(
            serde_json::json!(6.0),
            memory.root.get("newVar").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_angled_line_that_intersects() {
        let ast_fn = |offset: &str| -> String {
            format!(
                r#"const part001 = startSketchAt([0, 0])
  |> lineTo({{to:[2, 2], tag: "yo"}}, %)
  |> lineTo([3, 1], %)
  |> angledLineThatIntersects({{
  angle: 180,
  intersectTag: 'yo',
  offset: {},
  tag: "yo2"
}}, %)
const intersect = segEndX('yo2', part001)
show(part001)"#,
                offset
            )
        };

        let memory = parse_execute(&ast_fn("-1")).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0 + 2.0f64.sqrt()),
            memory.root.get("intersect").unwrap().get_json_value().unwrap()
        );

        let memory = parse_execute(&ast_fn("0")).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0000000000000002),
            memory.root.get("intersect").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_fn_definitions() {
        let ast = r#"fn def = (x) => {
  return x
}
fn ghi = (x) => {
  return x
}
fn jkl = (x) => {
  return x
}
fn hmm = (x) => {
  return x
}

const yo = 5 + 6

const abc = 3
const identifierGuy = 5
const part001 = startSketchAt([-1.2, 4.83])
|> line([2.8, 0], %)
|> angledLine([100 + 100, 3.01], %)
|> angledLine([abc, 3.02], %)
|> angledLine([def(yo), 3.03], %)
|> angledLine([ghi(2), 3.04], %)
|> angledLine([jkl(yo) + 2, 3.05], %)
|> close(%)
const yo2 = hmm([identifierGuy + 5])
show(part001)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions_unary() {
        let ast = r#"const myVar = 3
const part001 = startSketchAt([0, 0])
  |> line({ to: [3, 4], tag: 'seg01' }, %)
  |> line([
  min(segLen('seg01', %), myVar),
  -legLen(segLen('seg01', %), myVar)
], %)

show(part001)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_pipe_substitutions() {
        let ast = r#"const myVar = 3
const part001 = startSketchAt([0, 0])
  |> line({ to: [3, 4], tag: 'seg01' }, %)
  |> line([
  min(segLen('seg01', %), myVar),
  legLen(segLen('seg01', %), myVar)
], %)

show(part001)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_inline_comment() {
        let ast = r#"const baseThick = 1
const armAngle = 60

const baseThickHalf = baseThick / 2
const halfArmAngle = armAngle / 2

const arrExpShouldNotBeIncluded = [1, 2, 3]
const objExpShouldNotBeIncluded = { a: 1, b: 2, c: 3 }

const part001 = startSketchAt([0, 0])
  |> yLineTo(1, %)
  |> xLine(3.84, %) // selection-range-7ish-before-this

const variableBelowShouldNotBeIncluded = 3

show(part001)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_literal_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = () => {
  return -8
}

const firstExtrude = startSketchAt([0,0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing()], %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_unary_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = (x) => {
  return -x
}

const firstExtrude = startSketchAt([0,0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing(8)], %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_array_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn thing = (x) => {
  return [0, -x]
}

const firstExtrude = startSketchAt([0,0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line(thing(8), %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_call_in_pipe() {
        let ast = r#"const w = 20
const l = 8
const h = 10

fn other_thing = (y) => {
  return -y
}

fn thing = (x) => {
  return other_thing(x)
}

const firstExtrude = startSketchAt([0,0])
  |> line([0, l], %)
  |> line([w, 0], %)
  |> line([0, thing(8)], %)
  |> close(%)
  |> extrude(h, %)

show(firstExtrude)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_execute_with_function_sketch() {
        let ast = r#"fn box = (h, l, w) => {
 const myBox = startSketchAt([0,0])
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}

const fnBox = box(3, 6, 10)

show(fnBox)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_period() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchAt(obj.start)
    |> line([0, obj.l], %)
    |> line([obj.w, 0], %)
    |> line([0, -obj.l], %)
    |> close(%)
    |> extrude(obj.h, %)

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})

show(thisBox)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_brace() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchAt(obj["start"])
    |> line([0, obj["l"]], %)
    |> line([obj["w"], 0], %)
    |> line([0, -obj["l"]], %)
    |> close(%)
    |> extrude(obj["h"], %)

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})

show(thisBox)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_object_with_function_mix_period_brace() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchAt(obj["start"])
    |> line([0, obj["l"]], %)
    |> line([obj["w"], 0], %)
    |> line([10 - obj["w"], -obj.l], %)
    |> close(%)
    |> extrude(obj["h"], %)

  return myBox
}

const thisBox = box({start: [0,0], l: 6, w: 10, h: 3})

show(thisBox)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_objects() {
        let ast = r#"fn box = (obj) => {
 let myBox = startSketchAt(obj.start)
    |> line([0, obj.l], %)
    |> line([obj.w, 0], %)
    |> line([0, -obj.l], %)
    |> close(%)
    |> extrude(obj.h, %)

  return myBox
}

for var in [{start: [0,0], l: 6, w: 10, h: 3}, {start: [-10,-10], l: 3, w: 5, h: 1.5}] {
  const thisBox = box(var)
  show(thisBox)
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    #[ignore] // ignore til we get loops
    async fn test_execute_with_function_sketch_loop_array() {
        let ast = r#"fn box = (h, l, w, start) => {
 const myBox = startSketchAt([0,0])
    |> line([0, l], %)
    |> line([w, 0], %)
    |> line([0, -l], %)
    |> close(%)
    |> extrude(h, %)

  return myBox
}


for var in [[3, 6, 10, [0,0]], [1.5, 3, 5, [-10,-10]]] {
  const thisBox = box(var[0], var[1], var[2], var[3])
  show(thisBox)
}"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_get_member_of_array_with_function() {
        let ast = r#"fn box = (array) => {
 let myBox = startSketchAt(array[0])
    |> line([0, array[1]], %)
    |> line([array[2], 0], %)
    |> line([0, -array[1]], %)
    |> close(%)
    |> extrude(array[3], %)

  return myBox
}

const thisBox = box([[0,0], 6, 10, 3])

show(thisBox)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_with_functions() {
        let ast = r#"const myVar = 2 + min(100, -1 + legLen(5, 3))"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(5.0),
            memory.root.get("myVar").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute() {
        let ast = r#"const myVar = 1 + 2 * (3 - 4) / -5 + 6"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(7.4),
            memory.root.get("myVar").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_execute_start_negative() {
        let ast = r#"const myVar = -5 + 6"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(1.0),
            memory.root.get("myVar").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_define_decimal_without_leading_zero() {
        let ast = r#"let thing = .4 + 7"#;
        let memory = parse_execute(ast).await.unwrap();
        assert_eq!(
            serde_json::json!(7.4),
            memory.root.get("thing").unwrap().get_json_value().unwrap()
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_negative_variable_in_binary_expression() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 1 // inch

const p = 150 // lbs
const distance = 6 // inches
const FOS = 2

const leg1 = 5 // inches
const leg2 = 8 // inches

const thickness_squared = distance * p * FOS * 6 / sigmaAllow
const thickness = 0.56 // inches. App does not support square root function yet

const bracket = startSketchAt([0,0])
  |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-leg2 + thickness, 0], %)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_doubly_nested_parens() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 4 // inch
const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2
const leg1 = 5 // inches
const leg2 = 8 // inches
const thickness_squared = (distance * p * FOS * 6 / (sigmaAllow - width))
const thickness = 0.32 // inches. App does not support square root function yet
const bracket = startSketchAt([0,0])
    |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-1 * leg2 + thickness, 0], %)
  |> line([0, -1 * leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)
show(bracket)
"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_math_nested_parens_one_less() {
        let ast = r#"const sigmaAllow = 35000 // psi
const width = 4 // inch
const p = 150 // Force on shelf - lbs
const distance = 6 // inches
const FOS = 2
const leg1 = 5 // inches
const leg2 = 8 // inches
const thickness_squared = distance * p * FOS * 6 / (sigmaAllow - width)
const thickness = 0.32 // inches. App does not support square root function yet
const bracket = startSketchAt([0,0])
    |> line([0, leg1], %)
  |> line([leg2, 0], %)
  |> line([0, -thickness], %)
  |> line([-1 * leg2 + thickness, 0], %)
  |> line([0, -1 * leg1 + thickness], %)
  |> close(%)
  |> extrude(width, %)
show(bracket)
"#;
        parse_execute(ast).await.unwrap();
    }
}
