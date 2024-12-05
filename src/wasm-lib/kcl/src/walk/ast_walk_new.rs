use anyhow::Result;

use crate::{
    // parsing::ast::types::{
    //     BinaryPart, BodyItem, Expr, IfExpression, LiteralIdentifier, MemberExpression, MemberObject, NodeRef,
    //     ObjectExpression, ObjectProperty, Parameter, Program, UnaryExpression, VariableDeclarator,
    // },
    walk::Node,
};

/// Implemented on [Node] to handle recursing into the AST, as well as helpers
/// for traversing the tree.
trait WalkableAst<'tree> {
    fn children(&self) -> Vec<Node<'tree>>;
    fn node(&self) -> Node<'tree>;

    fn visit<VisitorT>(&self, visitor: VisitorT) -> Result<bool, VisitorT::Error>
    where
        VisitorT: AstVisitor<'tree>,
    {
        let children = self.children();
        visitor.visit(self.node(), &children)
    }
}

/// Function to be called on AST.
trait AstVisitor<'tree> {
    type Error;

    /// Return true to stop walking nodes.
    fn visit(&self, node: Node<'tree>, children: &[Node<'tree>]) -> Result<bool, Self::Error>;
}

impl<'tree> WalkableAst<'tree> for Node<'tree> {
    fn node(&self) -> Node<'tree> {
        self.clone()
    }

    fn children(&self) -> Vec<Node<'tree>> {
        match self {
            Node::Program(n) => n.body.iter().map(|node| node.into()).collect(),
            Node::ExpressionStatement(n) => {
                vec![(&n.expression).into()]
            }
            Node::BinaryExpression(n) => {
                vec![(&n.left).into(), (&n.right).into()]
            }
            Node::FunctionExpression(n) => {
                let mut children = n.params.iter().map(|v| v.into()).collect::<Vec<Node>>();
                children.push((&n.body).into());
                children
            }
            Node::CallExpression(n) => {
                let mut children = n.arguments.iter().map(|v| v.into()).collect::<Vec<Node>>();
                children.insert(0, (&n.callee).into());
                children
            }
            Node::CallExpressionKw(n) => {
                let mut children = n.unlabeled.iter().map(|v| v.into()).collect::<Vec<Node>>();

                // TODO: this is wrong but it's what the old walk code was doing.
                // We likely need a real LabeledArg AST node, but I don't
                // want to tango with it since it's a lot deeper than
                // adding it to the enum.
                children.extend(n.arguments.iter().map(|v| (&v.arg).into()).collect::<Vec<Node>>());
                children
            }
            Node::PipeExpression(n) => n.body.iter().map(|v| v.into()).collect(),
            Node::ArrayExpression(n) => n.elements.iter().map(|v| v.into()).collect(),
            Node::ArrayRangeExpression(n) => {
                vec![(&n.start_element).into(), (&n.end_element).into()]
            }
            Node::ObjectExpression(n) => n.properties.iter().map(|v| v.into()).collect(),
            Node::MemberExpression(n) => {
                vec![(&n.object).into(), (&n.property).into()]
            }
            Node::IfExpression(n) => {
                let mut children = n.else_ifs.iter().map(|v| v.into()).collect::<Vec<Node>>();
                children.insert(0, (&n.cond).as_ref().into());
                children.push((&n.final_else).as_ref().into());
                children
            }
            Node::VariableDeclaration(n) => n.declarations.iter().map(|v| v.into()).collect(),
            Node::ReturnStatement(n) => {
                vec![(&n.argument).into()]
            }
            Node::VariableDeclarator(n) => {
                vec![(&n.id).into(), (&n.init).into()]
            }
            Node::UnaryExpression(n) => {
                vec![(&n.argument).into()]
            }
            Node::Parameter(n) => {
                vec![(&n.identifier).into()]
            }
            Node::ObjectProperty(n) => {
                vec![(&n.value).into()]
            }
            Node::ElseIf(n) => {
                vec![(&n.cond).into(), n.then_val.as_ref().into()]
            }
            Node::PipeSubstitution(_)
            | Node::TagDeclarator(_)
            | Node::Identifier(_)
            | Node::ImportStatement(_)
            | Node::MemberObject(_)
            | Node::LiteralIdentifier(_)
            | Node::KclNone(_)
            | Node::Literal(_) => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    macro_rules! kcl {
        ( $kcl:expr ) => {{
            $crate::parsing::top_level_parse($kcl).unwrap()
        }};
    }

    #[test]
    fn count_crows() {
        let program = kcl!(
            "\
const crow1 = 1
const crow2 = 2
"
        );

        #[derive(Debug, Default)]
        struct CountCrows {
            n: Box<Mutex<usize>>,
        }

        impl<'tree> AstVisitor<'tree> for &CountCrows {
            type Error = ();

            fn visit(&self, node: Node<'tree>, children: &[Node<'tree>]) -> Result<bool, Self::Error> {
                if let Node::VariableDeclarator(vd) = node {
                    if vd.id.name.starts_with("crow") {
                        *self.n.lock().unwrap() += 1;
                    }
                }

                for child in children.iter() {
                    if !child.visit(*self)? {
                        return Ok(false);
                    }
                }

                Ok(true)
            }
        }

        let prog: Node = (&program).into();
        let count_crows: CountCrows = Default::default();
        prog.visit(&count_crows).unwrap();
        assert_eq!(*count_crows.n.lock().unwrap(), 2);
    }
}
