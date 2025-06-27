use anyhow::Result;

use crate::walk::Node;

/// Walk-specific trait adding the ability to traverse the KCL AST.
///
/// This trait is implemented on [Node] to handle the fairly tricky bit of
/// recursing into the AST in a single place, as well as helpers for traversing
/// the tree. for callers to use.
pub trait Visitable<'tree> {
    /// Return a `Vec<Node>` for all *direct* children of this AST node. This
    /// should only contain direct descendants.
    fn children(&self) -> Vec<Node<'tree>>;

    /// Return `self` as a [Node]. Generally speaking, the [Visitable] trait
    /// is only going to be implemented on [Node], so this is purely used by
    /// helpers that are generic over a [Visitable] and want to deref back
    /// into a [Node].
    fn node(&self) -> Node<'tree>;

    /// Call the provided [Visitor] in order to Visit `self`. This will
    /// only be called on `self` -- the [Visitor] is responsible for
    /// recursing into any children, if desired.
    fn visit<VisitorT>(&self, visitor: VisitorT) -> Result<bool, VisitorT::Error>
    where
        VisitorT: Visitor<'tree>,
    {
        visitor.visit_node(self.node())
    }
}

/// Trait used to enable visiting members of KCL AST.
///
/// Implementing this trait enables the implementer to be invoked over
/// members of KCL AST by using the [Visitable::visit] function on
/// a [Node].
pub trait Visitor<'tree> {
    /// Error type returned by the [Self::visit] function.
    type Error;

    /// Visit a KCL AST [Node].
    ///
    /// In general, implementers likely wish to check to see if a Node is what
    /// they're looking for, and either descend into that [Node]'s children (by
    /// calling [Visitable::children] on [Node] to get children nodes,
    /// calling [Visitable::visit] on each node of interest), or perform
    /// some action.
    fn visit_node(&self, node: Node<'tree>) -> Result<bool, Self::Error>;
}

impl<'a, FnT, ErrorT> Visitor<'a> for FnT
where
    FnT: Fn(Node<'a>) -> Result<bool, ErrorT>,
{
    type Error = ErrorT;

    fn visit_node(&self, n: Node<'a>) -> Result<bool, ErrorT> {
        self(n)
    }
}

impl<'tree> Visitable<'tree> for Node<'tree> {
    fn node(&self) -> Node<'tree> {
        *self
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
            Node::CallExpressionKw(n) => {
                let mut children: Vec<Node<'_>> =
                    Vec::with_capacity(1 + if n.unlabeled.is_some() { 1 } else { 0 } + n.arguments.len());
                children.push((&n.callee).into());
                children.extend(n.unlabeled.iter().map(Node::from));

                // TODO: this is wrong but it's what the old walk code was doing.
                // We likely need a real LabeledArg AST node, but I don't
                // want to tango with it since it's a lot deeper than
                // adding it to the enum.
                children.extend(n.arguments.iter().map(|v| Node::from(&v.arg)));
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
                children.insert(0, n.cond.as_ref().into());
                children.push(n.final_else.as_ref().into());
                children
            }
            Node::VariableDeclaration(n) => vec![(&n.declaration).into()],
            Node::TypeDeclaration(n) => vec![(&n.name).into()],
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
            Node::LabelledExpression(e) => {
                vec![(&e.expr).into(), (&e.label).into()]
            }
            Node::AscribedExpression(e) => {
                vec![(&e.expr).into()]
            }
            Node::Name(n) => Some((&n.name).into())
                .into_iter()
                .chain(n.path.iter().map(|n| n.into()))
                .collect(),
            Node::PipeSubstitution(_)
            | Node::TagDeclarator(_)
            | Node::Identifier(_)
            | Node::ImportStatement(_)
            | Node::KclNone(_)
            | Node::Literal(_) => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;

    macro_rules! kcl {
        ( $kcl:expr_2021 ) => {{ $crate::parsing::top_level_parse($kcl).unwrap() }};
    }

    #[test]
    fn count_crows() {
        let program = kcl!(
            "\
const crow1 = 1
const crow2 = 2

fn crow3() {
    const crow4 = 3
    crow5()
}
"
        );

        #[derive(Debug, Default)]
        struct CountCrows {
            n: Box<Mutex<usize>>,
        }

        impl<'tree> Visitor<'tree> for &CountCrows {
            type Error = ();

            fn visit_node(&self, node: Node<'tree>) -> Result<bool, Self::Error> {
                if let Node::VariableDeclarator(vd) = node {
                    if vd.id.name.starts_with("crow") {
                        *self.n.lock().unwrap() += 1;
                    }
                }

                for child in node.children().iter() {
                    if !child.visit(*self)? {
                        return Ok(false);
                    }
                }

                Ok(true)
            }
        }

        let prog: Node = (&program).into();
        let count_crows: CountCrows = Default::default();
        Visitable::visit(&prog, &count_crows).unwrap();
        assert_eq!(*count_crows.n.lock().unwrap(), 4);
    }
}
