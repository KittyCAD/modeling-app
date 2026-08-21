use std::collections::HashMap;
use std::sync::Arc;
use std::sync::Mutex;

use anyhow::Result;

use crate::ExecState;
use crate::ExecutorContext;
use crate::KclError;
use crate::ModuleId;
use crate::SourceRange;
use crate::errors::KclErrorDetails;
use crate::execution::typed_path::TypedPath;
use crate::modules::ModulePath;
use crate::modules::ModuleRepr;
use crate::parsing::ast::types::ImportPath;
use crate::parsing::ast::types::ImportStatement;
use crate::parsing::ast::types::Node as AstNode;
use crate::walk::Node;
use crate::walk::Visitable;

/// Specific dependency between two modules. The 0th element of this info
/// is the "importing" module, the 1st is the "imported" module. The 0th
/// module *depends on* the 1st module.
type Dependency = (String, String);

type Graph = Vec<Dependency>;

pub(crate) type DependencyInfo = (AstNode<ImportStatement>, ModuleId, ModulePath, ModuleRepr);
pub(crate) type UniverseMap = HashMap<TypedPath, AstNode<ImportStatement>>;
pub(crate) type Universe = HashMap<String, DependencyInfo>;

/// Add the ancestor import statements between `module_id` and the root module
/// to an error raised while eagerly executing that module.
///
/// Imported modules are executed in dependency order, so a leaf can fail
/// before its parents execute and naturally unwind. The universe still holds
/// each module's importing statement, which lets us reconstruct that chain.
/// Every per-module error path in the eager loop already records the
/// immediate import frame (`exec_module_from_ast` for KCL modules, the
/// labeled `send_to_engine` failure for foreign ones, and the not-found
/// internal error, which ranges the error at the import site), so this
/// starts with its parent.
pub(crate) fn add_import_backtrace(error: KclError, module_id: ModuleId, universe: &Universe) -> KclError {
    let Some((immediate_import, _, _, _)) = universe
        .values()
        .find(|(_, candidate_id, _, _)| *candidate_id == module_id)
    else {
        return error;
    };
    let parent = SourceRange::from(immediate_import).module_id();
    walk_import_ancestry(error, parent, universe, std::collections::HashSet::from([module_id]))
}

/// Add the import statements of `module_id` and its ancestors to an error
/// whose frames end inside that module, starting with `module_id`'s own
/// import statement.
///
/// Unlike [`add_import_backtrace`], this does not assume any import frame has
/// been recorded yet. Use it for errors that surface outside module
/// execution, like engine rejections of async commands.
pub(crate) fn add_import_backtrace_from(error: KclError, module_id: ModuleId, universe: &Universe) -> KclError {
    walk_import_ancestry(error, module_id, universe, std::collections::HashSet::new())
}

fn walk_import_ancestry(
    mut error: KclError,
    mut module_id: ModuleId,
    universe: &Universe,
    // Guard against malformed universes. Import cycles are rejected before
    // modules execute, but this runs on an error path where the failure mode
    // would be an infinite loop, so don't rely on that invariant here.
    mut visited: std::collections::HashSet<ModuleId>,
) -> KclError {
    while module_id != ModuleId::default() && visited.insert(module_id) {
        let Some((import_stmt, _, _, _)) = universe
            .values()
            .find(|(_, candidate_id, _, _)| *candidate_id == module_id)
        else {
            break;
        };

        let import_site = SourceRange::from(import_stmt);
        error = error.add_import_location(&import_stmt.path.to_string(), import_site);
        module_id = import_site.module_id();
    }

    error
}

/// Process a number of programs, returning the graph of dependencies.
///
/// This will (currently) return a list of lists of IDs that can be safely
/// run concurrently. Each "stage" is blocking in this model, which will
/// change in the future. Don't use this function widely, yet.
#[allow(clippy::iter_over_hash_type)]
pub(crate) fn import_graph(progs: &Universe, ctx: &ExecutorContext) -> Result<Vec<Vec<String>>, KclError> {
    let mut graph = Graph::new();

    for (name, (_, _, path, repr)) in progs.iter() {
        graph.extend(
            import_dependencies(path, repr, ctx)?
                .into_iter()
                .map(|(dependency, _, _)| (name.clone(), dependency))
                .collect::<Vec<_>>(),
        );
    }

    let all_modules: Vec<&str> = progs.keys().map(|v| v.as_str()).collect();
    topsort(&all_modules, graph)
}

