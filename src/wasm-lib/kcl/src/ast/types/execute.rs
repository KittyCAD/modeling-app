use super::{
    human_friendly_type, ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart,
    CallExpression, Expr, IfExpression, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject,
    ObjectExpression, TagDeclarator, UnaryExpression, UnaryOperator,
};
use crate::{
    errors::{KclError, KclErrorDetails},
    executor::{
        BodyType, ExecState, ExecutorContext, KclValue, Metadata, Sketch, SourceRange, StatementKind, TagEngineInfo,
        TagIdentifier, Tagged, UserVal,
    },
    std::FunctionKind,
};
use async_recursion::async_recursion;
use serde_json::Value as JValue;

impl BinaryPart {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        match self {
            BinaryPart::Literal(literal) => Ok(literal.into()),
            BinaryPart::Identifier(identifier) => {
                let value = exec_state.memory.get(&identifier.name, identifier.into())?;
                Ok(value.clone())
            }
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, ctx).await,
            BinaryPart::CallExpression(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, ctx).await,
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(exec_state),
            BinaryPart::IfExpression(e) => e.get_result(exec_state, ctx).await,
        }
    }
}

impl MemberExpression {
    pub fn get_result_array(&self, exec_state: &mut ExecState, index: usize) -> Result<KclValue, KclError> {
        let array = match &self.object {
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(exec_state)?,
            MemberObject::Identifier(identifier) => {
                let value = exec_state.memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        };

        let array_json = array.get_json_value()?;

        if let serde_json::Value::Array(array) = array_json {
            if let Some(value) = array.get(index) {
                Ok(KclValue::UserVal(UserVal {
                    value: value.clone(),
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                }))
            } else {
                Err(KclError::UndefinedValue(KclErrorDetails {
                    message: format!("index {} not found in array", index),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        } else {
            Err(KclError::Semantic(KclErrorDetails {
                message: format!("MemberExpression array is not an array: {:?}", array),
                source_ranges: vec![self.clone().into()],
            }))
        }
    }

    pub fn get_result(&self, exec_state: &mut ExecState) -> Result<KclValue, KclError> {
        let property = Property::try_from(self.computed, self.property.clone(), exec_state, self.into())?;
        let object = match &self.object {
            // TODO: Don't use recursion here, use a loop.
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(exec_state)?,
            MemberObject::Identifier(identifier) => {
                let value = exec_state.memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        };

        let object_json = object.get_json_value()?;

        // Check the property and object match -- e.g. ints for arrays, strs for objects.
        match (object_json, property) {
            (JValue::Object(map), Property::String(property)) => {
                if let Some(value) = map.get(&property) {
                    Ok(KclValue::UserVal(UserVal {
                        value: value.clone(),
                        meta: vec![Metadata {
                            source_range: self.into(),
                        }],
                    }))
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Property '{property}' not found in object"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (JValue::Object(_), p) => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Only strings can be used as the property of an object, but you're using a {}",
                    p.type_name()
                ),
                source_ranges: vec![self.clone().into()],
            })),
            (JValue::Array(arr), Property::Number(index)) => {
                let value_of_arr: Option<&JValue> = arr.get(index);
                if let Some(value) = value_of_arr {
                    Ok(KclValue::UserVal(UserVal {
                        value: value.clone(),
                        meta: vec![Metadata {
                            source_range: self.into(),
                        }],
                    }))
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("The array doesn't have any item at index {index}"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (JValue::Array(_), p) => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "Only integers >= 0 can be used as the index of an array, but you're using a {}",
                    p.type_name()
                ),
                source_ranges: vec![self.clone().into()],
            })),
            (being_indexed, _) => {
                let t = human_friendly_type(&being_indexed);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!("Only arrays and objects can be indexed, but you're trying to index a {t}"),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        }
    }
}

impl BinaryExpression {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let left_json_value = self.left.get_result(exec_state, ctx).await?.get_json_value()?;
        let right_json_value = self.right.get_result(exec_state, ctx).await?.get_json_value()?;

        // First check if we are doing string concatenation.
        if self.operator == BinaryOperator::Add {
            if let (Some(left), Some(right)) = (
                parse_json_value_as_string(&left_json_value),
                parse_json_value_as_string(&right_json_value),
            ) {
                let value = serde_json::Value::String(format!("{}{}", left, right));
                return Ok(KclValue::UserVal(UserVal {
                    value,
                    meta: vec![Metadata {
                        source_range: self.into(),
                    }],
                }));
            }
        }

        let left = parse_json_number_as_f64(&left_json_value, self.left.clone().into())?;
        let right = parse_json_number_as_f64(&right_json_value, self.right.clone().into())?;

        let value: serde_json::Value = match self.operator {
            BinaryOperator::Add => (left + right).into(),
            BinaryOperator::Sub => (left - right).into(),
            BinaryOperator::Mul => (left * right).into(),
            BinaryOperator::Div => (left / right).into(),
            BinaryOperator::Mod => (left % right).into(),
            BinaryOperator::Pow => (left.powf(right)).into(),
            BinaryOperator::Eq => (left == right).into(),
            BinaryOperator::Neq => (left != right).into(),
            BinaryOperator::Gt => (left > right).into(),
            BinaryOperator::Gte => (left >= right).into(),
            BinaryOperator::Lt => (left < right).into(),
            BinaryOperator::Lte => (left <= right).into(),
        };

        Ok(KclValue::UserVal(UserVal {
            value,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }
}

impl UnaryExpression {
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        if self.operator == UnaryOperator::Not {
            let value = self.argument.get_result(exec_state, ctx).await?.get_json_value()?;
            let Some(bool_value) = json_as_bool(&value) else {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!("Cannot apply unary operator ! to non-boolean value: {}", value),
                    source_ranges: vec![self.into()],
                }));
            };
            let negated = !bool_value;
            return Ok(KclValue::UserVal(UserVal {
                value: serde_json::Value::Bool(negated),
                meta: vec![Metadata {
                    source_range: self.into(),
                }],
            }));
        }

        let num = parse_json_number_as_f64(
            &self.argument.get_result(exec_state, ctx).await?.get_json_value()?,
            self.into(),
        )?;
        Ok(KclValue::UserVal(UserVal {
            value: (-(num)).into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }
}

pub(crate) async fn execute_pipe_body(
    exec_state: &mut ExecState,
    body: &[Expr],
    source_range: SourceRange,
    ctx: &ExecutorContext,
) -> Result<KclValue, KclError> {
    let Some((first, body)) = body.split_first() else {
        return Err(KclError::Semantic(KclErrorDetails {
            message: "Pipe expressions cannot be empty".to_owned(),
            source_ranges: vec![source_range],
        }));
    };
    // Evaluate the first element in the pipeline.
    // They use the pipe_value from some AST node above this, so that if pipe expression is nested in a larger pipe expression,
    // they use the % from the parent. After all, this pipe expression hasn't been executed yet, so it doesn't have any % value
    // of its own.
    let meta = Metadata {
        source_range: SourceRange([first.start(), first.end()]),
    };
    let output = ctx
        .execute_expr(first, exec_state, &meta, StatementKind::Expression)
        .await?;

    // Now that we've evaluated the first child expression in the pipeline, following child expressions
    // should use the previous child expression for %.
    // This means there's no more need for the previous pipe_value from the parent AST node above this one.
    let previous_pipe_value = std::mem::replace(&mut exec_state.pipe_value, Some(output));
    // Evaluate remaining elements.
    let result = inner_execute_pipe_body(exec_state, body, ctx).await;
    // Restore the previous pipe value.
    exec_state.pipe_value = previous_pipe_value;

    result
}

/// Execute the tail of a pipe expression.  exec_state.pipe_value must be set by
/// the caller.
#[async_recursion]
async fn inner_execute_pipe_body(
    exec_state: &mut ExecState,
    body: &[Expr],
    ctx: &ExecutorContext,
) -> Result<KclValue, KclError> {
    for expression in body {
        match expression {
            Expr::TagDeclarator(_) => {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!("This cannot be in a PipeExpression: {:?}", expression),
                    source_ranges: vec![expression.into()],
                }));
            }
            Expr::Literal(_)
            | Expr::Identifier(_)
            | Expr::BinaryExpression(_)
            | Expr::FunctionExpression(_)
            | Expr::CallExpression(_)
            | Expr::PipeExpression(_)
            | Expr::PipeSubstitution(_)
            | Expr::ArrayExpression(_)
            | Expr::ArrayRangeExpression(_)
            | Expr::ObjectExpression(_)
            | Expr::MemberExpression(_)
            | Expr::UnaryExpression(_)
            | Expr::IfExpression(_)
            | Expr::None(_) => {}
        };
        let metadata = Metadata {
            source_range: SourceRange([expression.start(), expression.end()]),
        };
        let output = ctx
            .execute_expr(expression, exec_state, &metadata, StatementKind::Expression)
            .await?;
        exec_state.pipe_value = Some(output);
    }
    // Safe to unwrap here, because pipe_value always has something pushed in when the `match first` executes.
    let final_output = exec_state.pipe_value.take().unwrap();
    Ok(final_output)
}

impl CallExpression {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee.name;

        let mut fn_args: Vec<KclValue> = Vec::with_capacity(self.arguments.len());

        for arg in &self.arguments {
            let metadata = Metadata {
                source_range: SourceRange::from(arg),
            };
            let result = ctx
                .execute_expr(arg, exec_state, &metadata, StatementKind::Expression)
                .await?;
            fn_args.push(result);
        }

        match ctx.stdlib.get_either(&self.callee.name) {
            FunctionKind::Core(func) => {
                // Attempt to call the function.
                let args = crate::std::Args::new(fn_args, self.into(), ctx.clone());
                let mut result = func.std_lib_fn()(exec_state, args).await?;

                // If the return result is a sketch or solid, we want to update the
                // memory for the tags of the group.
                // TODO: This could probably be done in a better way, but as of now this was my only idea
                // and it works.
                match result {
                    KclValue::UserVal(ref mut uval) => {
                        uval.mutate(|sketch: &mut Sketch| {
                            for (_, tag) in sketch.tags.iter() {
                                exec_state.memory.update_tag(&tag.value, tag.clone())?;
                            }
                            Ok::<_, KclError>(())
                        })?;
                    }
                    KclValue::Solid(ref mut solid) => {
                        for value in &solid.value {
                            if let Some(tag) = value.get_tag() {
                                // Get the past tag and update it.
                                let mut t = if let Some(t) = solid.sketch.tags.get(&tag.name) {
                                    t.clone()
                                } else {
                                    // It's probably a fillet or a chamfer.
                                    // Initialize it.
                                    TagIdentifier {
                                        value: tag.name.clone(),
                                        info: Some(TagEngineInfo {
                                            id: value.get_id(),
                                            tagged: Tagged::Surface(value.clone()),
                                            sketch: solid.id,
                                        }),
                                        meta: vec![Metadata {
                                            source_range: tag.clone().into(),
                                        }],
                                    }
                                };

                                let Some(ref info) = t.info else {
                                    return Err(KclError::Semantic(KclErrorDetails {
                                        message: format!("Tag {} does not have path info", tag.name),
                                        source_ranges: vec![tag.into()],
                                    }));
                                };

                                let mut info = info.clone();
                                info.tagged = Tagged::Surface(value.clone());
                                info.sketch = solid.id;
                                t.info = Some(info);

                                exec_state.memory.update_tag(&tag.name, t.clone())?;

                                // update the sketch tags.
                                solid.sketch.tags.insert(tag.name.clone(), t);
                            }
                        }

                        // Find the stale sketch in memory and update it.
                        if let Some(current_env) = exec_state
                            .memory
                            .environments
                            .get_mut(exec_state.memory.current_env.index())
                        {
                            current_env.update_sketch_tags(&solid.sketch);
                        }
                    }
                    _ => {}
                }

                Ok(result)
            }
            FunctionKind::Std(func) => {
                let function_expression = func.function();
                let (required_params, optional_params) =
                    function_expression.required_and_optional_params().map_err(|e| {
                        KclError::Semantic(KclErrorDetails {
                            message: format!("Error getting parts of function: {}", e),
                            source_ranges: vec![self.into()],
                        })
                    })?;
                if fn_args.len() < required_params.len() || fn_args.len() > function_expression.params.len() {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: format!(
                            "this function expected {} arguments, got {}",
                            required_params.len(),
                            fn_args.len(),
                        ),
                        source_ranges: vec![self.into()],
                    }));
                }

                // Add the arguments to the memory.
                let mut fn_memory = exec_state.memory.clone();
                for (index, param) in required_params.iter().enumerate() {
                    fn_memory.add(
                        &param.identifier.name,
                        fn_args.get(index).unwrap().clone(),
                        param.identifier.clone().into(),
                    )?;
                }
                // Add the optional arguments to the memory.
                for (index, param) in optional_params.iter().enumerate() {
                    if let Some(arg) = fn_args.get(index + required_params.len()) {
                        fn_memory.add(&param.identifier.name, arg.clone(), param.identifier.clone().into())?;
                    } else {
                        fn_memory.add(
                            &param.identifier.name,
                            KclValue::UserVal(UserVal {
                                value: serde_json::value::Value::Null,
                                meta: Default::default(),
                            }),
                            param.identifier.clone().into(),
                        )?;
                    }
                }

                let fn_dynamic_state = exec_state.dynamic_state.clone();
                // TODO: Shouldn't we merge program memory into fn_dynamic_state
                // here?

                // Call the stdlib function
                let p = &func.function().body;

                let (exec_result, fn_memory) = {
                    let previous_memory = std::mem::replace(&mut exec_state.memory, fn_memory);
                    let previous_dynamic_state = std::mem::replace(&mut exec_state.dynamic_state, fn_dynamic_state);
                    let result = ctx.inner_execute(p, exec_state, BodyType::Block).await;
                    exec_state.dynamic_state = previous_dynamic_state;
                    let fn_memory = std::mem::replace(&mut exec_state.memory, previous_memory);
                    (result, fn_memory)
                };

                match exec_result {
                    Ok(_) => {}
                    Err(err) => {
                        // We need to override the source ranges so we don't get the embedded kcl
                        // function from the stdlib.
                        return Err(err.override_source_ranges(vec![self.into()]));
                    }
                };
                let out = fn_memory.return_;
                let result = out.ok_or_else(|| {
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of stdlib function {} is undefined", fn_name),
                        source_ranges: vec![self.into()],
                    })
                })?;
                Ok(result)
            }
            FunctionKind::UserDefined => {
                let source_range = SourceRange::from(self);
                // Clone the function so that we can use a mutable reference to
                // exec_state.
                let func = exec_state.memory.get(fn_name, source_range)?.clone();
                let fn_dynamic_state = exec_state.dynamic_state.merge(&exec_state.memory);

                let return_value = {
                    let previous_dynamic_state = std::mem::replace(&mut exec_state.dynamic_state, fn_dynamic_state);
                    let result = func.call_fn(fn_args, exec_state, ctx.clone()).await.map_err(|e| {
                        // Add the call expression to the source ranges.
                        e.add_source_ranges(vec![source_range])
                    });
                    exec_state.dynamic_state = previous_dynamic_state;
                    result?
                };

                let result = return_value.ok_or_else(move || {
                    let mut source_ranges: Vec<SourceRange> = vec![source_range];
                    // We want to send the source range of the original function.
                    if let KclValue::Function { meta, .. } = func {
                        source_ranges = meta.iter().map(|m| m.source_range).collect();
                    };
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of user-defined function {} is undefined", fn_name),
                        source_ranges,
                    })
                })?;

                Ok(result)
            }
        }
    }
}

