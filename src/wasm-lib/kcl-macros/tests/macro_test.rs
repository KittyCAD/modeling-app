extern crate alloc;
use kcl_lib::ast::types::{
    BodyItem, Expr, Identifier, ItemVisibility, Literal, LiteralValue, Node, Program, VariableDeclaration,
    VariableDeclarator, VariableKind,
};
use kcl_macros::parse;
use pretty_assertions::assert_eq;

#[test]
fn basic() {
    let actual = parse!("const y = 4");
    let expected = Node {
        inner: Program {
            body: vec![BodyItem::VariableDeclaration(Box::new(Node::new(
                VariableDeclaration {
                    declarations: vec![Node::new(
                        VariableDeclarator {
                            id: Node::new(
                                Identifier {
                                    name: "y".to_owned(),
                                    digest: None,
                                },
                                6,
                                7,
                            ),
                            init: Expr::Literal(Box::new(Node::new(
                                Literal {
                                    value: LiteralValue::IInteger(4),
                                    raw: "4".to_owned(),
                                    digest: None,
                                },
                                10,
                                11,
                            ))),
                            digest: None,
                        },
                        6,
                        11,
                    )],
                    visibility: ItemVisibility::Default,
                    kind: VariableKind::Const,
                    digest: None,
                },
                0,
                11,
            )))],
            non_code_meta: Default::default(),
            digest: None,
        },
        start: 0,
        end: 11,
    };
    assert_eq!(expected, actual);
}
