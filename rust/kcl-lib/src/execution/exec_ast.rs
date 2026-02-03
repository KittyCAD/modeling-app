use std::collections::HashMap;

use async_recursion::async_recursion;
use indexmap::IndexMap;
use kcl_ezpz::{Constraint, NonLinearSystemError};

#[cfg(feature = "artifact-graph")]
use crate::front::{Object, ObjectKind};
use crate::{
    CompilationError, NodePath, SourceRange,
    errors::{KclError, KclErrorDetails},
    execution::{
        AbstractSegment, BodyType, ControlFlowKind, EnvironmentRef, ExecState, ExecutorContext, KclValue,
        KclValueControlFlow, Metadata, ModelingCmdMeta, ModuleArtifactState, Operation, PreserveMem, Segment,
        SegmentKind, SegmentRepr, SketchConstraintKind, SketchSurface, StatementKind, TagIdentifier, UnsolvedExpr,
        UnsolvedSegment, UnsolvedSegmentKind, annotations,
        cad_op::OpKclValue,
        control_continue,
        fn_call::{Arg, Args},
        kcl_value::{FunctionSource, KclFunctionSourceParams, TypeDef},
        memory,
        sketch_solve::{
            FreedomAnalysis, Solved, create_segment_scene_objects, normalize_to_solver_unit, solver_numeric_type,
            substitute_sketch_var_in_segment, substitute_sketch_vars,
        },
        state::{ModuleState, SketchBlockState},
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    front::PointCtor,
    modules::{ModuleExecutionOutcome, ModuleId, ModulePath, ModuleRepr},
    parsing::ast::types::{
        Annotation, ArrayExpression, ArrayRangeExpression, AscribedExpression, BinaryExpression, BinaryOperator,
        BinaryPart, BodyItem, CodeBlock, Expr, IfExpression, ImportPath, ImportSelector, ItemVisibility,
        MemberExpression, Name, Node, ObjectExpression, PipeExpression, Program, SketchBlock, SketchVar, TagDeclarator,
        Type, UnaryExpression, UnaryOperator,
    },
    std::{
        args::TyF64, shapes::SketchOrSurface, sketch::ensure_sketch_plane_in_engine, sketch2::create_segments_in_engine,
    },
};

fn internal_err(message: impl Into<String>, range: impl Into<SourceRange>) -> KclError {
    KclError::new_internal(KclErrorDetails::new(message.into(), vec![range.into()]))
}

impl<'a> StatementKind<'a> {
    fn expect_name(&self) -> &'a str {
        match self {
            StatementKind::Declaration { name } => name,
            StatementKind::Expression => unreachable!(),
        }
    }
}

