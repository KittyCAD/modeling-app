use std::collections::HashMap;

use async_recursion::async_recursion;
use indexmap::IndexMap;

use super::{cad_op::Group, kcl_value::TypeDef, types::PrimitiveType};
use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{
        annotations,
        cad_op::{OpArg, OpKclValue, Operation},
        kcl_value::FunctionSource,
        memory,
        state::ModuleState,
        types::{NumericType, RuntimeType},
        BodyType, EnvironmentRef, ExecState, ExecutorContext, KclValue, Metadata, PlaneType, TagEngineInfo,
        TagIdentifier,
    },
    modules::{ModuleId, ModulePath, ModuleRepr},
    parsing::ast::types::{
        Annotation, ArrayExpression, ArrayRangeExpression, BinaryExpression, BinaryOperator, BinaryPart, BodyItem,
        BoxNode, CallExpression, CallExpressionKw, Expr, FunctionExpression, IfExpression, ImportPath, ImportSelector,
        ItemVisibility, LiteralIdentifier, LiteralValue, MemberExpression, MemberObject, Name, Node, NodeRef,
        ObjectExpression, PipeExpression, Program, TagDeclarator, Type, UnaryExpression, UnaryOperator,
    },
    source_range::SourceRange,
    std::{
        args::{Arg, KwArgs},
        FunctionKind,
    },
    CompilationError,
};

