use async_recursion::async_recursion;
use indexmap::IndexMap;

use crate::{
    CompilationError, NodePath,
    errors::{KclError, KclErrorDetails},
    execution::{
        BodyType, EnvironmentRef, ExecState, ExecutorContext, KclValue, Metadata, StatementKind, TagEngineInfo,
        TagIdentifier,
        cad_op::{Group, OpArg, OpKclValue, Operation},
        kcl_value::FunctionSource,
        memory,
        types::RuntimeType,
    },
    parsing::ast::types::{CallExpressionKw, DefaultParamVal, FunctionExpression, Node, Program, Type},
    source_range::SourceRange,
    std::StdFn,
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

struct FunctionDefinition<'a> {
    input_arg: Option<(String, Option<Type>)>,
    named_args: IndexMap<String, (Option<DefaultParamVal>, Option<Type>)>,
    return_type: Option<Node<Type>>,
    deprecated: bool,
    include_in_feature_tree: bool,
    is_std: bool,
    body: FunctionBody<'a>,
}

#[derive(Debug)]
enum FunctionBody<'a> {
    Rust(StdFn),
    Kcl(&'a Node<Program>, EnvironmentRef),
}

impl<'a> From<&'a FunctionSource> for FunctionDefinition<'a> {
    fn from(value: &'a FunctionSource) -> Self {
        #[allow(clippy::type_complexity)]
        fn args_from_ast(
            ast: &FunctionExpression,
        ) -> (
            Option<(String, Option<Type>)>,
            IndexMap<String, (Option<DefaultParamVal>, Option<Type>)>,
        ) {
            let mut input_arg = None;
            let mut named_args = IndexMap::new();
            for p in &ast.params {
                if !p.labeled {
                    input_arg = Some((p.identifier.name.clone(), p.type_.as_ref().map(|t| t.inner.clone())));
                    continue;
                }

                named_args.insert(
                    p.identifier.name.clone(),
                    (p.default_value.clone(), p.type_.as_ref().map(|t| t.inner.clone())),
                );
            }

            (input_arg, named_args)
        }

        match value {
            FunctionSource::Std { func, ast, props } => {
                let (input_arg, named_args) = args_from_ast(ast);
                FunctionDefinition {
                    input_arg,
                    named_args,
                    return_type: ast.return_type.clone(),
                    deprecated: props.deprecated,
                    include_in_feature_tree: props.include_in_feature_tree,
                    is_std: true,
                    body: FunctionBody::Rust(*func),
                }
            }
            FunctionSource::User { ast, memory, .. } => {
                let (input_arg, named_args) = args_from_ast(ast);
                FunctionDefinition {
                    input_arg,
                    named_args,
                    return_type: ast.return_type.clone(),
                    deprecated: false,
                    include_in_feature_tree: true,
                    // TODO I think this might be wrong for pure Rust std functions
                    is_std: false,
                    body: FunctionBody::Kcl(&ast.body, *memory),
                }
            }
            FunctionSource::None => unreachable!(),
        }
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

        let args = Args::new_kw(
            KwArgs {
                unlabeled,
                labeled: fn_args,
                errors,
            },
            self.into(),
            ctx.clone(),
            exec_state.pipe_value().map(|v| Arg::new(v.clone(), callsite)),
        );

        // Clone the function so that we can use a mutable reference to
        // exec_state.
        let func = fn_name.get_result(exec_state, ctx).await?.clone();

        let Some(fn_src) = func.as_function() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "cannot call this because it isn't a function".to_string(),
                vec![callsite],
            )));
        };

        let return_value = fn_src
            .call_kw(Some(fn_name.to_string()), exec_state, ctx, args, callsite)
            .await
            .map_err(|e| {
                // Add the call expression to the source ranges.
                //
                // TODO: Use the name that the function was defined
                // with, not the identifier it was used with.
                e.add_unwind_location(Some(fn_name.name.name.clone()), callsite)
            })?;

        let result = return_value.ok_or_else(move || {
            let mut source_ranges: Vec<SourceRange> = vec![callsite];
            // We want to send the source range of the original function.
            if let KclValue::Function { meta, .. } = func {
                source_ranges = meta.iter().map(|m| m.source_range).collect();
            };
            KclError::new_undefined_value(
                KclErrorDetails::new(
                    format!("Result of user-defined function {fn_name} is undefined"),
                    source_ranges,
                ),
                None,
            )
        })?;

        Ok(result)
    }
}