impl ExecutorContext {
    /// Returns true if importing the prelude should be skipped.
    async fn handle_annotations(
        &self,
        annotations: impl Iterator<Item = &Node<Annotation>>,
        body_type: BodyType,
        exec_state: &mut ExecState,
    ) -> Result<bool, KclError> {
        let mut no_prelude = false;
        for annotation in annotations {
            if annotation.name() == Some(annotations::SETTINGS) {
                if matches!(body_type, BodyType::Root) {
                    let (updated_len, updated_angle) =
                        exec_state.mod_local.settings.update_from_annotation(annotation)?;
                    if updated_len {
                        exec_state.mod_local.explicit_length_units = true;
                    }
                    if updated_angle {
                        exec_state.warn(
                            CompilationError::err(
                                annotation.as_source_range(),
                                "Prefer to use explicit units for angles",
                            ),
                            annotations::WARN_ANGLE_UNITS,
                        );
                    }
                } else {
                    exec_state.err(CompilationError::err(
                        annotation.as_source_range(),
                        "Settings can only be modified at the top level scope of a file",
                    ));
                }
            } else if annotation.name() == Some(annotations::NO_PRELUDE) {
                if matches!(body_type, BodyType::Root) {
                    no_prelude = true;
                } else {
                    exec_state.err(CompilationError::err(
                        annotation.as_source_range(),
                        "The standard library can only be skipped at the top level scope of a file",
                    ));
                }
            } else if annotation.name() == Some(annotations::WARNINGS) {
                // TODO we should support setting warnings for the whole project, not just one file
                if matches!(body_type, BodyType::Root) {
                    let props = annotations::expect_properties(annotations::WARNINGS, annotation)?;
                    for p in props {
                        match &*p.inner.key.name {
                            annotations::WARN_ALLOW => {
                                let allowed = annotations::many_of(
                                    &p.inner.value,
                                    &annotations::WARN_VALUES,
                                    annotation.as_source_range(),
                                )?;
                                exec_state.mod_local.allowed_warnings = allowed;
                            }
                            annotations::WARN_DENY => {
                                let denied = annotations::many_of(
                                    &p.inner.value,
                                    &annotations::WARN_VALUES,
                                    annotation.as_source_range(),
                                )?;
                                exec_state.mod_local.denied_warnings = denied;
                            }
                            name => {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    format!(
                                        "Unexpected warnings key: `{name}`; expected one of `{}`, `{}`",
                                        annotations::WARN_ALLOW,
                                        annotations::WARN_DENY,
                                    ),
                                    vec![annotation.as_source_range()],
                                )));
                            }
                        }
                    }
                } else {
                    exec_state.err(CompilationError::err(
                        annotation.as_source_range(),
                        "Warnings can only be customized at the top level scope of a file",
                    ));
                }
            } else {
                exec_state.warn(
                    CompilationError::err(annotation.as_source_range(), "Unknown annotation"),
                    annotations::WARN_UNKNOWN_ATTR,
                );
            }
        }
        Ok(no_prelude)
    }

    pub(super) async fn exec_module_body(
        &self,
        program: &Node<Program>,
        exec_state: &mut ExecState,
        preserve_mem: PreserveMem,
        module_id: ModuleId,
        path: &ModulePath,
    ) -> Result<ModuleExecutionOutcome, (KclError, Option<EnvironmentRef>, Option<ModuleArtifactState>)> {
        crate::log::log(format!("enter module {path} {}", exec_state.stack()));

        // When executing only the new statements in incremental execution or
        // mock executing for sketch mode, we need the scene objects that were
        // created during the last execution, which are in the execution cache.
        // The cache is read to create the initial module state. Depending on
        // whether it's mock execution or engine execution, it's rehydrated
        // differently, so we need to clone them from a different place. Then
        // make sure the object ID generator matches the number of existing
        // scene objects.
        let mut local_state = ModuleState::new(
            path.clone(),
            exec_state.stack().memory.clone(),
            Some(module_id),
            exec_state.mod_local.sketch_mode,
            exec_state.mod_local.freedom_analysis,
        );
        match preserve_mem {
            PreserveMem::Always => {
                #[cfg(feature = "artifact-graph")]
                {
                    use crate::id::IncIdGenerator;
                    exec_state
                        .mod_local
                        .artifacts
                        .scene_objects
                        .clone_from(&exec_state.global.root_module_artifacts.scene_objects);
                    exec_state.mod_local.artifacts.object_id_generator =
                        IncIdGenerator::new(exec_state.global.root_module_artifacts.scene_objects.len());
                }
            }
            PreserveMem::Normal => {
                #[cfg(feature = "artifact-graph")]
                {
                    local_state
                        .artifacts
                        .scene_objects
                        .clone_from(&exec_state.mod_local.artifacts.scene_objects);
                }
                std::mem::swap(&mut exec_state.mod_local, &mut local_state);
            }
        }

        let no_prelude = self
            .handle_annotations(program.inner_attrs.iter(), crate::execution::BodyType::Root, exec_state)
            .await
            .map_err(|err| (err, None, None))?;

        if preserve_mem.normal() {
            exec_state.mut_stack().push_new_root_env(!no_prelude);
        }

        let result = self
            .exec_block(program, exec_state, crate::execution::BodyType::Root)
            .await;

        let env_ref = match preserve_mem {
            PreserveMem::Always => exec_state.mut_stack().pop_and_preserve_env(),
            PreserveMem::Normal => exec_state.mut_stack().pop_env(),
        };
        let module_artifacts = match preserve_mem {
            PreserveMem::Always => std::mem::take(&mut exec_state.mod_local.artifacts),
            PreserveMem::Normal => {
                std::mem::swap(&mut exec_state.mod_local, &mut local_state);
                local_state.artifacts
            }
        };

        crate::log::log(format!("leave {path}"));

        result
            .map_err(|err| (err, Some(env_ref), Some(module_artifacts.clone())))
            .map(|last_expr| ModuleExecutionOutcome {
                last_expr: last_expr.map(|value_cf| value_cf.into_value()),
                environment: env_ref,
                exports: local_state.module_exports,
                artifacts: module_artifacts,
            })
    }

    /// Execute an AST's program.
    #[async_recursion]
    pub(super) async fn exec_block<'a, B>(
        &'a self,
        block: &'a B,
        exec_state: &mut ExecState,
        body_type: BodyType,
    ) -> Result<Option<KclValueControlFlow>, KclError>
    where
        B: CodeBlock + Sync,
    {
        let mut last_expr = None;
        // Iterate over the body of the program.
        for statement in block.body() {
            match statement {
                BodyItem::ImportStatement(import_stmt) => {
                    if exec_state.sketch_mode() {
                        continue;
                    }
                    if !matches!(body_type, BodyType::Root) {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Imports are only supported at the top-level of a file.".to_owned(),
                            vec![import_stmt.into()],
                        )));
                    }

                    let source_range = SourceRange::from(import_stmt);
                    let attrs = &import_stmt.outer_attrs;
                    let module_path = ModulePath::from_import_path(
                        &import_stmt.path,
                        &self.settings.project_directory,
                        &exec_state.mod_local.path,
                    )?;
                    let module_id = self
                        .open_module(&import_stmt.path, attrs, &module_path, exec_state, source_range)
                        .await?;

                    match &import_stmt.selector {
                        ImportSelector::List { items } => {
                            let (env_ref, module_exports) =
                                self.exec_module_for_items(module_id, exec_state, source_range).await?;
                            for import_item in items {
                                // Extract the item from the module.
                                let mem = &exec_state.stack().memory;
                                let mut value = mem
                                    .get_from(&import_item.name.name, env_ref, import_item.into(), 0)
                                    .cloned();
                                let ty_name = format!("{}{}", memory::TYPE_PREFIX, import_item.name.name);
                                let mut ty = mem.get_from(&ty_name, env_ref, import_item.into(), 0).cloned();
                                let mod_name = format!("{}{}", memory::MODULE_PREFIX, import_item.name.name);
                                let mut mod_value = mem.get_from(&mod_name, env_ref, import_item.into(), 0).cloned();

                                if value.is_err() && ty.is_err() && mod_value.is_err() {
                                    return Err(KclError::new_undefined_value(
                                        KclErrorDetails::new(
                                            format!("{} is not defined in module", import_item.name.name),
                                            vec![SourceRange::from(&import_item.name)],
                                        ),
                                        None,
                                    ));
                                }

                                // Check that the item is allowed to be imported (in at least one namespace).
                                if value.is_ok() && !module_exports.contains(&import_item.name.name) {
                                    value = Err(KclError::new_semantic(KclErrorDetails::new(
                                        format!(
                                            "Cannot import \"{}\" from module because it is not exported. Add \"export\" before the definition to export it.",
                                            import_item.name.name
                                        ),
                                        vec![SourceRange::from(&import_item.name)],
                                    )));
                                }

                                if ty.is_ok() && !module_exports.contains(&ty_name) {
                                    ty = Err(KclError::new_semantic(KclErrorDetails::new(
                                        format!(
                                            "Cannot import \"{}\" from module because it is not exported. Add \"export\" before the definition to export it.",
                                            import_item.name.name
                                        ),
                                        vec![SourceRange::from(&import_item.name)],
                                    )));
                                }

                                if mod_value.is_ok() && !module_exports.contains(&mod_name) {
                                    mod_value = Err(KclError::new_semantic(KclErrorDetails::new(
                                        format!(
                                            "Cannot import \"{}\" from module because it is not exported. Add \"export\" before the definition to export it.",
                                            import_item.name.name
                                        ),
                                        vec![SourceRange::from(&import_item.name)],
                                    )));
                                }

                                if value.is_err() && ty.is_err() && mod_value.is_err() {
                                    return value.map(|v| Some(v.continue_()));
                                }

                                // Add the item to the current module.
                                if let Ok(value) = value {
                                    exec_state.mut_stack().add(
                                        import_item.identifier().to_owned(),
                                        value,
                                        SourceRange::from(&import_item.name),
                                    )?;

                                    if let ItemVisibility::Export = import_stmt.visibility {
                                        exec_state
                                            .mod_local
                                            .module_exports
                                            .push(import_item.identifier().to_owned());
                                    }
                                }

                                if let Ok(ty) = ty {
                                    let ty_name = format!("{}{}", memory::TYPE_PREFIX, import_item.identifier());
                                    exec_state.mut_stack().add(
                                        ty_name.clone(),
                                        ty,
                                        SourceRange::from(&import_item.name),
                                    )?;

                                    if let ItemVisibility::Export = import_stmt.visibility {
                                        exec_state.mod_local.module_exports.push(ty_name);
                                    }
                                }

                                if let Ok(mod_value) = mod_value {
                                    let mod_name = format!("{}{}", memory::MODULE_PREFIX, import_item.identifier());
                                    exec_state.mut_stack().add(
                                        mod_name.clone(),
                                        mod_value,
                                        SourceRange::from(&import_item.name),
                                    )?;

                                    if let ItemVisibility::Export = import_stmt.visibility {
                                        exec_state.mod_local.module_exports.push(mod_name);
                                    }
                                }
                            }
                        }
                        ImportSelector::Glob(_) => {
                            let (env_ref, module_exports) =
                                self.exec_module_for_items(module_id, exec_state, source_range).await?;
                            for name in module_exports.iter() {
                                let item = exec_state
                                    .stack()
                                    .memory
                                    .get_from(name, env_ref, source_range, 0)
                                    .map_err(|_err| {
                                        internal_err(
                                            format!("{name} is not defined in module (but was exported?)"),
                                            source_range,
                                        )
                                    })?
                                    .clone();
                                exec_state.mut_stack().add(name.to_owned(), item, source_range)?;

                                if let ItemVisibility::Export = import_stmt.visibility {
                                    exec_state.mod_local.module_exports.push(name.clone());
                                }
                            }
                        }
                        ImportSelector::None { .. } => {
                            let name = import_stmt.module_name().unwrap();
                            let item = KclValue::Module {
                                value: module_id,
                                meta: vec![source_range.into()],
                            };
                            exec_state.mut_stack().add(
                                format!("{}{}", memory::MODULE_PREFIX, name),
                                item,
                                source_range,
                            )?;
                        }
                    }
                    last_expr = None;
                }
                BodyItem::ExpressionStatement(expression_statement) => {
                    if exec_state.sketch_mode() && sketch_mode_should_skip(&expression_statement.expression) {
                        continue;
                    }

                    let metadata = Metadata::from(expression_statement);
                    let value = self
                        .execute_expr(
                            &expression_statement.expression,
                            exec_state,
                            &metadata,
                            &[],
                            StatementKind::Expression,
                        )
                        .await?;

                    let is_return = value.is_some_return();
                    last_expr = Some(value);

                    if is_return {
                        break;
                    }
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
                    if exec_state.sketch_mode() && sketch_mode_should_skip(&variable_declaration.declaration.init) {
                        continue;
                    }

                    let var_name = variable_declaration.declaration.id.name.to_string();
                    let source_range = SourceRange::from(&variable_declaration.declaration.init);
                    let metadata = Metadata { source_range };

                    let annotations = &variable_declaration.outer_attrs;

                    // During the evaluation of the variable's RHS, set context that this is all happening inside a variable
                    // declaration, for the given name. This helps improve user-facing error messages.
                    let lhs = variable_declaration.inner.name().to_owned();
                    let prev_being_declared = exec_state.mod_local.being_declared.take();
                    exec_state.mod_local.being_declared = Some(lhs);
                    let rhs_result = self
                        .execute_expr(
                            &variable_declaration.declaration.init,
                            exec_state,
                            &metadata,
                            annotations,
                            StatementKind::Declaration { name: &var_name },
                        )
                        .await;
                    // Declaration over, so unset this context.
                    exec_state.mod_local.being_declared = prev_being_declared;
                    let rhs = rhs_result?;

                    if rhs.is_some_return() {
                        last_expr = Some(rhs);
                        break;
                    }
                    let rhs = rhs.into_value();

                    let should_bind_name =
                        if let Some(fn_name) = variable_declaration.declaration.init.fn_declaring_name() {
                            // Declaring a function with a name, so only bind
                            // the variable name if it differs from the function
                            // name.
                            var_name != fn_name
                        } else {
                            // Not declaring a function, so we should bind the
                            // variable name.
                            true
                        };
                    if should_bind_name {
                        exec_state
                            .mut_stack()
                            .add(var_name.clone(), rhs.clone(), source_range)?;
                    }

                    // Track operations, for the feature tree.
                    // Don't track these operations if the KCL code being executed is in the stdlib,
                    // because users shouldn't know about stdlib internals -- it's useless noise, to them.
                    let should_show_in_feature_tree =
                        !exec_state.mod_local.inside_stdlib && rhs.show_variable_in_feature_tree();
                    if should_show_in_feature_tree {
                        exec_state.push_op(Operation::VariableDeclaration {
                            name: var_name.clone(),
                            value: OpKclValue::from(&rhs),
                            visibility: variable_declaration.visibility,
                            node_path: NodePath::placeholder(),
                            source_range,
                        });
                    }

                    // Track exports.
                    if let ItemVisibility::Export = variable_declaration.visibility {
                        if matches!(body_type, BodyType::Root) {
                            exec_state.mod_local.module_exports.push(var_name);
                        } else {
                            exec_state.err(CompilationError::err(
                                variable_declaration.as_source_range(),
                                "Exports are only supported at the top-level of a file. Remove `export` or move it to the top-level.",
                            ));
                        }
                    }
                    // Variable declaration can be the return value of a module.
                    last_expr = matches!(body_type, BodyType::Root).then_some(rhs.continue_());
                }
                BodyItem::TypeDeclaration(ty) => {
                    if exec_state.sketch_mode() {
                        continue;
                    }

                    let metadata = Metadata::from(&**ty);
                    let attrs = annotations::get_fn_attrs(&ty.outer_attrs, metadata.source_range)?.unwrap_or_default();
                    match attrs.impl_ {
                        annotations::Impl::Rust
                        | annotations::Impl::RustConstrainable
                        | annotations::Impl::RustConstraint => {
                            let std_path = match &exec_state.mod_local.path {
                                ModulePath::Std { value } => value,
                                ModulePath::Local { .. } | ModulePath::Main => {
                                    return Err(KclError::new_semantic(KclErrorDetails::new(
                                        "User-defined types are not yet supported.".to_owned(),
                                        vec![metadata.source_range],
                                    )));
                                }
                            };
                            let (t, props) = crate::std::std_ty(std_path, &ty.name.name);
                            let value = KclValue::Type {
                                value: TypeDef::RustRepr(t, props),
                                meta: vec![metadata],
                                experimental: attrs.experimental,
                            };
                            let name_in_mem = format!("{}{}", memory::TYPE_PREFIX, ty.name.name);
                            exec_state
                                .mut_stack()
                                .add(name_in_mem.clone(), value, metadata.source_range)
                                .map_err(|_| {
                                    KclError::new_semantic(KclErrorDetails::new(
                                        format!("Redefinition of type {}.", ty.name.name),
                                        vec![metadata.source_range],
                                    ))
                                })?;

                            if let ItemVisibility::Export = ty.visibility {
                                exec_state.mod_local.module_exports.push(name_in_mem);
                            }
                        }
                        // Do nothing for primitive types, they get special treatment and their declarations are just for documentation.
                        annotations::Impl::Primitive => {}
                        annotations::Impl::Kcl | annotations::Impl::KclConstrainable => match &ty.alias {
                            Some(alias) => {
                                let value = KclValue::Type {
                                    value: TypeDef::Alias(
                                        RuntimeType::from_parsed(
                                            alias.inner.clone(),
                                            exec_state,
                                            metadata.source_range,
                                            attrs.impl_ == annotations::Impl::KclConstrainable,
                                        )
                                        .map_err(|e| KclError::new_semantic(e.into()))?,
                                    ),
                                    meta: vec![metadata],
                                    experimental: attrs.experimental,
                                };
                                let name_in_mem = format!("{}{}", memory::TYPE_PREFIX, ty.name.name);
                                exec_state
                                    .mut_stack()
                                    .add(name_in_mem.clone(), value, metadata.source_range)
                                    .map_err(|_| {
                                        KclError::new_semantic(KclErrorDetails::new(
                                            format!("Redefinition of type {}.", ty.name.name),
                                            vec![metadata.source_range],
                                        ))
                                    })?;

                                if let ItemVisibility::Export = ty.visibility {
                                    exec_state.mod_local.module_exports.push(name_in_mem);
                                }
                            }
                            None => {
                                return Err(KclError::new_semantic(KclErrorDetails::new(
                                    "User-defined types are not yet supported.".to_owned(),
                                    vec![metadata.source_range],
                                )));
                            }
                        },
                    }

                    last_expr = None;
                }
                BodyItem::ReturnStatement(return_statement) => {
                    if exec_state.sketch_mode() && sketch_mode_should_skip(&return_statement.argument) {
                        continue;
                    }

                    let metadata = Metadata::from(return_statement);

                    if matches!(body_type, BodyType::Root) {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Cannot return from outside a function.".to_owned(),
                            vec![metadata.source_range],
                        )));
                    }

                    let value_cf = self
                        .execute_expr(
                            &return_statement.argument,
                            exec_state,
                            &metadata,
                            &[],
                            StatementKind::Expression,
                        )
                        .await?;
                    if value_cf.is_some_return() {
                        last_expr = Some(value_cf);
                        break;
                    }
                    let value = value_cf.into_value();
                    exec_state
                        .mut_stack()
                        .add(memory::RETURN_NAME.to_owned(), value, metadata.source_range)
                        .map_err(|_| {
                            KclError::new_semantic(KclErrorDetails::new(
                                "Multiple returns from a single function.".to_owned(),
                                vec![metadata.source_range],
                            ))
                        })?;
                    last_expr = None;
                }
            }
        }

        if matches!(body_type, BodyType::Root) {
            // Flush the batch queue.
            exec_state
                .flush_batch(
                    ModelingCmdMeta::new(exec_state, self, block.to_source_range()),
                    // True here tells the engine to flush all the end commands as well like fillets
                    // and chamfers where the engine would otherwise eat the ID of the segments.
                    true,
                )
                .await?;
        }

        Ok(last_expr)
    }

    pub async fn open_module(
        &self,
        path: &ImportPath,
        attrs: &[Node<Annotation>],
        resolved_path: &ModulePath,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<ModuleId, KclError> {
        match path {
            ImportPath::Kcl { .. } => {
                exec_state.global.mod_loader.cycle_check(resolved_path, source_range)?;

                if let Some(id) = exec_state.id_for_module(resolved_path) {
                    return Ok(id);
                }

                let id = exec_state.next_module_id();
                // Add file path string to global state even if it fails to import
                exec_state.add_path_to_source_id(resolved_path.clone(), id);
                let source = resolved_path.source(&self.fs, source_range).await?;
                exec_state.add_id_to_source(id, source.clone());
                // TODO handle parsing errors properly
                let parsed = crate::parsing::parse_str(&source.source, id).parse_errs_as_err()?;
                exec_state.add_module(id, resolved_path.clone(), ModuleRepr::Kcl(parsed, None));

                Ok(id)
            }
            ImportPath::Foreign { .. } => {
                if let Some(id) = exec_state.id_for_module(resolved_path) {
                    return Ok(id);
                }

                let id = exec_state.next_module_id();
                let path = resolved_path.expect_path();
                // Add file path string to global state even if it fails to import
                exec_state.add_path_to_source_id(resolved_path.clone(), id);
                let format = super::import::format_from_annotations(attrs, path, source_range)?;
                let geom = super::import::import_foreign(path, format, exec_state, self, source_range).await?;
                exec_state.add_module(id, resolved_path.clone(), ModuleRepr::Foreign(geom, None));
                Ok(id)
            }
            ImportPath::Std { .. } => {
                if let Some(id) = exec_state.id_for_module(resolved_path) {
                    return Ok(id);
                }

                let id = exec_state.next_module_id();
                // Add file path string to global state even if it fails to import
                exec_state.add_path_to_source_id(resolved_path.clone(), id);
                let source = resolved_path.source(&self.fs, source_range).await?;
                exec_state.add_id_to_source(id, source.clone());
                let parsed = crate::parsing::parse_str(&source.source, id)
                    .parse_errs_as_err()
                    .unwrap();
                exec_state.add_module(id, resolved_path.clone(), ModuleRepr::Kcl(parsed, None));
                Ok(id)
            }
        }
    }

    pub(super) async fn exec_module_for_items(
        &self,
        module_id: ModuleId,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<(EnvironmentRef, Vec<String>), KclError> {
        let path = exec_state.global.module_infos[&module_id].path.clone();
        let mut repr = exec_state.global.module_infos[&module_id].take_repr();
        // DON'T EARLY RETURN! We need to restore the module repr

        let result = match &mut repr {
            ModuleRepr::Root => Err(exec_state.circular_import_error(&path, source_range)),
            ModuleRepr::Kcl(_, Some(outcome)) => Ok((outcome.environment, outcome.exports.clone())),
            ModuleRepr::Kcl(program, cache) => self
                .exec_module_from_ast(program, module_id, &path, exec_state, source_range, PreserveMem::Normal)
                .await
                .map(|outcome| {
                    *cache = Some(outcome.clone());
                    (outcome.environment, outcome.exports)
                }),
            ModuleRepr::Foreign(geom, _) => Err(KclError::new_semantic(KclErrorDetails::new(
                "Cannot import items from foreign modules".to_owned(),
                vec![geom.source_range],
            ))),
            ModuleRepr::Dummy => unreachable!("Looking up {}, but it is still being interpreted", path),
        };

        exec_state.global.module_infos[&module_id].restore_repr(repr);
        result
    }

    async fn exec_module_for_result(
        &self,
        module_id: ModuleId,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        let path = exec_state.global.module_infos[&module_id].path.clone();
        let mut repr = exec_state.global.module_infos[&module_id].take_repr();
        // DON'T EARLY RETURN! We need to restore the module repr

        let result = match &mut repr {
            ModuleRepr::Root => Err(exec_state.circular_import_error(&path, source_range)),
            ModuleRepr::Kcl(_, Some(outcome)) => Ok(outcome.last_expr.clone()),
            ModuleRepr::Kcl(program, cached_items) => {
                let result = self
                    .exec_module_from_ast(program, module_id, &path, exec_state, source_range, PreserveMem::Normal)
                    .await;
                match result {
                    Ok(outcome) => {
                        let value = outcome.last_expr.clone();
                        *cached_items = Some(outcome);
                        Ok(value)
                    }
                    Err(e) => Err(e),
                }
            }
            ModuleRepr::Foreign(_, Some((imported, _))) => Ok(imported.clone()),
            ModuleRepr::Foreign(geom, cached) => {
                let result = super::import::send_to_engine(geom.clone(), exec_state, self)
                    .await
                    .map(|geom| Some(KclValue::ImportedGeometry(geom)));

                match result {
                    Ok(val) => {
                        *cached = Some((val.clone(), exec_state.mod_local.artifacts.clone()));
                        Ok(val)
                    }
                    Err(e) => Err(e),
                }
            }
            ModuleRepr::Dummy => unreachable!(),
        };

        exec_state.global.module_infos[&module_id].restore_repr(repr);

        result
    }

    pub async fn exec_module_from_ast(
        &self,
        program: &Node<Program>,
        module_id: ModuleId,
        path: &ModulePath,
        exec_state: &mut ExecState,
        source_range: SourceRange,
        preserve_mem: PreserveMem,
    ) -> Result<ModuleExecutionOutcome, KclError> {
        exec_state.global.mod_loader.enter_module(path);
        let result = self
            .exec_module_body(program, exec_state, preserve_mem, module_id, path)
            .await;
        exec_state.global.mod_loader.leave_module(path, source_range)?;

        // TODO: ModuleArtifactState is getting dropped here when there's an
        // error.  Should we propagate it for non-root modules?
        result.map_err(|(err, _, _)| {
            if let KclError::ImportCycle { .. } = err {
                // It was an import cycle.  Keep the original message.
                err.override_source_ranges(vec![source_range])
            } else {
                // TODO would be great to have line/column for the underlying error here
                KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Error loading imported file ({path}). Open it to view more details.\n  {}",
                        err.message()
                    ),
                    vec![source_range],
                ))
            }
        })
    }

    #[async_recursion]
    pub(crate) async fn execute_expr<'a: 'async_recursion>(
        &self,
        init: &Expr,
        exec_state: &mut ExecState,
        metadata: &Metadata,
        annotations: &[Node<Annotation>],
        statement_kind: StatementKind<'a>,
    ) -> Result<KclValueControlFlow, KclError> {
        let item = match init {
            Expr::None(none) => KclValue::from(none).continue_(),
            Expr::Literal(literal) => KclValue::from_literal((**literal).clone(), exec_state).continue_(),
            Expr::TagDeclarator(tag) => tag.execute(exec_state).await?.continue_(),
            Expr::Name(name) => {
                let being_declared = exec_state.mod_local.being_declared.clone();
                let value = name
                    .get_result(exec_state, self)
                    .await
                    .map_err(|e| var_in_own_ref_err(e, &being_declared))?
                    .clone();
                if let KclValue::Module { value: module_id, meta } = value {
                    self.exec_module_for_result(
                        module_id,
                        exec_state,
                        metadata.source_range
                        ).await?.map(|v| v.continue_())
                        .unwrap_or_else(|| {
                            exec_state.warn(CompilationError::err(
                                metadata.source_range,
                                "Imported module has no return value. The last statement of the module must be an expression, usually the Solid.",
                            ),
                        annotations::WARN_MOD_RETURN_VALUE);

                            let mut new_meta = vec![metadata.to_owned()];
                            new_meta.extend(meta);
                            KclValue::KclNone {
                                value: Default::default(),
                                meta: new_meta,
                            }.continue_()
                        })
                } else {
                    value.continue_()
                }
            }
            Expr::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, self).await?,
            Expr::FunctionExpression(function_expression) => {
                let attrs = annotations::get_fn_attrs(annotations, metadata.source_range)?;
                let experimental = attrs.map(|a| a.experimental).unwrap_or_default();
                let is_std = matches!(&exec_state.mod_local.path, ModulePath::Std { .. });

                // Check the KCL @(feature_tree = ) annotation.
                let include_in_feature_tree = attrs.unwrap_or_default().include_in_feature_tree;
                let (mut closure, placeholder_env_ref) = if let Some(attrs) = attrs
                    && (attrs.impl_ == annotations::Impl::Rust
                        || attrs.impl_ == annotations::Impl::RustConstrainable
                        || attrs.impl_ == annotations::Impl::RustConstraint)
                {
                    if let ModulePath::Std { value: std_path } = &exec_state.mod_local.path {
                        let (func, props) = crate::std::std_fn(std_path, statement_kind.expect_name());
                        (
                            KclValue::Function {
                                value: Box::new(FunctionSource::rust(func, function_expression.clone(), props, attrs)),
                                meta: vec![metadata.to_owned()],
                            },
                            None,
                        )
                    } else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Rust implementation of functions is restricted to the standard library".to_owned(),
                            vec![metadata.source_range],
                        )));
                    }
                } else {
                    // Snapshotting memory here is crucial for semantics so that we close
                    // over variables. Variables defined lexically later shouldn't
                    // be available to the function body.
                    let (env_ref, placeholder_env_ref) = if function_expression.name.is_some() {
                        // Recursive function needs a snapshot that includes
                        // itself.
                        let dummy = EnvironmentRef::dummy();
                        (dummy, Some(dummy))
                    } else {
                        (exec_state.mut_stack().snapshot(), None)
                    };
                    (
                        KclValue::Function {
                            value: Box::new(FunctionSource::kcl(
                                function_expression.clone(),
                                env_ref,
                                KclFunctionSourceParams {
                                    is_std,
                                    experimental,
                                    include_in_feature_tree,
                                },
                            )),
                            meta: vec![metadata.to_owned()],
                        },
                        placeholder_env_ref,
                    )
                };

                // If the function expression has a name, i.e. `fn name() {}`,
                // bind it in the current scope.
                if let Some(fn_name) = &function_expression.name {
                    // If we used a placeholder env ref for recursion, fix it up
                    // with the name recursively bound so that it's available in
                    // the function body.
                    if let Some(placeholder_env_ref) = placeholder_env_ref {
                        closure = exec_state.mut_stack().add_recursive_closure(
                            fn_name.name.to_owned(),
                            closure,
                            placeholder_env_ref,
                            metadata.source_range,
                        )?;
                    } else {
                        // Regular non-recursive binding.
                        exec_state
                            .mut_stack()
                            .add(fn_name.name.clone(), closure.clone(), metadata.source_range)?;
                    }
                }

                closure.continue_()
            }
            Expr::CallExpressionKw(call_expression) => call_expression.execute(exec_state, self).await?,
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_result(exec_state, self).await?,
            Expr::PipeSubstitution(pipe_substitution) => match statement_kind {
                StatementKind::Declaration { name } => {
                    let message = format!(
                        "you cannot declare variable {name} as %, because % can only be used in function calls"
                    );

                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        message,
                        vec![pipe_substitution.into()],
                    )));
                }
                StatementKind::Expression => match exec_state.mod_local.pipe_value.clone() {
                    Some(x) => x.continue_(),
                    None => {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "cannot use % outside a pipe expression".to_owned(),
                            vec![pipe_substitution.into()],
                        )));
                    }
                },
            },
            Expr::ArrayExpression(array_expression) => array_expression.execute(exec_state, self).await?,
            Expr::ArrayRangeExpression(range_expression) => range_expression.execute(exec_state, self).await?,
            Expr::ObjectExpression(object_expression) => object_expression.execute(exec_state, self).await?,
            Expr::MemberExpression(member_expression) => member_expression.get_result(exec_state, self).await?,
            Expr::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, self).await?,
            Expr::IfExpression(expr) => expr.get_result(exec_state, self).await?,
            Expr::LabelledExpression(expr) => {
                let value_cf = self
                    .execute_expr(&expr.expr, exec_state, metadata, &[], statement_kind)
                    .await?;
                let value = control_continue!(value_cf);
                exec_state
                    .mut_stack()
                    .add(expr.label.name.clone(), value.clone(), init.into())?;
                // TODO this lets us use the label as a variable name, but not as a tag in most cases
                value.continue_()
            }
            Expr::AscribedExpression(expr) => expr.get_result(exec_state, self).await?,
            Expr::SketchBlock(expr) => expr.get_result(exec_state, self).await?,
            Expr::SketchVar(expr) => expr.get_result(exec_state, self).await?.continue_(),
        };
        Ok(item)
    }
}