impl TagDeclarator {
    pub async fn execute(&self, exec_state: &mut ExecState) -> Result<KclValue, KclError> {
        let memory_item = KclValue::TagIdentifier(Box::new(TagIdentifier {
            value: self.name.clone(),
            info: None,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }));

        exec_state.memory.add(&self.name, memory_item.clone(), self.into())?;

        Ok(self.into())
    }
}

impl ArrayExpression {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let metadata = Metadata::from(element);
            // TODO: Carry statement kind here so that we know if we're
            // inside a variable declaration.
            let value = ctx
                .execute_expr(element, exec_state, &metadata, StatementKind::Expression)
                .await?;

            results.push(value.get_json_value()?);
        }

        Ok(KclValue::UserVal(UserVal {
            value: results.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }
}

impl ArrayRangeExpression {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let metadata = Metadata::from(&*self.start_element);
        let start = ctx
            .execute_expr(&self.start_element, exec_state, &metadata, StatementKind::Expression)
            .await?
            .get_json_value()?;
        let start = parse_json_number_as_i64(&start, (&*self.start_element).into())?;
        let metadata = Metadata::from(&*self.end_element);
        let end = ctx
            .execute_expr(&self.end_element, exec_state, &metadata, StatementKind::Expression)
            .await?
            .get_json_value()?;
        let end = parse_json_number_as_i64(&end, (&*self.end_element).into())?;

        if end < start {
            return Err(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![self.into()],
                message: format!("Range start is greater than range end: {start} .. {end}"),
            }));
        }

        let range: Vec<_> = if self.end_inclusive {
            (start..=end).map(JValue::from).collect()
        } else {
            (start..end).map(JValue::from).collect()
        };

        Ok(KclValue::UserVal(UserVal {
            value: range.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }
}

impl ObjectExpression {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let mut object = serde_json::Map::new();
        for property in &self.properties {
            let metadata = Metadata::from(&property.value);
            let result = ctx
                .execute_expr(&property.value, exec_state, &metadata, StatementKind::Expression)
                .await?;

            object.insert(property.key.name.clone(), result.get_json_value()?);
        }

        Ok(KclValue::UserVal(UserVal {
            value: object.into(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }))
    }
}

fn parse_json_number_as_i64(j: &serde_json::Value, source_range: SourceRange) -> Result<i64, KclError> {
    if let serde_json::Value::Number(n) = &j {
        n.as_i64().ok_or_else(|| {
            KclError::Syntax(KclErrorDetails {
                source_ranges: vec![source_range],
                message: format!("Invalid integer: {}", j),
            })
        })
    } else {
        Err(KclError::Syntax(KclErrorDetails {
            source_ranges: vec![source_range],
            message: format!("Invalid integer: {}", j),
        }))
    }
}

pub fn parse_json_number_as_f64(j: &serde_json::Value, source_range: SourceRange) -> Result<f64, KclError> {
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

/// JSON value as bool.  If it isn't a bool, returns None.
pub fn json_as_bool(j: &serde_json::Value) -> Option<bool> {
    match j {
        JValue::Null => None,
        JValue::Bool(b) => Some(*b),
        JValue::Number(_) => None,
        JValue::String(_) => None,
        JValue::Array(_) => None,
        JValue::Object(_) => None,
    }
}

impl IfExpression {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        // Check the `if` branch.
        let cond = ctx
            .execute_expr(&self.cond, exec_state, &Metadata::from(self), StatementKind::Expression)
            .await?
            .get_bool()?;
        if cond {
            let block_result = ctx.inner_execute(&self.then_val, exec_state, BodyType::Block).await?;
            // Block must end in an expression, so this has to be Some.
            // Enforced by the parser.
            // See https://github.com/KittyCAD/modeling-app/issues/4015
            return Ok(block_result.unwrap());
        }

        // Check any `else if` branches.
        for else_if in &self.else_ifs {
            let cond = ctx
                .execute_expr(
                    &else_if.cond,
                    exec_state,
                    &Metadata::from(self),
                    StatementKind::Expression,
                )
                .await?
                .get_bool()?;
            if cond {
                let block_result = ctx
                    .inner_execute(&else_if.then_val, exec_state, BodyType::Block)
                    .await?;
                // Block must end in an expression, so this has to be Some.
                // Enforced by the parser.
                // See https://github.com/KittyCAD/modeling-app/issues/4015
                return Ok(block_result.unwrap());
            }
        }

        // Run the final `else` branch.
        ctx.inner_execute(&self.final_else, exec_state, BodyType::Block)
            .await
            .map(|expr| expr.unwrap())
    }
}

#[derive(Debug)]
enum Property {
    Number(usize),
    String(String),
}

impl Property {
    fn try_from(
        computed: bool,
        value: LiteralIdentifier,
        exec_state: &ExecState,
        sr: SourceRange,
    ) -> Result<Self, KclError> {
        let property_sr = vec![sr];
        let property_src: SourceRange = value.clone().into();
        match value {
            LiteralIdentifier::Identifier(identifier) => {
                let name = identifier.name;
                if !computed {
                    // Treat the property as a literal
                    Ok(Property::String(name.to_string()))
                } else {
                    // Actually evaluate memory to compute the property.
                    let prop = exec_state.memory.get(&name, property_src)?;
                    let KclValue::UserVal(prop) = prop else {
                        return Err(KclError::Semantic(KclErrorDetails {
                            source_ranges: property_sr,
                            message: format!(
                                "{name} is not a valid property/index, you can only use a string or int (>= 0) here",
                            ),
                        }));
                    };
                    jvalue_to_prop(&prop.value, property_sr, &name)
                }
            }
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                match value {
                    LiteralValue::IInteger(x) => {
                        if let Ok(x) = u64::try_from(x) {
                            Ok(Property::Number(x.try_into().unwrap()))
                        } else {
                            Err(KclError::Semantic(KclErrorDetails {
                                source_ranges: property_sr,
                                message: format!("{x} is not a valid index, indices must be whole numbers >= 0"),
                            }))
                        }
                    }
                    LiteralValue::String(s) => Ok(Property::String(s)),
                    _ => Err(KclError::Semantic(KclErrorDetails {
                        source_ranges: vec![sr],
                        message: "Only strings or ints (>= 0) can be properties/indexes".to_owned(),
                    })),
                }
            }
        }
    }
}

