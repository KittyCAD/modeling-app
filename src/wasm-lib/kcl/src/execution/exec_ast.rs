use std::collections::HashMap;

use async_recursion::async_recursion;

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        BodyType, ExecState, ExecutorContext, KclValue, Metadata, StatementKind, TagEngineInfo, TagIdentifier,
    },
    parsing::ast::types::{
        ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart, CallExpression,
        CallExpressionKw, Expr, IfExpression, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject, Node,
        ObjectExpression, PipeExpression, TagDeclarator, UnaryExpression, UnaryOperator,
    },
    source_range::SourceRange,
    std::{
        args::{Arg, KwArgs},
        FunctionKind,
    },
};

use super::cad_op::{OpArg, Operation};

const FLOAT_TO_INT_MAX_DELTA: f64 = 0.01;

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
            BinaryPart::CallExpressionKw(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, ctx).await,
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(exec_state),
            BinaryPart::IfExpression(e) => e.get_result(exec_state, ctx).await,
        }
    }
}

impl Node<MemberExpression> {
    pub fn get_result_array(&self, exec_state: &mut ExecState, index: usize) -> Result<KclValue, KclError> {
        let array = match &self.object {
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(exec_state)?,
            MemberObject::Identifier(identifier) => {
                let value = exec_state.memory.get(&identifier.name, identifier.into())?;
                value.clone()
            }
        };

        let KclValue::Array { value: array, meta: _ } = array else {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("MemberExpression array is not an array: {:?}", array),
                source_ranges: vec![self.clone().into()],
            }));
        };

        if let Some(value) = array.get(index) {
            Ok(value.to_owned())
        } else {
            Err(KclError::UndefinedValue(KclErrorDetails {
                message: format!("index {} not found in array", index),
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

        // Check the property and object match -- e.g. ints for arrays, strs for objects.
        match (object, property) {
            (KclValue::Object { value: map, meta: _ }, Property::String(property)) => {
                if let Some(value) = map.get(&property) {
                    Ok(value.to_owned())
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Property '{property}' not found in object"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (KclValue::Object { .. }, p) => {
                let t = p.type_name();
                let article = article_for(t);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Only strings can be used as the property of an object, but you're using {article} {t}",
                    ),
                    source_ranges: vec![self.clone().into()],
                }))
            }
            (KclValue::Array { value: arr, meta: _ }, Property::UInt(index)) => {
                let value_of_arr = arr.get(index);
                if let Some(value) = value_of_arr {
                    Ok(value.to_owned())
                } else {
                    Err(KclError::UndefinedValue(KclErrorDetails {
                        message: format!("The array doesn't have any item at index {index}"),
                        source_ranges: vec![self.clone().into()],
                    }))
                }
            }
            (KclValue::Array { .. }, p) => {
                let t = p.type_name();
                let article = article_for(t);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Only integers >= 0 can be used as the index of an array, but you're using {article} {t}",
                    ),
                    source_ranges: vec![self.clone().into()],
                }))
            }
            (KclValue::Solid(solid), Property::String(prop)) if prop == "sketch" => Ok(KclValue::Sketch {
                value: Box::new(solid.sketch),
            }),
            (KclValue::Sketch { value: sk }, Property::String(prop)) if prop == "tags" => Ok(KclValue::Object {
                meta: vec![Metadata {
                    source_range: SourceRange::from(self.clone()),
                }],
                value: sk
                    .tags
                    .iter()
                    .map(|(k, tag)| (k.to_owned(), KclValue::TagIdentifier(Box::new(tag.to_owned()))))
                    .collect(),
            }),
            (being_indexed, _) => {
                let t = being_indexed.human_friendly_type();
                let article = article_for(t);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Only arrays and objects can be indexed, but you're trying to index {article} {t}"
                    ),
                    source_ranges: vec![self.clone().into()],
                }))
            }
        }
    }
}

impl Node<BinaryExpression> {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let left_value = self.left.get_result(exec_state, ctx).await?;
        let right_value = self.right.get_result(exec_state, ctx).await?;
        let mut meta = left_value.metadata();
        meta.extend(right_value.metadata());