/// When executing in sketch mode, whether we should skip executing this
/// expression.
fn sketch_mode_should_skip(expr: &Expr) -> bool {
    match expr {
        Expr::SketchBlock(sketch_block) => !sketch_block.is_being_edited,
        _ => true,
    }
}

/// If the error is about an undefined name, and that name matches the name being defined,
/// make the error message more specific.
fn var_in_own_ref_err(e: KclError, being_declared: &Option<String>) -> KclError {
    let KclError::UndefinedValue { name, mut details } = e else {
        return e;
    };
    // TODO after June 26th: replace this with a let-chain,
    // which will be available in Rust 1.88
    // https://rust-lang.github.io/rfcs/2497-if-let-chains.html
    if let (Some(name0), Some(name1)) = (&being_declared, &name)
        && name0 == name1
    {
        details.message = format!(
            "You can't use `{name0}` because you're currently trying to define it. Use a different variable here instead."
        );
    }
    KclError::UndefinedValue { details, name }
}

impl Node<AscribedExpression> {
    #[async_recursion]
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        let metadata = Metadata {
            source_range: SourceRange::from(self),
        };
        let result = ctx
            .execute_expr(&self.expr, exec_state, &metadata, &[], StatementKind::Expression)
            .await?;
        let result = control_continue!(result);
        apply_ascription(&result, &self.ty, exec_state, self.into()).map(KclValue::continue_)
    }
}

impl Node<SketchBlock> {
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        if exec_state.mod_local.sketch_block.is_some() {
            // Disallow nested sketch blocks for now.
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Cannot execute a sketch block from within another sketch block".to_owned(),
                vec![SourceRange::from(self)],
            )));
        }

        let range = SourceRange::from(self);

        // Evaluate arguments.
        let mut labeled = IndexMap::new();
        for labeled_arg in &self.arguments {
            let source_range = SourceRange::from(labeled_arg.arg.clone());
            let metadata = Metadata { source_range };
            let value_cf = ctx
                .execute_expr(&labeled_arg.arg, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            let value = control_continue!(value_cf);
            let arg = Arg::new(value, source_range);
            match &labeled_arg.label {
                Some(label) => {
                    labeled.insert(label.name.clone(), arg);
                }
                None => {
                    let name = labeled_arg.arg.ident_name();
                    if let Some(name) = name {
                        labeled.insert(name.to_owned(), arg);
                    } else {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Arguments to sketch blocks must be either labeled or simple identifiers".to_owned(),
                            vec![SourceRange::from(&labeled_arg.arg)],
                        )));
                    }
                }
            }
        }
        let mut args = Args::new_no_args(range, ctx.clone(), Some("sketch block".to_owned()));
        args.labeled = labeled;

        // Create the sketch block scene object. This needs to happen before
        // scene objects created inside the sketch block so that its ID is
        // stable across sketch block edits. In order to create the sketch block
        // scene object, we need to make sure the plane scene object is created.
        let arg_on: SketchOrSurface = args.get_kw_arg("on", &RuntimeType::sketch_or_surface(), exec_state)?;
        let mut sketch_surface = arg_on.into_sketch_surface();
        // Ensure that the plane has an ObjectId. Always create an Object so
        // that we're consistent with IDs.
        if exec_state.sketch_mode() {
            if sketch_surface.object_id().is_none() {
                #[cfg(not(feature = "artifact-graph"))]
                {
                    // Without artifact graph, we just create a new object ID.
                    // It will never be used for anything meaningful.
                    sketch_surface.set_object_id(exec_state.next_object_id());
                }
                #[cfg(feature = "artifact-graph")]
                {
                    // Look up the last object. Since this is where we would have
                    // created it in real execution, it will be the last object.
                    let Some(last_object) = exec_state.mod_local.artifacts.scene_objects.last() else {
                        return Err(internal_err(
                            "In sketch mode, the `on` plane argument must refer to an existing plane object.",
                            range,
                        ));
                    };
                    sketch_surface.set_object_id(last_object.id);
                }
            }
        } else {
            match &mut sketch_surface {
                SketchSurface::Plane(plane) => {
                    // Ensure that it's been created in the engine.
                    ensure_sketch_plane_in_engine(plane, exec_state, &args).await?;
                }
                SketchSurface::Face(_) => {
                    // All faces should already be created in the engine.
                }
            }
        }
        let on_object_id = if let Some(object_id) = sketch_surface.object_id() {
            object_id
        } else {
            let message = "The `on` argument should have an object after ensure_sketch_plane_in_engine".to_owned();
            debug_assert!(false, "{message}");
            return Err(internal_err(message, range));
        };
        let arg_on_expr_name = self
            .arguments
            .iter()
            .find_map(|labeled_arg| {
                if let Some(label) = &labeled_arg.label
                    && label.name == "on"
                {
                    // Being a simple identifier only is required by the parser.
                    if let Some(name) = labeled_arg.arg.ident_name() {
                        Some(Ok(name))
                    } else {
                        let message = "A sketch block's `on` parameter must be a variable or identifier, not an arbitrary expression. The parser should have enforced this."
                                .to_owned();
                        debug_assert!(false, "{message}");
                        Some(Err(internal_err(message, &labeled_arg.arg)))
                    }
                } else {
                    None
                }
            })
            .unwrap_or_else(|| {
                Err(KclError::new_invalid_expression(KclErrorDetails::new(
                    "sketch block requires an `on` parameter".to_owned(),
                    vec![SourceRange::from(self)],
                )))
            })?
            // Convert to owned so that we can do an exclusive borrow later.
            .to_owned();
        #[cfg(not(feature = "artifact-graph"))]
        {
            let _ = on_object_id;
            drop(arg_on_expr_name);
        }
        #[cfg(feature = "artifact-graph")]
        let sketch_id = {
            use crate::execution::{Artifact, ArtifactId, CodeRef, SketchBlock};

            let on_object = exec_state.mod_local.artifacts.scene_object_by_id(on_object_id);

            // Get the plane artifact ID so that we can do an exclusive borrow.
            let plane_artifact_id = on_object.map(|object| object.artifact_id);

            let sketch_id = exec_state.next_object_id();

            let artifact_id = ArtifactId::from(exec_state.next_uuid());
            let sketch_scene_object = Object {
                id: sketch_id,
                kind: ObjectKind::Sketch(crate::frontend::sketch::Sketch {
                    args: crate::front::SketchCtor { on: arg_on_expr_name },
                    plane: on_object_id,
                    segments: Default::default(),
                    constraints: Default::default(),
                }),
                label: Default::default(),
                comments: Default::default(),
                artifact_id,
                source: range.into(),
            };
            exec_state.add_scene_object(sketch_scene_object, range);

            // Create and add the sketch block artifact
            exec_state.add_artifact(Artifact::SketchBlock(SketchBlock {
                id: artifact_id,
                plane_id: plane_artifact_id,
                code_ref: CodeRef::placeholder(range),
                sketch_id,
            }));

            sketch_id
        };

        let (return_result, variables, sketch_block_state) = {
            // Don't early return until the stack frame is popped!
            self.prep_mem(exec_state.mut_stack().snapshot(), exec_state);

            // Track that we're executing a sketch block.
            let original_value = exec_state.mod_local.sketch_block.replace(SketchBlockState::default());

            // When executing the body of the sketch block, we no longer want to
            // skip any code.
            let original_sketch_mode = std::mem::replace(&mut exec_state.mod_local.sketch_mode, false);

            let result = ctx.exec_block(&self.body, exec_state, BodyType::Block).await;

            exec_state.mod_local.sketch_mode = original_sketch_mode;

            let sketch_block_state = std::mem::replace(&mut exec_state.mod_local.sketch_block, original_value);

            let block_variables = exec_state
                .stack()
                .find_all_in_current_env()
                .map(|(name, value)| (name.clone(), value.clone()))
                .collect::<IndexMap<_, _>>();

            exec_state.mut_stack().pop_env();

            (result, block_variables, sketch_block_state)
        };

        // Propagate errors.
        return_result?;
        let Some(sketch_block_state) = sketch_block_state else {
            debug_assert!(false, "Sketch block state should still be set to Some from just above");
            return Err(internal_err(
                "Sketch block state should still be set to Some from just above",
                self,
            ));
        };

        // Translate sketch variables and constraints to solver input.
        let constraints = sketch_block_state
            .solver_constraints
            .iter()
            .cloned()
            .map(kcl_ezpz::ConstraintRequest::highest_priority)
            .chain(
                // Optional constraints have a lower priority.
                sketch_block_state
                    .solver_optional_constraints
                    .iter()
                    .cloned()
                    .map(|c| kcl_ezpz::ConstraintRequest::new(c, 1)),
            )
            .collect::<Vec<_>>();
        let initial_guesses = sketch_block_state
            .sketch_vars
            .iter()
            .map(|v| {
                let Some(sketch_var) = v.as_sketch_var() else {
                    return Err(internal_err("Expected sketch variable", self));
                };
                let constraint_id = sketch_var.id.to_constraint_id(range)?;
                // Normalize units.
                let number_value = KclValue::Number {
                    value: sketch_var.initial_value,
                    ty: sketch_var.ty,
                    meta: sketch_var.meta.clone(),
                };
                let initial_guess_value =
                    normalize_to_solver_unit(&number_value, v.into(), exec_state, "sketch variable initial value")?;
                let initial_guess = if let Some(n) = initial_guess_value.as_ty_f64() {
                    n.n
                } else {
                    let message = format!(
                        "Expected number after coercion, but found {}",
                        initial_guess_value.human_friendly_type()
                    );
                    debug_assert!(false, "{}", &message);
                    return Err(internal_err(message, self));
                };
                Ok((constraint_id, initial_guess))
            })
            .collect::<Result<Vec<_>, KclError>>()?;
        // Solve constraints.
        let config = kcl_ezpz::Config::default().with_max_iterations(50);
        let solve_result = if exec_state.mod_local.freedom_analysis {
            kcl_ezpz::solve_analysis(&constraints, initial_guesses.clone(), config).map(|outcome| {
                let freedom_analysis = FreedomAnalysis::from_ezpz_analysis(outcome.analysis, constraints.len());
                (outcome.outcome, Some(freedom_analysis))
            })
        } else {
            kcl_ezpz::solve(&constraints, initial_guesses.clone(), config).map(|outcome| (outcome, None))
        };
        // Build a combined list of all constraints (regular + optional) for conflict detection
        let num_required_constraints = sketch_block_state.solver_constraints.len();
        let all_constraints: Vec<kcl_ezpz::Constraint> = sketch_block_state
            .solver_constraints
            .iter()
            .cloned()
            .chain(sketch_block_state.solver_optional_constraints.iter().cloned())
            .collect();

        let (solve_outcome, solve_analysis) = match solve_result {
            Ok((solved, freedom)) => {
                let outcome = Solved::from_ezpz_outcome(solved, &all_constraints, num_required_constraints);
                (outcome, freedom)
            }
            Err(failure) => {
                match &failure.error {
                    NonLinearSystemError::FaerMatrix { .. }
                    | NonLinearSystemError::Faer { .. }
                    | NonLinearSystemError::FaerSolve { .. }
                    | NonLinearSystemError::FaerSvd(..)
                    | NonLinearSystemError::DidNotConverge => {
                        // Constraint solver failed to find a solution. Build a
                        // solution that is the initial guesses.
                        exec_state.warn(
                            CompilationError::err(range, "Constraint solver failed to find a solution".to_owned()),
                            annotations::WARN_SOLVER,
                        );
                        let final_values = initial_guesses.iter().map(|(_, v)| *v).collect::<Vec<_>>();
                        (
                            Solved {
                                final_values,
                                iterations: Default::default(),
                                warnings: failure.warnings,
                                priority_solved: Default::default(),
                                variables_in_conflicts: Default::default(),
                            },
                            None,
                        )
                    }
                    NonLinearSystemError::EmptySystemNotAllowed
                    | NonLinearSystemError::WrongNumberGuesses { .. }
                    | NonLinearSystemError::MissingGuess { .. }
                    | NonLinearSystemError::NotFound(..) => {
                        // These indicate something's gone wrong in KCL or ezpz,
                        // it's not a user error. We should investigate this.
                        #[cfg(target_arch = "wasm32")]
                        web_sys::console::error_1(
                            &format!("Internal error from constraint solver: {}", &failure.error).into(),
                        );
                        return Err(internal_err(
                            format!("Internal error from constraint solver: {}", &failure.error),
                            self,
                        ));
                    }
                    _ => {
                        // Catch all error case so that it's not a breaking change to publish new errors.
                        return Err(internal_err(
                            format!("Error from constraint solver: {}", &failure.error),
                            self,
                        ));
                    }
                }
            }
        };
        #[cfg(not(feature = "artifact-graph"))]
        let _ = solve_analysis;
        // Propagate warnings.
        for warning in &solve_outcome.warnings {
            let message = if let Some(index) = warning.about_constraint.as_ref() {
                format!("{}; constraint index {}", &warning.content, index)
            } else {
                format!("{}", &warning.content)
            };
            exec_state.warn(CompilationError::err(range, message), annotations::WARN_SOLVER);
        }
        // Substitute solutions back into sketch variables.
        let solution_ty = solver_numeric_type(exec_state);
        let variables = substitute_sketch_vars(variables, &solve_outcome, solution_ty, solve_analysis.as_ref())?;
        let mut solved_segments = Vec::with_capacity(sketch_block_state.needed_by_engine.len());
        for unsolved_segment in &sketch_block_state.needed_by_engine {
            solved_segments.push(substitute_sketch_var_in_segment(
                unsolved_segment.clone(),
                &solve_outcome,
                solver_numeric_type(exec_state),
                solve_analysis.as_ref(),
            )?);
        }
        let solved_segments = solved_segments; // Remove mutability
        #[cfg(feature = "artifact-graph")]
        {
            // Store variable solutions so that the sketch refactoring API can
            // write them back to the source. When editing a sketch block, we
            // exit early so that the sketch block that we're editing is always
            // the last one. Therefore, we should overwrite any previous
            // solutions.
            exec_state.mod_local.artifacts.var_solutions =
                sketch_block_state.var_solutions(solve_outcome, solution_ty, SourceRange::from(self))?;
        }

        // Create scene objects after unknowns are solved.
        let scene_objects = create_segment_scene_objects(&solved_segments, range, exec_state)?;

        #[cfg(not(feature = "artifact-graph"))]
        drop(scene_objects);
        #[cfg(feature = "artifact-graph")]
        {
            let mut segment_object_ids = Vec::with_capacity(scene_objects.len());
            for scene_object in scene_objects {
                segment_object_ids.push(scene_object.id);
                // Fill in placeholder scene objects.
                exec_state.set_scene_object(scene_object);
            }
            // Update the sketch scene object with the segments.
            let Some(sketch_object) = exec_state.mod_local.artifacts.scene_object_by_id_mut(sketch_id) else {
                let message = format!("Sketch object not found after it was just created; id={:?}", sketch_id);
                debug_assert!(false, "{}", &message);
                return Err(internal_err(message, range));
            };
            let ObjectKind::Sketch(sketch) = &mut sketch_object.kind else {
                let message = format!(
                    "Expected Sketch object after it was just created to be a sketch kind; id={:?}, actual={:?}",
                    sketch_id, sketch_object
                );
                debug_assert!(
                    false,
                    "{}; scene_objects={:#?}",
                    &message, &exec_state.mod_local.artifacts.scene_objects
                );
                return Err(internal_err(message, range));
            };
            sketch.segments.extend(segment_object_ids);
            // Update the sketch scene object with constraints.
            let mut sketch_block_state = sketch_block_state;
            sketch
                .constraints
                .extend(std::mem::take(&mut sketch_block_state.sketch_constraints));

            // Push sketch solve operation
            exec_state.push_op(Operation::SketchSolve {
                sketch_id,
                node_path: NodePath::placeholder(),
                source_range: range,
            });
        }

        // If not in sketch mode, send everything to the engine.
        if !exec_state.sketch_mode() {
            create_segments_in_engine(&sketch_surface, &solved_segments, ctx, exec_state, range).await?;
        }

        let metadata = Metadata {
            source_range: SourceRange::from(self),
        };
        let return_value = KclValue::Object {
            value: variables,
            constrainable: Default::default(),
            meta: vec![metadata],
        };
        Ok(if self.is_being_edited {
            // When the sketch block is being edited, we exit the program
            // immediately.
            return_value.exit()
        } else {
            return_value.continue_()
        })
    }
}