#[allow(clippy::iter_over_hash_type)]
fn topsort(all_modules: &[&str], graph: Graph) -> Result<Vec<Vec<String>>, KclError> {
    if all_modules.is_empty() {
        return Ok(vec![]);
    }
    let mut dep_map = HashMap::<String, Vec<String>>::new();

    for (dependent, dependency) in graph.iter() {
        let mut dependencies = dep_map.remove(dependent).unwrap_or_default();
        dependencies.push(dependency.to_owned());
        dep_map.insert(dependent.to_owned(), dependencies);
    }

    // dep_map now contains reverse dependencies. For each module, it's a
    // list of what things are "waiting on it". A non-empty value for a key
    // means it's currently blocked.

    let mut waiting_modules = all_modules.to_owned();
    let mut order = vec![];

    loop {
        // Each pass through we need to find any modules which have nothing
        // "pointing at it" -- so-called reverse dependencies. This is an entry
        // that is either not in the dep_map OR an empty list.

        let mut stage_modules: Vec<String> = vec![];

        for module in &waiting_modules {
            let module = module.to_string();
            if dep_map.get(&module).map(|v| v.len()).unwrap_or(0) == 0 {
                // if it's None or empty, this is a node that we can process,
                // and remove from the graph.
                stage_modules.push(module.to_string());
            }
        }

        for stage_module in &stage_modules {
            // remove the ready-to-run module from the waiting list
            waiting_modules.retain(|v| *v != stage_module.as_str());

            // remove any dependencies for the next run
            for waiting_for in dep_map.values_mut() {
                waiting_for.retain(|v| v != stage_module);
            }
        }

        if stage_modules.is_empty() {
            waiting_modules.sort();

            return Err(KclError::new_import_cycle(KclErrorDetails::new(
                format!("circular import of modules not allowed: {}", waiting_modules.join(", ")),
                // TODO: we can get the right import lines from the AST, but we don't
                vec![SourceRange::default()],
            )));
        }

        // not strictly needed here, but perhaps helpful to avoid thinking
        // there's any implied ordering as well as helping to make tests
        // easier.
        stage_modules.sort();

        order.push(stage_modules);

        if waiting_modules.is_empty() {
            break;
        }
    }

    Ok(order)
}

type ImportDependencies = Vec<(String, AstNode<ImportStatement>, ModulePath)>;

fn import_dependencies(
    path: &ModulePath,
    repr: &ModuleRepr,
    ctx: &ExecutorContext,
) -> Result<ImportDependencies, KclError> {
    let ModuleRepr::Kcl(prog, _) = repr else {
        // It has no dependencies, so return an empty list.
        return Ok(vec![]);
    };

    let ret = Arc::new(Mutex::new(vec![]));
    fn walk(
        ret: Arc<Mutex<ImportDependencies>>,
        node: Node<'_>,
        import_from: &ModulePath,
        ctx: &ExecutorContext,
    ) -> Result<(), KclError> {
        if let Node::ImportStatement(is) = node {
            // We only care about Kcl and Foreign imports for now.
            let resolved_path = ModulePath::from_import_path(&is.path, &ctx.settings.project_directory, import_from)?;
            match &is.path {
                ImportPath::Kcl { filename } => {
                    // We need to lock the mutex to push the dependency.
                    // This is a bit of a hack, but it works for now.
                    ret.lock()
                        .map_err(|err| {
                            KclError::new_internal(KclErrorDetails::new(
                                format!("Failed to lock mutex: {err}"),
                                Default::default(),
                            ))
                        })?
                        .push((filename.to_string(), is.clone(), resolved_path));
                }
                ImportPath::Foreign { path } => {
                    ret.lock()
                        .map_err(|err| {
                            KclError::new_internal(KclErrorDetails::new(
                                format!("Failed to lock mutex: {err}"),
                                Default::default(),
                            ))
                        })?
                        .push((path.to_string(), is.clone(), resolved_path));
                }
                ImportPath::Std { .. } => { // do nothing
                }
            }
        }

        for child in node.children().iter() {
            walk(ret.clone(), *child, import_from, ctx)?;
        }

        Ok(())
    }

    walk(ret.clone(), prog.into(), path, ctx)?;

    let ret = ret.lock().map_err(|err| {
        KclError::new_internal(KclErrorDetails::new(
            format!("Failed to lock mutex: {err}"),
            Default::default(),
        ))
    })?;

    Ok(ret.clone())
}