impl FunctionDefinition<'_> {
    pub async fn call_kw(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        mut args: Args,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        if self.deprecated {
            exec_state.warn(CompilationError::err(
                callsite,
                format!(
                    "{} is deprecated, see the docs for a recommended replacement",
                    match &fn_name {
                        Some(n) => format!("`{n}`"),
                        None => "This function".to_owned(),
                    }
                ),
            ));
        }

        type_check_params_kw(fn_name.as_deref(), self, &mut args.kw_args, exec_state)?;

        // Don't early return until the stack frame is popped!
        self.body.prep_mem(exec_state);

        let op = if self.include_in_feature_tree {
            let op_labeled_args = args
                .kw_args
                .labeled
                .iter()
                .map(|(k, arg)| (k.clone(), OpArg::new(OpKclValue::from(&arg.value), arg.source_range)))
                .collect();

            if self.is_std {
                Some(Operation::StdLibCall {
                    name: fn_name.clone().unwrap_or_else(|| "unknown function".to_owned()),
                    unlabeled_arg: args
                        .unlabeled_kw_arg_unconverted()
                        .map(|arg| OpArg::new(OpKclValue::from(&arg.value), arg.source_range)),
                    labeled_args: op_labeled_args,
                    node_path: NodePath::placeholder(),
                    source_range: callsite,
                    is_error: false,
                })
            } else {
                exec_state.push_op(Operation::GroupBegin {
                    group: Group::FunctionCall {
                        name: fn_name.clone(),
                        function_source_range: self.as_source_range().unwrap(),
                        unlabeled_arg: args
                            .kw_args
                            .unlabeled
                            .as_ref()
                            .map(|arg| OpArg::new(OpKclValue::from(&arg.1.value), arg.1.source_range)),
                        labeled_args: op_labeled_args,
                    },
                    node_path: NodePath::placeholder(),
                    source_range: callsite,
                });

                None
            }
        } else {
            None
        };

        let mut result = match &self.body {
            FunctionBody::Rust(f) => f(exec_state, args).await.map(Some),
            FunctionBody::Kcl(f, _) => {
                if let Err(e) = assign_args_to_params_kw(self, args, exec_state) {
                    exec_state.mut_stack().pop_env();
                    return Err(e);
                }

                ctx.exec_block(f, exec_state, BodyType::Block).await.map(|_| {
                    exec_state
                        .stack()
                        .get(memory::RETURN_NAME, f.as_source_range())
                        .ok()
                        .cloned()
                })
            }
        };

        exec_state.mut_stack().pop_env();

        if let Some(mut op) = op {
            op.set_std_lib_call_is_error(result.is_err());
            // Track call operation.  We do this after the call
            // since things like patternTransform may call user code
            // before running, and we will likely want to use the
            // return value. The call takes ownership of the args,
            // so we need to build the op before the call.
            exec_state.push_op(op);
        } else if !self.is_std {
            exec_state.push_op(Operation::GroupEnd);
        }

        if self.is_std {
            if let Ok(Some(result)) = &mut result {
                update_memory_for_tags_of_geometry(result, exec_state)?;
            }
        }

        coerce_result_type(result, self, exec_state)
    }

    // Postcondition: result.is_some() if function is not in the standard library.
    fn as_source_range(&self) -> Option<SourceRange> {
        match &self.body {
            FunctionBody::Rust(_) => None,
            FunctionBody::Kcl(p, _) => Some(p.as_source_range()),
        }
    }
}

impl FunctionBody<'_> {
    fn prep_mem(&self, exec_state: &mut ExecState) {
        match self {
            FunctionBody::Rust(_) => exec_state.mut_stack().push_new_root_env(true),
            FunctionBody::Kcl(_, memory) => exec_state.mut_stack().push_new_env_for_call(*memory),
        }
    }
}