impl SketchBlock {
    fn prep_mem(&self, parent: EnvironmentRef, exec_state: &mut ExecState) {
        exec_state.mut_stack().push_new_env_for_call(parent);
    }
}

impl Node<SketchVar> {
    pub async fn get_result(&self, exec_state: &mut ExecState, _ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let Some(sketch_block_state) = &exec_state.mod_local.sketch_block else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Cannot use a sketch variable outside of a sketch block".to_owned(),
                vec![SourceRange::from(self)],
            )));
        };
        let id = sketch_block_state.next_sketch_var_id();
        let sketch_var = if let Some(initial) = &self.initial {
            KclValue::from_sketch_var_literal(initial, id, exec_state)
        } else {
            let metadata = Metadata {
                source_range: SourceRange::from(self),
            };

            KclValue::SketchVar {
                value: Box::new(super::SketchVar {
                    id,
                    initial_value: 0.0,
                    ty: NumericType::default(),
                    meta: vec![metadata],
                }),
            }
        };

        let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Cannot use a sketch variable outside of a sketch block".to_owned(),
                vec![SourceRange::from(self)],
            )));
        };
        sketch_block_state.sketch_vars.push(sketch_var.clone());

        Ok(sketch_var)
    }
}

fn apply_ascription(
    value: &KclValue,
    ty: &Node<Type>,
    exec_state: &mut ExecState,
    source_range: SourceRange,
) -> Result<KclValue, KclError> {
    let ty = RuntimeType::from_parsed(ty.inner.clone(), exec_state, value.into(), false)
        .map_err(|e| KclError::new_semantic(e.into()))?;

    if matches!(&ty, &RuntimeType::Primitive(PrimitiveType::Number(..))) {
        exec_state.clear_units_warnings(&source_range);
    }

    value.coerce(&ty, false, exec_state).map_err(|_| {
        let suggestion = if ty == RuntimeType::length() {
            ", you might try coercing to a fully specified numeric type such as `mm`"
        } else if ty == RuntimeType::angle() {
            ", you might try coercing to a fully specified numeric type such as `deg`"
        } else {
            ""
        };
        let ty_str = if let Some(ty) = value.principal_type() {
            format!("(with type `{ty}`) ")
        } else {
            String::new()
        };
        KclError::new_semantic(KclErrorDetails::new(
            format!(
                "could not coerce {} {ty_str}to type `{ty}`{suggestion}",
                value.human_friendly_type()
            ),
            vec![source_range],
        ))
    })
}

impl BinaryPart {
    #[async_recursion]
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        match self {
            BinaryPart::Literal(literal) => Ok(KclValue::from_literal((**literal).clone(), exec_state).continue_()),
            BinaryPart::Name(name) => name.get_result(exec_state, ctx).await.cloned().map(KclValue::continue_),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, ctx).await,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, ctx).await,
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(exec_state, ctx).await,
            BinaryPart::ArrayExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::ArrayRangeExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::ObjectExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::IfExpression(e) => e.get_result(exec_state, ctx).await,
            BinaryPart::AscribedExpression(e) => e.get_result(exec_state, ctx).await,
            BinaryPart::SketchVar(e) => e.get_result(exec_state, ctx).await.map(KclValue::continue_),
        }
    }
}

impl Node<Name> {
    pub(super) async fn get_result<'a>(
        &self,
        exec_state: &'a mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<&'a KclValue, KclError> {
        let being_declared = exec_state.mod_local.being_declared.clone();
        self.get_result_inner(exec_state, ctx)
            .await
            .map_err(|e| var_in_own_ref_err(e, &being_declared))
    }

    async fn get_result_inner<'a>(
        &self,
        exec_state: &'a mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<&'a KclValue, KclError> {
        if self.abs_path {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                "Absolute paths (names beginning with `::` are not yet supported)".to_owned(),
                self.as_source_ranges(),
            )));
        }

        let mod_name = format!("{}{}", memory::MODULE_PREFIX, self.name.name);

        if self.path.is_empty() {
            let item_value = exec_state.stack().get(&self.name.name, self.into());
            if item_value.is_ok() {
                return item_value;
            }
            return exec_state.stack().get(&mod_name, self.into());
        }

        let mut mem_spec: Option<(EnvironmentRef, Vec<String>)> = None;
        for p in &self.path {
            let value = match mem_spec {
                Some((env, exports)) => {
                    if !exports.contains(&p.name) {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            format!("Item {} not found in module's exported items", p.name),
                            p.as_source_ranges(),
                        )));
                    }

                    exec_state
                        .stack()
                        .memory
                        .get_from(&p.name, env, p.as_source_range(), 0)?
                }
                None => exec_state
                    .stack()
                    .get(&format!("{}{}", memory::MODULE_PREFIX, p.name), self.into())?,
            };

            let KclValue::Module { value: module_id, .. } = value else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Identifier in path must refer to a module, found {}",
                        value.human_friendly_type()
                    ),
                    p.as_source_ranges(),
                )));
            };

            mem_spec = Some(
                ctx.exec_module_for_items(*module_id, exec_state, p.as_source_range())
                    .await?,
            );
        }

        let (env, exports) = mem_spec.unwrap();

        let item_exported = exports.contains(&self.name.name);
        let item_value = exec_state
            .stack()
            .memory
            .get_from(&self.name.name, env, self.name.as_source_range(), 0);

        // Item is defined and exported.
        if item_exported && item_value.is_ok() {
            return item_value;
        }

        let mod_exported = exports.contains(&mod_name);
        let mod_value = exec_state
            .stack()
            .memory
            .get_from(&mod_name, env, self.name.as_source_range(), 0);

        // Module is defined and exported.
        if mod_exported && mod_value.is_ok() {
            return mod_value;
        }

        // Neither item or module is defined.
        if item_value.is_err() && mod_value.is_err() {
            return item_value;
        }

        // Either item or module is defined, but not exported.
        debug_assert!((item_value.is_ok() && !item_exported) || (mod_value.is_ok() && !mod_exported));
        Err(KclError::new_semantic(KclErrorDetails::new(
            format!("Item {} not found in module's exported items", self.name.name),
            self.name.as_source_ranges(),
        )))
    }
}

impl Node<MemberExpression> {
    async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        let meta = Metadata {
            source_range: SourceRange::from(self),
        };
        // TODO: The order of execution is wrong. We should execute the object
        // *before* the property.
        let property = Property::try_from(
            self.computed,
            self.property.clone(),
            exec_state,
            self.into(),
            ctx,
            &meta,
            &[],
            StatementKind::Expression,
        )
        .await?;
        let object_cf = ctx
            .execute_expr(&self.object, exec_state, &meta, &[], StatementKind::Expression)
            .await?;
        let object = control_continue!(object_cf);

