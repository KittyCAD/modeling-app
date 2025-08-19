use async_recursion::async_recursion;
use indexmap::IndexMap;

use crate::{
    CompilationError, NodePath, SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        BodyType, EnvironmentRef, ExecState, ExecutorContext, KclValue, Metadata, StatementKind, TagEngineInfo,
        TagIdentifier, annotations,
        cad_op::{Group, OpArg, OpKclValue, Operation},
        kcl_value::FunctionSource,
        memory,
        types::{DisplayType, RuntimeType, UnitSubsts},
    },
    parsing::ast::types::{CallExpressionKw, DefaultParamVal, FunctionExpression, Node, Program, Type},
    std::StdFn,
};

#[derive(Debug, Clone)]
pub struct Args<Status: ArgsStatus = Desugared> {
    /// Unlabeled keyword args. Currently only the first formal arg can be unlabeled.
    /// If the argument was a local variable, then the first element of the tuple is its name
    /// which may be used to treat this arg as a labelled arg.
    pub unlabeled: Vec<(Option<String>, Arg)>,
    /// Labeled args.
    pub labeled: IndexMap<String, Arg>,
    pub source_range: SourceRange,
    pub ctx: ExecutorContext,
    /// If this call happens inside a pipe (|>) expression, this holds the LHS of that |>.
    /// Otherwise it's None.
    pub pipe_value: Option<Arg>,
    _status: std::marker::PhantomData<Status>,
}

pub trait ArgsStatus: std::fmt::Debug + Clone {}

#[derive(Debug, Clone)]
pub struct Sugary;
impl ArgsStatus for Sugary {}

// Invariants guaranteed by the `Desugared` status:
// - There is either 0 or 1 unlabeled arguments
// - Any lableled args are in the labeled map, and not the unlabeled Vec.
// - The arguments match the type signature of the function exactly
// - pipe_value.is_none()
#[derive(Debug, Clone)]
pub struct Desugared;
impl ArgsStatus for Desugared {}

impl Args<Sugary> {
    /// Collect the given keyword arguments.
    pub fn new(
        labeled: IndexMap<String, Arg>,
        unlabeled: Vec<(Option<String>, Arg)>,
        source_range: SourceRange,
        exec_state: &mut ExecState,
        ctx: ExecutorContext,
    ) -> Args<Sugary> {
        Args {
            labeled,
            unlabeled,
            source_range,
            ctx,
            pipe_value: exec_state.pipe_value().map(|v| Arg::new(v.clone(), source_range)),
            _status: std::marker::PhantomData,
        }
    }
}

impl<Status: ArgsStatus> Args<Status> {
    /// How many arguments are there?
    pub fn len(&self) -> usize {
        self.labeled.len() + self.unlabeled.len()
    }

    /// Are there no arguments?
    pub fn is_empty(&self) -> bool {
        self.labeled.is_empty() && self.unlabeled.is_empty()
    }
}

impl Args<Desugared> {
    pub fn new_no_args(source_range: SourceRange, ctx: ExecutorContext) -> Args {
        Args {
            unlabeled: Default::default(),
            labeled: Default::default(),
            source_range,
            ctx,
            pipe_value: None,
            _status: std::marker::PhantomData,
        }
    }

    /// Get the unlabeled keyword argument. If not set, returns None.
    pub(crate) fn unlabeled_kw_arg_unconverted(&self) -> Option<&Arg> {
        self.unlabeled.first().map(|(_, a)| a)
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

#[derive(Debug)]
struct FunctionDefinition<'a> {
    input_arg: Option<(String, Option<Type>)>,
    named_args: IndexMap<String, (Option<DefaultParamVal>, Option<Type>)>,
    return_type: Option<Node<Type>>,
    deprecated: bool,
    experimental: bool,
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
                    input_arg = Some((
                        p.identifier.name.clone(),
                        p.param_type.as_ref().map(|t| t.inner.clone()),
                    ));
                    continue;
                }