fn jvalue_to_prop(value: &JValue, property_sr: Vec<SourceRange>, name: &str) -> Result<Property, KclError> {
    let make_err = |message: String| {
        Err::<Property, _>(KclError::Semantic(KclErrorDetails {
            source_ranges: property_sr,
            message,
        }))
    };
    const MUST_BE_POSINT: &str = "indices must be whole positive numbers";
    const TRY_INT: &str = "try using the int() function to make this a whole number";
    match value {
        JValue::Number(ref num) => {
            let maybe_uint = num.as_u64().and_then(|x| usize::try_from(x).ok());
            if let Some(uint) = maybe_uint {
                Ok(Property::Number(uint))
            } else if let Some(iint) = num.as_i64() {
                make_err(format!("'{iint}' is not a valid index, {MUST_BE_POSINT}"))
            } else if let Some(fnum) = num.as_f64() {
                if fnum < 0.0 {
                    make_err(format!("'{fnum}' is not a valid index, {MUST_BE_POSINT}"))
                } else if fnum.fract() == 0.0 {
                    make_err(format!("'{fnum:.1}' is stored as a fractional number but indices must be whole numbers, {TRY_INT}"))
                } else {
                    make_err(format!("'{fnum}' is not a valid index, {MUST_BE_POSINT}, {TRY_INT}"))
                }
            } else {
                make_err(format!("'{num}' is not a valid index, {MUST_BE_POSINT}"))
            }
        }
        JValue::String(ref x) => Ok(Property::String(x.to_owned())),
        _ => {
            make_err(format!("{name} is not a valid property/index, you can only use a string to get the property of an object, or an int (>= 0) to get an item in an array"))
        }
    }
}
impl Property {
    fn type_name(&self) -> &'static str {
        match self {
            Property::Number(_) => "number",
            Property::String(_) => "string",
        }
    }
}