        // Check the property and object match -- e.g. ints for arrays, strs for objects.
        match (object, property, self.computed) {
            (KclValue::Segment { value: segment }, Property::String(property), false) => match property.as_str() {
                "at" => match &segment.repr {
                    SegmentRepr::Unsolved { segment } => {
                        match &segment.kind {
                            UnsolvedSegmentKind::Point { position, .. } => {
                                // TODO: assert that types of all elements are the same.
                                Ok(KclValue::HomArray {
                                    value: vec![
                                        KclValue::from_unsolved_expr(position[0].clone(), segment.meta.clone()),
                                        KclValue::from_unsolved_expr(position[1].clone(), segment.meta.clone()),
                                    ],
                                    ty: RuntimeType::any(),
                                }
                                .continue_())
                            }
                            _ => Err(KclError::new_undefined_value(
                                KclErrorDetails::new(
                                    format!("Property '{property}' not found in segment"),
                                    vec![self.clone().into()],
                                ),
                                None,
                            )),
                        }
                    }
                    SegmentRepr::Solved { segment } => {
                        match &segment.kind {
                            SegmentKind::Point { position, .. } => {
                                // TODO: assert that types of all elements are the same.
                                Ok(KclValue::array_from_point2d(
                                    [position[0].n, position[1].n],
                                    position[0].ty,
                                    segment.meta.clone(),
                                )
                                .continue_())
                            }
                            _ => Err(KclError::new_undefined_value(
                                KclErrorDetails::new(
                                    format!("Property '{property}' not found in segment"),
                                    vec![self.clone().into()],
                                ),
                                None,
                            )),
                        }
                    }
                },
                "start" => match &segment.repr {
                    SegmentRepr::Unsolved { segment } => match &segment.kind {
                        UnsolvedSegmentKind::Point { .. } => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in point segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                        UnsolvedSegmentKind::Line {
                            start,
                            ctor,
                            start_object_id,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Unsolved {
                                    segment: UnsolvedSegment {
                                        id: segment.id,
                                        object_id: *start_object_id,
                                        kind: UnsolvedSegmentKind::Point {
                                            position: start.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.start.clone(),
                                            }),
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        UnsolvedSegmentKind::Arc {
                            start,
                            ctor,
                            start_object_id,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Unsolved {
                                    segment: UnsolvedSegment {
                                        id: segment.id,
                                        object_id: *start_object_id,
                                        kind: UnsolvedSegmentKind::Point {
                                            position: start.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.start.clone(),
                                            }),
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                    },
                    SegmentRepr::Solved { segment } => match &segment.kind {
                        SegmentKind::Point { .. } => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in point segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                        SegmentKind::Line {
                            start,
                            ctor,
                            start_object_id,
                            start_freedom,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Solved {
                                    segment: Segment {
                                        id: segment.id,
                                        object_id: *start_object_id,
                                        kind: SegmentKind::Point {
                                            position: start.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.start.clone(),
                                            }),
                                            freedom: *start_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        SegmentKind::Arc {
                            start,
                            ctor,
                            start_object_id,
                            start_freedom,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Solved {
                                    segment: Segment {
                                        id: segment.id,
                                        object_id: *start_object_id,
                                        kind: SegmentKind::Point {
                                            position: start.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.start.clone(),
                                            }),
                                            freedom: *start_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                    },
                },
                "end" => match &segment.repr {
                    SegmentRepr::Unsolved { segment } => match &segment.kind {
                        UnsolvedSegmentKind::Point { .. } => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in point segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                        UnsolvedSegmentKind::Line {
                            end,
                            ctor,
                            end_object_id,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Unsolved {
                                    segment: UnsolvedSegment {
                                        id: segment.id,
                                        object_id: *end_object_id,
                                        kind: UnsolvedSegmentKind::Point {
                                            position: end.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.end.clone(),
                                            }),
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        UnsolvedSegmentKind::Arc {
                            end,
                            ctor,
                            end_object_id,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Unsolved {
                                    segment: UnsolvedSegment {
                                        id: segment.id,
                                        object_id: *end_object_id,
                                        kind: UnsolvedSegmentKind::Point {
                                            position: end.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.end.clone(),
                                            }),
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                    },
                    SegmentRepr::Solved { segment } => match &segment.kind {
                        SegmentKind::Point { .. } => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in point segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                        SegmentKind::Line {
                            end,
                            ctor,
                            end_object_id,
                            end_freedom,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Solved {
                                    segment: Segment {
                                        id: segment.id,
                                        object_id: *end_object_id,
                                        kind: SegmentKind::Point {
                                            position: end.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.end.clone(),
                                            }),
                                            freedom: *end_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        SegmentKind::Arc {
                            end,
                            ctor,
                            end_object_id,
                            end_freedom,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Solved {
                                    segment: Segment {
                                        id: segment.id,
                                        object_id: *end_object_id,
                                        kind: SegmentKind::Point {
                                            position: end.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.end.clone(),
                                            }),
                                            freedom: *end_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                    },
                },
                "center" => match &segment.repr {
                    SegmentRepr::Unsolved { segment } => match &segment.kind {
                        UnsolvedSegmentKind::Arc {
                            center,
                            ctor,
                            center_object_id,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Unsolved {
                                    segment: UnsolvedSegment {
                                        id: segment.id,
                                        object_id: *center_object_id,
                                        kind: UnsolvedSegmentKind::Point {
                                            position: center.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.center.clone(),
                                            }),
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        _ => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                    },
                    SegmentRepr::Solved { segment } => match &segment.kind {
                        SegmentKind::Arc {
                            center,
                            ctor,
                            center_object_id,
                            center_freedom,
                            ..
                        } => Ok(KclValue::Segment {
                            value: Box::new(AbstractSegment {
                                repr: SegmentRepr::Solved {
                                    segment: Segment {
                                        id: segment.id,
                                        object_id: *center_object_id,
                                        kind: SegmentKind::Point {
                                            position: center.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.center.clone(),
                                            }),
                                            freedom: *center_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }
                        .continue_()),
                        _ => Err(KclError::new_undefined_value(
                            KclErrorDetails::new(
                                format!("Property '{property}' not found in segment"),
                                vec![self.clone().into()],
                            ),
                            None,
                        )),
                    },
                },
                other => Err(KclError::new_undefined_value(
                    KclErrorDetails::new(
                        format!("Property '{other}' not found in segment"),
                        vec![self.clone().into()],
                    ),
                    None,
                )),
            },
            (KclValue::Plane { value: plane }, Property::String(property), false) => match property.as_str() {
                "zAxis" => {
                    let (p, u) = plane.info.z_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]).continue_())
                }
                "yAxis" => {
                    let (p, u) = plane.info.y_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]).continue_())
                }
                "xAxis" => {
                    let (p, u) = plane.info.x_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]).continue_())
                }
                "origin" => {
                    let (p, u) = plane.info.origin.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]).continue_())
                }
                other => Err(KclError::new_undefined_value(
                    KclErrorDetails::new(
                        format!("Property '{other}' not found in plane"),
                        vec![self.clone().into()],
                    ),
                    None,
                )),
            },
            (KclValue::Object { value: map, .. }, Property::String(property), false) => {
                if let Some(value) = map.get(&property) {
                    Ok(value.to_owned().continue_())
                } else {
                    Err(KclError::new_undefined_value(
                        KclErrorDetails::new(
                            format!("Property '{property}' not found in object"),
                            vec![self.clone().into()],
                        ),
                        None,
                    ))
                }
            }
            (KclValue::Object { .. }, Property::String(property), true) => {
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Cannot index object with string; use dot notation instead, e.g. `obj.{property}`"),
                    vec![self.clone().into()],
                )))
            }
            (KclValue::Object { value: map, .. }, p @ Property::UInt(i), _) => {
                if i == 0
                    && let Some(value) = map.get("x")
                {
                    return Ok(value.to_owned().continue_());
                }
                if i == 1
                    && let Some(value) = map.get("y")
                {
                    return Ok(value.to_owned().continue_());
                }
                if i == 2
                    && let Some(value) = map.get("z")
                {
                    return Ok(value.to_owned().continue_());
                }
                let t = p.type_name();
                let article = article_for(t);
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Only strings can be used as the property of an object, but you're using {article} {t}",),
                    vec![self.clone().into()],
                )))
            }
            (KclValue::HomArray { value: arr, .. }, Property::UInt(index), _) => {
                let value_of_arr = arr.get(index);
                if let Some(value) = value_of_arr {
                    Ok(value.to_owned().continue_())
                } else {
                    Err(KclError::new_undefined_value(
                        KclErrorDetails::new(
                            format!("The array doesn't have any item at index {index}"),
                            vec![self.clone().into()],
                        ),
                        None,
                    ))
                }
            }
            // Singletons and single-element arrays should be interchangeable, but only indexing by 0 should work.
            // This is kind of a silly property, but it's possible it occurs in generic code or something.
            (obj, Property::UInt(0), _) => Ok(obj.continue_()),
            (KclValue::HomArray { .. }, p, _) => {
                let t = p.type_name();
                let article = article_for(t);
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Only integers >= 0 can be used as the index of an array, but you're using {article} {t}",),
                    vec![self.clone().into()],
                )))
            }
            (KclValue::Solid { value }, Property::String(prop), false) if prop == "sketch" => Ok(KclValue::Sketch {
                value: Box::new(value.sketch),
            }
            .continue_()),
            (geometry @ KclValue::Solid { .. }, Property::String(prop), false) if prop == "tags" => {
                // This is a common mistake.
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Property `{prop}` not found on {}. You can get a solid's tags through its sketch, as in, `exampleSolid.sketch.tags`.",
                        geometry.human_friendly_type()
                    ),
                    vec![self.clone().into()],
                )))
            }
            (KclValue::Sketch { value: sk }, Property::String(prop), false) if prop == "tags" => Ok(KclValue::Object {
                meta: vec![Metadata {
                    source_range: SourceRange::from(self.clone()),
                }],
                value: sk
                    .tags
                    .iter()
                    .map(|(k, tag)| (k.to_owned(), KclValue::TagIdentifier(Box::new(tag.to_owned()))))
                    .collect(),
                constrainable: false,
            }
            .continue_()),
            (geometry @ (KclValue::Sketch { .. } | KclValue::Solid { .. }), Property::String(property), false) => {
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Property `{property}` not found on {}", geometry.human_friendly_type()),
                    vec![self.clone().into()],
                )))
            }
            (being_indexed, _, false) => Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Only objects can have members accessed with dot notation, but you're trying to access {}",
                    being_indexed.human_friendly_type()
                ),
                vec![self.clone().into()],
            ))),
            (being_indexed, _, true) => Err(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Only arrays can be indexed, but you're trying to index {}",
                    being_indexed.human_friendly_type()
                ),
                vec![self.clone().into()],
            ))),
        }
    }
}

impl Node<BinaryExpression> {
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        enum State {
            EvaluateLeft(Node<BinaryExpression>),
            FromLeft {
                node: Node<BinaryExpression>,
            },
            EvaluateRight {
                node: Node<BinaryExpression>,
                left: KclValue,
            },
            FromRight {
                node: Node<BinaryExpression>,
                left: KclValue,
            },
        }

        let mut stack = vec![State::EvaluateLeft(self.clone())];
        let mut last_result: Option<KclValue> = None;

        while let Some(state) = stack.pop() {
            match state {
                State::EvaluateLeft(node) => {
                    let left_part = node.left.clone();
                    match left_part {
                        BinaryPart::BinaryExpression(child) => {
                            stack.push(State::FromLeft { node });
                            stack.push(State::EvaluateLeft(*child));
                        }
                        part => {
                            let left_value = part.get_result(exec_state, ctx).await?;
                            let left_value = control_continue!(left_value);
                            stack.push(State::EvaluateRight { node, left: left_value });
                        }
                    }
                }
                State::FromLeft { node } => {
                    let Some(left_value) = last_result.take() else {
                        return Err(Self::missing_result_error(&node));
                    };
                    stack.push(State::EvaluateRight { node, left: left_value });
                }
                State::EvaluateRight { node, left } => {
                    let right_part = node.right.clone();
                    match right_part {
                        BinaryPart::BinaryExpression(child) => {
                            stack.push(State::FromRight { node, left });
                            stack.push(State::EvaluateLeft(*child));
                        }
                        part => {
                            let right_value = part.get_result(exec_state, ctx).await?;
                            let right_value = control_continue!(right_value);
                            let result = node.apply_operator(exec_state, ctx, left, right_value).await?;
                            last_result = Some(result);
                        }
                    }
                }
                State::FromRight { node, left } => {
                    let Some(right_value) = last_result.take() else {
                        return Err(Self::missing_result_error(&node));
                    };
                    let result = node.apply_operator(exec_state, ctx, left, right_value).await?;
                    last_result = Some(result);
                }
            }
        }