impl FunctionSource {
    pub async fn call_kw(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        args: Args,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        let def: FunctionDefinition = self.into();
        def.call_kw(fn_name, exec_state, ctx, args, callsite).await
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
        KclValue::Solid { value } => {
            for v in &value.value {
                if let Some(tag) = v.get_tag() {
                    // Get the past tag and update it.
                    let tag_id = if let Some(t) = value.sketch.tags.get(&tag.name) {
                        let mut t = t.clone();
                        let Some(info) = t.get_cur_info() else {
                            return Err(KclError::new_internal(KclErrorDetails::new(
                                format!("Tag {} does not have path info", tag.name),
                                vec![tag.into()],
                            )));
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

fn type_err_str(expected: &Type, found: &KclValue, source_range: &SourceRange, exec_state: &mut ExecState) -> String {
    fn strip_backticks(s: &str) -> &str {
        let mut result = s;
        if s.starts_with('`') {
            result = &result[1..]
        }
        if s.ends_with('`') {
            result = &result[..result.len() - 1]
        }
        result
    }

    let expected_human = expected.human_friendly_type();
    let expected_ty = expected.to_string();
    let expected_str =
        if expected_human == expected_ty || expected_human == format!("a value with type `{expected_ty}`") {
            format!("a value with type `{expected_ty}`")
        } else {
            format!("{expected_human} (`{expected_ty}`)")
        };
    let found_human = found.human_friendly_type();
    let found_ty = found.principal_type_string();
    let found_str = if found_human == found_ty || found_human == format!("a {}", strip_backticks(&found_ty)) {
        format!("a value with type {found_ty}")
    } else {
        format!("{found_human} (with type {found_ty})")
    };

    let mut result = format!("{expected_str}, but found {found_str}.");

    if found.is_unknown_number() {
        exec_state.clear_units_warnings(source_range);
        result.push_str("\nThe found value is a number but has incomplete units information. You can probably fix this error by specifying the units using type ascription, e.g., `len: number(mm)` or `(a * b): number(deg)`.");
    }

    result
}

fn type_check_params_kw(
    fn_name: Option<&str>,
    fn_def: &FunctionDefinition<'_>,
    args: &mut KwArgs,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    // If it's possible the input arg was meant to be labelled and we probably don't want to use
    // it as the input arg, then treat it as labelled.
    if let Some((Some(label), _)) = &args.unlabeled {
        if (fn_def.input_arg.is_none() || exec_state.pipe_value().is_some())
            && fn_def.named_args.iter().any(|p| p.0 == label)
            && !args.labeled.contains_key(label)
        {
            let (label, arg) = args.unlabeled.take().unwrap();
            args.labeled.insert(label.unwrap(), arg);
        }
    }

    for (label, arg) in &mut args.labeled {
        match fn_def.named_args.get(label) {
            Some((def, ty)) => {
                // For optional args, passing None should be the same as not passing an arg.
                if !(def.is_some() && matches!(arg.value, KclValue::KclNone { .. })) {
                    if let Some(ty) = ty {
                        let rty = RuntimeType::from_parsed(ty.clone(), exec_state, arg.source_range)
                            .map_err(|e| KclError::new_semantic(e.into()))?;
                        arg.value = arg
                            .value
                            .coerce(
                                &rty,
                                true,
                                exec_state,
                            )
                            .map_err(|e| {
                                let mut message = format!(
                                    "{label} requires {}",
                                    type_err_str(ty, &arg.value, &arg.source_range, exec_state),
                                );
                                if let Some(ty) = e.explicit_coercion {
                                    // TODO if we have access to the AST for the argument we could choose which example to suggest.
                                    message = format!("{message}\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): number({ty})`");
                                }
                                KclError::new_semantic(KclErrorDetails::new(
                                    message,
                                    vec![arg.source_range],
                                ))
                            })?;
                    }
                }
            }
            None => {
                exec_state.err(CompilationError::err(
                    arg.source_range,
                    format!(
                        "`{label}` is not an argument of {}",
                        fn_name
                            .map(|n| format!("`{n}`"))
                            .unwrap_or_else(|| "this function".to_owned()),
                    ),
                ));
            }
        }
    }

    if !args.errors.is_empty() {
        let actuals = args.labeled.keys();
        let formals: Vec<_> = fn_def
            .named_args
            .keys()
            .filter_map(|name| {
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

        return Err(KclError::new_semantic(first.into()));
    }

    if let Some(arg) = &mut args.unlabeled {
        if let Some((_, Some(ty))) = &fn_def.input_arg {
            let rty = RuntimeType::from_parsed(ty.clone(), exec_state, arg.1.source_range)
                .map_err(|e| KclError::new_semantic(e.into()))?;
            arg.1.value = arg.1.value.coerce(&rty, true, exec_state).map_err(|_| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The input argument of {} requires {}",
                        fn_name
                            .map(|n| format!("`{n}`"))
                            .unwrap_or_else(|| "this function".to_owned()),
                        type_err_str(ty, &arg.1.value, &arg.1.source_range, exec_state),
                    ),
                    vec![arg.1.source_range],
                ))
            })?;
        }
    } else if let Some((name, _)) = &fn_def.input_arg {
        if let Some(arg) = args.labeled.get(name) {
            exec_state.err(CompilationError::err(
                arg.source_range,
                format!(
                    "{} expects an unlabeled first argument (`@{name}`), but it is labelled in the call",
                    fn_name
                        .map(|n| format!("The function `{n}`"))
                        .unwrap_or_else(|| "This function".to_owned()),
                ),
            ));
        }
    }

    Ok(())
}

fn assign_args_to_params_kw(
    fn_def: &FunctionDefinition<'_>,
    args: Args,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    let source_ranges = fn_def.as_source_range().into_iter().collect();

    for (name, (default, _)) in fn_def.named_args.iter() {
        let arg = args.kw_args.labeled.get(name);
        match arg {
            Some(arg) => {
                exec_state.mut_stack().add(
                    name.clone(),
                    arg.value.clone(),
                    arg.source_ranges().pop().unwrap_or(SourceRange::synthetic()),
                )?;
            }
            None => match default {
                Some(default_val) => {
                    let value = KclValue::from_default_param(default_val.clone(), exec_state);
                    exec_state
                        .mut_stack()
                        .add(name.clone(), value, default_val.source_range())?;
                }
                None => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!("This function requires a parameter {name}, but you haven't passed it one."),
                        source_ranges,
                    )));
                }
            },
        }
    }

    if let Some((param_name, _)) = &fn_def.input_arg {
        let unlabelled = args.unlabeled_kw_arg_unconverted();

        let Some(unlabeled) = unlabelled else {
            return Err(if args.kw_args.labeled.contains_key(param_name) {
                KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "The function does declare a parameter named '{param_name}', but this parameter doesn't use a label. Try removing the `{param_name}:`"
                    ),
                    source_ranges,
                ))
            } else {
                KclError::new_semantic(KclErrorDetails::new(
                    "This function expects an unlabeled first parameter, but you haven't passed it one.".to_owned(),
                    source_ranges,
                ))
            });
        };
        exec_state.mut_stack().add(
            param_name.clone(),
            unlabeled.value.clone(),
            unlabeled.source_ranges().pop().unwrap_or(SourceRange::synthetic()),
        )?;
    }

    Ok(())
}