                named_args.insert(
                    p.identifier.name.clone(),
                    (p.default_value.clone(), p.param_type.as_ref().map(|t| t.inner.clone())),
                );
            }

            (input_arg, named_args)
        }

        match value {
            FunctionSource::Std {
                func,
                ast,
                props,
                attrs,
            } => {
                let (input_arg, named_args) = args_from_ast(ast);
                FunctionDefinition {
                    input_arg,
                    named_args,
                    return_type: ast.return_type.clone(),
                    deprecated: attrs.deprecated,
                    experimental: attrs.experimental,
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
                    experimental: false,
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

        // Clone the function so that we can use a mutable reference to
        // exec_state.
        let func = fn_name.get_result(exec_state, ctx).await?.clone();

        let Some(fn_src) = func.as_function() else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "cannot call this because it isn't a function".to_string(),
                vec![callsite],
            )));
        };

        // Build a hashmap from argument labels to the final evaluated values.
        let mut fn_args = IndexMap::with_capacity(self.arguments.len());
        let mut unlabeled = Vec::new();

        // Evaluate the unlabeled first param, if any exists.
        if let Some(ref arg_expr) = self.unlabeled {
            let source_range = SourceRange::from(arg_expr.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;

            let label = arg_expr.ident_name().map(str::to_owned);

            unlabeled.push((label, Arg::new(value, source_range)))
        }

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
                    unlabeled.push((arg_expr.arg.ident_name().map(str::to_owned), arg));
                }
            }
        }

        let args = Args::new(fn_args, unlabeled, callsite, exec_state, ctx.clone());

        let return_value = fn_src
            .call(Some(fn_name.to_string()), exec_state, ctx, args, callsite)
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
    pub async fn call(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        args: Args<Sugary>,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        if self.deprecated {
            exec_state.warn(
                CompilationError::err(
                    callsite,
                    format!(
                        "{} is deprecated, see the docs for a recommended replacement",
                        match &fn_name {
                            Some(n) => format!("`{n}`"),
                            None => "This function".to_owned(),
                        }
                    ),
                ),
                annotations::WARN_DEPRECATED,
            );
        }
        if self.experimental {
            exec_state.warn_experimental(
                &match &fn_name {
                    Some(n) => format!("`{n}`"),
                    None => "This function".to_owned(),
                },
                callsite,
            );
        }

        let (args, unit_substs) = type_check_params(fn_name.as_deref(), self, args, exec_state)?;

        // Don't early return until the stack frame is popped!
        self.body.prep_mem(exec_state);

        let op = if self.include_in_feature_tree {
            let op_labeled_args = args
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
                            .unlabeled_kw_arg_unconverted()
                            .map(|arg| OpArg::new(OpKclValue::from(&arg.value), arg.source_range)),
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

        exec_state.mut_unit_stack().push(unit_substs);
        let mut result = match &self.body {
            FunctionBody::Rust(f) => f(exec_state, args).await.map(Some),
            FunctionBody::Kcl(f, _) => {
                if let Err(e) = assign_args_to_params(self, args, exec_state) {
                    exec_state.mut_stack().pop_env();
                    exec_state.mut_unit_stack().pop();
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
        exec_state.mut_unit_stack().pop();

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

        if self.is_std
            && let Ok(Some(result)) = &mut result
        {
            update_memory_for_tags_of_geometry(result, exec_state)?;
        }

        let ret_ty = self
            .return_type
            .as_ref()
            .map(|ret_ty| {
                let mut ty =
                    RuntimeType::from_parsed(ret_ty.inner.clone(), exec_state, ret_ty.as_source_range(), false)
                        .map_err(|e| KclError::new_semantic(e.into()))?;
                ty.subst_units(unit_substs);
                Ok::<_, KclError>(ty)
            })
            .transpose()?;
        if let Some(ret_ty) = &ret_ty {
            coerce_result_type(result, ret_ty, exec_state)
        } else {
            result
        }
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
    pub async fn call(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        args: Args<Sugary>,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        let def: FunctionDefinition = self.into();
        def.call(fn_name, exec_state, ctx, args, callsite).await
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

fn type_err_str(
    expected: &impl DisplayType,
    found: &KclValue,
    source_range: &SourceRange,
    exec_state: &mut ExecState,
) -> String {
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

    let expected_human = expected.human_friendly_string();
    let expected_ty = expected.src_string();
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

    if found.is_unknown_number(exec_state) {
        exec_state.clear_units_warnings(source_range);
        result.push_str("\nThe found value is a number but has incomplete units information. You can probably fix this error by specifying the units using type ascription, e.g., `len: mm` or `(a * b): deg`.");
    }

    result
}

fn type_check_params(
    fn_name: Option<&str>,
    fn_def: &FunctionDefinition<'_>,
    mut args: Args<Sugary>,
    exec_state: &mut ExecState,
) -> Result<(Args<Desugared>, UnitSubsts), KclError> {
    let mut result = Args::new_no_args(args.source_range, args.ctx);

    // If it's possible the input arg was meant to be labelled and we probably don't want to use
    // it as the input arg, then treat it as labelled.
    if let Some((Some(label), _)) = args.unlabeled.first()
        && args.unlabeled.len() == 1
        && (fn_def.input_arg.is_none() || args.pipe_value.is_some())
        && fn_def.named_args.iter().any(|p| p.0 == label)
        && !args.labeled.contains_key(label)
    {
        let (label, arg) = args.unlabeled.pop().unwrap();
        args.labeled.insert(label.unwrap(), arg);
    }

    // Collect substitutions for `number(Length)` or `number(Angle)`. See docs on execution::types::UnitSubsts
    // for details.
    let mut unit_substs = UnitSubsts::default();

    // Apply the `a == a: a` shorthand by desugaring unlabeled args into labeled ones.
    let (labeled_unlabeled, unlabeled_unlabeled) = args.unlabeled.into_iter().partition(|(l, _)| {
        if let Some(l) = l
            && fn_def.named_args.contains_key(l)
            && !args.labeled.contains_key(l)
        {
            true
        } else {
            false
        }
    });
    args.unlabeled = unlabeled_unlabeled;
    for (l, arg) in labeled_unlabeled {
        let previous = args.labeled.insert(l.unwrap(), arg);
        debug_assert!(previous.is_none());
    }

    if let Some((name, ty)) = &fn_def.input_arg {
        // Expecting an input arg

        if args.unlabeled.is_empty() {
            // No args provided

            if let Some(pipe) = args.pipe_value {
                // But there is a pipeline
                result.unlabeled = vec![(None, pipe)];
            } else if let Some(arg) = args.labeled.swap_remove(name) {
                // Mistakenly labelled
                exec_state.err(CompilationError::err(
                    arg.source_range,
                    format!(
                        "{} expects an unlabeled first argument (`@{name}`), but it is labelled in the call. You might try removing the `{name} = `",
                        fn_name
                            .map(|n| format!("The function `{n}`"))
                            .unwrap_or_else(|| "This function".to_owned()),
                    ),
                ));
                result.unlabeled = vec![(Some(name.clone()), arg)];
            } else {
                // Just missing
                return Err(KclError::new_argument(KclErrorDetails::new(
                    "This function expects an unlabeled first parameter, but you haven't passed it one.".to_owned(),
                    fn_def.as_source_range().into_iter().collect(),
                )));
            }
        } else if args.unlabeled.len() == 1 {
            let mut arg = args.unlabeled.pop().unwrap().1;
            if let Some(ty) = ty {
                let mut rty = RuntimeType::from_parsed(ty.clone(), exec_state, arg.source_range, false)
                    .map_err(|e| KclError::new_semantic(e.into()))?;
                rty.subst_units(unit_substs);

                let (value, substs) = arg
                    .value
                    .coerce_and_find_unit_substs(&rty, true, exec_state)
                    .map_err(|_| {
                        KclError::new_argument(KclErrorDetails::new(
                            format!(
                                "The input argument of {} requires {}",
                                fn_name
                                    .map(|n| format!("`{n}`"))
                                    .unwrap_or_else(|| "this function".to_owned()),
                                type_err_str(ty, &arg.value, &arg.source_range, exec_state),
                            ),
                            vec![arg.source_range],
                        ))
                    })?;

                arg.value = value;
                unit_substs = unit_substs.or(substs);
            }
            result.unlabeled = vec![(None, arg)]
        } else {
            // Multiple unlabelled args

            // Try to un-spread args into an array
            if let Some(Type::Array { len, .. }) = ty {
                if len.satisfied(args.unlabeled.len(), false).is_none() {
                    exec_state.err(CompilationError::err(
                        args.source_range,
                        format!(
                            "{} expects an array input argument with {} elements",
                            fn_name
                                .map(|n| format!("The function `{n}`"))
                                .unwrap_or_else(|| "This function".to_owned()),
                            len.human_friendly_type(),
                        ),
                    ));
                }

                let source_range = SourceRange::merge(args.unlabeled.iter().map(|(_, a)| a.source_range));
                exec_state.warn_experimental("array input arguments", source_range);
                result.unlabeled = vec![(
                    None,
                    Arg {
                        source_range,
                        value: KclValue::HomArray {
                            value: args.unlabeled.drain(..).map(|(_, a)| a.value).collect(),
                            ty: RuntimeType::any(),
                        },
                    },
                )]
            }
        }
    }

    // Either we didn't move the arg above, or we're not expecting one.
    if !args.unlabeled.is_empty() {
        // Not expecting an input arg, but found one or more
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

        let mut errors = args.unlabeled.iter().map(|(_, arg)| {
            CompilationError::err(
                arg.source_range,
                format!("This argument needs a label, but it doesn't have one{suggestion}"),
            )
        });

        let first = errors.next().unwrap();
        errors.for_each(|e| exec_state.err(e));

        return Err(KclError::new_argument(first.into()));
    }

    for (label, mut arg) in args.labeled {
        match fn_def.named_args.get(&label) {
            Some((def, ty)) => {
                // For optional args, passing None should be the same as not passing an arg.
                if !(def.is_some() && matches!(arg.value, KclValue::KclNone { .. })) {
                    if let Some(ty) = ty {
                        let mut rty = RuntimeType::from_parsed(ty.clone(), exec_state, arg.source_range, false)
                            .map_err(|e| KclError::new_semantic(e.into()))?;
                        rty.subst_units(unit_substs);

                        let (value, substs) = arg
                                .value
                                .coerce_and_find_unit_substs(
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
                                        message = format!("{message}\n\nYou may need to add information about the type of the argument, for example:\n  using a numeric suffix: `42{ty}`\n  or using type ascription: `foo(): {ty}`");
                                    }
                                    KclError::new_argument(KclErrorDetails::new(
                                        message,
                                        vec![arg.source_range],
                                    ))
                                })?;

                        arg.value = value;
                        unit_substs = unit_substs.or(substs);
                    }
                    result.labeled.insert(label, arg);
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

    Ok((result, unit_substs))
}

fn assign_args_to_params(
    fn_def: &FunctionDefinition<'_>,
    args: Args<Desugared>,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    let source_ranges = fn_def.as_source_range().into_iter().collect();

    for (name, (default, _)) in fn_def.named_args.iter() {
        let arg = args.labeled.get(name);
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
                    return Err(KclError::new_argument(KclErrorDetails::new(
                        format!("This function requires a parameter {name}, but you haven't passed it one."),
                        source_ranges,
                    )));
                }
            },
        }
    }

    if let Some((param_name, _)) = &fn_def.input_arg {
        let Some(unlabeled) = args.unlabeled_kw_arg_unconverted() else {
            debug_assert!(false, "Bad args");
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Desugared arguments are inconsistent".to_owned(),
                source_ranges,
            )));
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
    return_ty: &RuntimeType,
    exec_state: &mut ExecState,
) -> Result<Option<KclValue>, KclError> {
    if let Ok(Some(val)) = result {
        let val = val.coerce(return_ty, true, exec_state).map_err(|_| {
            KclError::new_type(KclErrorDetails::new(
                format!(
                    "This function requires its result to be {}",
                    type_err_str(return_ty, &val, &(&val).into(), exec_state)
                ),
                val.into(),
            ))
        })?;
        Ok(Some(val))
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
                param_type: None,
                default_value: Some(DefaultParamVal::none()),
                labeled: true,
                digest: None,
            }
        }
        fn req_param(s: &'static str) -> Parameter {
            Parameter {
                identifier: ident(s),
                param_type: None,
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
                Err(KclError::new_argument(KclErrorDetails::new(
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
                Err(KclError::new_argument(KclErrorDetails::new(
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

            let args = Args {
                labeled,
                unlabeled: Vec::new(),
                source_range: SourceRange::default(),
                ctx: exec_ctxt,
                pipe_value: None,
                _status: std::marker::PhantomData,
            };
            let actual =
                assign_args_to_params(&(&func_src).into(), args, &mut exec_state).map(|_| exec_state.mod_local.stack);
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
            "prefix requires a value with type `string`, but found a value with type `number`.\nThe found value is a number but has incomplete units information. You can probably fix this error by specifying the units using type ascription, e.g., `len: mm` or `(a * b): deg`."
        )
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn array_input_arg() {
        let ast = r#"fn f(@input: [mm]) { return 1 }
f([1, 2, 3])
f(1, 2, 3)
"#;
        parse_execute(ast).await.unwrap();
    }
}