        last_result
            .map(KclValue::continue_)
            .ok_or_else(|| Self::missing_result_error(self))
    }

    async fn apply_operator(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        left_value: KclValue,
        right_value: KclValue,
    ) -> Result<KclValue, KclError> {
        let mut meta = left_value.metadata();
        meta.extend(right_value.metadata());

        // First check if we are doing string concatenation.
        if self.operator == BinaryOperator::Add
            && let (KclValue::String { value: left, .. }, KclValue::String { value: right, .. }) =
                (&left_value, &right_value)
        {
            return Ok(KclValue::String {
                value: format!("{left}{right}"),
                meta,
            });
        }

        // Then check if we have solids.
        if self.operator == BinaryOperator::Add || self.operator == BinaryOperator::Or {
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = Args::new_no_args(self.into(), ctx.clone(), Some("union".to_owned()));
                let result = crate::std::csg::inner_union(
                    vec![*left.clone(), *right.clone()],
                    Default::default(),
                    exec_state,
                    args,
                )
                .await?;
                return Ok(result.into());
            }
        } else if self.operator == BinaryOperator::Sub {
            // Check if we have solids.
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = Args::new_no_args(self.into(), ctx.clone(), Some("subtract".to_owned()));
                let result = crate::std::csg::inner_subtract(
                    vec![*left.clone()],
                    vec![*right.clone()],
                    Default::default(),
                    exec_state,
                    args,
                )
                .await?;
                return Ok(result.into());
            }
        } else if self.operator == BinaryOperator::And
            && let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value)
        {
            // Check if we have solids.
            let args = Args::new_no_args(self.into(), ctx.clone(), Some("intersect".to_owned()));
            let result = crate::std::csg::inner_intersect(
                vec![*left.clone(), *right.clone()],
                Default::default(),
                exec_state,
                args,
            )
            .await?;
            return Ok(result.into());
        }

        // Check if we are doing logical operations on booleans.
        if self.operator == BinaryOperator::Or || self.operator == BinaryOperator::And {
            let KclValue::Bool { value: left_value, .. } = left_value else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Cannot apply logical operator to non-boolean value: {}",
                        left_value.human_friendly_type()
                    ),
                    vec![self.left.clone().into()],
                )));
            };
            let KclValue::Bool { value: right_value, .. } = right_value else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Cannot apply logical operator to non-boolean value: {}",
                        right_value.human_friendly_type()
                    ),
                    vec![self.right.clone().into()],
                )));
            };
            let raw_value = match self.operator {
                BinaryOperator::Or => left_value || right_value,
                BinaryOperator::And => left_value && right_value,
                _ => unreachable!(),
            };
            return Ok(KclValue::Bool { value: raw_value, meta });
        }

        // Check if we're doing equivalence in sketch mode.
        if self.operator == BinaryOperator::Eq && exec_state.mod_local.sketch_block.is_some() {
            match (&left_value, &right_value) {
                // Same sketch variables.
                (KclValue::SketchVar { value: left_value, .. }, KclValue::SketchVar { value: right_value, .. })
                    if left_value.id == right_value.id =>
                {
                    return Ok(KclValue::Bool { value: true, meta });
                }
                // Different sketch variables.
                (KclValue::SketchVar { .. }, KclValue::SketchVar { .. }) => {
                    // TODO: sketch-api: Collapse the two sketch variables into
                    // one constraint variable.
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "TODO: Different sketch variables".to_owned(),
                        vec![self.into()],
                    )));
                }
                // One sketch variable, one number.
                (KclValue::SketchVar { value: var, .. }, input_number @ KclValue::Number { .. })
                | (input_number @ KclValue::Number { .. }, KclValue::SketchVar { value: var, .. }) => {
                    let number_value = normalize_to_solver_unit(
                        input_number,
                        input_number.into(),
                        exec_state,
                        "fixed constraint value",
                    )?;
                    let Some(n) = number_value.as_ty_f64() else {
                        let message = format!(
                            "Expected number after coercion, but found {}",
                            number_value.human_friendly_type()
                        );
                        debug_assert!(false, "{}", &message);
                        return Err(internal_err(message, self));
                    };
                    let constraint = Constraint::Fixed(var.id.to_constraint_id(self.as_source_range())?, n.n);
                    let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                        let message = "Being inside a sketch block should have already been checked above".to_owned();
                        debug_assert!(false, "{}", &message);
                        return Err(internal_err(message, self));
                    };
                    sketch_block_state.solver_constraints.push(constraint);
                    return Ok(KclValue::Bool { value: true, meta });
                }
                // One sketch constraint, one number.
                (KclValue::SketchConstraint { value: constraint }, input_number @ KclValue::Number { .. })
                | (input_number @ KclValue::Number { .. }, KclValue::SketchConstraint { value: constraint }) => {
                    let number_value = normalize_to_solver_unit(
                        input_number,
                        input_number.into(),
                        exec_state,
                        "fixed constraint value",
                    )?;
                    let Some(n) = number_value.as_ty_f64() else {
                        let message = format!(
                            "Expected number after coercion, but found {}",
                            number_value.human_friendly_type()
                        );
                        debug_assert!(false, "{}", &message);
                        return Err(internal_err(message, self));
                    };
                    match &constraint.kind {
                        SketchConstraintKind::Distance { points } => {
                            let range = self.as_source_range();
                            let p0 = &points[0];
                            let p1 = &points[1];
                            let solver_pt0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p0.vars.x.to_constraint_id(range)?,
                                p0.vars.y.to_constraint_id(range)?,
                            );
                            let solver_pt1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p1.vars.x.to_constraint_id(range)?,
                                p1.vars.y.to_constraint_id(range)?,
                            );
                            let solver_constraint = Constraint::Distance(solver_pt0, solver_pt1, n.n);

                            #[cfg(feature = "artifact-graph")]
                            let constraint_id = exec_state.next_object_id();
                            let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                                let message =
                                    "Being inside a sketch block should have already been checked above".to_owned();
                                debug_assert!(false, "{}", &message);
                                return Err(internal_err(message, self));
                            };
                            sketch_block_state.solver_constraints.push(solver_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                use crate::{execution::ArtifactId, front::Distance};

                                let constraint = crate::front::Constraint::Distance(Distance {
                                    points: vec![p0.object_id, p1.object_id],
                                    distance: n.try_into().map_err(|_| {
                                        internal_err("Failed to convert distance units numeric suffix:", range)
                                    })?,
                                });
                                sketch_block_state.sketch_constraints.push(constraint_id);
                                exec_state.add_scene_object(
                                    Object {
                                        id: constraint_id,
                                        kind: ObjectKind::Constraint { constraint },
                                        label: Default::default(),
                                        comments: Default::default(),
                                        artifact_id: ArtifactId::constraint(),
                                        source: range.into(),
                                    },
                                    range,
                                );
                            }
                        }
                        SketchConstraintKind::Radius { points } | SketchConstraintKind::Diameter { points } => {
                            let range = self.as_source_range();
                            let center = &points[0];
                            let start = &points[1];
                            // Find the arc segment that has matching center and start to get its end point
                            let Some(sketch_block_state) = &exec_state.mod_local.sketch_block else {
                                return Err(internal_err(
                                    "Being inside a sketch block should have already been checked above",
                                    self,
                                ));
                            };
                            // Find the arc segment with matching center and start
                            let (constraint_name, is_diameter) = match &constraint.kind {
                                SketchConstraintKind::Radius { .. } => ("radius", false),
                                SketchConstraintKind::Diameter { .. } => ("diameter", true),
                                _ => unreachable!(),
                            };
                            let arc_segment = sketch_block_state
                                .needed_by_engine
                                .iter()
                                .find(|seg| {
                                    matches!(&seg.kind, UnsolvedSegmentKind::Arc {
                                        center_object_id,
                                        start_object_id,
                                        ..
                                    } if *center_object_id == center.object_id && *start_object_id == start.object_id)
                                })
                                .ok_or_else(|| {
                                    internal_err(
                                        format!("Could not find arc segment for {} constraint", constraint_name),
                                        range,
                                    )
                                })?;
                            let UnsolvedSegmentKind::Arc { end, .. } = &arc_segment.kind else {
                                return Err(internal_err("Expected arc segment", range));
                            };
                            // Extract end point coordinates
                            let (end_x_var, end_y_var) = match (&end[0], &end[1]) {
                                (UnsolvedExpr::Unknown(end_x), UnsolvedExpr::Unknown(end_y)) => (*end_x, *end_y),
                                _ => {
                                    return Err(internal_err(
                                        "Arc end point must have sketch vars in all coordinates",
                                        range,
                                    ));
                                }
                            };
                            let solver_arc = kcl_ezpz::datatypes::inputs::DatumCircularArc {
                                center: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                    center.vars.x.to_constraint_id(range)?,
                                    center.vars.y.to_constraint_id(range)?,
                                ),
                                start: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                    start.vars.x.to_constraint_id(range)?,
                                    start.vars.y.to_constraint_id(range)?,
                                ),
                                end: kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                    end_x_var.to_constraint_id(range)?,
                                    end_y_var.to_constraint_id(range)?,
                                ),
                            };
                            // Use ArcRadius constraint from ezpz solver
                            // Diameter is twice the radius, so we divide by 2 before passing to the solver
                            let radius_value = if is_diameter { n.n / 2.0 } else { n.n };
                            let solver_constraint = Constraint::ArcRadius(solver_arc, radius_value);

                            #[cfg(feature = "artifact-graph")]
                            let constraint_id = exec_state.next_object_id();
                            let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                                let message =
                                    "Being inside a sketch block should have already been checked above".to_owned();
                                debug_assert!(false, "{}", &message);
                                return Err(internal_err(message, self));
                            };
                            sketch_block_state.solver_constraints.push(solver_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                use crate::execution::ArtifactId;

                                // Find the arc segment object ID from the sketch block state
                                let arc_object_id = sketch_block_state
                                    .needed_by_engine
                                    .iter()
                                    .find(|seg| {
                                        matches!(&seg.kind, UnsolvedSegmentKind::Arc {
                                            center_object_id,
                                            start_object_id,
                                            ..
                                        } if *center_object_id == center.object_id && *start_object_id == start.object_id)
                                    })
                                    .map(|seg| seg.object_id)
                                    .ok_or_else(|| {
                                        internal_err(
                                            format!(
                                                "Could not find arc segment object ID for {} constraint",
                                                constraint_name
                                            ),
                                            range,
                                        )
                                    })?;

                                let constraint = if is_diameter {
                                    use crate::frontend::sketch::Diameter;
                                    crate::front::Constraint::Diameter(Diameter {
                                        arc: arc_object_id,
                                        diameter: n.try_into().map_err(|_| {
                                            internal_err("Failed to convert diameter units numeric suffix:", range)
                                        })?,
                                    })
                                } else {
                                    use crate::frontend::sketch::Radius;
                                    crate::front::Constraint::Radius(Radius {
                                        arc: arc_object_id,
                                        radius: n.try_into().map_err(|_| {
                                            internal_err("Failed to convert radius units numeric suffix:", range)
                                        })?,
                                    })
                                };
                                sketch_block_state.sketch_constraints.push(constraint_id);
                                exec_state.add_scene_object(
                                    Object {
                                        id: constraint_id,
                                        kind: ObjectKind::Constraint { constraint },
                                        label: Default::default(),
                                        comments: Default::default(),
                                        artifact_id: ArtifactId::constraint(),
                                        source: range.into(),
                                    },
                                    range,
                                );
                            }
                        }
                        SketchConstraintKind::HorizontalDistance { points } => {
                            let range = self.as_source_range();
                            let p0 = &points[0];
                            let p1 = &points[1];
                            let solver_pt0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p0.vars.x.to_constraint_id(range)?,
                                p0.vars.y.to_constraint_id(range)?,
                            );
                            let solver_pt1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p1.vars.x.to_constraint_id(range)?,
                                p1.vars.y.to_constraint_id(range)?,
                            );
                            // Horizontal distance: p1.x - p0.x = n
                            // Note: EZPZ's HorizontalDistance(p0, p1, d) means p0.x - p1.x = d
                            // So we swap the points to get p1.x - p0.x = n
                            let solver_constraint =
                                kcl_ezpz::Constraint::HorizontalDistance(solver_pt1, solver_pt0, n.n);

                            #[cfg(feature = "artifact-graph")]
                            let constraint_id = exec_state.next_object_id();
                            let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                                let message =
                                    "Being inside a sketch block should have already been checked above".to_owned();
                                debug_assert!(false, "{}", &message);
                                return Err(internal_err(message, self));
                            };
                            sketch_block_state.solver_constraints.push(solver_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                use crate::{execution::ArtifactId, front::Distance};

                                let constraint = crate::front::Constraint::HorizontalDistance(Distance {
                                    points: vec![p0.object_id, p1.object_id],
                                    distance: n.try_into().map_err(|_| {
                                        internal_err("Failed to convert distance units numeric suffix:", range)
                                    })?,
                                });
                                sketch_block_state.sketch_constraints.push(constraint_id);
                                exec_state.add_scene_object(
                                    Object {
                                        id: constraint_id,
                                        kind: ObjectKind::Constraint { constraint },
                                        label: Default::default(),
                                        comments: Default::default(),
                                        artifact_id: ArtifactId::constraint(),
                                        source: range.into(),
                                    },
                                    range,
                                );
                            }
                        }
                        SketchConstraintKind::VerticalDistance { points } => {
                            let range = self.as_source_range();
                            let p0 = &points[0];
                            let p1 = &points[1];
                            let solver_pt0 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p0.vars.x.to_constraint_id(range)?,
                                p0.vars.y.to_constraint_id(range)?,
                            );
                            let solver_pt1 = kcl_ezpz::datatypes::inputs::DatumPoint::new_xy(
                                p1.vars.x.to_constraint_id(range)?,
                                p1.vars.y.to_constraint_id(range)?,
                            );
                            // Vertical distance: p1.y - p0.y = n
                            // Note: EZPZ's VerticalDistance(p0, p1, d) means p0.y - p1.y = d
                            // So we swap the points to get p1.y - p0.y = n
                            let solver_constraint = kcl_ezpz::Constraint::VerticalDistance(solver_pt1, solver_pt0, n.n);

                            #[cfg(feature = "artifact-graph")]
                            let constraint_id = exec_state.next_object_id();
                            let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                                let message =
                                    "Being inside a sketch block should have already been checked above".to_owned();
                                debug_assert!(false, "{}", &message);
                                return Err(internal_err(message, self));
                            };
                            sketch_block_state.solver_constraints.push(solver_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                use crate::{execution::ArtifactId, front::Distance};

                                let constraint = crate::front::Constraint::VerticalDistance(Distance {
                                    points: vec![p0.object_id, p1.object_id],
                                    distance: n.try_into().map_err(|_| {
                                        internal_err("Failed to convert distance units numeric suffix:", range)
                                    })?,
                                });
                                sketch_block_state.sketch_constraints.push(constraint_id);
                                exec_state.add_scene_object(
                                    Object {
                                        id: constraint_id,
                                        kind: ObjectKind::Constraint { constraint },
                                        label: Default::default(),
                                        comments: Default::default(),
                                        artifact_id: ArtifactId::constraint(),
                                        source: range.into(),
                                    },
                                    range,
                                );
                            }
                        }
                    }
                    return Ok(KclValue::Bool { value: true, meta });
                }
                _ => {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "Cannot create an equivalence constraint between values of these types: {} and {}",
                            left_value.human_friendly_type(),
                            right_value.human_friendly_type()
                        ),
                        vec![self.into()],
                    )));
                }
            }
        }

        let left = number_as_f64(&left_value, self.left.clone().into())?;
        let right = number_as_f64(&right_value, self.right.clone().into())?;

        let value = match self.operator {
            BinaryOperator::Add => {
                let (l, r, ty) = NumericType::combine_eq_coerce(left, right, None);
                self.warn_on_unknown(&ty, "Adding", exec_state);
                KclValue::Number { value: l + r, meta, ty }
            }
            BinaryOperator::Sub => {
                let (l, r, ty) = NumericType::combine_eq_coerce(left, right, None);
                self.warn_on_unknown(&ty, "Subtracting", exec_state);
                KclValue::Number { value: l - r, meta, ty }
            }
            BinaryOperator::Mul => {
                let (l, r, ty) = NumericType::combine_mul(left, right);
                self.warn_on_unknown(&ty, "Multiplying", exec_state);
                KclValue::Number { value: l * r, meta, ty }
            }
            BinaryOperator::Div => {
                let (l, r, ty) = NumericType::combine_div(left, right);
                self.warn_on_unknown(&ty, "Dividing", exec_state);
                KclValue::Number { value: l / r, meta, ty }
            }
            BinaryOperator::Mod => {
                let (l, r, ty) = NumericType::combine_mod(left, right);
                self.warn_on_unknown(&ty, "Modulo of", exec_state);
                KclValue::Number { value: l % r, meta, ty }
            }
            BinaryOperator::Pow => KclValue::Number {
                value: left.n.powf(right.n),
                meta,
                ty: exec_state.current_default_units(),
            },
            BinaryOperator::Neq => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l != r, meta }
            }
            BinaryOperator::Gt => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l > r, meta }
            }
            BinaryOperator::Gte => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l >= r, meta }
            }
            BinaryOperator::Lt => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l < r, meta }
            }
            BinaryOperator::Lte => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l <= r, meta }
            }
            BinaryOperator::Eq => {
                let (l, r, ty) = NumericType::combine_eq(left, right, exec_state, self.as_source_range());
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l == r, meta }
            }
            BinaryOperator::And | BinaryOperator::Or => unreachable!(),
        };

        Ok(value)
    }

    fn missing_result_error(node: &Node<BinaryExpression>) -> KclError {
        internal_err("missing result while evaluating binary expression", node)
    }

    fn warn_on_unknown(&self, ty: &NumericType, verb: &str, exec_state: &mut ExecState) {
        if ty == &NumericType::Unknown {
            let sr = self.as_source_range();
            exec_state.clear_units_warnings(&sr);
            let mut err = CompilationError::err(
                sr,
                format!(
                    "{verb} numbers which have unknown or incompatible units.\nYou can probably fix this error by specifying the units using type ascription, e.g., `len: number(mm)` or `(a * b): number(deg)`."
                ),
            );
            err.tag = crate::errors::Tag::UnknownNumericUnits;
            exec_state.warn(err, annotations::WARN_UNKNOWN_UNITS);
        }
    }
}