        // First check if we are doing string concatenation.
        if self.operator == BinaryOperator::Add {
            if let (KclValue::String { value: left, meta: _ }, KclValue::String { value: right, meta: _ }) =
                (&left_value, &right_value)
            {
                return Ok(KclValue::String {
                    value: format!("{}{}", left, right),
                    meta,
                });
            }
        }

        let left = parse_number_as_f64(&left_value, self.left.clone().into())?;
        let right = parse_number_as_f64(&right_value, self.right.clone().into())?;

        let value = match self.operator {
            BinaryOperator::Add => KclValue::Number {
                value: left + right,
                meta,
            },
            BinaryOperator::Sub => KclValue::Number {
                value: left - right,
                meta,
            },
            BinaryOperator::Mul => KclValue::Number {
                value: left * right,
                meta,
            },
            BinaryOperator::Div => KclValue::Number {
                value: left / right,
                meta,
            },
            BinaryOperator::Mod => KclValue::Number {
                value: left % right,
                meta,
            },
            BinaryOperator::Pow => KclValue::Number {
                value: left.powf(right),
                meta,
            },
            BinaryOperator::Neq => KclValue::Bool {
                value: left != right,
                meta,
            },
            BinaryOperator::Gt => KclValue::Bool {
                value: left > right,
                meta,
            },
            BinaryOperator::Gte => KclValue::Bool {
                value: left >= right,
                meta,
            },
            BinaryOperator::Lt => KclValue::Bool {
                value: left < right,
                meta,
            },
            BinaryOperator::Lte => KclValue::Bool {
                value: left <= right,
                meta,
            },
            BinaryOperator::Eq => KclValue::Bool {
                value: left == right,
                meta,
            },
        };

        Ok(value)
    }
}

