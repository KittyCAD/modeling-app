use std::collections::HashMap;

use async_recursion::async_recursion;
use indexmap::IndexMap;
use kcl_ezpz::{Constraint, SolveOutcome};
use kittycad_modeling_cmds::units::UnitLength;

#[cfg(feature = "artifact-graph")]
use crate::front::ObjectKind;
use crate::{
    CompilationError, NodePath, SourceRange,
    errors::{KclError, KclErrorDetails},
    exec::UnitType,
    execution::{
        AbstractSegment, BodyType, EnvironmentRef, ExecState, ExecutorContext, KclValue, Metadata, ModelingCmdMeta,
        ModuleArtifactState, Operation, PlaneType, Segment, SegmentKind, SegmentRepr, SketchConstraintKind,
        StatementKind, TagIdentifier, UnsolvedExpr, UnsolvedSegment, UnsolvedSegmentKind, annotations,
        cad_op::OpKclValue,
        fn_call::{Arg, Args},
        kcl_value::{FunctionSource, KclFunctionSourceParams, TypeDef},
        memory,
        state::{ModuleState, SketchBlockState},
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    fmt,
    front::{Freedom, Object, PointCtor},
    modules::{ModuleExecutionOutcome, ModuleId, ModulePath, ModuleRepr},
    parsing::ast::types::{
        Annotation, ArrayExpression, ArrayRangeExpression, AscribedExpression, BinaryExpression, BinaryOperator,
        BinaryPart, BodyItem, CodeBlock, Expr, IfExpression, ImportPath, ImportSelector, ItemVisibility,
        MemberExpression, Name, Node, ObjectExpression, PipeExpression, Program, SketchBlock, SketchVar, TagDeclarator,
        Type, UnaryExpression, UnaryOperator,
    },
    std::args::TyF64,
};

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
        preserve_mem: bool,
        module_id: ModuleId,
        path: &ModulePath,
    ) -> Result<ModuleExecutionOutcome, (KclError, Option<EnvironmentRef>, Option<ModuleArtifactState>)> {
        crate::log::log(format!("enter module {path} {}", exec_state.stack()));
        #[cfg(not(feature = "artifact-graph"))]
        let next_object_id = 0;
        #[cfg(feature = "artifact-graph")]
        let next_object_id = exec_state.global.root_module_artifacts.scene_objects.len();
        let mut local_state = ModuleState::new(
            path.clone(),
            exec_state.stack().memory.clone(),
            Some(module_id),
            next_object_id,
        );
        if !preserve_mem {
            std::mem::swap(&mut exec_state.mod_local, &mut local_state);
        }

        let no_prelude = self
            .handle_annotations(program.inner_attrs.iter(), crate::execution::BodyType::Root, exec_state)
            .await
            .map_err(|err| (err, None, None))?;

        if !preserve_mem {
            exec_state.mut_stack().push_new_root_env(!no_prelude);
        }

        let result = self
            .exec_block(program, exec_state, crate::execution::BodyType::Root)
            .await;

        let env_ref = if preserve_mem {
            exec_state.mut_stack().pop_and_preserve_env()
        } else {
            exec_state.mut_stack().pop_env()
        };
        let module_artifacts = if !preserve_mem {
            std::mem::swap(&mut exec_state.mod_local, &mut local_state);
            local_state.artifacts
        } else {
            std::mem::take(&mut exec_state.mod_local.artifacts)
        };

        crate::log::log(format!("leave {path}"));

        result
            .map_err(|err| (err, Some(env_ref), Some(module_artifacts.clone())))
            .map(|last_expr| ModuleExecutionOutcome {
                last_expr,
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
    ) -> Result<Option<KclValue>, KclError>
    where
        B: CodeBlock + Sync,
    {
        let mut last_expr = None;
        // Iterate over the body of the program.
        for statement in block.body() {
            match statement {
                BodyItem::ImportStatement(import_stmt) => {
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
                                    return value.map(Option::Some);
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
                                        KclError::new_internal(KclErrorDetails::new(
                                            format!("{name} is not defined in module (but was exported?)"),
                                            vec![source_range],
                                        ))
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
                    let metadata = Metadata::from(expression_statement);
                    last_expr = Some(
                        self.execute_expr(
                            &expression_statement.expression,
                            exec_state,
                            &metadata,
                            &[],
                            StatementKind::Expression,
                        )
                        .await?,
                    );
                }
                BodyItem::VariableDeclaration(variable_declaration) => {
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

                    exec_state
                        .mut_stack()
                        .add(var_name.clone(), rhs.clone(), source_range)?;

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
                    last_expr = matches!(body_type, BodyType::Root).then_some(rhs);
                }
                BodyItem::TypeDeclaration(ty) => {
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
                    let metadata = Metadata::from(return_statement);

                    if matches!(body_type, BodyType::Root) {
                        return Err(KclError::new_semantic(KclErrorDetails::new(
                            "Cannot return from outside a function.".to_owned(),
                            vec![metadata.source_range],
                        )));
                    }

                    let value = self
                        .execute_expr(
                            &return_statement.argument,
                            exec_state,
                            &metadata,
                            &[],
                            StatementKind::Expression,
                        )
                        .await?;
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
                    ModelingCmdMeta::new(self, block.to_source_range()),
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
                .exec_module_from_ast(program, module_id, &path, exec_state, source_range, false)
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
                    .exec_module_from_ast(program, module_id, &path, exec_state, source_range, false)
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
        preserve_mem: bool,
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
    ) -> Result<KclValue, KclError> {
        let item = match init {
            Expr::None(none) => KclValue::from(none),
            Expr::Literal(literal) => KclValue::from_literal((**literal).clone(), exec_state),
            Expr::TagDeclarator(tag) => tag.execute(exec_state).await?,
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
                        ).await?
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
                            }
                        })
                } else {
                    value
                }
            }
            Expr::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, self).await?,
            Expr::FunctionExpression(function_expression) => {
                let attrs = annotations::get_fn_attrs(annotations, metadata.source_range)?;
                let experimental = attrs.map(|a| a.experimental).unwrap_or_default();
                let is_std = matches!(&exec_state.mod_local.path, ModulePath::Std { .. });

                // Check the KCL @(feature_tree = ) annotation.
                let include_in_feature_tree = attrs.unwrap_or_default().include_in_feature_tree;
                if let Some(attrs) = attrs
                    && (attrs.impl_ == annotations::Impl::Rust
                        || attrs.impl_ == annotations::Impl::RustConstrainable
                        || attrs.impl_ == annotations::Impl::RustConstraint)
                {
                    if let ModulePath::Std { value: std_path } = &exec_state.mod_local.path {
                        let (func, props) = crate::std::std_fn(std_path, statement_kind.expect_name());
                        KclValue::Function {
                            value: Box::new(FunctionSource::rust(func, function_expression.clone(), props, attrs)),
                            meta: vec![metadata.to_owned()],
                        }
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
                    KclValue::Function {
                        value: Box::new(FunctionSource::kcl(
                            function_expression.clone(),
                            exec_state.mut_stack().snapshot(),
                            KclFunctionSourceParams {
                                is_std,
                                experimental,
                                include_in_feature_tree,
                            },
                        )),
                        meta: vec![metadata.to_owned()],
                    }
                }
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
                    Some(x) => x,
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
                let result = self
                    .execute_expr(&expr.expr, exec_state, metadata, &[], statement_kind)
                    .await?;
                exec_state
                    .mut_stack()
                    .add(expr.label.name.clone(), result.clone(), init.into())?;
                // TODO this lets us use the label as a variable name, but not as a tag in most cases
                result
            }
            Expr::AscribedExpression(expr) => expr.get_result(exec_state, self).await?,
            Expr::SketchBlock(expr) => expr.get_result(exec_state, self).await?,
            Expr::SketchVar(expr) => expr.get_result(exec_state, self).await?,
        };
        Ok(item)
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let metadata = Metadata {
            source_range: SourceRange::from(self),
        };
        let result = ctx
            .execute_expr(&self.expr, exec_state, &metadata, &[], StatementKind::Expression)
            .await?;
        apply_ascription(&result, &self.ty, exec_state, self.into())
    }
}

