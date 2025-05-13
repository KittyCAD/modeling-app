use async_recursion::async_recursion;
use indexmap::IndexMap;

#[cfg(feature = "artifact-graph")]
use crate::execution::cad_op::{Group, OpArg, OpKclValue, Operation};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        kcl_value::FunctionSource, memory, types::RuntimeType, BodyType, ExecState, ExecutorContext, KclValue,
        Metadata, StatementKind, TagEngineInfo, TagIdentifier,
    },
    parsing::ast::types::{CallExpressionKw, FunctionExpression, Node, NodeRef},
    source_range::SourceRange,
    CompilationError,
};

#[derive(Debug, Clone)]
pub struct Args {
    /// Positional args.
    pub args: Vec<Arg>,
    /// Keyword arguments
    pub kw_args: KwArgs,
    pub source_range: SourceRange,
    pub ctx: ExecutorContext,
    /// If this call happens inside a pipe (|>) expression, this holds the LHS of that |>.
    /// Otherwise it's None.
    pub pipe_value: Option<Arg>,
}

impl Args {
    pub fn new(args: Vec<Arg>, source_range: SourceRange, ctx: ExecutorContext, pipe_value: Option<Arg>) -> Self {
        Self {
            args,
            kw_args: Default::default(),
            source_range,
            ctx,
            pipe_value,
        }
    }

    /// Collect the given keyword arguments.
    pub fn new_kw(kw_args: KwArgs, source_range: SourceRange, ctx: ExecutorContext, pipe_value: Option<Arg>) -> Self {
        Self {
            args: Default::default(),
            kw_args,
            source_range,
            ctx,
            pipe_value,
        }
    }

    /// Get the unlabeled keyword argument. If not set, returns None.
    pub(crate) fn unlabeled_kw_arg_unconverted(&self) -> Option<&Arg> {
        self.kw_args
            .unlabeled
            .as_ref()
            .map(|(_, a)| a)
            .or(self.args.first())
            .or(self.pipe_value.as_ref())
    }
}

#[derive(Debug, Clone)]
pub struct Arg {
    /// The evaluated argument.
    pub value: KclValue,
    /// The source range of the unevaluated argument.
    pub source_range: SourceRange,
}

impl Arg {
    pub fn new(value: KclValue, source_range: SourceRange) -> Self {
        Self { value, source_range }
    }

    pub fn synthetic(value: KclValue) -> Self {
        Self {
            value,
            source_range: SourceRange::synthetic(),
        }
    }

    pub fn source_ranges(&self) -> Vec<SourceRange> {
        vec![self.source_range]
    }
}

#[derive(Debug, Clone, Default)]
pub struct KwArgs {
    /// Unlabeled keyword args. Currently only the first arg can be unlabeled.
    /// If the argument was a local variable, then the first element of the tuple is its name
    /// which may be used to treat this arg as a labelled arg.
    pub unlabeled: Option<(Option<String>, Arg)>,
    /// Labeled args.
    pub labeled: IndexMap<String, Arg>,
    pub errors: Vec<Arg>,
}

impl KwArgs {
    /// How many arguments are there?
    pub fn len(&self) -> usize {
        self.labeled.len() + if self.unlabeled.is_some() { 1 } else { 0 }
    }
    /// Are there no arguments?
    pub fn is_empty(&self) -> bool {
        self.labeled.len() == 0 && self.unlabeled.is_none()
    }
}