enum StatementKind<'a> {
    Declaration { name: &'a str },
    Expression,
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
                    if exec_state.mod_local.settings.update_from_annotation(annotation)? {
                        exec_state.mod_local.explicit_length_units = true;
                    }
                    let new_units = exec_state.length_unit();
                    self.engine
                        .set_units(
                            new_units.into(),
                            annotation.as_source_range(),
                            exec_state.id_generator(),
                        )
                        .await?;
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
    ) -> Result<(Option<KclValue>, EnvironmentRef, Vec<String>), KclError> {
        crate::log::log(format!("enter module {path} {}", exec_state.stack()));

        let old_units = exec_state.length_unit();

        let mut local_state = ModuleState::new(path.std_path(), exec_state.stack().memory.clone(), Some(module_id));
        if !preserve_mem {
            std::mem::swap(&mut exec_state.mod_local, &mut local_state);
        }

        let no_prelude = self
            .handle_annotations(program.inner_attrs.iter(), crate::execution::BodyType::Root, exec_state)
            .await?;

        if !preserve_mem {
            exec_state.mut_stack().push_new_root_env(!no_prelude);
        }

        let result = self
            .exec_block(program, exec_state, crate::execution::BodyType::Root)
            .await;

        let new_units = exec_state.length_unit();
        let env_ref = if preserve_mem {
            exec_state.mut_stack().pop_and_preserve_env()
        } else {
            exec_state.mut_stack().pop_env()
        };
        if !preserve_mem {
            std::mem::swap(&mut exec_state.mod_local, &mut local_state);
        }

        // We only need to reset the units if we are not on the Main path.
        // If we reset at the end of the main path, then we just add on an extra
        // command and we'd need to flush the batch again.
        // This avoids that.
        if new_units != old_units && *path != ModulePath::Main {
            self.engine
                .set_units(old_units.into(), Default::default(), exec_state.id_generator())
                .await?;
        }

        crate::log::log(format!("leave {path}"));

        result.map(|result| (result, env_ref, local_state.module_exports))
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
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "Imports are only supported at the top-level of a file.".to_owned(),
                            source_ranges: vec![import_stmt.into()],
                        }));
                    }

                    let source_range = SourceRange::from(import_stmt);
                    let attrs = &import_stmt.outer_attrs;
                    let module_id = self
                        .open_module(&import_stmt.path, attrs, exec_state, source_range)
                        .await?;

                    match &import_stmt.selector {
                        ImportSelector::List { items } => {
                            let (env_ref, module_exports) =
                                self.exec_module_for_items(module_id, exec_state, source_range).await?;
                            for import_item in items {
                                // Extract the item from the module.
                                let item = exec_state
                                    .stack()
                                    .memory
                                    .get_from(&import_item.name.name, env_ref, import_item.into(), 0)
                                    .map_err(|_err| {
                                        KclError::UndefinedValue(KclErrorDetails {
                                            message: format!("{} is not defined in module", import_item.name.name),
                                            source_ranges: vec![SourceRange::from(&import_item.name)],
                                        })
                                    })?
                                    .clone();
                                // Check that the item is allowed to be imported.
                                if !module_exports.contains(&import_item.name.name) {
                                    return Err(KclError::Semantic(KclErrorDetails {
                                        message: format!(
                                            "Cannot import \"{}\" from module because it is not exported. Add \"export\" before the definition to export it.",
                                            import_item.name.name
                                        ),
                                        source_ranges: vec![SourceRange::from(&import_item.name)],
                                    }));
                                }

                                // Add the item to the current module.
                                exec_state.mut_stack().add(
                                    import_item.identifier().to_owned(),
                                    item,
                                    SourceRange::from(&import_item.name),
                                )?;

                                if let ItemVisibility::Export = import_stmt.visibility {
                                    exec_state
                                        .mod_local
                                        .module_exports
                                        .push(import_item.identifier().to_owned());
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
                                        KclError::Internal(KclErrorDetails {
                                            message: format!("{} is not defined in module (but was exported?)", name),
                                            source_ranges: vec![source_range],
                                        })
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
                            exec_state.mut_stack().add(name, item, source_range)?;
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

                    let memory_item = self
                        .execute_expr(
                            &variable_declaration.declaration.init,
                            exec_state,
                            &metadata,
                            annotations,
                            StatementKind::Declaration { name: &var_name },
                        )
                        .await?;
                    exec_state
                        .mut_stack()
                        .add(var_name.clone(), memory_item, source_range)?;

                    // Track exports.
                    if let ItemVisibility::Export = variable_declaration.visibility {
                        exec_state.mod_local.module_exports.push(var_name);
                    }
                    last_expr = None;
                }
                BodyItem::TypeDeclaration(ty) => {
                    let metadata = Metadata::from(&**ty);
                    let impl_kind = annotations::get_impl(&ty.outer_attrs, metadata.source_range)?.unwrap_or_default();
                    match impl_kind {
                        annotations::Impl::Rust => {
                            let std_path = match &exec_state.mod_local.std_path {
                                Some(p) => p,
                                None => {
                                    return Err(KclError::Semantic(KclErrorDetails {
                                        message: "User-defined types are not yet supported.".to_owned(),
                                        source_ranges: vec![metadata.source_range],
                                    }));
                                }
                            };
                            let (t, props) = crate::std::std_ty(std_path, &ty.name.name);
                            let value = KclValue::Type {
                                value: TypeDef::RustRepr(t, props),
                                meta: vec![metadata],
                            };
                            exec_state
                                .mut_stack()
                                .add(
                                    format!("{}{}", memory::TYPE_PREFIX, ty.name.name),
                                    value,
                                    metadata.source_range,
                                )
                                .map_err(|_| {
                                    KclError::Semantic(KclErrorDetails {
                                        message: format!("Redefinition of type {}.", ty.name.name),
                                        source_ranges: vec![metadata.source_range],
                                    })
                                })?;
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
                                        .map_err(|e| KclError::Semantic(e.into()))?,
                                    ),
                                    meta: vec![metadata],
                                };
                                exec_state
                                    .mut_stack()
                                    .add(
                                        format!("{}{}", memory::TYPE_PREFIX, ty.name.name),
                                        value,
                                        metadata.source_range,
                                    )
                                    .map_err(|_| {
                                        KclError::Semantic(KclErrorDetails {
                                            message: format!("Redefinition of type {}.", ty.name.name),
                                            source_ranges: vec![metadata.source_range],
                                        })
                                    })?;
                            }
                            None => {
                                return Err(KclError::Semantic(KclErrorDetails {
                                    message: "User-defined types are not yet supported.".to_owned(),
                                    source_ranges: vec![metadata.source_range],
                                }))
                            }
                        },
                    }

                    last_expr = None;
                }
                BodyItem::ReturnStatement(return_statement) => {
                    let metadata = Metadata::from(return_statement);

                    if matches!(body_type, BodyType::Root) {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "Cannot return from outside a function.".to_owned(),
                            source_ranges: vec![metadata.source_range],
                        }));
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
                            KclError::Semantic(KclErrorDetails {
                                message: "Multiple returns from a single function.".to_owned(),
                                source_ranges: vec![metadata.source_range],
                            })
                        })?;
                    last_expr = None;
                }
            }
        }

        if matches!(body_type, BodyType::Root) {
            // Flush the batch queue.
            self.engine
                .flush_batch(
                    // True here tells the engine to flush all the end commands as well like fillets
                    // and chamfers where the engine would otherwise eat the ID of the segments.
                    true,
                    SourceRange::new(program.end, program.end, program.module_id),
                )
                .await?;
        }

        Ok(last_expr)
    }

    pub async fn open_module(
        &self,
        path: &ImportPath,
        attrs: &[Node<Annotation>],
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<ModuleId, KclError> {
        let resolved_path = ModulePath::from_import_path(path, &self.settings.project_directory);

        match path {
            ImportPath::Kcl { .. } => {
                exec_state.global.mod_loader.cycle_check(&resolved_path, source_range)?;

                if let Some(id) = exec_state.id_for_module(&resolved_path) {
                    return Ok(id);
                }

                let id = exec_state.next_module_id();
                // Add file path string to global state even if it fails to import
                exec_state.add_path_to_source_id(resolved_path.clone(), id);
                let source = resolved_path.source(&self.fs, source_range).await?;
                exec_state.add_id_to_source(id, source.clone());
                // TODO handle parsing errors properly
                let parsed = crate::parsing::parse_str(&source.source, id).parse_errs_as_err()?;
                exec_state.add_module(id, resolved_path, ModuleRepr::Kcl(parsed, None));

                Ok(id)
            }
            ImportPath::Foreign { .. } => {
                if let Some(id) = exec_state.id_for_module(&resolved_path) {
                    return Ok(id);
                }

                let id = exec_state.next_module_id();
                let path = resolved_path.expect_path();
                // Add file path string to global state even if it fails to import
                exec_state.add_path_to_source_id(resolved_path.clone(), id);
                let format = super::import::format_from_annotations(attrs, path, source_range)?;
                let geom = super::import::import_foreign(path, format, exec_state, self, source_range).await?;
                exec_state.add_module(id, resolved_path, ModuleRepr::Foreign(geom));
                Ok(id)
            }
            ImportPath::Std { .. } => {
                if let Some(id) = exec_state.id_for_module(&resolved_path) {
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
                exec_state.add_module(id, resolved_path, ModuleRepr::Kcl(parsed, None));
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
            ModuleRepr::Kcl(_, Some((_, env_ref, items))) => Ok((*env_ref, items.clone())),
            ModuleRepr::Kcl(program, cache) => self
                .exec_module_from_ast(program, module_id, &path, exec_state, source_range)
                .await
                .map(|(val, er, items)| {
                    *cache = Some((val, er, items.clone()));
                    (er, items)
                }),
            ModuleRepr::Foreign(geom) => Err(KclError::Semantic(KclErrorDetails {
                message: "Cannot import items from foreign modules".to_owned(),
                source_ranges: vec![geom.source_range],
            })),
            ModuleRepr::Dummy => unreachable!(),
        };

        exec_state.global.module_infos[&module_id].restore_repr(repr);
        result
    }

    async fn exec_module_for_result(
        &self,
        module_id: ModuleId,
        module_name: &BoxNode<Name>,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        exec_state.global.operations.push(Operation::GroupBegin {
            group: Group::ModuleInstance {
                name: module_name.to_string(),
                module_id,
            },
            source_range,
        });

        let path = exec_state.global.module_infos[&module_id].path.clone();
        let mut repr = exec_state.global.module_infos[&module_id].take_repr();
        // DON'T EARLY RETURN! We need to restore the module repr

        let result = match &mut repr {
            ModuleRepr::Root => Err(exec_state.circular_import_error(&path, source_range)),
            ModuleRepr::Kcl(_, Some((val, _, _))) => Ok(val.clone()),
            ModuleRepr::Kcl(program, cached_items) => {
                let result = self
                    .exec_module_from_ast(program, module_id, &path, exec_state, source_range)
                    .await;
                match result {
                    Ok((val, env, items)) => {
                        *cached_items = Some((val.clone(), env, items));
                        Ok(val)
                    }
                    Err(e) => Err(e),
                }
            }
            ModuleRepr::Foreign(geom) => super::import::send_to_engine(geom.clone(), self)
                .await
                .map(|geom| Some(KclValue::ImportedGeometry(geom))),
            ModuleRepr::Dummy => unreachable!(),
        };

        exec_state.global.module_infos[&module_id].restore_repr(repr);

        exec_state.global.operations.push(Operation::GroupEnd);

        result
    }

    pub async fn exec_module_from_ast(
        &self,
        program: &Node<Program>,
        module_id: ModuleId,
        path: &ModulePath,
        exec_state: &mut ExecState,
        source_range: SourceRange,
    ) -> Result<(Option<KclValue>, EnvironmentRef, Vec<String>), KclError> {
        exec_state.global.mod_loader.enter_module(path);
        let result = self.exec_module_body(program, exec_state, false, module_id, path).await;
        exec_state.global.mod_loader.leave_module(path);

        result.map_err(|err| {
            if let KclError::ImportCycle(_) = err {
                // It was an import cycle.  Keep the original message.
                err.override_source_ranges(vec![source_range])
            } else {
                KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Error loading imported file. Open it to view more details. {}: {}",
                        path,
                        err.message()
                    ),
                    source_ranges: vec![source_range],
                })
            }
        })
    }

    #[async_recursion]
    async fn execute_expr<'a: 'async_recursion>(
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
                let value = name.get_result(exec_state, self).await?.clone();
                if let KclValue::Module { value: module_id, meta } = value {
                    self.exec_module_for_result(module_id, name, exec_state,  metadata.source_range)
                        .await?
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
                    if let Some(std_path) = &exec_state.mod_local.std_path {
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
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "Rust implementation of functions is restricted to the standard library"
                                .to_owned(),
                            source_ranges: vec![metadata.source_range],
                        }));
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
            Expr::CallExpression(call_expression) => call_expression.execute(exec_state, self).await?,
            Expr::CallExpressionKw(call_expression) => call_expression.execute(exec_state, self).await?,
            Expr::PipeExpression(pipe_expression) => pipe_expression.get_result(exec_state, self).await?,
            Expr::PipeSubstitution(pipe_substitution) => match statement_kind {
                StatementKind::Declaration { name } => {
                    let message = format!(
                        "you cannot declare variable {name} as %, because % can only be used in function calls"
                    );

                    return Err(KclError::Semantic(KclErrorDetails {
                        message,
                        source_ranges: vec![pipe_substitution.into()],
                    }));
                }
                StatementKind::Expression => match exec_state.mod_local.pipe_value.clone() {
                    Some(x) => x,
                    None => {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: "cannot use % outside a pipe expression".to_owned(),
                            source_ranges: vec![pipe_substitution.into()],
                        }));
                    }
                },
            },
            Expr::ArrayExpression(array_expression) => array_expression.execute(exec_state, self).await?,
            Expr::ArrayRangeExpression(range_expression) => range_expression.execute(exec_state, self).await?,
            Expr::ObjectExpression(object_expression) => object_expression.execute(exec_state, self).await?,
            Expr::MemberExpression(member_expression) => member_expression.get_result(exec_state)?,
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
            Expr::AscribedExpression(expr) => {
                let result = self
                    .execute_expr(&expr.expr, exec_state, metadata, &[], statement_kind)
                    .await?;
                coerce(&result, &expr.ty, exec_state, expr.into())?
            }
        };
        Ok(item)
    }
}