impl Node<SketchBlock> {
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
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
            let value = ctx
                .execute_expr(&labeled_arg.arg, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
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

        #[cfg(feature = "artifact-graph")]
        let sketch_id = {
            // Create the sketch block scene object. This needs to happen before
            // scene objects created inside the sketch block so that its ID is
            // stable across sketch block edits.

            use crate::{
                engine::PlaneName,
                execution::{Artifact, ArtifactId, CodeRef, SketchBlock},
            };
            let sketch_id = exec_state.next_object_id();
            let arg_on: Option<crate::execution::Plane> =
                args.get_kw_arg_opt("on", &RuntimeType::plane(), exec_state)?;
            let on_object = arg_on.as_ref().and_then(|plane| plane.object_id);

            // Get the plane artifact ID if the plane is an object plane
            let plane_artifact_id = arg_on.as_ref().map(|plane| plane.artifact_id);

            let artifact_id = ArtifactId::from(exec_state.next_uuid());
            let sketch_scene_object = Object {
                id: sketch_id,
                kind: ObjectKind::Sketch(crate::frontend::sketch::Sketch {
                    args: crate::front::SketchArgs {
                        on: on_object
                            .map(crate::front::Plane::Object)
                            .unwrap_or(crate::front::Plane::Default(PlaneName::Xy)),
                    },
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

            let result = ctx.exec_block(&self.body, exec_state, BodyType::Block).await;

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
            return Err(KclError::new_internal(KclErrorDetails::new(
                "Sketch block state should still be set to Some from just above".to_owned(),
                vec![SourceRange::from(self)],
            )));
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
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        "Expected sketch variable".to_owned(),
                        vec![SourceRange::from(self)],
                    )));
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
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        message,
                        vec![SourceRange::from(self)],
                    )));
                };
                Ok((constraint_id, initial_guess))
            })
            .collect::<Result<Vec<_>, KclError>>()?;
        // Solve constraints.
        let config = kcl_ezpz::Config {
            max_iterations: 1000,
            ..Default::default()
        };
        let solve_outcome = match kcl_ezpz::solve_with_priority(&constraints, initial_guesses.clone(), config) {
            Ok(o) => o,
            Err(failure) => {
                if let kcl_ezpz::Error::Solver(_) = &failure.error {
                    // Constraint solver failed to find a solution. Build a
                    // solution that is the initial guesses.
                    exec_state.warn(
                        CompilationError::err(range, "Constraint solver failed to find a solution".to_owned()),
                        annotations::WARN_SOLVER,
                    );
                    let final_values = initial_guesses.iter().map(|(_, v)| *v).collect::<Vec<_>>();
                    kcl_ezpz::SolveOutcome {
                        final_values,
                        iterations: Default::default(),
                        warnings: failure.warnings,
                        unsatisfied: Default::default(),
                        priority_solved: Default::default(),
                    }
                } else {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        format!("Error from constraint solver: {}", &failure.error),
                        vec![SourceRange::from(self)],
                    )));
                }
            }
        };
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
        let variables = substitute_sketch_vars(variables, &solve_outcome, solution_ty)?;
        let mut solved_segments = Vec::with_capacity(sketch_block_state.needed_by_engine.len());
        for unsolved_segment in &sketch_block_state.needed_by_engine {
            solved_segments.push(substitute_sketch_var_in_segment(
                unsolved_segment.clone(),
                &solve_outcome,
                solver_numeric_type(exec_state),
            )?);
        }
        #[cfg(feature = "artifact-graph")]
        {
            // Store variable solutions so that the sketch refactoring API can
            // write them back to the source. Because of how the frontend works
            // and how we don't really support more than one sketch block yet,
            // we only update it if it's empty so that empty blocks at the end
            // are ignored.
            if exec_state.mod_local.artifacts.var_solutions.is_empty() {
                exec_state.mod_local.artifacts.var_solutions =
                    sketch_block_state.var_solutions(solve_outcome, solution_ty, SourceRange::from(self))?;
            }
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
            let Some(sketch_object) = exec_state.mod_local.artifacts.scene_objects.get_mut(sketch_id.0) else {
                let message = format!("Sketch object not found after it was just created; id={:?}", sketch_id);
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(message, vec![range])));
            };
            let ObjectKind::Sketch(sketch) = &mut sketch_object.kind else {
                let message = format!(
                    "Expected Sketch object after it was just created to be a sketch kind; id={:?}, actual={:?}",
                    sketch_id, sketch_object
                );
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(message, vec![range])));
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

        // TODO: sketch-api: send everything to the engine.

        let metadata = Metadata {
            source_range: SourceRange::from(self),
        };
        Ok(KclValue::Object {
            value: variables,
            constrainable: Default::default(),
            meta: vec![metadata],
        })
    }
}