impl Node<UnaryExpression> {
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        match self.operator {
            UnaryOperator::Not => {
                let value = self.argument.get_result(exec_state, ctx).await?;
                let value = control_continue!(value);
                let KclValue::Bool {
                    value: bool_value,
                    meta: _,
                } = value
                else {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "Cannot apply unary operator ! to non-boolean value: {}",
                            value.human_friendly_type()
                        ),
                        vec![self.into()],
                    )));
                };
                let meta = vec![Metadata {
                    source_range: self.into(),
                }];
                let negated = KclValue::Bool {
                    value: !bool_value,
                    meta,
                };

                Ok(negated.continue_())
            }
            UnaryOperator::Neg => {
                let value = self.argument.get_result(exec_state, ctx).await?;
                let value = control_continue!(value);
                let err = || {
                    KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "You can only negate numbers, planes, or lines, but this is a {}",
                            value.human_friendly_type()
                        ),
                        vec![self.into()],
                    ))
                };
                match &value {
                    KclValue::Number { value, ty, .. } => {
                        let meta = vec![Metadata {
                            source_range: self.into(),
                        }];
                        Ok(KclValue::Number {
                            value: -value,
                            meta,
                            ty: *ty,
                        }
                        .continue_())
                    }
                    KclValue::Plane { value } => {
                        let mut plane = value.clone();
                        if plane.info.x_axis.x != 0.0 {
                            plane.info.x_axis.x *= -1.0;
                        }
                        if plane.info.x_axis.y != 0.0 {
                            plane.info.x_axis.y *= -1.0;
                        }
                        if plane.info.x_axis.z != 0.0 {
                            plane.info.x_axis.z *= -1.0;
                        }

                        plane.id = exec_state.next_uuid();
                        plane.object_id = None;
                        Ok(KclValue::Plane { value: plane }.continue_())
                    }
                    KclValue::Object {
                        value: values, meta, ..
                    } => {
                        // Special-case for negating line-like objects.
                        let Some(direction) = values.get("direction") else {
                            return Err(err());
                        };

                        let direction = match direction {
                            KclValue::Tuple { value: values, meta } => {
                                let values = values
                                    .iter()
                                    .map(|v| match v {
                                        KclValue::Number { value, ty, meta } => Ok(KclValue::Number {
                                            value: *value * -1.0,
                                            ty: *ty,
                                            meta: meta.clone(),
                                        }),
                                        _ => Err(err()),
                                    })
                                    .collect::<Result<Vec<_>, _>>()?;

                                KclValue::Tuple {
                                    value: values,
                                    meta: meta.clone(),
                                }
                            }
                            KclValue::HomArray {
                                value: values,
                                ty: ty @ RuntimeType::Primitive(PrimitiveType::Number(_)),
                            } => {
                                let values = values
                                    .iter()
                                    .map(|v| match v {
                                        KclValue::Number { value, ty, meta } => Ok(KclValue::Number {
                                            value: *value * -1.0,
                                            ty: *ty,
                                            meta: meta.clone(),
                                        }),
                                        _ => Err(err()),
                                    })
                                    .collect::<Result<Vec<_>, _>>()?;

                                KclValue::HomArray {
                                    value: values,
                                    ty: ty.clone(),
                                }
                            }
                            _ => return Err(err()),
                        };

                        let mut value = values.clone();
                        value.insert("direction".to_owned(), direction);
                        Ok(KclValue::Object {
                            value,
                            meta: meta.clone(),
                            constrainable: false,
                        }
                        .continue_())
                    }
                    _ => Err(err()),
                }
            }
            UnaryOperator::Plus => {
                let operand = self.argument.get_result(exec_state, ctx).await?;
                let operand = control_continue!(operand);
                match operand {
                    KclValue::Number { .. } | KclValue::Plane { .. } => Ok(operand.continue_()),
                    _ => Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "You can only apply unary + to numbers or planes, but this is a {}",
                            operand.human_friendly_type()
                        ),
                        vec![self.into()],
                    ))),
                }
            }
        }
    }
}

pub(crate) async fn execute_pipe_body(
    exec_state: &mut ExecState,
    body: &[Expr],
    source_range: SourceRange,
    ctx: &ExecutorContext,
) -> Result<KclValueControlFlow, KclError> {
    let Some((first, body)) = body.split_first() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Pipe expressions cannot be empty".to_owned(),
            vec![source_range],
        )));
    };
    // Evaluate the first element in the pipeline.
    // They use the pipe_value from some AST node above this, so that if pipe expression is nested in a larger pipe expression,
    // they use the % from the parent. After all, this pipe expression hasn't been executed yet, so it doesn't have any % value
    // of its own.
    let meta = Metadata {
        source_range: SourceRange::from(first),
    };
    let output = ctx
        .execute_expr(first, exec_state, &meta, &[], StatementKind::Expression)
        .await?;
    let output = control_continue!(output);

    // Now that we've evaluated the first child expression in the pipeline, following child expressions
    // should use the previous child expression for %.
    // This means there's no more need for the previous pipe_value from the parent AST node above this one.
    let previous_pipe_value = exec_state.mod_local.pipe_value.replace(output);
    // Evaluate remaining elements.
    let result = inner_execute_pipe_body(exec_state, body, ctx).await;
    // Restore the previous pipe value.
    exec_state.mod_local.pipe_value = previous_pipe_value;

    result
}

/// Execute the tail of a pipe expression.  exec_state.pipe_value must be set by
/// the caller.
#[async_recursion]
async fn inner_execute_pipe_body(
    exec_state: &mut ExecState,
    body: &[Expr],
    ctx: &ExecutorContext,
) -> Result<KclValueControlFlow, KclError> {
    for expression in body {
        if let Expr::TagDeclarator(_) = expression {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("This cannot be in a PipeExpression: {expression:?}"),
                vec![expression.into()],
            )));
        }
        let metadata = Metadata {
            source_range: SourceRange::from(expression),
        };
        let output = ctx
            .execute_expr(expression, exec_state, &metadata, &[], StatementKind::Expression)
            .await?;
        let output = control_continue!(output);
        exec_state.mod_local.pipe_value = Some(output);
    }
    // Safe to unwrap here, because pipe_value always has something pushed in when the `match first` executes.
    let final_output = exec_state.mod_local.pipe_value.take().unwrap();
    Ok(final_output.continue_())
}

impl Node<TagDeclarator> {
    pub async fn execute(&self, exec_state: &mut ExecState) -> Result<KclValue, KclError> {
        let memory_item = KclValue::TagIdentifier(Box::new(TagIdentifier {
            value: self.name.clone(),
            info: Vec::new(),
            meta: vec![Metadata {
                source_range: self.into(),
            }],
        }));

        exec_state
            .mut_stack()
            .add(self.name.clone(), memory_item, self.into())?;

        Ok(self.into())
    }
}

impl Node<ArrayExpression> {
    #[async_recursion]
    pub(super) async fn execute(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let metadata = Metadata::from(element);
            // TODO: Carry statement kind here so that we know if we're
            // inside a variable declaration.
            let value = ctx
                .execute_expr(element, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            let value = control_continue!(value);

            results.push(value);
        }

        Ok(KclValue::HomArray {
            value: results,
            ty: RuntimeType::Primitive(PrimitiveType::Any),
        }
        .continue_())
    }
}

impl Node<ArrayRangeExpression> {
    #[async_recursion]
    pub(super) async fn execute(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        let metadata = Metadata::from(&self.start_element);
        let start_val = ctx
            .execute_expr(
                &self.start_element,
                exec_state,
                &metadata,
                &[],
                StatementKind::Expression,
            )
            .await?;
        let start_val = control_continue!(start_val);
        let start = start_val
            .as_ty_f64()
            .ok_or(KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "Expected number for range start but found {}",
                    start_val.human_friendly_type()
                ),
                vec![self.into()],
            )))?;
        let metadata = Metadata::from(&self.end_element);
        let end_val = ctx
            .execute_expr(&self.end_element, exec_state, &metadata, &[], StatementKind::Expression)
            .await?;
        let end_val = control_continue!(end_val);
        let end = end_val.as_ty_f64().ok_or(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Expected number for range end but found {}",
                end_val.human_friendly_type()
            ),
            vec![self.into()],
        )))?;

        let (start, end, ty) = NumericType::combine_range(start, end, exec_state, self.as_source_range())?;
        let Some(start) = crate::try_f64_to_i64(start) else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Range start must be an integer, but found {start}"),
                vec![self.into()],
            )));
        };
        let Some(end) = crate::try_f64_to_i64(end) else {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Range end must be an integer, but found {end}"),
                vec![self.into()],
            )));
        };

        if end < start {
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Range start is greater than range end: {start} .. {end}"),
                vec![self.into()],
            )));
        }

        let range: Vec<_> = if self.end_inclusive {
            (start..=end).collect()
        } else {
            (start..end).collect()
        };

        let meta = vec![Metadata {
            source_range: self.into(),
        }];

        Ok(KclValue::HomArray {
            value: range
                .into_iter()
                .map(|num| KclValue::Number {
                    value: num as f64,
                    ty,
                    meta: meta.clone(),
                })
                .collect(),
            ty: RuntimeType::Primitive(PrimitiveType::Number(ty)),
        }
        .continue_())
    }
}

impl Node<ObjectExpression> {
    #[async_recursion]
    pub(super) async fn execute(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        let mut object = HashMap::with_capacity(self.properties.len());
        for property in &self.properties {
            let metadata = Metadata::from(&property.value);
            let result = ctx
                .execute_expr(&property.value, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            let result = control_continue!(result);
            object.insert(property.key.name.clone(), result);
        }

        Ok(KclValue::Object {
            value: object,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
            constrainable: false,
        }
        .continue_())
    }
}

fn article_for<S: AsRef<str>>(s: S) -> &'static str {
    // '[' is included since it's an array.
    if s.as_ref().starts_with(['a', 'e', 'i', 'o', 'u', '[']) {
        "an"
    } else {
        "a"
    }
}

fn number_as_f64(v: &KclValue, source_range: SourceRange) -> Result<TyF64, KclError> {
    v.as_ty_f64().ok_or_else(|| {
        let actual_type = v.human_friendly_type();
        KclError::new_semantic(KclErrorDetails::new(
            format!("Expected a number, but found {actual_type}",),
            vec![source_range],
        ))
    })
}

impl Node<IfExpression> {
    #[async_recursion]
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        // Check the `if` branch.
        let cond_value = ctx
            .execute_expr(
                &self.cond,
                exec_state,
                &Metadata::from(self),
                &[],
                StatementKind::Expression,
            )
            .await?;
        let cond_value = control_continue!(cond_value);
        if cond_value.get_bool()? {
            let block_result = ctx.exec_block(&*self.then_val, exec_state, BodyType::Block).await?;
            // Block must end in an expression, so this has to be Some.
            // Enforced by the parser.
            // See https://github.com/KittyCAD/modeling-app/issues/4015
            return Ok(block_result.unwrap());
        }

        // Check any `else if` branches.
        for else_if in &self.else_ifs {
            let cond_value = ctx
                .execute_expr(
                    &else_if.cond,
                    exec_state,
                    &Metadata::from(self),
                    &[],
                    StatementKind::Expression,
                )
                .await?;
            let cond_value = control_continue!(cond_value);
            if cond_value.get_bool()? {
                let block_result = ctx.exec_block(&*else_if.then_val, exec_state, BodyType::Block).await?;
                // Block must end in an expression, so this has to be Some.
                // Enforced by the parser.
                // See https://github.com/KittyCAD/modeling-app/issues/4015
                return Ok(block_result.unwrap());
            }
        }