fn coerce(
    value: &KclValue,
    ty: &Node<Type>,
    exec_state: &mut ExecState,
    source_range: SourceRange,
) -> Result<KclValue, KclError> {
    let ty = RuntimeType::from_parsed(ty.inner.clone(), exec_state, value.into())
        .map_err(|e| KclError::Semantic(e.into()))?;

    value.coerce(&ty, exec_state).ok_or_else(|| {
        KclError::Semantic(KclErrorDetails {
            message: format!("could not coerce {} value to type {}", value.human_friendly_type(), ty),
            source_ranges: vec![source_range],
        })
    })
}

impl BinaryPart {
    #[async_recursion]
    pub async fn get_result(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        match self {
            BinaryPart::Literal(literal) => Ok(KclValue::from_literal((**literal).clone(), exec_state)),
            BinaryPart::Name(name) => name.get_result(exec_state, ctx).await.cloned(),
            BinaryPart::BinaryExpression(binary_expression) => binary_expression.get_result(exec_state, ctx).await,
            BinaryPart::CallExpression(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::CallExpressionKw(call_expression) => call_expression.execute(exec_state, ctx).await,
            BinaryPart::UnaryExpression(unary_expression) => unary_expression.get_result(exec_state, ctx).await,
            BinaryPart::MemberExpression(member_expression) => member_expression.get_result(exec_state),
            BinaryPart::IfExpression(e) => e.get_result(exec_state, ctx).await,
        }
    }
}

impl Node<Name> {
    async fn get_result<'a>(
        &self,
        exec_state: &'a mut ExecState,
        ctx: &ExecutorContext,
    ) -> Result<&'a KclValue, KclError> {
        if self.abs_path {
            return Err(KclError::Semantic(KclErrorDetails {
                message: "Absolute paths (names beginning with `::` are not yet supported)".to_owned(),
                source_ranges: self.as_source_ranges(),
            }));
        }