impl Node<CallExpressionKw> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee;
        let callsite: SourceRange = self.into();

        // Build a hashmap from argument labels to the final evaluated values.
        let mut fn_args = IndexMap::with_capacity(self.arguments.len());
        let mut errors = Vec::new();
        for arg_expr in &self.arguments {
            let source_range = SourceRange::from(arg_expr.arg.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(&arg_expr.arg, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            let arg = Arg::new(value, source_range);
            match &arg_expr.label {
                Some(l) => {
                    fn_args.insert(l.name.clone(), arg);
                }
                None => {
                    if let Some(id) = arg_expr.arg.ident_name() {
                        fn_args.insert(id.to_owned(), arg);
                    } else {
                        errors.push(arg);
                    }
                }
            }
        }

        // Evaluate the unlabeled first param, if any exists.
        let unlabeled = if let Some(ref arg_expr) = self.unlabeled {
            let source_range = SourceRange::from(arg_expr.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;

            let label = arg_expr.ident_name().map(str::to_owned);

            Some((label, Arg::new(value, source_range)))
        } else {
            None
        };

        let mut args = Args::new_kw(
            KwArgs {
                unlabeled,
                labeled: fn_args,
                errors,
            },
            self.into(),
            ctx.clone(),
            exec_state.pipe_value().map(|v| Arg::new(v.clone(), callsite)),
        );

        match ctx.stdlib.get_rust_function(fn_name) {
            Some(func) => {
                if func.deprecated() {
                    exec_state.warn(CompilationError::err(
                        self.callee.as_source_range(),
                        format!("`{fn_name}` is deprecated, see the docs for a recommended replacement"),
                    ));
                }

                let formals = func.args(false);

                // If it's possible the input arg was meant to be labelled and we probably don't want to use
                // it as the input arg, then treat it as labelled.
                if let Some((Some(label), _)) = &args.kw_args.unlabeled {
                    if (formals.iter().all(|a| a.label_required) || exec_state.pipe_value().is_some())
                        && formals.iter().any(|a| &a.name == label && a.label_required)
                        && !args.kw_args.labeled.contains_key(label)
                    {
                        let (label, arg) = args.kw_args.unlabeled.take().unwrap();
                        args.kw_args.labeled.insert(label.unwrap(), arg);
                    }
                }

                let op = if func.feature_tree_operation() && cfg!(feature = "artifact-graph") {
                    let op_labeled_args = args
                        .kw_args
                        .labeled
                        .iter()
                        .map(|(k, arg)| (k.clone(), OpArg::new(OpKclValue::from(&arg.value), arg.source_range)))
                        .collect();
                    Some(Operation::StdLibCall {
                        std_lib_fn: (&func).into(),
                        unlabeled_arg: args
                            .unlabeled_kw_arg_unconverted()
                            .map(|arg| OpArg::new(OpKclValue::from(&arg.value), arg.source_range)),
                        labeled_args: op_labeled_args,
                        source_range: callsite,
                        is_error: false,
                    })
                } else {
                    None
                };

                for (label, arg) in &args.kw_args.labeled {
                    match formals.iter().find(|p| &p.name == label) {
                        Some(p) => {
                            if !p.label_required {
                                exec_state.err(CompilationError::err(
                                    arg.source_range,
                                    format!(
                                        "The function `{fn_name}` expects an unlabeled first parameter (`{label}`), but it is labelled in the call"
                                    ),
                                ));
                            }
                        }
                        None => {
                            exec_state.err(CompilationError::err(
                                arg.source_range,
                                format!("`{label}` is not an argument of `{fn_name}`"),
                            ));
                        }
                    }
                }

                // Attempt to call the function.
                let mut return_value = {
                    // Don't early-return in this block.
                    exec_state.mut_stack().push_new_env_for_rust_call();
                    let result = func.std_lib_fn()(exec_state, args).await;
                    exec_state.mut_stack().pop_env();

                    if let Some(mut op) = op {
                        op.set_std_lib_call_is_error(result.is_err());
                        // Track call operation.  We do this after the call
                        // since things like patternTransform may call user code
                        // before running, and we will likely want to use the
                        // return value. The call takes ownership of the args,
                        // so we need to build the op before the call.
                        exec_state.push_op(op);
                    }

                    result
                }?;

                update_memory_for_tags_of_geometry(&mut return_value, exec_state)?;

                Ok(return_value)
            }
            None => {
                // Clone the function so that we can use a mutable reference to
                // exec_state.
                let func = fn_name.get_result(exec_state, ctx).await?.clone();

                let Some(fn_src) = func.as_fn() else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: "cannot call this because it isn't a function".to_string(),
                        source_ranges: vec![callsite],
                    }));
                };

                let return_value = fn_src
                    .call_kw(Some(fn_name.to_string()), exec_state, ctx, args, callsite)
                    .await
                    .map_err(|e| {
                        // Add the call expression to the source ranges.
                        // TODO currently ignored by the frontend
                        e.add_source_ranges(vec![callsite])
                    })?;

                let result = return_value.ok_or_else(move || {
                    let mut source_ranges: Vec<SourceRange> = vec![callsite];
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

fn update_memory_for_tags_of_geometry(result: &mut KclValue, exec_state: &mut ExecState) -> Result<(), KclError> {
    // If the return result is a sketch or solid, we want to update the
    // memory for the tags of the group.
    // TODO: This could probably be done in a better way, but as of now this was my only idea
    // and it works.
    match result {
        KclValue::Sketch { value } => {
            for (name, tag) in value.tags.iter() {
                if exec_state.stack().cur_frame_contains(name) {
                    exec_state.mut_stack().update(name, |v, _| {
                        v.as_mut_tag().unwrap().merge_info(tag);
                    });
                } else {
                    exec_state
                        .mut_stack()
                        .add(
                            name.to_owned(),
                            KclValue::TagIdentifier(Box::new(tag.clone())),
                            SourceRange::default(),
                        )
                        .unwrap();
                }
            }
        }
        KclValue::Solid { ref mut value } => {
            for v in &value.value {
                if let Some(tag) = v.get_tag() {
                    // Get the past tag and update it.
                    let tag_id = if let Some(t) = value.sketch.tags.get(&tag.name) {
                        let mut t = t.clone();
                        let Some(info) = t.get_cur_info() else {
                            return Err(KclError::Internal(KclErrorDetails {
                                message: format!("Tag {} does not have path info", tag.name),
                                source_ranges: vec![tag.into()],
                            }));
                        };

                        let mut info = info.clone();
                        info.surface = Some(v.clone());
                        info.sketch = value.id;
                        t.info.push((exec_state.stack().current_epoch(), info));
                        t
                    } else {
                        // It's probably a fillet or a chamfer.
                        // Initialize it.
                        TagIdentifier {
                            value: tag.name.clone(),
                            info: vec![(
                                exec_state.stack().current_epoch(),
                                TagEngineInfo {
                                    id: v.get_id(),
                                    surface: Some(v.clone()),
                                    path: None,
                                    sketch: value.id,
                                },
                            )],
                            meta: vec![Metadata {
                                source_range: tag.clone().into(),
                            }],
                        }
                    };

                    // update the sketch tags.
                    value.sketch.merge_tags(Some(&tag_id).into_iter());

                    if exec_state.stack().cur_frame_contains(&tag.name) {
                        exec_state.mut_stack().update(&tag.name, |v, _| {
                            v.as_mut_tag().unwrap().merge_info(&tag_id);
                        });
                    } else {
                        exec_state
                            .mut_stack()
                            .add(
                                tag.name.clone(),
                                KclValue::TagIdentifier(Box::new(tag_id)),
                                SourceRange::default(),
                            )
                            .unwrap();
                    }
                }
            }

            // Find the stale sketch in memory and update it.
            if !value.sketch.tags.is_empty() {
                let sketches_to_update: Vec<_> = exec_state
                    .stack()
                    .find_keys_in_current_env(|v| match v {
                        KclValue::Sketch { value: sk } => sk.original_id == value.sketch.original_id,
                        _ => false,
                    })
                    .cloned()
                    .collect();

                for k in sketches_to_update {
                    exec_state.mut_stack().update(&k, |v, _| {
                        let sketch = v.as_mut_sketch().unwrap();
                        sketch.merge_tags(value.sketch.tags.values());
                    });
                }
            }
        }
        KclValue::Tuple { value, .. } | KclValue::HomArray { value, .. } => {
            for v in value {
                update_memory_for_tags_of_geometry(v, exec_state)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn type_check_params_kw(
    fn_name: Option<&str>,
    function_expression: NodeRef<'_, FunctionExpression>,
    args: &mut KwArgs,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    // If it's possible the input arg was meant to be labelled and we probably don't want to use
    // it as the input arg, then treat it as labelled.
    if let Some((Some(label), _)) = &args.unlabeled {
        if (function_expression.params.iter().all(|p| p.labeled) || exec_state.pipe_value().is_some())
            && function_expression
                .params
                .iter()
                .any(|p| &p.identifier.name == label && p.labeled)
            && !args.labeled.contains_key(label)
        {
            let (label, arg) = args.unlabeled.take().unwrap();
            args.labeled.insert(label.unwrap(), arg);
        }
    }

    for (label, arg) in &mut args.labeled {
        match function_expression.params.iter().find(|p| &p.identifier.name == label) {
            Some(p) => {
                if !p.labeled {
                    exec_state.err(CompilationError::err(
                        arg.source_range,
                        format!(
                            "{} expects an unlabeled first parameter (`{label}`), but it is labelled in the call",
                            fn_name
                                .map(|n| format!("The function `{}`", n))
                                .unwrap_or_else(|| "This function".to_owned()),
                        ),
                    ));
                }

                if let Some(ty) = &p.type_ {
                    arg.value = arg
                        .value
                        .coerce(
                            &RuntimeType::from_parsed(ty.inner.clone(), exec_state, arg.source_range).map_err(|e| KclError::Semantic(e.into()))?,
                            exec_state,
                        )
                        .map_err(|e| {
                            let mut message = format!(
                                "{label} requires a value with type `{}`, but found {}",
                                ty.inner,
                                arg.value.human_friendly_type(),
                            );
                            if let Some(ty) = e.explicit_coercion {
                                // TODO if we have access to the AST for the argument we could choose which example to suggest.
                                message = format!("{message}\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`");
                            }
                            KclError::Semantic(KclErrorDetails {
                                message,
                                source_ranges: vec![arg.source_range],
                            })
                        })?;
                }
            }
            None => {
                exec_state.err(CompilationError::err(
                    arg.source_range,
                    format!(
                        "`{label}` is not an argument of {}",
                        fn_name
                            .map(|n| format!("`{}`", n))
                            .unwrap_or_else(|| "this function".to_owned()),
                    ),
                ));
            }
        }
    }

    if !args.errors.is_empty() {
        let actuals = args.labeled.keys();
        let formals: Vec<_> = function_expression
            .params
            .iter()
            .filter_map(|p| {
                if !p.labeled {
                    return None;
                }

                let name = &p.identifier.name;
                if actuals.clone().any(|a| a == name) {
                    return None;
                }

                Some(format!("`{name}`"))
            })
            .collect();

        let suggestion = if formals.is_empty() {
            String::new()
        } else {
            format!("; suggested labels: {}", formals.join(", "))
        };

        let mut errors = args.errors.iter().map(|e| {
            CompilationError::err(
                e.source_range,
                format!("This argument needs a label, but it doesn't have one{suggestion}"),
            )
        });

        let first = errors.next().unwrap();
        errors.for_each(|e| exec_state.err(e));

        return Err(KclError::Semantic(first.into()));
    }

    if let Some(arg) = &mut args.unlabeled {
        if let Some(p) = function_expression.params.iter().find(|p| !p.labeled) {
            if let Some(ty) = &p.type_ {
                arg.1.value = arg
                    .1
                    .value
                    .coerce(
                        &RuntimeType::from_parsed(ty.inner.clone(), exec_state, arg.1.source_range)
                            .map_err(|e| KclError::Semantic(e.into()))?,
                        exec_state,
                    )
                    .map_err(|_| {
                        KclError::Semantic(KclErrorDetails {
                            message: format!(
                                "The input argument of {} requires a value with type `{}`, but found {}",
                                fn_name
                                    .map(|n| format!("`{}`", n))
                                    .unwrap_or_else(|| "this function".to_owned()),
                                ty.inner,
                                arg.1.value.human_friendly_type()
                            ),
                            source_ranges: vec![arg.1.source_range],
                        })
                    })?;
            }
        }
    }

    Ok(())
}

fn assign_args_to_params_kw(
    fn_name: Option<&str>,
    function_expression: NodeRef<'_, FunctionExpression>,
    mut args: Args,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    type_check_params_kw(fn_name, function_expression, &mut args.kw_args, exec_state)?;

    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    let source_ranges = vec![function_expression.into()];

    for param in function_expression.params.iter() {
        if param.labeled {
            let arg = args.kw_args.labeled.get(&param.identifier.name);
            let arg_val = match arg {
                Some(arg) => arg.value.clone(),
                None => match param.default_value {
                    Some(ref default_val) => KclValue::from_default_param(default_val.clone(), exec_state),
                    None => {
                        return Err(KclError::Semantic(KclErrorDetails {
                            source_ranges,
                            message: format!(
                                "This function requires a parameter {}, but you haven't passed it one.",
                                param.identifier.name
                            ),
                        }));
                    }
                },
            };
            exec_state
                .mut_stack()
                .add(param.identifier.name.clone(), arg_val, (&param.identifier).into())?;
        } else {
            let unlabelled = args.unlabeled_kw_arg_unconverted();

            let Some(unlabeled) = unlabelled else {
                let param_name = &param.identifier.name;
                return Err(if args.kw_args.labeled.contains_key(param_name) {
                    KclError::Semantic(KclErrorDetails {
                        source_ranges,
                        message: format!("The function does declare a parameter named '{param_name}', but this parameter doesn't use a label. Try removing the `{param_name}:`"),
                    })
                } else {
                    KclError::Semantic(KclErrorDetails {
                        source_ranges,
                        message: "This function expects an unlabeled first parameter, but you haven't passed it one."
                            .to_owned(),
                    })
                });
            };
            exec_state.mut_stack().add(
                param.identifier.name.clone(),
                unlabeled.value.clone(),
                (&param.identifier).into(),
            )?;
        }
    }

    Ok(())
}

fn coerce_result_type(
    result: Result<Option<KclValue>, KclError>,
    function_expression: NodeRef<'_, FunctionExpression>,
    exec_state: &mut ExecState,
) -> Result<Option<KclValue>, KclError> {
    if let Ok(Some(val)) = result {
        if let Some(ret_ty) = &function_expression.return_type {
            let ty = RuntimeType::from_parsed(ret_ty.inner.clone(), exec_state, ret_ty.as_source_range())
                .map_err(|e| KclError::Semantic(e.into()))?;
            let val = val.coerce(&ty, exec_state).map_err(|_| {
                KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "This function requires its result to be of type `{}`, but found {}",
                        ty.human_friendly_type(),
                        val.human_friendly_type(),
                    ),
                    source_ranges: ret_ty.as_source_ranges(),
                })
            })?;
            Ok(Some(val))
        } else {
            Ok(Some(val))
        }
    } else {
        result
    }
}

impl FunctionSource {
    pub async fn call_kw(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        mut args: Args,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        match self {
            FunctionSource::Std { func, ast, props } => {
                if props.deprecated {
                    exec_state.warn(CompilationError::err(
                        callsite,
                        format!(
                            "`{}` is deprecated, see the docs for a recommended replacement",
                            props.name
                        ),
                    ));
                }

                type_check_params_kw(Some(&props.name), ast, &mut args.kw_args, exec_state)?;

                if let Some(arg) = &mut args.kw_args.unlabeled {
                    if let Some(p) = ast.params.iter().find(|p| !p.labeled) {
                        if let Some(ty) = &p.type_ {
                            arg.1.value = arg
                                .1
                                .value
                                .coerce(
                                    &RuntimeType::from_parsed(ty.inner.clone(), exec_state, arg.1.source_range)
                                        .map_err(|e| KclError::Semantic(e.into()))?,
                                    exec_state,
                                )
                                .map_err(|_| {
                                    KclError::Semantic(KclErrorDetails {
                                        message: format!(
                                            "The input argument of {} requires a value with type `{}`, but found {}",
                                            props.name,
                                            ty.inner,
                                            arg.1.value.human_friendly_type(),
                                        ),
                                        source_ranges: vec![callsite],
                                    })
                                })?;
                        }
                    }
                }

                let op = if props.include_in_feature_tree && cfg!(feature = "artifact-graph") {
                    let op_labeled_args = args
                        .kw_args
                        .labeled
                        .iter()
                        .map(|(k, arg)| (k.clone(), OpArg::new(OpKclValue::from(&arg.value), arg.source_range)))
                        .collect();

                    Some(Operation::KclStdLibCall {
                        name: fn_name.unwrap_or_default(),
                        unlabeled_arg: args
                            .unlabeled_kw_arg_unconverted()
                            .map(|arg| OpArg::new(OpKclValue::from(&arg.value), arg.source_range)),
                        labeled_args: op_labeled_args,
                        source_range: callsite,
                        is_error: false,
                    })
                } else {
                    None
                };

                // Attempt to call the function.
                exec_state.mut_stack().push_new_env_for_rust_call();
                let mut result = {
                    // Don't early-return in this block.
                    let result = func(exec_state, args).await;
                    exec_state.mut_stack().pop_env();

                    if let Some(mut op) = op {
                        op.set_std_lib_call_is_error(result.is_err());
                        // Track call operation.  We do this after the call
                        // since things like patternTransform may call user code
                        // before running, and we will likely want to use the
                        // return value. The call takes ownership of the args,
                        // so we need to build the op before the call.
                        exec_state.push_op(op);
                    }
                    result
                }?;

                update_memory_for_tags_of_geometry(&mut result, exec_state)?;

                Ok(Some(result))
            }
            FunctionSource::User { ast, memory, .. } => {
                // Track call operation.
                #[cfg(feature = "artifact-graph")]
                {
                    let op_labeled_args = args
                        .kw_args
                        .labeled
                        .iter()
                        .map(|(k, arg)| (k.clone(), OpArg::new(OpKclValue::from(&arg.value), arg.source_range)))
                        .collect();
                    exec_state.push_op(Operation::GroupBegin {
                        group: Group::FunctionCall {
                            name: fn_name.clone(),
                            function_source_range: ast.as_source_range(),
                            unlabeled_arg: args
                                .kw_args
                                .unlabeled
                                .as_ref()
                                .map(|arg| OpArg::new(OpKclValue::from(&arg.1.value), arg.1.source_range)),
                            labeled_args: op_labeled_args,
                        },
                        source_range: callsite,
                    });
                }

                // Create a new environment to execute the function body in so that local
                // variables shadow variables in the parent scope.  The new environment's
                // parent should be the environment of the closure.
                exec_state.mut_stack().push_new_env_for_call(*memory);
                if let Err(e) = assign_args_to_params_kw(fn_name.as_deref(), ast, args, exec_state) {
                    exec_state.mut_stack().pop_env();
                    return Err(e);
                }

                // Execute the function body using the memory we just created.
                let result = ctx.exec_block(&ast.body, exec_state, BodyType::Block).await;
                let mut result = result.map(|_| {
                    exec_state
                        .stack()
                        .get(memory::RETURN_NAME, ast.as_source_range())
                        .ok()
                        .cloned()
                });

                result = coerce_result_type(result, ast, exec_state);

                // Restore the previous memory.
                exec_state.mut_stack().pop_env();

                // Track return operation.
                exec_state.push_op(Operation::GroupEnd);

                result
            }
            FunctionSource::None => unreachable!(),
        }
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use super::*;
    use crate::{
        execution::{memory::Stack, types::NumericType, ContextType},
        parsing::ast::types::Program,
        parsing::ast::types::{DefaultParamVal, Identifier, Parameter},
    };

    #[tokio::test(flavor = "multi_thread")]
    async fn test_assign_args_to_params() {
        // Set up a little framework for this test.
        fn mem(number: usize) -> KclValue {
            KclValue::Number {
                value: number as f64,
                ty: NumericType::count(),
                meta: Default::default(),
            }
        }
        fn ident(s: &'static str) -> Node<Identifier> {
            Node::no_src(Identifier {
                name: s.to_owned(),
                digest: None,
            })
        }
        fn opt_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                type_: None,
                default_value: Some(DefaultParamVal::none()),
                labeled: true,
                digest: None,
            }
        }
        fn req_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                type_: None,
                default_value: None,
                labeled: true,
                digest: None,
            }
        }
        fn additional_program_memory(items: &[(String, KclValue)]) -> Stack {
            let mut program_memory = Stack::new_for_tests();
            for (name, item) in items {
                program_memory
                    .add(name.clone(), item.clone(), SourceRange::default())
                    .unwrap();
            }
            program_memory
        }
        // Declare the test cases.
        for (test_name, params, args, expected) in [
            ("empty", Vec::new(), Vec::new(), Ok(additional_program_memory(&[]))),
            (
                "all params required, and all given, should be OK",
                vec![req_param("x")],
                vec![("x", mem(1))],
                Ok(additional_program_memory(&[("x".to_owned(), mem(1))])),
            ),
            (
                "all params required, none given, should error",
                vec![req_param("x")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "This function requires a parameter x, but you haven't passed it one.".to_owned(),
                })),
            ),
            (
                "all params optional, none given, should be OK",
                vec![opt_param("x")],
                vec![],
                Ok(additional_program_memory(&[("x".to_owned(), KclValue::none())])),
            ),
            (
                "mixed params, too few given",
                vec![req_param("x"), opt_param("y")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "This function requires a parameter x, but you haven't passed it one.".to_owned(),
                })),
            ),
            (
                "mixed params, minimum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![("x", mem(1))],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), KclValue::none()),
                ])),
            ),
            (
                "mixed params, maximum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![("x", mem(1)), ("y", mem(2))],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), mem(2)),
                ])),
            ),
        ] {
            // Run each test.
            let func_expr = &Node::no_src(FunctionExpression {
                params,
                body: Program::empty(),
                return_type: None,
                digest: None,
            });
            let labeled = args
                .iter()
                .map(|(name, value)| {
                    let arg = Arg::new(value.clone(), SourceRange::default());
                    ((*name).to_owned(), arg)
                })
                .collect::<IndexMap<_, _>>();
            let exec_ctxt = ExecutorContext {
                engine: Arc::new(Box::new(
                    crate::engine::conn_mock::EngineConnection::new().await.unwrap(),
                )),
                fs: Arc::new(crate::fs::FileManager::new()),
                stdlib: Arc::new(crate::std::StdLib::new()),
                settings: Default::default(),
                context_type: ContextType::Mock,
            };
            let mut exec_state = ExecState::new(&exec_ctxt);
            exec_state.mod_local.stack = Stack::new_for_tests();

            let args = Args::new_kw(
                KwArgs {
                    unlabeled: None,
                    labeled,
                    errors: Vec::new(),
                },
                SourceRange::default(),
                exec_ctxt,
                None,
            );
            let actual =
                assign_args_to_params_kw(None, func_expr, args, &mut exec_state).map(|_| exec_state.mod_local.stack);
            assert_eq!(
                actual, expected,
                "failed test '{test_name}':\ngot {actual:?}\nbut expected\n{expected:?}"
            );
        }
    }
}