fn solver_unit(exec_state: &ExecState) -> UnitLength {
    exec_state.length_unit()
}

fn solver_numeric_type(exec_state: &ExecState) -> NumericType {
    NumericType::Known(UnitType::Length(solver_unit(exec_state)))
}

/// When giving input to the solver, all numbers must be given in the same
/// units.
pub(crate) fn normalize_to_solver_unit(
    value: &KclValue,
    source_range: SourceRange,
    exec_state: &mut ExecState,
    description: &str,
) -> Result<KclValue, KclError> {
    let length_ty = RuntimeType::Primitive(PrimitiveType::Number(solver_numeric_type(exec_state)));
    value.coerce(&length_ty, true, exec_state).map_err(|_| {
        KclError::new_semantic(KclErrorDetails::new(
            format!(
                "{} must be a length coercible to the module length unit {}, but found {}",
                description,
                length_ty.human_friendly_type(),
                value.human_friendly_type(),
            ),
            vec![source_range],
        ))
    })
}

fn substitute_sketch_vars(
    variables: IndexMap<String, KclValue>,
    solve_outcome: &SolveOutcome,
    solution_ty: NumericType,
) -> Result<HashMap<String, KclValue>, KclError> {
    let mut subbed = HashMap::with_capacity(variables.len());
    for (name, value) in variables {
        let subbed_value = substitute_sketch_var(value, solve_outcome, solution_ty)?;
        subbed.insert(name, subbed_value);
    }
    Ok(subbed)
}