        if self.path.is_empty() {
            return exec_state.stack().get(&self.name.name, self.into());
        }

        let mut mem_spec: Option<(EnvironmentRef, Vec<String>)> = None;
        for p in &self.path {
            let value = match mem_spec {
                Some((env, exports)) => {
                    if !exports.contains(&p.name) {
                        return Err(KclError::Semantic(KclErrorDetails {
                            message: format!("Item {} not found in module's exported items", p.name),
                            source_ranges: p.as_source_ranges(),
                        }));
                    }

                    exec_state
                        .stack()
                        .memory
                        .get_from(&p.name, env, p.as_source_range(), 0)?
                }
                None => exec_state.stack().get(&p.name, self.into())?,
            };

            let KclValue::Module { value: module_id, .. } = value else {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Identifier in path must refer to a module, found {}",
                        value.human_friendly_type()
                    ),
                    source_ranges: p.as_source_ranges(),
                }));
            };

            mem_spec = Some(
                ctx.exec_module_for_items(*module_id, exec_state, p.as_source_range())
                    .await?,
            );
        }

        let (env, exports) = mem_spec.unwrap();
        if !exports.contains(&self.name.name) {
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("Item {} not found in module's exported items", self.name.name),
                source_ranges: self.name.as_source_ranges(),
            }));
        }

        exec_state
            .stack()
            .memory
            .get_from(&self.name.name, env, self.name.as_source_range(), 0)
    }
}

