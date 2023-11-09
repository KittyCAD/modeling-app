extern crate alloc;
use kcl_compile_macro::parse_kcl;
use kcl_lib::ast::types::{
    BodyItem, Identifier, Literal, LiteralValue, NonCodeMeta, Program, Value, VariableDeclaration, VariableDeclarator,
    VariableKind,
};
use pretty_assertions::assert_eq;

#[test]
fn basic() {
    let actual = parse_kcl!("const y = 4");
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
                },
                init: Value::Literal(Box::new(Literal {
                    start: 10,
                    end: 11,
                    value: LiteralValue::IInteger(4),
                    raw: "4".to_owned(),
                })),
            }],
            kind: VariableKind::Const,
        })],
        non_code_meta: NonCodeMeta::default(),
    };
    assert_eq!(expected, actual);
}
