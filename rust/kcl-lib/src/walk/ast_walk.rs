use anyhow::Result;

use super::ast_visitor::{Visitable, Visitor};
use crate::{
    parsing::ast::types::{NodeRef, Program},
    walk::Node,
};

/// *DEPRECATED* Walk trait.
///
/// This was written before [Visitor], which is the better way to traverse
/// a AST.
///
/// This trait continues to exist in order to not change all the linter
/// as we refine the walk code.
///
/// This, internally, uses the new [Visitor] trait, and is only provided as
/// a stub until we migrate all existing code off this trait.
pub trait Walker<'a> {
    /// Walk will visit every element of the AST, recursing through the
    /// whole tree.
    fn walk(&self, n: Node<'a>) -> Result<bool>;
}

impl<'tree, VisitorT> Walker<'tree> for VisitorT
where
    VisitorT: Visitor<'tree>,
    VisitorT: Clone,
    anyhow::Error: From<VisitorT::Error>,
    VisitorT::Error: Send,
    VisitorT::Error: Sync,
{
    fn walk(&self, n: Node<'tree>) -> Result<bool> {
        if !n.visit(self.clone())? {
            return Ok(false);
        }
        for child in n.children() {
            if !Self::walk(self, child)? {
                return Ok(false);
            }
        }
        Ok(true)
    }
}

/// Run the Walker against all [Node]s in a [Program].
pub fn walk<'a, WalkT>(prog: NodeRef<'a, Program>, f: WalkT) -> Result<bool>
where
    WalkT: Walker<'a>,
{
    let prog: Node = prog.into();
    f.walk(prog)
}

#[cfg(test)]
mod tests {
    use super::*;

    macro_rules! kcl {
        ( $kcl:expr_2021 ) => {{ $crate::parsing::top_level_parse($kcl).unwrap() }};
    }

    #[test]
    fn stop_walking() {
        let program = kcl!(
            "
const foo = 1
const bar = 2
"
        );

        walk(&program, |node| {
            if let Node::VariableDeclarator(vd) = node {
                if vd.id.name == "foo" {
                    return Ok::<bool, anyhow::Error>(false);
                }
                panic!("walk didn't stop");
            }
            Ok(true)
        })
        .unwrap();
    }
}