fn substitute_sketch_var(
    value: KclValue,
    solve_outcome: &SolveOutcome,
    solution_ty: NumericType,
) -> Result<KclValue, KclError> {
    match value {
        KclValue::Uuid { .. } => Ok(value),
        KclValue::Bool { .. } => Ok(value),
        KclValue::Number { .. } => Ok(value),
        KclValue::String { .. } => Ok(value),
        KclValue::SketchVar { value: var } => {
            let Some(solution) = solve_outcome.final_values.get(var.id.0) else {
                let message = format!("No solution for sketch variable with id {}", var.id.0);
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    var.meta.into_iter().map(|m| m.source_range).collect(),
                )));
            };
            Ok(KclValue::Number {
                value: *solution,
                ty: solution_ty,
                meta: var.meta.clone(),
            })
        }
        KclValue::SketchConstraint { .. } => {
            debug_assert!(false, "Sketch constraints should not appear in substituted values");
            Ok(value)
        }
        KclValue::Tuple { value, meta } => {
            let subbed = value
                .into_iter()
                .map(|v| substitute_sketch_var(v, solve_outcome, solution_ty))
                .collect::<Result<Vec<_>, KclError>>()?;
            Ok(KclValue::Tuple { value: subbed, meta })
        }
        KclValue::HomArray { value, ty } => {
            let subbed = value
                .into_iter()
                .map(|v| substitute_sketch_var(v, solve_outcome, solution_ty))
                .collect::<Result<Vec<_>, KclError>>()?;
            Ok(KclValue::HomArray { value: subbed, ty })
        }
        KclValue::Object {
            value,
            constrainable,
            meta,
        } => {
            let subbed = value
                .into_iter()
                .map(|(k, v)| substitute_sketch_var(v, solve_outcome, solution_ty).map(|v| (k, v)))
                .collect::<Result<HashMap<_, _>, KclError>>()?;
            Ok(KclValue::Object {
                value: subbed,
                constrainable,
                meta,
            })
        }
        KclValue::TagIdentifier(_) => Ok(value),
        KclValue::TagDeclarator(_) => Ok(value),
        KclValue::GdtAnnotation { .. } => Ok(value),
        KclValue::Plane { .. } => Ok(value),
        KclValue::Face { .. } => Ok(value),
        KclValue::Segment {
            value: abstract_segment,
        } => match abstract_segment.repr {
            SegmentRepr::Unsolved { segment } => {
                let subbed = substitute_sketch_var_in_segment(segment, solve_outcome, solution_ty)?;
                Ok(KclValue::Segment {
                    value: Box::new(AbstractSegment {
                        repr: SegmentRepr::Solved { segment: subbed },
                        meta: abstract_segment.meta,
                    }),
                })
            }
            SegmentRepr::Solved { .. } => Ok(KclValue::Segment {
                value: abstract_segment,
            }),
        },
        KclValue::Sketch { .. } => Ok(value),
        KclValue::Solid { .. } => Ok(value),
        KclValue::Helix { .. } => Ok(value),
        KclValue::ImportedGeometry(_) => Ok(value),
        KclValue::Function { .. } => Ok(value),
        KclValue::Module { .. } => Ok(value),
        KclValue::Type { .. } => Ok(value),
        KclValue::KclNone { .. } => Ok(value),
    }
}

