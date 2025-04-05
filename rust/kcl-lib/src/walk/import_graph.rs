use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::Result;

use crate::{
    errors::KclErrorDetails,
    modules::{ModulePath, ModuleRepr},
    parsing::ast::types::{ImportPath, ImportStatement, Node as AstNode, NodeRef, Program},
    walk::{Node, Visitable},
    ExecState, ExecutorContext, KclError, ModuleId,
};

/// Specific dependency between two modules. The 0th element of this info
/// is the "importing" module, the 1st is the "imported" module. The 0th
/// module *depends on* the 1st module.
type Dependency = (String, String);

type Graph = Vec<Dependency>;

type DependencyInfo = (AstNode<ImportStatement>, ModuleId, ModulePath, AstNode<Program>);
type Universe = HashMap<String, DependencyInfo>;

/// Process a number of programs, returning the graph of dependencies.
///
/// This will (currently) return a list of lists of IDs that can be safely
/// run concurrently. Each "stage" is blocking in this model, which will
/// change in the future. Don't use this function widely, yet.
#[allow(clippy::iter_over_hash_type)]
pub fn import_graph(progs: &Universe, ctx: &ExecutorContext) -> Result<Vec<Vec<String>>, KclError> {
    let mut graph = Graph::new();

    for (name, (_, _, _, program)) in progs.iter() {
        graph.extend(
            import_dependencies(program, ctx)?
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
            for (_, waiting_for) in dep_map.iter_mut() {
                waiting_for.retain(|v| v != stage_module);
            }
        }

        if stage_modules.is_empty() {
            return Err(KclError::Internal(KclErrorDetails {
                message: "Circular import detected".to_string(),
                source_ranges: Default::default(),
            }));
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

pub(crate) fn import_dependencies(
    prog: NodeRef<Program>,
    ctx: &ExecutorContext,
) -> Result<ImportDependencies, KclError> {
    let ret = Arc::new(Mutex::new(vec![]));

    fn walk(ret: Arc<Mutex<ImportDependencies>>, node: Node<'_>, ctx: &ExecutorContext) -> Result<(), KclError> {
        if let Node::ImportStatement(is) = node {
            // We only care about Kcl imports for now.
            if let ImportPath::Kcl { filename } = &is.path {
                let resolved_path = ModulePath::from_import_path(&is.path, &ctx.settings.project_directory);

                // We need to lock the mutex to push the dependency.
                // This is a bit of a hack, but it works for now.
                ret.lock()
                    .map_err(|err| {
                        KclError::Internal(KclErrorDetails {
                            message: format!("Failed to lock mutex: {}", err),
                            source_ranges: Default::default(),
                        })
                    })?
                    .push((filename.to_string(), is.clone(), resolved_path));
            }
        }

        for child in node.children().iter() {
            walk(ret.clone(), *child, ctx)?;
        }

        Ok(())
    }

    walk(ret.clone(), prog.into(), ctx)?;

    let ret = ret.lock().map_err(|err| {
        KclError::Internal(KclErrorDetails {
            message: format!("Failed to lock mutex: {}", err),
            source_ranges: Default::default(),
        })
    })?;

    Ok(ret.clone())
}

pub(crate) async fn import_universe(
    ctx: &ExecutorContext,
    prog: NodeRef<'_, Program>,
    out: &mut Universe,
    exec_state: &mut ExecState,
) -> Result<(), KclError> {
    let modules = import_dependencies(prog, ctx)?;
    for (filename, import_stmt, module_path) in modules {
        if out.contains_key(&filename) {
            continue;
        }

        let module_id = ctx
            .open_module(&import_stmt.path, &[], exec_state, Default::default())
            .await?;

        let program = {
            let Some(module_info) = exec_state.get_module(module_id) else {
                return Err(KclError::Internal(KclErrorDetails {
                    message: format!("Module {} not found", module_id),
                    source_ranges: Default::default(),
                }));
            };
            let ModuleRepr::Kcl(program, _) = &module_info.repr else {
                return Err(KclError::Internal(KclErrorDetails {
                    message: format!("Module {} is not a KCL module", module_id),
                    source_ranges: Default::default(),
                }));
            };
            program.clone()
        };

        out.insert(
            filename.clone(),
            (import_stmt.clone(), module_id, module_path.clone(), program.clone()),
        );
        Box::pin(import_universe(ctx, &program, out, exec_state)).await?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsing::ast::types::ImportSelector;

    macro_rules! kcl {
        ( $kcl:expr ) => {{
            $crate::parsing::top_level_parse($kcl).unwrap()
        }};
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
            ModulePath::Local { value: "".into() },
            program,
        )
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

        let ctx = ExecutorContext::new_mock().await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned()]], order);
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

        let ctx = ExecutorContext::new_mock().await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned(), "b.kcl".to_owned()]], order);
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

        let ctx = ExecutorContext::new_mock().await;
        let order = import_graph(&modules, &ctx).unwrap();
        assert_eq!(
            vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned(), "c.kcl".to_owned()]],
            order
        );
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

        let ctx = ExecutorContext::new_mock().await;
        import_graph(&modules, &ctx).unwrap_err();
    }
}