impl Node<UnaryExpression> {
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        if self.operator == UnaryOperator::Not {
            let value = self.argument.get_result(exec_state, ctx).await?;
            let KclValue::Bool {
                value: bool_value,
                meta: _,
            } = value
            else {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Cannot apply unary operator ! to non-boolean value: {}",
                        value.human_friendly_type()
                    ),
                    source_ranges: vec![self.into()],
                }));
            };
            let meta = vec![Metadata {
                source_range: self.into(),
            }];
            let negated = KclValue::Bool {
                value: !bool_value,
                meta,
            };

            return Ok(negated);
        }

        let value = &self.argument.get_result(exec_state, ctx).await?;
        match value {
            KclValue::Number { value, meta: _ } => {
                let meta = vec![Metadata {
                    source_range: self.into(),
                }];
                Ok(KclValue::Number { value: -value, meta })
            }
            KclValue::Int { value, meta: _ } => {
                let meta = vec![Metadata {
                    source_range: self.into(),
                }];
                Ok(KclValue::Number {
                    value: (-value) as f64,
                    meta,
                })
            }
            _ => Err(KclError::Semantic(KclErrorDetails {
                message: format!(
                    "You can only negate numbers, but this is a {}",
                    value.human_friendly_type()
                ),
                source_ranges: vec![self.into()],
            })),
        }
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
        source_range: SourceRange::from(first),
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
        if let Expr::TagDeclarator(_) = expression {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("This cannot be in a PipeExpression: {:?}", expression),
                source_ranges: vec![expression.into()],
            }));
        }
        let metadata = Metadata {
            source_range: SourceRange::from(expression),
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

impl Node<CallExpressionKw> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee.name;
        let callsite: SourceRange = self.into();

        // Build a hashmap from argument labels to the final evaluated values.
        let mut fn_args = HashMap::with_capacity(self.arguments.len());
        let mut tag_declarator_args = Vec::new();
        for arg_expr in &self.arguments {
            let source_range = SourceRange::from(arg_expr.arg.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(&arg_expr.arg, exec_state, &metadata, StatementKind::Expression)
                .await?;
            fn_args.insert(arg_expr.label.name.clone(), Arg::new(value, source_range));
            if let Expr::TagDeclarator(td) = &arg_expr.arg {
                tag_declarator_args.push((td.inner.clone(), source_range));
            }
        }
        let fn_args = fn_args; // remove mutability
        let tag_declarator_args = tag_declarator_args; // remove mutability

        // Evaluate the unlabeled first param, if any exists.
        let unlabeled = if let Some(ref arg_expr) = self.unlabeled {
            let source_range = SourceRange::from(arg_expr.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, StatementKind::Expression)
                .await?;
            Some(Arg::new(value, source_range))
        } else {
            None
        };

        let args = crate::std::Args::new_kw(
            KwArgs {
                unlabeled,
                labeled: fn_args,
            },
            self.into(),
            ctx.clone(),
        );
        match ctx.stdlib.get_either(fn_name) {
            FunctionKind::Core(func) => {
                if func.feature_tree_operation() {
                    // Track call operation.
                    let op_labeled_args = args
                        .kw_args
                        .labeled
                        .iter()
                        .map(|(k, v)| (k.clone(), OpArg::new(v.source_range)))
                        .collect();
                    exec_state.operations.push(Operation::StdLibCall {
                        std_lib_fn: (&func).into(),
                        unlabeled_arg: args.kw_args.unlabeled.as_ref().map(|arg| OpArg::new(arg.source_range)),
                        labeled_args: op_labeled_args,
                        source_range: callsite,
                    });
                }

                // Attempt to call the function.
                let mut result = func.std_lib_fn()(exec_state, args).await?;
                update_memory_for_tags_of_geometry(&mut result, &tag_declarator_args, exec_state)?;
                Ok(result)
            }
            FunctionKind::UserDefined => {
                let source_range = SourceRange::from(self);
                // Clone the function so that we can use a mutable reference to
                // exec_state.
                let func = exec_state.memory.get(fn_name, source_range)?.clone();
                let fn_dynamic_state = exec_state.dynamic_state.merge(&exec_state.memory);

                // Track call operation.
                let op_labeled_args = args
                    .kw_args
                    .labeled
                    .iter()
                    .map(|(k, v)| (k.clone(), OpArg::new(v.source_range)))
                    .collect();
                exec_state.operations.push(Operation::UserDefinedFunctionCall {
                    name: Some(fn_name.clone()),
                    function_source_range: func.first_source_range().unwrap_or_default(),
                    unlabeled_arg: args.kw_args.unlabeled.as_ref().map(|arg| OpArg::new(arg.source_range)),
                    labeled_args: op_labeled_args,
                    source_range: callsite,
                });

                let return_value = {
                    let previous_dynamic_state = std::mem::replace(&mut exec_state.dynamic_state, fn_dynamic_state);
                    let result = func
                        .call_fn_kw(args, exec_state, ctx.clone(), callsite)
                        .await
                        .map_err(|e| {
                            // Add the call expression to the source ranges.
                            // TODO currently ignored by the frontend
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

                // Track return operation.
                exec_state.operations.push(Operation::UserDefinedFunctionReturn);

                Ok(result)
            }
        }
    }
}

impl Node<CallExpression> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee.name;
        let callsite = SourceRange::from(self);

        let mut fn_args: Vec<Arg> = Vec::with_capacity(self.arguments.len());
        let mut tag_declarator_args = Vec::new();

        for arg_expr in &self.arguments {
            let metadata = Metadata {
                source_range: SourceRange::from(arg_expr),
            };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, StatementKind::Expression)
                .await?;
            let arg = Arg::new(value, SourceRange::from(arg_expr));
            if let Expr::TagDeclarator(td) = arg_expr {
                tag_declarator_args.push((td.inner.clone(), arg.source_range));
            }
            fn_args.push(arg);
        }
        let fn_args = fn_args; // remove mutability
        let tag_declarator_args = tag_declarator_args; // remove mutability

        match ctx.stdlib.get_either(fn_name) {
            FunctionKind::Core(func) => {
                if func.feature_tree_operation() {
                    // Track call operation.
                    let op_labeled_args = func
                        .args(false)
                        .iter()
                        .zip(&fn_args)
                        .map(|(k, v)| (k.name.clone(), OpArg::new(v.source_range)))
                        .collect();
                    exec_state.operations.push(Operation::StdLibCall {
                        std_lib_fn: (&func).into(),
                        unlabeled_arg: None,
                        labeled_args: op_labeled_args,
                        source_range: callsite,
                    });
                }

                // Attempt to call the function.
                let args = crate::std::Args::new(fn_args, self.into(), ctx.clone());
                let mut result = func.std_lib_fn()(exec_state, args).await?;
                update_memory_for_tags_of_geometry(&mut result, &tag_declarator_args, exec_state)?;
                Ok(result)
            }
            FunctionKind::UserDefined => {
                let source_range = SourceRange::from(self);
                // Clone the function so that we can use a mutable reference to
                // exec_state.
                let func = exec_state.memory.get(fn_name, source_range)?.clone();
                let fn_dynamic_state = exec_state.dynamic_state.merge(&exec_state.memory);

                // Track call operation.
                exec_state.operations.push(Operation::UserDefinedFunctionCall {
                    name: Some(fn_name.clone()),
                    function_source_range: func.first_source_range().unwrap_or_default(),
                    unlabeled_arg: None,
                    // TODO: Add the arguments for legacy positional parameters.
                    labeled_args: Default::default(),
                    source_range: callsite,
                });

                let return_value = {
                    let previous_dynamic_state = std::mem::replace(&mut exec_state.dynamic_state, fn_dynamic_state);
                    let result = func.call_fn(fn_args, exec_state, ctx.clone()).await.map_err(|e| {
                        // Add the call expression to the source ranges.
                        // TODO currently ignored by the frontend
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

                // Track return operation.
                exec_state.operations.push(Operation::UserDefinedFunctionReturn);

                Ok(result)
            }
        }
    }
}

/// `tag_declarator_args` should only contain tag declarator literals, which
/// will be defined as local variables.  Non-literals that evaluate to tag
/// declarators should not be defined.
fn update_memory_for_tags_of_geometry(
    result: &mut KclValue,
    tag_declarator_args: &[(TagDeclarator, SourceRange)],
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    // Define all the tags in the memory.
    for (tag_declarator, arg_sr) in tag_declarator_args {
        let tag = TagIdentifier {
            value: tag_declarator.name.clone(),
            info: None,
            meta: vec![Metadata { source_range: *arg_sr }],
        };

        exec_state.memory.add_tag(&tag.value, tag.clone(), *arg_sr)?;
    }
    // If the return result is a sketch or solid, we want to update the
    // memory for the tags of the group.
    // TODO: This could probably be done in a better way, but as of now this was my only idea
    // and it works.
    match result {
        KclValue::Sketch { value: ref mut sketch } => {
            for (_, tag) in sketch.tags.iter() {
                exec_state.memory.update_tag_if_defined(&tag.value, tag.clone());
            }
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
                                surface: Some(value.clone()),
                                path: None,
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
                    info.surface = Some(value.clone());
                    info.sketch = solid.id;
                    t.info = Some(info);

                    exec_state.memory.update_tag_if_defined(&tag.name, t.clone());

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
    Ok(())
}

impl Node<ArrayExpression> {
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

            results.push(value);
        }

        Ok(KclValue::Array {
            value: results,
            meta: vec![self.into()],
        })
    }
}

impl Node<ArrayRangeExpression> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let metadata = Metadata::from(&self.start_element);
        let start = ctx
            .execute_expr(&self.start_element, exec_state, &metadata, StatementKind::Expression)
            .await?;
        let start = start.as_int().ok_or(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![self.into()],
            message: format!("Expected int but found {}", start.human_friendly_type()),
        }))?;
        let metadata = Metadata::from(&self.end_element);
        let end = ctx
            .execute_expr(&self.end_element, exec_state, &metadata, StatementKind::Expression)
            .await?;
        let end = end.as_int().ok_or(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![self.into()],
            message: format!("Expected int but found {}", end.human_friendly_type()),
        }))?;

        if end < start {
            return Err(KclError::Semantic(KclErrorDetails {
                source_ranges: vec![self.into()],
                message: format!("Range start is greater than range end: {start} .. {end}"),
            }));
        }

        let range: Vec<_> = if self.end_inclusive {
            (start..=end).collect()
        } else {
            (start..end).collect()
        };

        let meta = vec![Metadata {
            source_range: self.into(),
        }];
        Ok(KclValue::Array {
            value: range
                .into_iter()
                .map(|num| KclValue::Int {
                    value: num,
                    meta: meta.clone(),
                })
                .collect(),
            meta,
        })
    }
}