fn substitute_sketch_var_in_segment(
    segment: UnsolvedSegment,
    solve_outcome: &SolveOutcome,
    solution_ty: NumericType,
) -> Result<Segment, KclError> {
    let srs = segment.meta.iter().map(|m| m.source_range).collect::<Vec<_>>();
    match &segment.kind {
        UnsolvedSegmentKind::Point { position, ctor } => {
            let (position_x, position_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&position[0], solve_outcome, solution_ty, &srs)?;
            let (position_y, position_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&position[1], solve_outcome, solution_ty, &srs)?;
            let position = [position_x, position_y];
            Ok(Segment {
                object_id: segment.object_id,
                kind: SegmentKind::Point {
                    position,
                    ctor: ctor.clone(),
                    freedom: position_x_freedom.merge(position_y_freedom),
                },
                meta: segment.meta,
            })
        }
        UnsolvedSegmentKind::Line {
            start,
            end,
            ctor,
            start_object_id,
            end_object_id,
        } => {
            let (start_x, start_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[0], solve_outcome, solution_ty, &srs)?;
            let (start_y, start_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&start[1], solve_outcome, solution_ty, &srs)?;
            let (end_x, end_x_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[0], solve_outcome, solution_ty, &srs)?;
            let (end_y, end_y_freedom) =
                substitute_sketch_var_in_unsolved_expr(&end[1], solve_outcome, solution_ty, &srs)?;
            let start = [start_x, start_y];
            let end = [end_x, end_y];
            Ok(Segment {
                object_id: segment.object_id,
                kind: SegmentKind::Line {
                    start,
                    end,
                    ctor: ctor.clone(),
                    start_object_id: *start_object_id,
                    end_object_id: *end_object_id,
                    start_freedom: start_x_freedom.merge(start_y_freedom),
                    end_freedom: end_x_freedom.merge(end_y_freedom),
                },
                meta: segment.meta,
            })
        }
    }
}

fn substitute_sketch_var_in_unsolved_expr(
    unsolved_expr: &UnsolvedExpr,
    solve_outcome: &SolveOutcome,
    solution_ty: NumericType,
    source_ranges: &[SourceRange],
) -> Result<(TyF64, Freedom), KclError> {
    match unsolved_expr {
        UnsolvedExpr::Known(n) => Ok((n.clone(), Freedom::Fixed)),
        UnsolvedExpr::Unknown(var_id) => {
            let Some(solution) = solve_outcome.final_values.get(var_id.0) else {
                let message = format!("No solution for sketch variable with id {}", var_id.0);
                debug_assert!(false, "{}", &message);
                return Err(KclError::new_internal(KclErrorDetails::new(
                    message,
                    source_ranges.to_vec(),
                )));
            };
            // TODO: sketch-api: This isn't implemented properly yet.
            // solve_outcome.unsatisfied.contains means "Fixed or over-constrained"
            let freedom = if solve_outcome.unsatisfied.contains(&var_id.0) {
                Freedom::Free
            } else {
                Freedom::Fixed
            };
            Ok((TyF64::new(*solution, solution_ty), freedom))
        }
    }
}