/// Mutates the `out` universe with the imported modules. Returns the imports of
/// only `repr`'s non-transitive imports.
pub(crate) async fn import_universe(
    ctx: &ExecutorContext,
    path: &ModulePath,
    repr: &ModuleRepr,
    out: &mut Universe,
    exec_state: &mut ExecState,
) -> Result<UniverseMap, KclError> {
    let modules = import_dependencies(path, repr, ctx)?;
    let mut module_imports = HashMap::new();
    for (filename, import_stmt, module_path) in modules {
        match &module_path {
            ModulePath::Main => {
                // We only care about what the root module imports.
            }
            ModulePath::Local { value, .. } => {
                module_imports.insert(value.clone(), import_stmt.clone());
            }
            ModulePath::Std { .. } => {
                // We don't care about std imports.
            }
        }

        if out.contains_key(&filename) {
            continue;
        }

        let source_range = SourceRange::from(&import_stmt);
        let attrs = &import_stmt.outer_attrs;
        let module_id = ctx
            .open_module(&import_stmt.path, attrs, &module_path, exec_state, source_range)
            .await?;

        let repr = {
            let Some(module_info) = exec_state.get_module(module_id) else {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    format!("Module {module_id} not found"),
                    vec![import_stmt.into()],
                )));
            };
            module_info.repr.clone()
        };

        out.insert(filename, (import_stmt, module_id, module_path.clone(), repr.clone()));
        Box::pin(import_universe(ctx, &module_path, &repr, out, exec_state)).await?;
    }

    Ok(module_imports)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::ast::types::ImportSelector;
    use crate::parsing::ast::types::Program;

    macro_rules! kcl {
        ( $kcl:expr_2021 ) => {{ $crate::parsing::top_level_parse($kcl).unwrap() }};
    }

    fn into_module_info(program: AstNode<Program>) -> DependencyInfo {
        (
            AstNode::no_src(ImportStatement {
                selector: ImportSelector::None { alias: None },
                path: ImportPath::Kcl { filename: "".into() },
                visibility: Default::default(),
                digest: None,
            }),
            ModuleId::default(),
            ModulePath::Local {
                value: "".into(),
                original_import_path: None,
            },
            ModuleRepr::Kcl(program, None),
        )
    }

    /// A universe entry for `filename` imported by a statement located in
    /// `importer`.
    fn dependency_info(filename: &str, module_id: ModuleId, importer: ModuleId) -> DependencyInfo {
        (
            AstNode::new(
                ImportStatement {
                    selector: ImportSelector::None { alias: None },
                    path: ImportPath::Kcl {
                        filename: filename.into(),
                    },
                    visibility: Default::default(),
                    digest: None,
                },
                0,
                filename.len(),
                importer,
            ),
            module_id,
            ModulePath::Local {
                value: filename.into(),
                original_import_path: None,
            },
            ModuleRepr::Dummy,
        )
    }

    #[test]
    fn add_import_backtrace_walks_ancestors_to_root() {
        let root = ModuleId::default();
        let mid = ModuleId::from_usize(1);
        let leaf = ModuleId::from_usize(2);
        let mut universe = HashMap::new();
        universe.insert("mid.kcl".to_owned(), dependency_info("mid.kcl", mid, root));
        universe.insert("leaf.kcl".to_owned(), dependency_info("leaf.kcl", leaf, mid));

        // The per-module error path has already recorded the leaf's own
        // import site by the time add_import_backtrace runs.
        let error = KclError::new_semantic(KclErrorDetails::new(
            "boom".to_owned(),
            vec![SourceRange::new(0, 1, leaf)],
        ))
        .add_import_location("leaf.kcl", SourceRange::new(0, 8, mid));
        let error = add_import_backtrace(error, leaf, &universe);

        // Only the ancestor (mid.kcl's import in the root) is added here,
        // completing the innermost-first chain.
        let fn_names: Vec<_> = error.backtrace().into_iter().map(|item| item.fn_name).collect();
        assert_eq!(
            fn_names,
            [
                Some("import leaf.kcl".to_owned()),
                Some("import mid.kcl".to_owned()),
                None
            ]
        );
        let modules: Vec<_> = error
            .source_ranges()
            .into_iter()
            .map(|range| range.module_id())
            .collect();
        assert_eq!(modules, [leaf, mid, root]);
    }

    #[test]
    fn foreign_import_failure_gets_full_backtrace() {
        // main.kcl imports assembly.kcl, which imports model.obj. The engine
        // send fails; the error is ranged at the import statement in
        // assembly.kcl and carries no deeper frames because foreign files
        // have no source ranges.
        let root = ModuleId::default();
        let assembly = ModuleId::from_usize(1);
        let obj = ModuleId::from_usize(2);
        let mut universe = HashMap::new();
        universe.insert(
            "assembly.kcl".to_owned(),
            dependency_info("assembly.kcl", assembly, root),
        );
        universe.insert("model.obj".to_owned(), dependency_info("model.obj", obj, assembly));

        let obj_import_site = SourceRange::new(0, 18, assembly);
        let engine_error =
            KclError::new_engine(KclErrorDetails::new("engine hangup".to_owned(), vec![obj_import_site]));
        // The eager loop's foreign arm labels the failure with the import.
        let error = engine_error.add_import_location("model.obj", obj_import_site);
        let error = add_import_backtrace(error, obj, &universe);

        let fn_names: Vec<_> = error.backtrace().into_iter().map(|item| item.fn_name).collect();
        assert_eq!(
            fn_names,
            [
                Some("import model.obj".to_owned()),
                Some("import assembly.kcl".to_owned()),
                None
            ]
        );
        let modules: Vec<_> = error
            .source_ranges()
            .into_iter()
            .map(|range| range.module_id())
            .collect();
        assert_eq!(modules, [assembly, assembly, root]);
    }

    #[test]
    fn add_import_backtrace_from_records_own_import_first() {
        // A deferred engine error (e.g. an async foreign import rejection)
        // carries only a range inside the module; nothing has recorded any
        // import frame yet.
        let root = ModuleId::default();
        let assembly = ModuleId::from_usize(1);
        let mut universe = HashMap::new();
        universe.insert(
            "assembly.kcl".to_owned(),
            dependency_info("assembly.kcl", assembly, root),
        );

        let error = KclError::new_engine(KclErrorDetails::new(
            "Import failed".to_owned(),
            vec![SourceRange::new(0, 18, assembly)],
        ));
        let error = add_import_backtrace_from(error, assembly, &universe);

        let fn_names: Vec<_> = error.backtrace().into_iter().map(|item| item.fn_name).collect();
        assert_eq!(fn_names, [Some("import assembly.kcl".to_owned()), None]);
        let modules: Vec<_> = error
            .source_ranges()
            .into_iter()
            .map(|range| range.module_id())
            .collect();
        assert_eq!(modules, [assembly, root]);
    }

    #[test]
    fn add_import_backtrace_terminates_on_cyclic_universe() {
        // A universe that claims module 1 was imported from module 2 and vice
        // versa never reaches the root. Import cycles are rejected before
        // execution, but a malformed universe must not hang this error path.
        let a = ModuleId::from_usize(1);
        let b = ModuleId::from_usize(2);
        let mut universe = HashMap::new();
        universe.insert("a.kcl".to_owned(), dependency_info("a.kcl", a, b));
        universe.insert("b.kcl".to_owned(), dependency_info("b.kcl", b, a));

        let error = KclError::new_semantic(KclErrorDetails::new("boom".to_owned(), vec![SourceRange::new(0, 1, a)]));
        let error = add_import_backtrace(error, a, &universe);

        // Each module's import location is added at most once.
        assert!(error.source_ranges().len() <= 3);
    }

    #[tokio::test]
    async fn order_imports() {
        let mut modules = HashMap::new();

        let a = kcl!("");
        modules.insert("a.kcl".to_owned(), into_module_info(a));

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), into_module_info(b));

        let ctx = ExecutorContext::new_mock(None).await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned()]], order);
        ctx.close().await;
    }

    #[tokio::test]
    async fn order_imports_none() {
        let mut modules = HashMap::new();

        let a = kcl!(
            "
y = 2
"
        );
        modules.insert("a.kcl".to_owned(), into_module_info(a));

        let b = kcl!(
            "
x = 1
"
        );
        modules.insert("b.kcl".to_owned(), into_module_info(b));

        let ctx = ExecutorContext::new_mock(None).await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned(), "b.kcl".to_owned()]], order);
        ctx.close().await;
    }

    #[tokio::test]
    async fn order_imports_2() {
        let mut modules = HashMap::new();

        let a = kcl!("");
        modules.insert("a.kcl".to_owned(), into_module_info(a));

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), into_module_info(b));

        let c = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("c.kcl".to_owned(), into_module_info(c));

        let ctx = ExecutorContext::new_mock(None).await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(
            vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned(), "c.kcl".to_owned()]],
            order
        );
        ctx.close().await;
    }

    #[tokio::test]
    async fn order_imports_cycle() {
        let mut modules = HashMap::new();

        let a = kcl!(
            "
import \"b.kcl\"
"
        );
        modules.insert("a.kcl".to_owned(), into_module_info(a));

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), into_module_info(b));

        let ctx = ExecutorContext::new_mock(None).await;
        import_graph(&modules, &ctx).unwrap_err();
        ctx.close().await;
    }
}