impl Node<ObjectExpression> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let mut object = HashMap::with_capacity(self.properties.len());
        for property in &self.properties {
            let metadata = Metadata::from(&property.value);
            let result = ctx
                .execute_expr(&property.value, exec_state, &metadata, StatementKind::Expression)
                .await?;

            object.insert(property.key.name.clone(), result);
        }

        Ok(KclValue::Object {
            value: object,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        })
    }
}

fn article_for(s: &str) -> &'static str {
    if s.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    }
}

pub fn parse_number_as_f64(v: &KclValue, source_range: SourceRange) -> Result<f64, KclError> {
    if let KclValue::Number { value: n, .. } = &v {
        Ok(*n)
    } else if let KclValue::Int { value: n, .. } = &v {
        Ok(*n as f64)
    } else {
        let actual_type = v.human_friendly_type();
        let article = if actual_type.starts_with(['a', 'e', 'i', 'o', 'u']) {
            "an"
        } else {
            "a"
        };
        Err(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![source_range],
            message: format!("Expected a number, but found {article} {actual_type}",),
        }))
    }
}

impl Node<IfExpression> {
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
    UInt(usize),
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
                let name = &identifier.name;
                if !computed {
                    // Treat the property as a literal
                    Ok(Property::String(name.to_string()))
                } else {
                    // Actually evaluate memory to compute the property.
                    let prop = exec_state.memory.get(name, property_src)?;
                    jvalue_to_prop(prop, property_sr, name)
                }
            }
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                match value {
                    LiteralValue::Number(x) => {
                        if let Some(x) = crate::try_f64_to_usize(x) {
                            Ok(Property::UInt(x))
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
                        message: "Only strings or numbers (>= 0) can be properties/indexes".to_owned(),
                    })),
                }
            }
        }
    }
}

