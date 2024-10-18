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
<<<<<<< HEAD
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
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
    let expected = Program {
        start: 0,
        end: 11,
        body: vec![BodyItem::VariableDeclaration(VariableDeclaration {
            start: 0,
            end: 11,
            declarations: vec![VariableDeclarator {
                start: 6,
                end: 11,
                id: Identifier {
                    start: 6,
                    end: 7,
                    name: "y".to_owned(),
=======
    let expected = Program {
        start: 0,
        end: 11,
        body: vec![BodyItem::VariableDeclaration(VariableDeclaration {
            r#type: Default::default(),
            start: 0,
            end: 11,
            declarations: vec![VariableDeclarator {
                start: 6,
                end: 11,
                id: Identifier {
                    r#type: Default::default(),
                    start: 6,
                    end: 7,
                    name: "y".to_owned(),
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)
                    digest: None,
                },
<<<<<<< HEAD
                0,
                11,
            )))],
            non_code_meta: Default::default(),
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
                init: Expr::Literal(Box::new(Literal {
                    start: 10,
                    end: 11,
                    value: LiteralValue::IInteger(4),
                    raw: "4".to_owned(),
                    digest: None,
                })),
                digest: None,
            }],
            visibility: ItemVisibility::Default,
            kind: VariableKind::Const,
=======
                init: Expr::Literal(Box::new(Literal {
                    r#type: Default::default(),
                    start: 10,
                    end: 11,
                    value: LiteralValue::IInteger(4),
                    raw: "4".to_owned(),
                    digest: None,
                })),
                digest: None,
            }],
            visibility: ItemVisibility::Default,
            kind: VariableKind::Const,
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)
            digest: None,
        },
        start: 0,
        end: 11,
    };
    assert_eq!(expected, actual);
}