impl Node<MemberExpression> {
    fn get_result(&self, exec_state: &mut ExecState) -> Result<KclValue, KclError> {
        let property = Property::try_from(self.computed, self.property.clone(), exec_state, self.into())?;
        let object = match &self.object {
            // TODO: Don't use recursion here, use a loop.
            MemberObject::MemberExpression(member_expr) => member_expr.get_result(exec_state)?,
            MemberObject::Identifier(identifier) => {
                let value = exec_state.stack().get(&identifier.name, identifier.into())?;
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
            (KclValue::MixedArray { value: arr, meta: _ }, Property::UInt(index)) => {
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
            (KclValue::MixedArray { .. }, p) => {
                let t = p.type_name();
                let article = article_for(t);
                Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Only integers >= 0 can be used as the index of an array, but you're using {article} {t}",
                    ),
                    source_ranges: vec![self.clone().into()],
                }))
            }
            (KclValue::Solid { value }, Property::String(prop)) if prop == "sketch" => Ok(KclValue::Sketch {
                value: Box::new(value.sketch),
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

        // Then check if we have solids.
        if self.operator == BinaryOperator::Add || self.operator == BinaryOperator::Or {
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = crate::std::Args::new(Default::default(), self.into(), ctx.clone(), None);
                let result =
                    crate::std::csg::inner_union(vec![*left.clone(), *right.clone()], exec_state, args).await?;
                return Ok(result.into());
            }
        } else if self.operator == BinaryOperator::Sub {
            // Check if we have solids.
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = crate::std::Args::new(Default::default(), self.into(), ctx.clone(), None);
                let result =
                    crate::std::csg::inner_subtract(vec![*left.clone()], vec![*right.clone()], exec_state, args)
                        .await?;
                return Ok(result.into());
            }
        } else if self.operator == BinaryOperator::And {
            // Check if we have solids.
            if let (KclValue::Solid { value: left }, KclValue::Solid { value: right }) = (&left_value, &right_value) {
                let args = crate::std::Args::new(Default::default(), self.into(), ctx.clone(), None);
                let result =
                    crate::std::csg::inner_intersect(vec![*left.clone(), *right.clone()], exec_state, args).await?;
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
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Cannot apply logical operator to non-boolean value: {}",
                        left_value.human_friendly_type()
                    ),
                    source_ranges: vec![self.left.clone().into()],
                }));
            };
            let KclValue::Bool {
                value: right_value,
                meta: _,
            } = right_value
            else {
                return Err(KclError::Semantic(KclErrorDetails {
                    message: format!(
                        "Cannot apply logical operator to non-boolean value: {}",
                        right_value.human_friendly_type()
                    ),
                    source_ranges: vec![self.right.clone().into()],
                }));
            };
            let raw_value = match self.operator {
                BinaryOperator::Or => left_value || right_value,
                BinaryOperator::And => left_value && right_value,
                _ => unreachable!(),
            };
            return Ok(KclValue::Bool { value: raw_value, meta });
        }

        let (left, lty) = parse_number_as_f64(&left_value, self.left.clone().into())?;
        let (right, rty) = parse_number_as_f64(&right_value, self.right.clone().into())?;

        let value = match self.operator {
            BinaryOperator::Add => KclValue::Number {
                value: left + right,
                meta,
                ty: NumericType::combine_add(lty, rty),
            },
            BinaryOperator::Sub => KclValue::Number {
                value: left - right,
                meta,
                ty: NumericType::combine_add(lty, rty),
            },
            BinaryOperator::Mul => KclValue::Number {
                value: left * right,
                meta,
                ty: NumericType::combine_mul(lty, rty),
            },
            BinaryOperator::Div => KclValue::Number {
                value: left / right,
                meta,
                ty: NumericType::combine_div(lty, rty),
            },
            BinaryOperator::Mod => KclValue::Number {
                value: left % right,
                meta,
                ty: NumericType::combine_div(lty, rty),
            },
            BinaryOperator::Pow => KclValue::Number {
                value: left.powf(right),
                meta,
                ty: NumericType::Unknown,
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
            BinaryOperator::And | BinaryOperator::Or => unreachable!(),
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
        let err = || {
            KclError::Semantic(KclErrorDetails {
                message: format!(
                    "You can only negate numbers, planes, or lines, but this is a {}",
                    value.human_friendly_type()
                ),
                source_ranges: vec![self.into()],
            })
        };
        match value {
            KclValue::Number { value, ty, .. } => {
                let meta = vec![Metadata {
                    source_range: self.into(),
                }];
                Ok(KclValue::Number {
                    value: -value,
                    meta,
                    ty: ty.clone(),
                })
            }
            KclValue::Plane { value } => {
                let mut plane = value.clone();
                plane.z_axis.x *= -1.0;
                plane.z_axis.y *= -1.0;
                plane.z_axis.z *= -1.0;

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
                    KclValue::MixedArray { value: values, meta } => {
                        let values = values
                            .iter()
                            .map(|v| match v {
                                KclValue::Number { value, ty, meta } => Ok(KclValue::Number {
                                    value: *value * -1.0,
                                    ty: ty.clone(),
                                    meta: meta.clone(),
                                }),
                                _ => Err(err()),
                            })
                            .collect::<Result<Vec<_>, _>>()?;

                        KclValue::MixedArray {
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
                                    ty: ty.clone(),
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
        .execute_expr(first, exec_state, &meta, &[], StatementKind::Expression)
        .await?;

    // Now that we've evaluated the first child expression in the pipeline, following child expressions
    // should use the previous child expression for %.
    // This means there's no more need for the previous pipe_value from the parent AST node above this one.
    let previous_pipe_value = std::mem::replace(&mut exec_state.mod_local.pipe_value, Some(output));
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
            return Err(KclError::Semantic(KclErrorDetails {
                message: format!("This cannot be in a PipeExpression: {:?}", expression),
                source_ranges: vec![expression.into()],
            }));
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

impl Node<CallExpressionKw> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee;
        let callsite: SourceRange = self.into();

        // Build a hashmap from argument labels to the final evaluated values.
        let mut fn_args = IndexMap::with_capacity(self.arguments.len());
        for arg_expr in &self.arguments {
            let source_range = SourceRange::from(arg_expr.arg.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(&arg_expr.arg, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            fn_args.insert(arg_expr.label.name.clone(), Arg::new(value, source_range));
        }
        let fn_args = fn_args; // remove mutability

        // Evaluate the unlabeled first param, if any exists.
        let unlabeled = if let Some(ref arg_expr) = self.unlabeled {
            let source_range = SourceRange::from(arg_expr.clone());
            let metadata = Metadata { source_range };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, &[], StatementKind::Expression)
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
            exec_state.mod_local.pipe_value.clone().map(|v| Arg::new(v, callsite)),
        );
        match ctx.stdlib.get_either(fn_name) {
            FunctionKind::Core(func) => {
                if func.deprecated() {
                    exec_state.warn(CompilationError::err(
                        self.callee.as_source_range(),
                        format!("`{fn_name}` is deprecated, see the docs for a recommended replacement"),
                    ));
                }

                let op = if func.feature_tree_operation() {
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

                let formals = func.args(false);
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
                        exec_state.global.operations.push(op);
                    }
                    result
                }?;

                update_memory_for_tags_of_geometry(&mut return_value, exec_state)?;

                Ok(return_value)
            }
            FunctionKind::UserDefined => {
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

                if matches!(fn_src, FunctionSource::User { .. }) {
                    // Track return operation.
                    exec_state.global.operations.push(Operation::GroupEnd);
                }

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

impl Node<CallExpression> {
    #[async_recursion]
    pub async fn execute(&self, exec_state: &mut ExecState, ctx: &ExecutorContext) -> Result<KclValue, KclError> {
        let fn_name = &self.callee;
        let callsite = SourceRange::from(self);

        let mut fn_args: Vec<Arg> = Vec::with_capacity(self.arguments.len());

        for arg_expr in &self.arguments {
            let metadata = Metadata {
                source_range: SourceRange::from(arg_expr),
            };
            let value = ctx
                .execute_expr(arg_expr, exec_state, &metadata, &[], StatementKind::Expression)
                .await?;
            let arg = Arg::new(value, SourceRange::from(arg_expr));
            fn_args.push(arg);
        }
        let fn_args = fn_args; // remove mutability

        match ctx.stdlib.get_either(fn_name) {
            FunctionKind::Core(func) => {
                if func.deprecated() {
                    exec_state.warn(CompilationError::err(
                        self.callee.as_source_range(),
                        format!("`{fn_name}` is deprecated, see the docs for a recommended replacement"),
                    ));
                }

                let op = if func.feature_tree_operation() {
                    let op_labeled_args = func
                        .args(false)
                        .iter()
                        .zip(&fn_args)
                        .map(|(k, arg)| {
                            (
                                k.name.clone(),
                                OpArg::new(OpKclValue::from(&arg.value), arg.source_range),
                            )
                        })
                        .collect();
                    Some(Operation::StdLibCall {
                        std_lib_fn: (&func).into(),
                        unlabeled_arg: None,
                        labeled_args: op_labeled_args,
                        source_range: callsite,
                        is_error: false,
                    })
                } else {
                    None
                };

                // Attempt to call the function.
                let args = crate::std::Args::new(
                    fn_args,
                    self.into(),
                    ctx.clone(),
                    exec_state.mod_local.pipe_value.clone().map(|v| Arg::new(v, callsite)),
                );
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
                        exec_state.global.operations.push(op);
                    }
                    result
                }?;

                update_memory_for_tags_of_geometry(&mut return_value, exec_state)?;

                Ok(return_value)
            }
            FunctionKind::UserDefined => {
                let source_range = SourceRange::from(self);
                // Clone the function so that we can use a mutable reference to
                // exec_state.
                let func = fn_name.get_result(exec_state, ctx).await?.clone();

                // Track call operation.
                exec_state.global.operations.push(Operation::GroupBegin {
                    group: Group::FunctionCall {
                        name: Some(fn_name.to_string()),
                        function_source_range: func.function_def_source_range().unwrap_or_default(),
                        unlabeled_arg: None,
                        // TODO: Add the arguments for legacy positional parameters.
                        labeled_args: Default::default(),
                    },
                    source_range: callsite,
                });

                let Some(fn_src) = func.as_fn() else {
                    return Err(KclError::Semantic(KclErrorDetails {
                        message: "cannot call this because it isn't a function".to_string(),
                        source_ranges: vec![source_range],
                    }));
                };
                let return_value = fn_src
                    .call(Some(fn_name.to_string()), exec_state, ctx, fn_args, source_range)
                    .await
                    .map_err(|e| {
                        // Add the call expression to the source ranges.
                        // TODO currently ignored by the frontend
                        e.add_source_ranges(vec![source_range])
                    })?;

                let result = return_value.ok_or_else(move || {
                    let mut source_ranges: Vec<SourceRange> = vec![source_range];
                    // We want to send the source range of the original function.
                    if let KclValue::Function { meta, .. } = func {
                        source_ranges = meta.iter().map(|m| m.source_range).collect();
                    };
                    KclError::UndefinedValue(KclErrorDetails {
                        message: format!("Result of function {} is undefined", fn_name),
                        source_ranges,
                    })
                })?;

                // Track return operation.
                exec_state.global.operations.push(Operation::GroupEnd);

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
                        KclValue::Sketch { value: sk } => sk.artifact_id == value.sketch.artifact_id,
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
        KclValue::MixedArray { value, .. } | KclValue::HomArray { value, .. } => {
            for v in value {
                update_memory_for_tags_of_geometry(v, exec_state)?;
            }
        }
        _ => {}
    }
    Ok(())
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

        Ok(KclValue::MixedArray {
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
            .execute_expr(
                &self.start_element,
                exec_state,
                &metadata,
                &[],
                StatementKind::Expression,
            )
            .await?;
        let start = start.as_int().ok_or(KclError::Semantic(KclErrorDetails {
            source_ranges: vec![self.into()],
            message: format!("Expected int but found {}", start.human_friendly_type()),
        }))?;
        let metadata = Metadata::from(&self.end_element);
        let end = ctx
            .execute_expr(&self.end_element, exec_state, &metadata, &[], StatementKind::Expression)
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
        Ok(KclValue::MixedArray {
            value: range
                .into_iter()
                .map(|num| KclValue::Number {
                    value: num as f64,
                    ty: NumericType::count(),
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

fn article_for(s: &str) -> &'static str {
    if s.starts_with(['a', 'e', 'i', 'o', 'u']) {
        "an"
    } else {
        "a"
    }
}

pub fn parse_number_as_f64(v: &KclValue, source_range: SourceRange) -> Result<(f64, NumericType), KclError> {
    if let KclValue::Number { value: n, ty, .. } = &v {
        Ok((*n, ty.clone()))
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
                    // Treat the property as a literal
                    Ok(Property::String(name.to_string()))
                } else {
                    // Actually evaluate memory to compute the property.
                    let prop = exec_state.stack().get(name, property_src)?;
                    jvalue_to_prop(prop, property_sr, name)
                }
            }
            LiteralIdentifier::Literal(literal) => {
                let value = literal.value.clone();
                match value {
                    LiteralValue::Number { value, .. } => {
                        if let Some(x) = crate::try_f64_to_usize(value) {
                            Ok(Property::UInt(x))
                        } else {
                            Err(KclError::Semantic(KclErrorDetails {
                                source_ranges: property_sr,
                                message: format!("{value} is not a valid index, indices must be whole numbers >= 0"),
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
        KclValue::Number{value: num, .. } => {
            let num = *num;
            if num < 0.0 {
                return make_err(format!("'{num}' is negative, so you can't index an array with it"))
            }
            let nearest_int = crate::try_f64_to_usize(num);
            if let Some(nearest_int) = nearest_int {
                Ok(Property::UInt(nearest_int))
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

/// For each argument given,
/// assign it to a parameter of the function, in the given block of function memory.
/// Returns Err if too few/too many arguments were given for the function.
fn assign_args_to_params(
    function_expression: NodeRef<'_, FunctionExpression>,
    args: Vec<Arg>,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    let num_args = function_expression.number_of_args();
    let (min_params, max_params) = num_args.into_inner();
    let n = args.len();

    // Check if the user supplied too many arguments
    // (we'll check for too few arguments below).
    let err_wrong_number_args = KclError::Semantic(KclErrorDetails {
        message: if min_params == max_params {
            format!("Expected {min_params} arguments, got {n}")
        } else {
            format!("Expected {min_params}-{max_params} arguments, got {n}")
        },
        source_ranges: vec![function_expression.into()],
    });
    if n > max_params {
        return Err(err_wrong_number_args);
    }

    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    for (index, param) in function_expression.params.iter().enumerate() {
        if let Some(arg) = args.get(index) {
            // Argument was provided.
            exec_state.mut_stack().add(
                param.identifier.name.clone(),
                arg.value.clone(),
                (&param.identifier).into(),
            )?;
        } else {
            // Argument was not provided.
            if let Some(ref default_val) = param.default_value {
                // If the corresponding parameter is optional,
                // then it's fine, the user doesn't need to supply it.
                let value = KclValue::from_default_param(default_val.clone(), exec_state);
                exec_state
                    .mut_stack()
                    .add(param.identifier.name.clone(), value, (&param.identifier).into())?;
            } else {
                // But if the corresponding parameter was required,
                // then the user has called with too few arguments.
                return Err(err_wrong_number_args);
            }
        }
    }
    Ok(())
}

fn assign_args_to_params_kw(
    function_expression: NodeRef<'_, FunctionExpression>,
    mut args: crate::std::args::KwArgs,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    for (label, arg) in &args.labeled {
        match function_expression.params.iter().find(|p| &p.identifier.name == label) {
            Some(p) => {
                if !p.labeled {
                    exec_state.err(CompilationError::err(
                        arg.source_range,
                        format!(
                            "This function expects an unlabeled first parameter (`{label}`), but it is labelled in the call"
                        ),
                    ));
                }
            }
            None => {
                exec_state.err(CompilationError::err(
                    arg.source_range,
                    format!("`{label}` is not an argument of this function"),
                ));
            }
        }
    }

    // Add the arguments to the memory.  A new call frame should have already
    // been created.
    let source_ranges = vec![function_expression.into()];

    for param in function_expression.params.iter() {
        if param.labeled {
            let arg = args.labeled.get(&param.identifier.name);
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
            let Some(unlabeled) = args.unlabeled.take() else {
                let param_name = &param.identifier.name;
                return Err(if args.labeled.contains_key(param_name) {
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

async fn call_user_defined_function(
    args: Vec<Arg>,
    memory: EnvironmentRef,
    function_expression: NodeRef<'_, FunctionExpression>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Option<KclValue>, KclError> {
    // Create a new environment to execute the function body in so that local
    // variables shadow variables in the parent scope.  The new environment's
    // parent should be the environment of the closure.
    exec_state.mut_stack().push_new_env_for_call(memory);
    if let Err(e) = assign_args_to_params(function_expression, args, exec_state) {
        exec_state.mut_stack().pop_env();
        return Err(e);
    }

    // Execute the function body using the memory we just created.
    let result = ctx
        .exec_block(&function_expression.body, exec_state, BodyType::Block)
        .await;
    let result = result.map(|_| {
        exec_state
            .stack()
            .get(memory::RETURN_NAME, function_expression.as_source_range())
            .ok()
            .cloned()
    });
    // Restore the previous memory.
    exec_state.mut_stack().pop_env();

    result
}

async fn call_user_defined_function_kw(
    args: crate::std::args::KwArgs,
    memory: EnvironmentRef,
    function_expression: NodeRef<'_, FunctionExpression>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Option<KclValue>, KclError> {
    // Create a new environment to execute the function body in so that local
    // variables shadow variables in the parent scope.  The new environment's
    // parent should be the environment of the closure.
    exec_state.mut_stack().push_new_env_for_call(memory);
    if let Err(e) = assign_args_to_params_kw(function_expression, args, exec_state) {
        exec_state.mut_stack().pop_env();
        return Err(e);
    }

    // Execute the function body using the memory we just created.
    let result = ctx
        .exec_block(&function_expression.body, exec_state, BodyType::Block)
        .await;
    let result = result.map(|_| {
        exec_state
            .stack()
            .get(memory::RETURN_NAME, function_expression.as_source_range())
            .ok()
            .cloned()
    });
    // Restore the previous memory.
    exec_state.mut_stack().pop_env();

    result
}

impl FunctionSource {
    pub async fn call(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        mut args: Vec<Arg>,
        callsite: SourceRange,
    ) -> Result<Option<KclValue>, KclError> {
        match self {
            FunctionSource::Std { props, .. } => {
                if args.len() <= 1 {
                    let args = crate::std::Args::new_kw(
                        KwArgs {
                            unlabeled: args.pop(),
                            labeled: IndexMap::new(),
                        },
                        callsite,
                        ctx.clone(),
                        exec_state.mod_local.pipe_value.clone().map(|v| Arg::new(v, callsite)),
                    );
                    self.call_kw(fn_name, exec_state, ctx, args, callsite).await
                } else {
                    Err(KclError::Semantic(KclErrorDetails {
                        message: format!("{} requires its arguments to be labelled", props.name),
                        source_ranges: vec![callsite],
                    }))
                }
            }
            FunctionSource::User { ast, memory, .. } => {
                call_user_defined_function(args, *memory, ast, exec_state, ctx).await
            }
            FunctionSource::None => unreachable!(),
        }
    }

    pub async fn call_kw(
        &self,
        fn_name: Option<String>,
        exec_state: &mut ExecState,
        ctx: &ExecutorContext,
        mut args: crate::std::Args,
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

                for (label, arg) in &mut args.kw_args.labeled {
                    match ast.params.iter().find(|p| &p.identifier.name == label) {
                        Some(p) => {
                            if !p.labeled {
                                exec_state.err(CompilationError::err(
                                    arg.source_range,
                                    format!(
                                        "The function `{}` expects an unlabeled first parameter (`{label}`), but it is labelled in the call",
                                        props.name
                                    ),
                                ));
                            }

                            if let Some(ty) = &p.type_ {
                                arg.value = arg
                                    .value
                                    .coerce(
                                        &RuntimeType::from_parsed(ty.inner.clone(), exec_state, arg.source_range)
                                            .unwrap(),
                                        exec_state,
                                    )
                                    .ok_or_else(|| {
                                        KclError::Semantic(KclErrorDetails {
                                            message: format!(
                                                "{label} requires a value with type `{}`, but found {}",
                                                ty.inner,
                                                arg.value.human_friendly_type()
                                            ),
                                            source_ranges: vec![callsite],
                                        })
                                    })?;
                            }
                        }
                        None => {
                            exec_state.err(CompilationError::err(
                                arg.source_range,
                                format!("`{label}` is not an argument of `{}`", props.name),
                            ));
                        }
                    }
                }

                if let Some(arg) = &mut args.kw_args.unlabeled {
                    if let Some(p) = ast.params.iter().find(|p| !p.labeled) {
                        if let Some(ty) = &p.type_ {
                            arg.value = arg
                                .value
                                .coerce(
                                    &RuntimeType::from_parsed(ty.inner.clone(), exec_state, arg.source_range).unwrap(),
                                    exec_state,
                                )
                                .ok_or_else(|| {
                                    KclError::Semantic(KclErrorDetails {
                                        message: format!(
                                            "The input argument of {} requires a value with type `{}`, but found {}",
                                            props.name,
                                            ty.inner,
                                            arg.value.human_friendly_type()
                                        ),
                                        source_ranges: vec![callsite],
                                    })
                                })?;
                        }
                    }
                }

                let op = if props.include_in_feature_tree {
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
                        exec_state.global.operations.push(op);
                    }
                    result
                }?;

                update_memory_for_tags_of_geometry(&mut result, exec_state)?;

                Ok(Some(result))
            }
            FunctionSource::User { ast, memory, .. } => {
                // Track call operation.
                let op_labeled_args = args
                    .kw_args
                    .labeled
                    .iter()
                    .map(|(k, arg)| (k.clone(), OpArg::new(OpKclValue::from(&arg.value), arg.source_range)))
                    .collect();
                exec_state.global.operations.push(Operation::GroupBegin {
                    group: Group::FunctionCall {
                        name: fn_name,
                        function_source_range: ast.as_source_range(),
                        unlabeled_arg: args
                            .kw_args
                            .unlabeled
                            .as_ref()
                            .map(|arg| OpArg::new(OpKclValue::from(&arg.value), arg.source_range)),
                        labeled_args: op_labeled_args,
                    },
                    source_range: callsite,
                });

                call_user_defined_function_kw(args.kw_args, *memory, ast, exec_state, ctx).await
            }
            FunctionSource::None => unreachable!(),
        }
    }
}

#[cfg(test)]
mod test {
    use std::sync::Arc;

    use tokio::io::AsyncWriteExt;

    use super::*;
    use crate::{
        execution::{memory::Stack, parse_execute, ContextType},
        parsing::ast::types::{DefaultParamVal, Identifier, Parameter},
        ExecutorSettings,
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
                vec![mem(1)],
                Ok(additional_program_memory(&[("x".to_owned(), mem(1))])),
            ),
            (
                "all params required, none given, should error",
                vec![req_param("x")],
                vec![],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "Expected 1 arguments, got 0".to_owned(),
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
                    message: "Expected 1-2 arguments, got 0".to_owned(),
                })),
            ),
            (
                "mixed params, minimum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1)],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), KclValue::none()),
                ])),
            ),
            (
                "mixed params, maximum given, should be OK",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1), mem(2)],
                Ok(additional_program_memory(&[
                    ("x".to_owned(), mem(1)),
                    ("y".to_owned(), mem(2)),
                ])),
            ),
            (
                "mixed params, too many given",
                vec![req_param("x"), opt_param("y")],
                vec![mem(1), mem(2), mem(3)],
                Err(KclError::Semantic(KclErrorDetails {
                    source_ranges: vec![SourceRange::default()],
                    message: "Expected 1-2 arguments, got 3".to_owned(),
                })),
            ),
        ] {
            // Run each test.
            let func_expr = &Node::no_src(FunctionExpression {
                params,
                body: Program::empty(),
                return_type: None,
                digest: None,
            });
            let args = args.into_iter().map(Arg::synthetic).collect();
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
            let actual = assign_args_to_params(func_expr, args, &mut exec_state).map(|_| exec_state.mod_local.stack);
            assert_eq!(
                actual, expected,
                "failed test '{test_name}':\ngot {actual:?}\nbut expected\n{expected:?}"
            );
        }
    }

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
"#;

        let result = parse_execute(program).await.unwrap();
        let mem = result.exec_state.stack();
        assert!(matches!(
            mem.memory
                .get_from("p", result.mem_env, SourceRange::default(), 0)
                .unwrap(),
            KclValue::Plane { .. }
        ));

        let program = r#"
a = 42: string
"#;
        let result = parse_execute(program).await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("could not coerce number value to type string"));

        let program = r#"
a = 42: Plane
"#;
        let result = parse_execute(program).await;
        assert!(result
            .unwrap_err()
            .to_string()
            .contains("could not coerce number value to type Plane"));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn neg_plane() {
        let program = r#"
p = {
  origin = { x = 0, y = 0, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = 1, z = 0 },
  zAxis = { x = 0, y = 0, z = 1 }
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
            KclValue::Plane { value } => assert_eq!(value.z_axis.z, -1.0),
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
        let programa_kcl = r#"
export a = 1
"#;
        // program b.kcl
        let programb_kcl = r#"
import a from 'a.kcl'

export b = a + 1
"#;
        // program c.kcl
        let programc_kcl = r#"
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

        let tmpdir = tempdir::TempDir::new("zma_kcl_load_all_modules").unwrap();

        tokio::fs::File::create(tmpdir.path().join("main.kcl"))
            .await
            .unwrap()
            .write_all(main_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("a.kcl"))
            .await
            .unwrap()
            .write_all(programa_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("b.kcl"))
            .await
            .unwrap()
            .write_all(programb_kcl.as_bytes())
            .await
            .unwrap();

        tokio::fs::File::create(tmpdir.path().join("c.kcl"))
            .await
            .unwrap()
            .write_all(programc_kcl.as_bytes())
            .await
            .unwrap();

        let exec_ctxt = ExecutorContext {
            engine: Arc::new(Box::new(
                crate::engine::conn_mock::EngineConnection::new()
                    .await
                    .map_err(|err| {
                        KclError::Internal(crate::errors::KclErrorDetails {
                            message: format!("Failed to create mock engine connection: {}", err),
                            source_ranges: vec![SourceRange::default()],
                        })
                    })
                    .unwrap(),
            )),
            fs: Arc::new(crate::fs::FileManager::new()),
            settings: ExecutorSettings {
                project_directory: Some(tmpdir.path().into()),
                ..Default::default()
            },
            stdlib: Arc::new(crate::std::StdLib::new()),
            context_type: ContextType::Mock,
        };
        let mut exec_state = ExecState::new(&exec_ctxt);

        exec_ctxt
            .run_concurrent(
                &crate::Program {
                    ast: main.clone(),
                    original_file_contents: "".to_owned(),
                },
                &mut exec_state,
                false,
            )
            .await
            .unwrap();
    }
}