fn coerce_result_type(
    result: Result<Option<KclValue>, KclError>,
    fn_def: &FunctionDefinition<'_>,
    exec_state: &mut ExecState,
) -> Result<Option<KclValue>, KclError> {
    if let Ok(Some(val)) = result {
        if let Some(ret_ty) = &fn_def.return_type {
            let ty = RuntimeType::from_parsed(ret_ty.inner.clone(), exec_state, ret_ty.as_source_range())
                .map_err(|e| KclError::new_semantic(e.into()))?;
            let val = val.coerce(&ty, true, exec_state).map_err(|_| {
                KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "This function requires its result to be {}",
                        type_err_str(ret_ty, &val, &(&val).into(), exec_state)
                    ),
                    ret_ty.as_source_ranges(),
                ))
            })?;
            Ok(Some(val))
        } else {
            Ok(Some(val))
        }
    } else {
        result
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use super::*;
    use crate::{
        execution::{ContextType, memory::Stack, parse_execute, types::NumericType},
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
                Err(KclError::new_semantic(KclErrorDetails::new(
                    "This function requires a parameter x, but you haven't passed it one.".to_owned(),
                    vec![SourceRange::default()],
                ))),
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
                Err(KclError::new_semantic(KclErrorDetails::new(
                    "This function requires a parameter x, but you haven't passed it one.".to_owned(),
                    vec![SourceRange::default()],
                ))),
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
            let func_expr = Node::no_src(FunctionExpression {
                params,
                body: Program::empty(),
                return_type: None,
                digest: None,
            });
            let func_src = FunctionSource::User {
                ast: Box::new(func_expr),
                settings: Default::default(),
                memory: EnvironmentRef::dummy(),
            };
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
            let actual = assign_args_to_params_kw(&(&func_src).into(), args, &mut exec_state)
                .map(|_| exec_state.mod_local.stack);
            assert_eq!(
                actual, expected,
                "failed test '{test_name}':\ngot {actual:?}\nbut expected\n{expected:?}"
            );
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn type_check_user_args() {
        let program = r#"fn makeMessage(prefix: string, suffix: string) {
  return prefix + suffix
}

msg1 = makeMessage(prefix = "world", suffix = " hello")
msg2 = makeMessage(prefix = 1, suffix = 3)"#;
        let err = parse_execute(program).await.unwrap_err();
        assert_eq!(
            err.message(),
            "prefix requires a value with type `string`, but found a value with type `number`.\nThe found value is a number but has incomplete units information. You can probably fix this error by specifying the units using type ascription, e.g., `len: number(mm)` or `(a * b): number(deg)`."
        )
    }
}
