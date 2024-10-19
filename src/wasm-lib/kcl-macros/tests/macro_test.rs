extern crate alloc;
use kcl_lib::ast::types::{
    BodyItem, Expr, Identifier, ItemVisibility, Literal, LiteralValue, NonCodeMeta, Program, VariableDeclaration,
    VariableDeclarator, VariableKind,
};
use kcl_macros::parse;
use pretty_assertions::assert_eq;

#[test]
fn basic() {
    let actual = parse!("const y = 4");
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
                    digest: None,
                },
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
            digest: None,
        })],
        non_code_meta: NonCodeMeta::default(),
        digest: None,
    };
    assert_eq!(expected, actual);
}
