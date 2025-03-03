use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use anyhow::Result;

use crate::{
    parsing::ast::types::{ImportPath, NodeRef, Program},
    walk::{Node, Visitable},
};

/// Specific dependency between two modules. The 0th element of this tuple
/// is the "importing" module, the 1st is the "imported" module. The 0th
/// module *depends on* the 1st module.
type Dependency = (String, String);

type Graph = Vec<Dependency>;

/// Process a number of programs, returning the graph of dependencies.
///
/// This will (currently) return a list of lists of IDs that can be safely
/// run concurrently. Each "stage" is blocking in this model, which will
/// change in the future. Don't use this function widely, yet.
#[allow(clippy::iter_over_hash_type)]
pub fn import_graph(progs: HashMap<String, NodeRef<'_, Program>>) -> Result<Vec<Vec<String>>> {
    let mut graph = Graph::new();

    for (name, program) in progs.iter() {
        graph.extend(
            import_dependencies(program)?
                .into_iter()
                .map(|dependency| (name.clone(), dependency))
                .collect::<Vec<_>>(),
        );
    }

    let all_modules: Vec<&str> = progs.keys().map(|v| v.as_str()).collect();
    topsort(&all_modules, graph)
}

#[allow(clippy::iter_over_hash_type)]
fn topsort(all_modules: &[&str], graph: Graph) -> Result<Vec<Vec<String>>> {
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
            anyhow::bail!("imports are acyclic");
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

pub(crate) fn import_dependencies(prog: NodeRef<'_, Program>) -> Result<Vec<String>> {
    let ret = Arc::new(Mutex::new(vec![]));

    fn walk(ret: Arc<Mutex<Vec<String>>>, node: Node<'_>) {
        if let Node::ImportStatement(is) = node {
            let dependency = match &is.path {
                ImportPath::Kcl { filename } => filename.to_string(),
                ImportPath::Foreign { path } => path.to_string(),
                ImportPath::Std { path } => path.join("::"),
            };

            ret.lock().unwrap().push(dependency);
        }
        for child in node.children().iter() {
            walk(ret.clone(), *child)
        }
    }

    walk(ret.clone(), prog.into());

    let ret = ret.lock().unwrap().clone();
    Ok(ret)
}

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! kcl {
        ( $kcl:expr ) => {{
            $crate::parsing::top_level_parse($kcl).unwrap()
        }};
    }

    #[test]
    fn order_imports() {
        let mut modules = HashMap::new();

        let a = kcl!("");
        modules.insert("a.kcl".to_owned(), &a);

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), &b);

        let order = import_graph(modules).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned()]], order);
    }

    #[test]
    fn order_imports_none() {
        let mut modules = HashMap::new();

        let a = kcl!(
            "
y = 2
"
        );
        modules.insert("a.kcl".to_owned(), &a);

        let b = kcl!(
            "
x = 1
"
        );
        modules.insert("b.kcl".to_owned(), &b);

        let order = import_graph(modules).unwrap();
        assert_eq!(vec![vec!["a.kcl".to_owned(), "b.kcl".to_owned()]], order);
    }

    #[test]
    fn order_imports_2() {
        let mut modules = HashMap::new();

        let a = kcl!("");
        modules.insert("a.kcl".to_owned(), &a);

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), &b);

        let c = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("c.kcl".to_owned(), &c);

        let order = import_graph(modules).unwrap();
        assert_eq!(
            vec![vec!["a.kcl".to_owned()], vec!["b.kcl".to_owned(), "c.kcl".to_owned()]],
            order
        );
    }

    #[test]
    fn order_imports_cycle() {
        let mut modules = HashMap::new();

        let a = kcl!(
            "
import \"b.kcl\"
"
        );
        modules.insert("a.kcl".to_owned(), &a);

        let b = kcl!(
            "
import \"a.kcl\"
"
        );
        modules.insert("b.kcl".to_owned(), &b);

        import_graph(modules).unwrap_err();
    }
}
