use anyhow::Result;

use super::ast_walk_new::{AstVisitor, WalkableAst};
use crate::{
    parsing::ast::types::{
        BinaryPart, BodyItem, Expr, IfExpression, LiteralIdentifier, MemberExpression, MemberObject, NodeRef,
        ObjectExpression, ObjectProperty, Parameter, Program, UnaryExpression, VariableDeclarator,
    },
    walk::Node,
};

/// Old walk trait
#[deprecated]
pub trait Walker<'a> {
    /// Walk will visit every element of the AST.
    fn walk(&self, n: Node<'a>) -> Result<bool>;
}

impl<'a, FnT> Walker<'a> for FnT
where
    FnT: Fn(Node<'a>) -> Result<bool>,
{
    fn walk(&self, n: Node<'a>) -> Result<bool> {
        self(n)
    }
}

impl<'tree, WalkerT> AstVisitor<'tree> for WalkerT
where
    WalkerT: Walker<'tree>,
{
    type Error = anyhow::Error;

    fn visit(&self, n: Node<'tree>, children: &[Node<'tree>]) -> Result<bool> {
        if !Walker::walk(self, n)? {
            return Ok(false);
        }
        for child in children {
            if !Walker::walk(self, child.clone())? {
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
    WalkableAst::visit(&prog, f)
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
    fn stop_walking() {
        let program = kcl!(
            "
const foo = 1
const bar = 2
"
        );

        walk(&program, &|node| {
            if let Node::VariableDeclarator(vd) = node {
                if vd.id.name == "foo" {
                    return Ok(false);
                }
                panic!("walk didn't stop");
            }
            Ok(true)
        })
        .unwrap();
    }
}
