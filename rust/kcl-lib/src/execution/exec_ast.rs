use std::collections::HashMap;

use async_recursion::async_recursion;

use crate::{
    CompilationError, NodePath,
    errors::{KclError, KclErrorDetails},
    execution::{
        BodyType, EnvironmentRef, ExecState, ExecutorContext, KclValue, Metadata, ModelingCmdMeta, ModuleArtifactState,
        Operation, PlaneType, StatementKind, TagIdentifier, annotations,
        cad_op::OpKclValue,
        fn_call::Args,
        kcl_value::{FunctionSource, TypeDef},
        memory,
        state::ModuleState,
        types::{NumericType, PrimitiveType, RuntimeType},
    },
    fmt,
    modules::{ModuleId, ModulePath, ModuleRepr},
    parsing::{
        ast::types::{
            Annotation, ArrayExpression, ArrayRangeExpression, AscribedExpression, BinaryExpression, BinaryOperator,
            BinaryPart, BodyItem, Expr, IfExpression, ImportPath, ImportSelector, ItemVisibility, LiteralIdentifier,
            LiteralValue, MemberExpression, Name, Node, NodeRef, ObjectExpression, PipeExpression, Program,
            TagDeclarator, Type, UnaryExpression, UnaryOperator,
        },
        token::NumericSuffix,
    },
    source_range::SourceRange,
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
                    if exec_state.mod_local.settings.update_from_annotation(annotation)? {
                        exec_state.mod_local.explicit_length_units = true;
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
            } else {
                exec_state.warn(CompilationError::err(
                    annotation.as_source_range(),
                    "Unknown annotation",
                ));
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
    ) -> Result<
        (Option<KclValue>, EnvironmentRef, Vec<String>, ModuleArtifactState),
        (KclError, Option<ModuleArtifactState>),
    > {
        crate::log::log(format!("enter module {path} {}", exec_state.stack()));

        let mut local_state = ModuleState::new(path.clone(), exec_state.stack().memory.clone(), Some(module_id));
        if !preserve_mem {
            std::mem::swap(&mut exec_state.mod_local, &mut local_state);
        }

        let no_prelude = self
            .handle_annotations(program.inner_attrs.iter(), crate::execution::BodyType::Root, exec_state)
            .await
            .map_err(|err| (err, None))?;

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
            .map_err(|err| (err, Some(module_artifacts.clone())))
            .map(|result| (result, env_ref, local_state.module_exports, module_artifacts))
    }

    /// Execute an AST's program.
    #[async_recursion]
    pub(super) async fn exec_block<'a>(
        &'a self,
        program: NodeRef<'a, Program>,
        exec_state: &mut ExecState,
        body_type: BodyType,
    ) -> Result<Option<KclValue>, KclError> {
        let mut last_expr = None;
        // Iterate over the body of the program.
        for statement in &program.body {
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

                    if rhs.show_variable_in_feature_tree() {
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
                    let impl_kind = annotations::get_impl(&ty.outer_attrs, metadata.source_range)?.unwrap_or_default();
                    match impl_kind {
                        annotations::Impl::Rust => {
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
                        annotations::Impl::Kcl => match &ty.alias {
                            Some(alias) => {
                                let value = KclValue::Type {
                                    value: TypeDef::Alias(
                                        RuntimeType::from_parsed(
                                            alias.inner.clone(),
                                            exec_state,
                                            metadata.source_range,
                                        )
                                        .map_err(|e| KclError::new_semantic(e.into()))?,
                                    ),
                                    meta: vec![metadata],
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
                    ModelingCmdMeta::new(self, SourceRange::new(program.end, program.end, program.module_id)),
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
            ModuleRepr::Kcl(_, Some((_, env_ref, items, _))) => Ok((*env_ref, items.clone())),
            ModuleRepr::Kcl(program, cache) => self
                .exec_module_from_ast(program, module_id, &path, exec_state, source_range, false)
                .await
                .map(|(val, er, items, module_artifacts)| {
                    *cache = Some((val, er, items.clone(), module_artifacts.clone()));
                    (er, items)
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
            ModuleRepr::Kcl(_, Some((val, _, _, _))) => Ok(val.clone()),
            ModuleRepr::Kcl(program, cached_items) => {
                let result = self
                    .exec_module_from_ast(program, module_id, &path, exec_state, source_range, false)
                    .await;
                match result {
                    Ok((val, env, items, module_artifacts)) => {
                        *cached_items = Some((val.clone(), env, items, module_artifacts));
                        Ok(val)
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
    ) -> Result<(Option<KclValue>, EnvironmentRef, Vec<String>, ModuleArtifactState), KclError> {
        exec_state.global.mod_loader.enter_module(path);
        let result = self
            .exec_module_body(program, exec_state, preserve_mem, module_id, path)
            .await;
        exec_state.global.mod_loader.leave_module(path);

        // TODO: ModuleArtifactState is getting dropped here when there's an
        // error.  Should we propagate it for non-root modules?
        result.map_err(|(err, _)| {
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
    pub(super) async fn execute_expr<'a: 'async_recursion>(
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
                            ));

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
                let rust_impl = annotations::get_impl(annotations, metadata.source_range)?
                    .map(|s| s == annotations::Impl::Rust)
                    .unwrap_or(false);

                if rust_impl {
                    if let ModulePath::Std { value: std_path } = &exec_state.mod_local.path {
                        let (func, props) = crate::std::std_fn(std_path, statement_kind.expect_name());
                        KclValue::Function {
                            value: FunctionSource::Std {
                                func,
                                props,
                                ast: function_expression.clone(),
                            },
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
                        value: FunctionSource::User {
                            ast: function_expression.clone(),
                            settings: exec_state.mod_local.settings.clone(),
                            memory: exec_state.mut_stack().snapshot(),
                        },
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

fn apply_ascription(
    value: &KclValue,
    ty: &Node<Type>,
    exec_state: &mut ExecState,
    source_range: SourceRange,
) -> Result<KclValue, KclError> {
    let ty = RuntimeType::from_parsed(ty.inner.clone(), exec_state, value.into())
        .map_err(|e| KclError::new_semantic(e.into()))?;

    if matches!(&ty, &RuntimeType::Primitive(PrimitiveType::Number(..))) {
        exec_state.clear_units_warnings(&source_range);
    }

    value.coerce(&ty, false, exec_state).map_err(|_| {
        let suggestion = if ty == RuntimeType::length() {
            ", you might try coercing to a fully specified numeric type such as `number(mm)`"
        } else if ty == RuntimeType::angle() {
            ", you might try coercing to a fully specified numeric type such as `number(deg)`"
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
        let property = Property::try_from(self.computed, self.property.clone(), exec_state, self.into())?;
        let meta = Metadata {
            source_range: SourceRange::from(self),
        };
        let object = ctx
            .execute_expr(&self.object, exec_state, &meta, &[], StatementKind::Expression)
            .await?;

        // Check the property and object match -- e.g. ints for arrays, strs for objects.
        match (object, property, self.computed) {
            (KclValue::Plane { value: plane }, Property::String(property), false) => match property.as_str() {
                "yAxis" => {
                    let (p, u) = plane.info.y_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(
                        p,
                        NumericType::Known(crate::exec::UnitType::Length(u)),
                        vec![meta],
                    ))
                }
                "xAxis" => {
                    let (p, u) = plane.info.x_axis.as_3_dims();
                    Ok(KclValue::array_from_point3d(
                        p,
                        NumericType::Known(crate::exec::UnitType::Length(u)),
                        vec![meta],
                    ))
                }
                "origin" => {
                    let (p, u) = plane.info.origin.as_3_dims();
                    Ok(KclValue::array_from_point3d(
                        p,
                        NumericType::Known(crate::exec::UnitType::Length(u)),
                        vec![meta],
                    ))
                }
                other => Err(KclError::new_undefined_value(
                    KclErrorDetails::new(
                        format!("Property '{other}' not found in plane"),
                        vec![self.clone().into()],
                    ),
                    None,
                )),
            },
            (KclValue::Object { value: map, meta: _ }, Property::String(property), false) => {
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
            }),
            (geometry @ (KclValue::Sketch { .. } | KclValue::Solid { .. }), Property::String(property), false) => {
                Err(KclError::new_semantic(KclErrorDetails::new(
                    format!("Property `{property}` not found on {}", geometry.human_friendly_type()),
                    vec![self.clone().into()],
                )))
            }
            (being_indexed, _, _) => Err(KclError::new_semantic(KclErrorDetails::new(
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
                    value: format!("{left}{right}"),
                    meta,
                });
            }
        }

        // Then check if we have solids.
        if self.operator == BinaryOperator::Add || self.operator == BinaryOperator::Or {
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = Args::new(Default::default(), self.into(), ctx.clone(), None);
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
                let args = Args::new(Default::default(), self.into(), ctx.clone(), None);
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
        } else if self.operator == BinaryOperator::And {
            // Check if we have solids.
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = Args::new(Default::default(), self.into(), ctx.clone(), None);
                let result = crate::std::csg::inner_intersect(
                    vec![*left.clone(), *right.clone()],
                    Default::default(),
                    exec_state,
                    args,
                )
                .await?;
                return Ok(result.into());
            }
        }

        // Check if we are doing logical operations on booleans.
        if self.operator == BinaryOperator::Or || self.operator == BinaryOperator::And {
            let KclValue::Bool {
                value: left_value,
                meta: _,
            } = left_value
            else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    format!(
                        "Cannot apply logical operator to non-boolean value: {}",
                        left_value.human_friendly_type()
                    ),
                    vec![self.left.clone().into()],
                )));
            };
            let KclValue::Bool {
                value: right_value,
                meta: _,
            } = right_value
            else {
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

        let left = number_as_f64(&left_value, self.left.clone().into())?;
        let right = number_as_f64(&right_value, self.right.clone().into())?;

        let value = match self.operator {
            BinaryOperator::Add => {
                let (l, r, ty) = NumericType::combine_eq_coerce(left, right);
                self.warn_on_unknown(&ty, "Adding", exec_state);
                KclValue::Number { value: l + r, meta, ty }
            }
            BinaryOperator::Sub => {
                let (l, r, ty) = NumericType::combine_eq_coerce(left, right);
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
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l != r, meta }
            }
            BinaryOperator::Gt => {
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l > r, meta }
            }
            BinaryOperator::Gte => {
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l >= r, meta }
            }
            BinaryOperator::Lt => {
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l < r, meta }
            }
            BinaryOperator::Lte => {
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l <= r, meta }
            }
            BinaryOperator::Eq => {
                let (l, r, ty) = NumericType::combine_eq(left, right);
                self.warn_on_unknown(&ty, "Comparing", exec_state);
                KclValue::Bool { value: l == r, meta }
            }
            BinaryOperator::And | BinaryOperator::Or => unreachable!(),
        };

        Ok(value)
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
            exec_state.warn(err);
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
            KclValue::Object { value: values, meta } => {
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
            .add(self.name.clone(), memory_item.clone(), self.into())?;

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
            let block_result = ctx.exec_block(&self.then_val, exec_state, BodyType::Block).await?;
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
                let block_result = ctx.exec_block(&else_if.then_val, exec_state, BodyType::Block).await?;
                // Block must end in an expression, so this has to be Some.
                // Enforced by the parser.
                // See https://github.com/KittyCAD/modeling-app/issues/4015
                return Ok(block_result.unwrap());
            }
        }

        // Run the final `else` branch.
        ctx.exec_block(&self.final_else, exec_state, BodyType::Block)
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
                    // This is dot syntax. Treat the property as a literal.
                    Ok(Property::String(name.to_string()))
                } else {
                    // This is bracket syntax. Actually evaluate memory to
                    // compute the property.
                    let prop = exec_state.stack().get(name, property_src)?;
                    jvalue_to_prop(prop, property_sr, name)
                }
            }
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                match value {
                    n @ LiteralValue::Number { value, suffix } => {
                        if !matches!(suffix, NumericSuffix::None | NumericSuffix::Count) {
                            return Err(KclError::new_semantic(KclErrorDetails::new(
                                format!("{n} is not a valid index, indices must be non-dimensional numbers"),
                                property_sr,
                            )));
                        }
                        if let Some(x) = crate::try_f64_to_usize(value) {
                            Ok(Property::UInt(x))
                        } else {
                            Err(KclError::new_semantic(KclErrorDetails::new(
                                format!("{n} is not a valid index, indices must be whole numbers >= 0"),
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
    }
}

fn jvalue_to_prop(value: &KclValue, property_sr: Vec<SourceRange>, name: &str) -> Result<Property, KclError> {
    let make_err =
        |message: String| Err::<Property, _>(KclError::new_semantic(KclErrorDetails::new(message, property_sr)));
    match value {
        n @ KclValue::Number { value: num, ty, .. } => {
            if !matches!(
                ty,
                NumericType::Known(crate::exec::UnitType::Count) | NumericType::Default { .. } | NumericType::Any
            ) {
                return make_err(format!(
                    "arrays can only be indexed by non-dimensioned numbers, found {}",
                    n.human_friendly_type()
                ));
            }
            let num = *num;
            if num < 0.0 {
                return make_err(format!("'{num}' is negative, so you can't index an array with it"));
            }
            let nearest_int = crate::try_f64_to_usize(num);
            if let Some(nearest_int) = nearest_int {
                Ok(Property::UInt(nearest_int))
            } else {
                make_err(format!(
                    "'{num}' is not an integer, so you can't index an array with it"
                ))
            }
        }
        KclValue::String { value: x, meta: _ } => Ok(Property::String(x.to_owned())),
        _ => make_err(format!(
            "{name} is not a valid property/index, you can only use a string to get the property of an object, or an int (>= 0) to get an item in an array"
        )),
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
        ExecutorSettings, UnitLen,
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
            assert_eq!(*ty, RuntimeType::known_length(UnitLen::Cm));
            // Compare, ignoring meta.
            if let KclValue::Number { value, ty, .. } = &value[0] {
                // It should not convert units.
                assert_eq!(*value, 42.0);
                assert_eq!(*ty, NumericType::Known(UnitType::Length(UnitLen::Cm)));
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
                    .await
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

        let program = r#"fn foo(): number(mm) {
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
        // let ast = include_str!("../../tests/inputs/planestuff.kcl");
        let ast = std::fs::read_to_string("tests/inputs/planestuff.kcl").unwrap();

        parse_execute(&ast).await.unwrap();
    }
}