        // Run the final `else` branch.
        ctx.exec_block(&*self.final_else, exec_state, BodyType::Block)
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
    #[allow(clippy::too_many_arguments)]
    async fn try_from<'a>(
        computed: bool,
        value: Expr,
        exec_state: &mut ExecState,
        sr: SourceRange,
        ctx: &ExecutorContext,
        metadata: &Metadata,
        annotations: &[Node<Annotation>],
        statement_kind: StatementKind<'a>,
    ) -> Result<Self, KclError> {
        let property_sr = vec![sr];
        if !computed {
            let Expr::Name(identifier) = value else {
                // Should actually be impossible because the parser would reject it.
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Object expressions like `obj.property` must use simple identifier names, not complex expressions"
                        .to_owned(),
                    property_sr,
                )));
            };
            return Ok(Property::String(identifier.to_string()));
        }

        let prop_value = ctx
            .execute_expr(&value, exec_state, metadata, annotations, statement_kind)
            .await?;
        let prop_value = match prop_value.control {
            ControlFlowKind::Continue => prop_value.into_value(),
            ControlFlowKind::Exit => {
                let message = "Early return inside array brackets is currently not supported".to_owned();
                debug_assert!(false, "{}", &message);
                return Err(internal_err(message, sr));
            }
        };
        match prop_value {
            KclValue::Number { value, ty, meta: _ } => {
                if !matches!(
                    ty,
                    NumericType::Unknown
                        | NumericType::Default { .. }
                        | NumericType::Known(crate::exec::UnitType::Count)
                ) {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        format!(
                            "{value} is not a valid index, indices must be non-dimensional numbers. If you're sure this is correct, you can add `: number(Count)` to tell KCL this number is an index"
                        ),
                        property_sr,
                    )));
                }
                if let Some(x) = crate::try_f64_to_usize(value) {
                    Ok(Property::UInt(x))
                } else {
                    Err(KclError::new_semantic(KclErrorDetails::new(
                        format!("{value} is not a valid index, indices must be whole numbers >= 0"),
                        property_sr,
                    )))
                }
            }
            _ => Err(KclError::new_semantic(KclErrorDetails::new(
                "Only numbers (>= 0) can be indexes".to_owned(),
                vec![sr],
            ))),
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
    pub(super) async fn get_result(
        &self,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<KclValueControlFlow, KclError> {
        execute_pipe_body(exec_state, &self.body, self.into(), ctx).await
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use tokio::io::AsyncWriteExt;

    use super::*;
    use crate::{
        ExecutorSettings,
        errors::Severity,
        exec::UnitType,
        execution::{ContextType, parse_execute},
    };

    #[tokio::test(flavor = "multi_thread")]
    async fn ascription() {
        let program = r#"
a = 42: number
b = a: number
p = {
  origin = { x = 0, y = 0, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = 1, z = 0 },
  zAxis = { x = 0, y = 0, z = 1 }
}: Plane
arr1 = [42]: [number(cm)]
"#;

        let result = parse_execute(program).await.unwrap();
        let mem = result.exec_state.stack();
        assert!(matches!(
            mem.memory
                .get_from("p", result.mem_env, SourceRange::default(), 0)
                .unwrap(),
            KclValue::Plane { .. }
        ));
        let arr1 = mem
            .memory
            .get_from("arr1", result.mem_env, SourceRange::default(), 0)
            .unwrap();
        if let KclValue::HomArray { value, ty } = arr1 {
            assert_eq!(value.len(), 1, "Expected Vec with specific length: found {value:?}");
            assert_eq!(
                *ty,
                RuntimeType::known_length(kittycad_modeling_cmds::units::UnitLength::Centimeters)
            );
            // Compare, ignoring meta.
            if let KclValue::Number { value, ty, .. } = &value[0] {
                // It should not convert units.
                assert_eq!(*value, 42.0);
                assert_eq!(
                    *ty,
                    NumericType::Known(UnitType::Length(kittycad_modeling_cmds::units::UnitLength::Centimeters))
                );
            } else {
                panic!("Expected a number; found {:?}", value[0]);
            }
        } else {
            panic!("Expected HomArray; found {arr1:?}");
        }

        let program = r#"
a = 42: string
"#;
        let result = parse_execute(program).await;
        let err = result.unwrap_err();
        assert!(
            err.to_string()
                .contains("could not coerce a number (with type `number`) to type `string`"),
            "Expected error but found {err:?}"
        );

        let program = r#"
a = 42: Plane
"#;
        let result = parse_execute(program).await;
        let err = result.unwrap_err();
        assert!(
            err.to_string()
                .contains("could not coerce a number (with type `number`) to type `Plane`"),
            "Expected error but found {err:?}"
        );

        let program = r#"
arr = [0]: [string]
"#;
        let result = parse_execute(program).await;
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains(
                "could not coerce an array of `number` with 1 value (with type `[any; 1]`) to type `[string]`"
            ),
            "Expected error but found {err:?}"
        );

        let program = r#"
mixedArr = [0, "a"]: [number(mm)]
"#;
        let result = parse_execute(program).await;
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains(
                "could not coerce an array of `number`, `string` (with type `[any; 2]`) to type `[number(mm)]`"
            ),
            "Expected error but found {err:?}"
        );

        let program = r#"
mixedArr = [0, "a"]: [mm]
"#;
        let result = parse_execute(program).await;
        let err = result.unwrap_err();
        assert!(
            err.to_string().contains(
                "could not coerce an array of `number`, `string` (with type `[any; 2]`) to type `[number(mm)]`"
            ),
            "Expected error but found {err:?}"
        );
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn neg_plane() {
        let program = r#"
p = {
  origin = { x = 0, y = 0, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = 1, z = 0 },
}: Plane
p2 = -p
"#;

        let result = parse_execute(program).await.unwrap();
        let mem = result.exec_state.stack();
        match mem
            .memory
            .get_from("p2", result.mem_env, SourceRange::default(), 0)
            .unwrap()
        {
            KclValue::Plane { value } => {
                assert_eq!(value.info.x_axis.x, -1.0);
                assert_eq!(value.info.x_axis.y, 0.0);
                assert_eq!(value.info.x_axis.z, 0.0);
            }
            _ => unreachable!(),
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn multiple_returns() {
        let program = r#"fn foo() {
  return 0
  return 42
}

a = foo()
"#;

        let result = parse_execute(program).await;
        assert!(result.unwrap_err().to_string().contains("return"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn load_all_modules() {
        // program a.kcl
        let program_a_kcl = r#"
export a = 1
"#;
        // program b.kcl
        let program_b_kcl = r#"
import a from 'a.kcl'

export b = a + 1
"#;
        // program c.kcl
        let program_c_kcl = r#"
import a from 'a.kcl'

export c = a + 2
"#;

        // program main.kcl
        let main_kcl = r#"
import b from 'b.kcl'
import c from 'c.kcl'

d = b + c
"#;

        let main = crate::parsing::parse_str(main_kcl, ModuleId::default())
            .parse_errs_as_err()
            .unwrap();

        let tmpdir = tempfile::TempDir::with_prefix("zma_kcl_load_all_modules").unwrap();

        tokio::fs::File::create(tmpdir.path().join("main.kcl"))
            .await
            .unwrap()
            .write_all(main_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("a.kcl"))
            .await
            .unwrap()
            .write_all(program_a_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("b.kcl"))
            .await
            .unwrap()
            .write_all(program_b_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("c.kcl"))
            .await
            .unwrap()
            .write_all(program_c_kcl.as_bytes())
            .await
            .unwrap();

        let exec_ctxt = ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_mock::EngineConnection::new()
                    .map_err(|err| {
                        internal_err(
                            format!("Failed to create mock engine connection: {err}"),
                            SourceRange::default(),
                        )
                    })
                    .unwrap(),
            )),
            fs: Arc::new(crate::fs::FileManager::new()),
            settings: ExecutorSettings {
                project_directory: Some(crate::TypedPath(tmpdir.path().into())),
                ..Default::default()
            },
            context_type: ContextType::Mock,
        };
        let mut exec_state = ExecState::new(&exec_ctxt);

        exec_ctxt
            .run(
                &crate::Program {
                    ast: main.clone(),
                    original_file_contents: "".to_owned(),
                },
                &mut exec_state,
            )
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn user_coercion() {
        let program = r#"fn foo(x: Axis2d) {
  return 0
}

foo(x = { direction = [0, 0], origin = [0, 0]})
"#;

        parse_execute(program).await.unwrap();

        let program = r#"fn foo(x: Axis3d) {
  return 0
}

foo(x = { direction = [0, 0], origin = [0, 0]})
"#;

        parse_execute(program).await.unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_return() {
        let program = r#"fn foo(): number(mm) {
  return 42
}

a = foo()
"#;

        parse_execute(program).await.unwrap();

        let program = r#"fn foo(): mm {
  return 42
}

a = foo()
"#;

        parse_execute(program).await.unwrap();

        let program = r#"fn foo(): number(mm) {
  return { bar: 42 }
}

a = foo()
"#;

        parse_execute(program).await.unwrap_err();

        let program = r#"fn foo(): mm {
  return { bar: 42 }
}

a = foo()
"#;

        parse_execute(program).await.unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn test_sensible_error_when_missing_equals_in_kwarg() {
        for (i, call) in ["f(x=1,3,0)", "f(x=1,3,z)", "f(x=1,0,z=1)", "f(x=1, 3 + 4, z)"]
            .into_iter()
            .enumerate()
        {
            let program = format!(
                "fn foo() {{ return 0 }}
z = 0
fn f(x, y, z) {{ return 0 }}
{call}"
            );
            let err = parse_execute(&program).await.unwrap_err();
            let msg = err.message();
            assert!(
                msg.contains("This argument needs a label, but it doesn't have one"),
                "failed test {i}: {msg}"
            );
            assert!(msg.contains("`y`"), "failed test {i}, missing `y`: {msg}");
            if i == 0 {
                assert!(msg.contains("`z`"), "failed test {i}, missing `z`: {msg}");
            }
        }
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn default_param_for_unlabeled() {
        // Tests that the input param for myExtrude is taken from the pipeline value and same-name
        // keyword args.
        let ast = r#"fn myExtrude(@sk, length) {
  return extrude(sk, length)
}
sketch001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 93.75)
  |> myExtrude(length = 40)
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn dont_use_unlabelled_as_input() {
        // `length` should be used as the `length` argument to extrude, not the unlabelled input
        let ast = r#"length = 10
startSketchOn(XY)
  |> circle(center = [0, 0], radius = 93.75)
  |> extrude(length)
"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn ascription_in_binop() {
        let ast = r#"foo = tan(0): number(rad) - 4deg"#;
        parse_execute(ast).await.unwrap();

        let ast = r#"foo = tan(0): rad - 4deg"#;
        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn neg_sqrt() {
        let ast = r#"bad = sqrt(-2)"#;

        let e = parse_execute(ast).await.unwrap_err();
        // Make sure we get a useful error message and not an engine error.
        assert!(e.message().contains("sqrt"), "Error message: '{}'", e.message());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn non_array_fns() {
        let ast = r#"push(1, item = 2)
pop(1)
map(1, f = fn(@x) { return x + 1 })
reduce(1, f = fn(@x, accum) { return accum + x}, initial = 0)"#;

        parse_execute(ast).await.unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn non_array_indexing() {
        let good = r#"a = 42
good = a[0]
"#;
        let result = parse_execute(good).await.unwrap();
        let mem = result.exec_state.stack();
        let num = mem
            .memory
            .get_from("good", result.mem_env, SourceRange::default(), 0)
            .unwrap()
            .as_ty_f64()
            .unwrap();
        assert_eq!(num.n, 42.0);

        let bad = r#"a = 42
bad = a[1]
"#;

        parse_execute(bad).await.unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn coerce_unknown_to_length() {
        let ast = r#"x = 2mm * 2mm
y = x: number(Length)"#;
        let e = parse_execute(ast).await.unwrap_err();
        assert!(
            e.message().contains("could not coerce"),
            "Error message: '{}'",
            e.message()
        );

        let ast = r#"x = 2mm
y = x: number(Length)"#;
        let result = parse_execute(ast).await.unwrap();
        let mem = result.exec_state.stack();
        let num = mem
            .memory
            .get_from("y", result.mem_env, SourceRange::default(), 0)
            .unwrap()
            .as_ty_f64()
            .unwrap();
        assert_eq!(num.n, 2.0);
        assert_eq!(num.ty, NumericType::mm());
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn one_warning_unknown() {
        let ast = r#"
// Should warn once
a = PI * 2
// Should warn once
b = (PI * 2) / 3
// Should not warn
c = ((PI * 2) / 3): number(deg)
"#;

        let result = parse_execute(ast).await.unwrap();
        assert_eq!(result.exec_state.errors().len(), 2);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn non_count_indexing() {
        let ast = r#"x = [0, 0]
y = x[1mm]
"#;
        parse_execute(ast).await.unwrap_err();

        let ast = r#"x = [0, 0]
y = 1deg
z = x[y]
"#;
        parse_execute(ast).await.unwrap_err();

        let ast = r#"x = [0, 0]
y = x[0mm + 1]
"#;
        parse_execute(ast).await.unwrap_err();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn getting_property_of_plane() {
        let ast = std::fs::read_to_string("tests/inputs/planestuff.kcl").unwrap();
        parse_execute(&ast).await.unwrap();
    }

    #[cfg(feature = "artifact-graph")]
    #[tokio::test(flavor = "multi_thread")]
    async fn no_artifacts_from_within_hole_call() {
        // Test that executing stdlib KCL, like the `hole` function
        // (which is actually implemented in KCL not Rust)
        // does not generate artifacts from within the stdlib code,
        // only from the user code.
        let ast = std::fs::read_to_string("tests/inputs/sample_hole.kcl").unwrap();
        let out = parse_execute(&ast).await.unwrap();

        // Get all the operations that occurred.
        let actual_operations = out.exec_state.global.root_module_artifacts.operations;

        // There should be 5, for sketching the cube and applying the hole.
        // If the stdlib internal calls are being tracked, that's a bug,
        // and the actual number of operations will be something like 35.
        let expected = 5;
        assert_eq!(
            actual_operations.len(),
            expected,
            "expected {expected} operations, received {}:\n{actual_operations:#?}",
            actual_operations.len(),
        );
    }

    #[cfg(feature = "artifact-graph")]
    #[tokio::test(flavor = "multi_thread")]
    async fn feature_tree_annotation_on_user_defined_kcl() {
        // The call to foo() should not generate an operation,
        // because its 'feature_tree' attribute has been set to false.
        let ast = std::fs::read_to_string("tests/inputs/feature_tree_annotation_on_user_defined_kcl.kcl").unwrap();
        let out = parse_execute(&ast).await.unwrap();

        // Get all the operations that occurred.
        let actual_operations = out.exec_state.global.root_module_artifacts.operations;

        let expected = 0;
        assert_eq!(
            actual_operations.len(),
            expected,
            "expected {expected} operations, received {}:\n{actual_operations:#?}",
            actual_operations.len(),
        );
    }

    #[cfg(feature = "artifact-graph")]
    #[tokio::test(flavor = "multi_thread")]
    async fn no_feature_tree_annotation_on_user_defined_kcl() {
        // The call to foo() should generate an operation,
        // because @(feature_tree) defaults to true.
        let ast = std::fs::read_to_string("tests/inputs/no_feature_tree_annotation_on_user_defined_kcl.kcl").unwrap();
        let out = parse_execute(&ast).await.unwrap();

        // Get all the operations that occurred.
        let actual_operations = out.exec_state.global.root_module_artifacts.operations;

        let expected = 2;
        assert_eq!(
            actual_operations.len(),
            expected,
            "expected {expected} operations, received {}:\n{actual_operations:#?}",
            actual_operations.len(),
        );
        assert!(matches!(actual_operations[0], Operation::GroupBegin { .. }));
        assert!(matches!(actual_operations[1], Operation::GroupEnd));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn custom_warning() {
        let warn = r#"
a = PI * 2
"#;
        let result = parse_execute(warn).await.unwrap();
        assert_eq!(result.exec_state.errors().len(), 1);
        assert_eq!(result.exec_state.errors()[0].severity, Severity::Warning);

        let allow = r#"
@warnings(allow = unknownUnits)
a = PI * 2
"#;
        let result = parse_execute(allow).await.unwrap();
        assert_eq!(result.exec_state.errors().len(), 0);

        let deny = r#"
@warnings(deny = [unknownUnits])
a = PI * 2
"#;
        let result = parse_execute(deny).await.unwrap();
        assert_eq!(result.exec_state.errors().len(), 1);
        assert_eq!(result.exec_state.errors()[0].severity, Severity::Error);
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn cannot_solid_extrude_an_open_profile() {
        // This should fail during mock execution, because KCL should catch
        // that the profile is not closed.
        let code = std::fs::read_to_string("tests/inputs/cannot_solid_extrude_an_open_profile.kcl").unwrap();
        let program = crate::Program::parse_no_errs(&code).expect("should parse");
        let exec_ctxt = ExecutorContext::new_mock(None).await;
        let mut exec_state = ExecState::new(&exec_ctxt);

        let err = exec_ctxt.run(&program, &mut exec_state).await.unwrap_err().error;
        assert!(matches!(err, KclError::Semantic { .. }));
        exec_ctxt.close().await;
    }
}
