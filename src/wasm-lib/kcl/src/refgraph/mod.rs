mod walk;

use crate::{
    parsing::ast::types,
    walk::{Node, Visitable},
};
use std::sync::{Arc, Mutex};

///
type Declaration<'tree> = (Vec<Node<'tree>>, &'tree types::Identifier);

///
type Reference<'tree> = (Vec<Node<'tree>>, &'tree types::Identifier);

///
type RefEdge<'tree> = (Option<Declaration<'tree>>, Reference<'tree>);

// TODO change to a list of all parents of the node instead

///
#[derive(Clone, Debug)]
pub struct Scope<'tree> {
    ///
    pub declarations: Vec<Declaration<'tree>>,

    ///
    pub references: Vec<Reference<'tree>>,

    ///
    pub children: Vec<Scope<'tree>>,
}

impl<'tree> Scope<'tree> {
    pub fn new() -> Self {
        Scope {
            declarations: vec![],
            references: vec![],
            children: vec![],
        }
    }

    pub fn edges(&self) -> Vec<RefEdge> {
        let mut edges = Vec::<RefEdge>::new();
        let mut unmatched_refs = self.references.clone();

        for child in &self.children {
            for (declaration, (ref_node, ref_id)) in child.edges() {
                match declaration {
                    Some((decl_node, decl_id)) => {
                        edges.push((Some((decl_node.clone(), decl_id)), (ref_node.clone(), ref_id)));
                    }
                    None => {
                        unmatched_refs.push((ref_node.clone(), ref_id));
                    }
                }
            }
        }

        for (ref_node, ref_id) in unmatched_refs.into_iter() {
            edges.push((
                self.declarations
                    .iter()
                    .filter(|(_, decl_id)| decl_id.name == ref_id.name)
                    .cloned()
                    .next(),
                (ref_node.clone(), ref_id),
            ));
        }

        edges
    }
}

///
#[derive(Clone, Debug)]
pub struct ScopeVisitor<'tree> {
    scope: Arc<Mutex<Scope<'tree>>>,
}

impl<'tree> ScopeVisitor<'tree> {
    pub fn new() -> Self {
        Self {
            scope: Arc::new(Mutex::new(Scope::new())),
        }
    }
}

impl<'tree> ScopeVisitor<'tree> {
    fn visit(&self, path: Vec<Node<'tree>>, node: Node<'tree>) -> Result<bool, std::convert::Infallible> {
        if let Node::Program(program) = node {
            let csv = ScopeVisitor::new();
            for child in node.children() {
                let mut path = path.clone();
                path.push(node.clone());
                csv.clone().visit(path, child.clone())?;
            }

            self.scope
                .lock()
                .unwrap()
                .children
                .push(csv.scope.lock().unwrap().clone());
            return Ok(true);
        }

        let mut path = path.clone();
        path.push(node.clone());

        match node {
            Node::VariableDeclaration(vd) => {
                self.scope
                    .lock()
                    .unwrap()
                    .declarations
                    .push((vec![node.clone()], &vd.declaration.id));

                let node: Node = (&vd.declaration.init).into();
                self.clone().visit(path, node)?;
            }
            Node::Identifier(id) => {
                self.scope.lock().unwrap().references.push((vec![node.clone()], &id));
            }
            _ => {
                for child in node.children() {
                    self.visit(path.clone(), child.clone())?;
                }
            }
        }

        Ok(true)
    }
}

pub fn extract_refgraph<'a, 'tree>(
    program: types::NodeRef<'tree, types::Program>,
) -> Result<Scope<'tree>, std::convert::Infallible> {
    let sv = ScopeVisitor::new();
    let node: Node = (program).into();

    for child in node.children() {
        sv.clone().visit(vec![node.clone()], child.clone())?;
    }

    let x = sv.scope.lock().unwrap().clone();
    Ok(x)
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
    fn extract_edges() {
        let program = kcl!(
            "
const foo = 1
const bar = foo + 1

fn myfn = () => {
    const foo = 2
    sin(foo)
}
"
        );

        let refgraph = extract_refgraph(&program).unwrap();

        let edges = refgraph.edges().into_iter().collect::<Vec<_>>();
        assert_eq!(edges.len(), 3);

        // sin is a global so we are chilin
        let (decl, (_ref_node, ref_id)) = edges.get(2).unwrap();
        assert_eq!("sin", ref_id.name);
        assert!(decl.is_none());

        // myfn's foo
        let (decl, (_ref_node, ref_id)) = edges.get(1).unwrap();
        assert_eq!("foo", ref_id.name);
        assert!(decl.is_some());
        // todo: check this is actually refering to the parent scope foo

        let (Some((decl_nodes, _)), _) = edges.get(1).unwrap() else {
            panic!("not some");
        };

        assert!(decl_nodes[0].ptr_eq((&program.body[0]).into()));
    }

    #[test]
    fn extract_simple() {
        let program = kcl!(
            "
const foo = 1
const bar = foo + 1

fn myfn = () => {
    const foo = 2
    sin(foo)
}
"
        );

        let refgraph = extract_refgraph(&program).unwrap();

        assert_eq!(3, refgraph.declarations.len());
        assert_eq!(
            &["foo", "bar", "myfn"],
            refgraph
                .declarations
                .iter()
                .map(|(_, id)| id.name.as_str())
                .collect::<Vec<_>>()
                .as_slice()
        );

        assert_eq!(1, refgraph.references.len());
        assert_eq!(
            &["foo"],
            refgraph
                .references
                .iter()
                .map(|(_, id)| id.name.as_str())
                .collect::<Vec<_>>()
                .as_slice()
        );

        assert_eq!(1, refgraph.children.len());
        let myfn = refgraph.children.first().unwrap();

        assert_eq!(myfn.declarations.len(), 1);
        assert_eq!(
            &["foo"],
            myfn.declarations
                .iter()
                .map(|(_, id)| id.name.as_str())
                .collect::<Vec<_>>()
                .as_slice()
        );

        assert_eq!(myfn.references.len(), 2);
        assert_eq!(
            &["sin", "foo"],
            myfn.references
                .iter()
                .map(|(_, id)| id.name.as_str())
                .collect::<Vec<_>>()
                .as_slice()
        );
    }
}