#[cfg(not(feature = "artifact-graph"))]
fn create_segment_scene_objects(
    _segments: &[Segment],
    _sketch_block_range: SourceRange,
    _exec_state: &mut ExecState,
) -> Result<Vec<Object>, KclError> {
    Ok(Vec::new())
}

#[cfg(feature = "artifact-graph")]
fn create_segment_scene_objects(
    segments: &[Segment],
    sketch_block_range: SourceRange,
    exec_state: &mut ExecState,
) -> Result<Vec<Object>, KclError> {
    let mut scene_objects = Vec::with_capacity(segments.len());
    for segment in segments {
        let source = Metadata::to_source_ref(&segment.meta);

        match &segment.kind {
            SegmentKind::Point {
                position,
                ctor,
                freedom,
            } => {
                let point2d = TyF64::to_point2d(position).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting start point runtime type to API value: {:?}", position),
                        vec![sketch_block_range],
                    ))
                })?;
                let artifact_id = exec_state.next_artifact_id();
                let point_object = Object {
                    id: segment.object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: point2d.clone(),
                            ctor: Some(crate::front::PointCtor {
                                position: ctor.position.clone(),
                            }),
                            owner: None,
                            freedom: *freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id,
                    source: source.clone(),
                };
                scene_objects.push(point_object);
            }
            SegmentKind::Line {
                start,
                end,
                ctor,
                start_object_id,
                end_object_id,
                start_freedom,
                end_freedom,
            } => {
                let start_point2d = TyF64::to_point2d(start).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting start point runtime type to API value: {:?}", start),
                        vec![sketch_block_range],
                    ))
                })?;
                let start_artifact_id = exec_state.next_artifact_id();
                let start_point_object = Object {
                    id: *start_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: start_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *start_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: start_artifact_id,
                    source: source.clone(),
                };
                let start_point_object_id = start_point_object.id;
                scene_objects.push(start_point_object);

                let end_point2d = TyF64::to_point2d(end).map_err(|_| {
                    KclError::new_internal(KclErrorDetails::new(
                        format!("Error converting end point runtime type to API value: {:?}", end),
                        vec![sketch_block_range],
                    ))
                })?;
                let end_artifact_id = exec_state.next_artifact_id();
                let end_point_object = Object {
                    id: *end_object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Point(crate::front::Point {
                            position: end_point2d.clone(),
                            ctor: None,
                            owner: Some(segment.object_id),
                            freedom: *end_freedom,
                            constraints: Vec::new(),
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: end_artifact_id,
                    source: source.clone(),
                };
                let end_point_object_id = end_point_object.id;
                scene_objects.push(end_point_object);

                let line_artifact_id = exec_state.next_artifact_id();
                let segment_object = Object {
                    id: segment.object_id,
                    kind: ObjectKind::Segment {
                        segment: crate::front::Segment::Line(crate::front::Line {
                            start: start_point_object_id,
                            end: end_point_object_id,
                            ctor: crate::front::SegmentCtor::Line(ctor.as_ref().clone()),
                            ctor_applicable: true,
                        }),
                    },
                    label: Default::default(),
                    comments: Default::default(),
                    artifact_id: line_artifact_id,
                    source,
                };
                scene_objects.push(segment_object);
            }
        }
    }
    Ok(scene_objects)
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        match self {
            BinaryPart::Literal(literal) => Ok(KclValue::from_literal((**literal).clone(), exec_state)),
            BinaryPart::Name(name) => name.get_result(exec_state, ctx).await.cloned(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, ctx).await,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, ctx).await,
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(exec_state, ctx).await,
            BinaryPart::ArrayExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::ArrayRangeExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::ObjectExpression(e) => e.execute(exec_state, ctx).await,
            BinaryPart::IfExpression(e) => e.get_result(exec_state, ctx).await,
            BinaryPart::AscribedExpression(e) => e.get_result(exec_state, ctx).await,
            BinaryPart::SketchVar(e) => e.get_result(exec_state, ctx).await,
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
    async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let meta = Metadata {
            source_range: SourceRange::from(self),
        };
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
        let object = ctx
            .execute_expr(&self.object, exec_state, &meta, &[], StatementKind::Expression)
            .await?;

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
                                })
                            }
                            UnsolvedSegmentKind::Line { .. } => Err(KclError::new_undefined_value(
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
                                ))
                            }
                            SegmentKind::Line { .. } => Err(KclError::new_undefined_value(
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
                        }),
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
                        }),
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
                        }),
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
                                        object_id: *end_object_id,
                                        kind: SegmentKind::Point {
                                            position: end.clone(),
                                            ctor: Box::new(PointCtor {
                                                position: ctor.start.clone(),
                                            }),
                                            freedom: *end_freedom,
                                        },
                                        meta: segment.meta.clone(),
                                    },
                                },
                                meta: segment.meta.clone(),
                            }),
                        }),
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
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]))
                }
                "yAxis" => {
                    let (p, u) = plane.info.y_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]))
                }
                "xAxis" => {
                    let (p, u) = plane.info.x_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]))
                }
                "origin" => {
                    let (p, u) = plane.info.origin.as_3_dims();
                    Ok(KclValue::array_from_point3d(p, u.into(), vec![meta]))
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
                    Ok(value.to_owned())
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
                    return Ok(value.to_owned());
                }
                if i == 1
                    && let Some(value) = map.get("y")
                {
                    return Ok(value.to_owned());
                }
                if i == 2
                    && let Some(value) = map.get("z")
                {
                    return Ok(value.to_owned());
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
                    Ok(value.to_owned())
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
            (obj, Property::UInt(0), _) => Ok(obj),
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
            }),
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
            }),
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
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

        last_result.ok_or_else(|| Self::missing_result_error(self))
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
                        return Err(KclError::new_internal(KclErrorDetails::new(message, vec![self.into()])));
                    };
                    let constraint = Constraint::Fixed(var.id.to_constraint_id(self.as_source_range())?, n.n);
                    let Some(sketch_block_state) = &mut exec_state.mod_local.sketch_block else {
                        let message = "Being inside a sketch block should have already been checked above".to_owned();
                        debug_assert!(false, "{}", &message);
                        return Err(KclError::new_internal(KclErrorDetails::new(
                            message,
                            vec![SourceRange::from(self)],
                        )));
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
                        return Err(KclError::new_internal(KclErrorDetails::new(message, vec![self.into()])));
                    };
                    match &constraint.kind {
                        SketchConstraintKind::Distance { points } => {
                            let range = self.as_source_range();
                            let p0 = &points[0];
                            let p1 = &points[1];
                            let solver_pt0 = kcl_ezpz::datatypes::DatumPoint::new_xy(
                                p0.vars.x.to_constraint_id(range)?,
                                p0.vars.y.to_constraint_id(range)?,
                            );
                            let solver_pt1 = kcl_ezpz::datatypes::DatumPoint::new_xy(
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
                                return Err(KclError::new_internal(KclErrorDetails::new(
                                    message,
                                    vec![SourceRange::from(self)],
                                )));
                            };
                            sketch_block_state.solver_constraints.push(solver_constraint);
                            #[cfg(feature = "artifact-graph")]
                            {
                                use crate::{execution::ArtifactId, front::Distance};

                                let constraint = crate::front::Constraint::Distance(Distance {
                                    points: vec![p0.object_id, p1.object_id],
                                    distance: n.try_into().map_err(|_| {
                                        KclError::new_internal(KclErrorDetails::new(
                                            "Failed to convert distance units numeric suffix:".to_owned(),
                                            vec![range],
                                        ))
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
        KclError::new_internal(KclErrorDetails::new(
            "missing result while evaluating binary expression".to_owned(),
            vec![SourceRange::from(node)],
        ))
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        if self.operator == UnaryOperator::Not {
            let value = self.argument.get_result(exec_state, ctx).await?;
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

            return Ok(negated);
        }

        let value = &self.argument.get_result(exec_state, ctx).await?;
        let err = || {
            KclError::new_semantic(KclErrorDetails::new(
                format!(
                    "You can only negate numbers, planes, or lines, but this is a {}",
                    value.human_friendly_type()
                ),
                vec![self.into()],
            ))
        };
        match value {
            KclValue::Number { value, ty, .. } => {
                let meta = vec![Metadata {
                    source_range: self.into(),
                }];
                Ok(KclValue::Number {
                    value: -value,
                    meta,
                    ty: *ty,
                })
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

                plane.value = PlaneType::Uninit;
                plane.id = exec_state.next_uuid();
                Ok(KclValue::Plane { value: plane })
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
                })
            }
            _ => Err(err()),
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
) -> Result<KclValue, KclError> {
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
        exec_state.mod_local.pipe_value = Some(output);
    }
    // Safe to unwrap here, because pipe_value always has something pushed in when the `match first` executes.
    let final_output = exec_state.mod_local.pipe_value.take().unwrap();
    Ok(final_output)
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
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let mut results = Vec::with_capacity(self.elements.len());

        for element in &self.elements {
            let metadata = Metadata::from(element);
            // TODO: Carry statement kind here so that we know if we're
            // inside a variable declaration.
            let value = ctx
                .execute_expr(element, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;

            results.push(value);
        }

        Ok(KclValue::HomArray {
            value: results,
            ty: RuntimeType::Primitive(PrimitiveType::Any),
        })
    }
}

impl Node<ArrayRangeExpression> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
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
        let (start, start_ty) = start_val
            .as_int_with_ty()
            .ok_or(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected int but found {}", start_val.human_friendly_type()),
                vec![self.into()],
            )))?;
        let metadata = Metadata::from(&self.end_element);
        let end_val = ctx
            .execute_expr(&self.end_element, exec_state, &metadata, &[], StatementKind::Expression)
            .await?;
        let (end, end_ty) = end_val
            .as_int_with_ty()
            .ok_or(KclError::new_semantic(KclErrorDetails::new(
                format!("Expected int but found {}", end_val.human_friendly_type()),
                vec![self.into()],
            )))?;

        if start_ty != end_ty {
            let start = start_val.as_ty_f64().unwrap_or(TyF64 { n: 0.0, ty: start_ty });
            let start = fmt::human_display_number(start.n, start.ty);
            let end = end_val.as_ty_f64().unwrap_or(TyF64 { n: 0.0, ty: end_ty });
            let end = fmt::human_display_number(end.n, end.ty);
            return Err(KclError::new_semantic(KclErrorDetails::new(
                format!("Range start and end must be of the same type, but found {start} and {end}"),
                vec![self.into()],
            )));
        }

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
                    ty: start_ty,
                    meta: meta.clone(),
                })
                .collect(),
            ty: RuntimeType::Primitive(PrimitiveType::Number(start_ty)),
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
                .execute_expr(&property.value, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;

            object.insert(property.key.name.clone(), result);
        }

        Ok(KclValue::Object {
            value: object,
            meta: vec![Metadata {
                source_range: self.into(),
            }],
            constrainable: false,
        })
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        // Check the `if` branch.
        let cond = ctx
            .execute_expr(
                &self.cond,
                exec_state,
                &Metadata::from(self),
                &[],
                StatementKind::Expression,
            )
            .await?
            .get_bool()?;
        if cond {
            let block_result = ctx.exec_block(&*self.then_val, exec_state, BodyType::Block).await?;
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
                    &[],
                    StatementKind::Expression,
                )
                .await?
                .get_bool()?;
            if cond {
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
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
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
                        KclError::new_internal(KclErrorDetails::new(
                            format!("Failed to create mock engine connection: {err}"),
                            vec![SourceRange::default()],
                        ))
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
}