fn jvalue_to_prop(value: &KclValue, property_sr: Vec<SourceRange>, name: &str) -> Result<Property, KclError> {
    let make_err = |message: String| {
        Err::<Property, _>(KclError::Semantic(KclErrorDetails {
            source_ranges: property_sr,
            message,
        }))
    };
    match value {
        KclValue::Int { value:num, meta: _ } => {
            let maybe_int: Result<usize, _> = (*num).try_into();
            if let Ok(uint) = maybe_int {
                Ok(Property::UInt(uint))
            }
            else {
                make_err(format!("'{num}' is negative, so you can't index an array with it"))
            }
        }
        KclValue::Number{value: num, meta:_} => {
            let num = *num;
            if num < 0.0 {
                return make_err(format!("'{num}' is negative, so you can't index an array with it"))
            }
            let nearest_int = num.round();
            let delta = num-nearest_int;
            if delta < FLOAT_TO_INT_MAX_DELTA {
                Ok(Property::UInt(nearest_int as usize))
            } else {
                make_err(format!("'{num}' is not an integer, so you can't index an array with it"))
            }
        }
        KclValue::String{value: x, meta:_} => Ok(Property::String(x.to_owned())),
        _ => {
            make_err(format!("{name} is not a valid property/index, you can only use a string to get the property of an object, or an int (>= 0) to get an item in an array"))
        }
    }
}
impl Property {
    fn type_name(&self) -> &'static str {
        match self {
            Property::UInt(_) => "number",
            Property::String(_) => "string",
        }
    }
}

impl Node<PipeExpression> {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        execute_pipe_body(exec_state, &self.body, self.into(), ctx).await
    }
}
