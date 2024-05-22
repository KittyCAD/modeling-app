use std::{collections::HashMap, env};

use ep::{constants, instruction::SourceRange, sketch_types, Destination, UnaryArithmetic};
use ept::{ListHeader, ObjectHeader, Primitive};
use kittycad_modeling_cmds::shared::Point2d;
use kittycad_modeling_session::SessionBuilder;
use pretty_assertions::assert_eq;

use super::*;

fn must_plan(program: &str) -> (Vec<Instruction>, BindingScope, Address) {
    let tokens = kcl_lib::token::lexer(program).unwrap();
    let parser = kcl_lib::parser::Parser::new(tokens);
    let ast = parser.ast().unwrap();
    let mut p = Planner::new();
    let (instrs, _) = p.build_plan(ast).unwrap();
    (instrs, p.binding_scope, p.next_addr)
}

fn should_not_compile(program: &str) -> CompileError {
    let tokens = kcl_lib::token::lexer(program).unwrap();
    let parser = kcl_lib::parser::Parser::new(tokens);
    let ast = parser.ast().unwrap();
    let mut p = Planner::new();
    p.build_plan(ast).unwrap_err()
}

#[test]
fn assignments() {
    let program = "
        let x = 1
        let y = 2";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: 1i64.into(),
                },
                SourceRange([17, 18])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO.offset(1),
                    value: 2i64.into(),
                },
                SourceRange([35, 36]),
            ),
        ]
    );
}

#[test]
fn bind_array_simple() {
    let program = r#"let x = [44, 55, "sixty-six"]"#;
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            // Array length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: ListHeader {
                        // The list has 3 elements
                        count: 3,
                        // The 3 elements each take 2 primitives (one for length, one for value),
                        // so 6 in total.
                        size: 6
                    }
                    .into()
                },
                SourceRange([8, 29])
            ),
            // Elem 0
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 1usize.into()
                },
                SourceRange([8, 29])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 2,
                    value: 44i64.into(),
                },
                SourceRange([9, 11])
            ),
            // Elem 1
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 3,
                    value: 1usize.into()
                },
                SourceRange([8, 29])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 4,
                    value: 55i64.into(),
                },
                SourceRange([13, 15])
            ),
            // Elem 2
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 5,
                    value: 1usize.into()
                },
                SourceRange([8, 29])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 6,
                    value: "sixty-six".to_owned().into(),
                },
                SourceRange([17, 28])
            ),
        ]
    );
}

#[test]
fn bind_nested_array() {
    let program = r#"let x = [44, [55, "sixty-six"]]"#;
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            // Outer array length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: ListHeader {
                        count: 2,
                        // 2 for each of the 3 elements, plus 1 for the inner array header.
                        size: 2 + 2 + 2 + 1,
                    }
                    .into(),
                },
                SourceRange([8, 31])
            ),
            // Outer array element 0 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 1usize.into(),
                },
                SourceRange([8, 31])
            ),
            // Outer array element 0 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 2,
                    value: 44i64.into(),
                },
                SourceRange([9, 11])
            ),
            // Outer array element 1 length (i.e. inner array header)
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 3,
                    value: ListHeader { count: 2, size: 4 }.into(),
                },
                SourceRange([13, 30])
            ),
            // Inner array elem0 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 4,
                    value: 1usize.into(),
                },
                SourceRange([13, 30])
            ),
            // Inner array elem0 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 5,
                    value: 55i64.into(),
                },
                SourceRange([14, 16])
            ),
            // Inner array elem1 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 6,
                    value: 1usize.into(),
                },
                SourceRange([13, 30])
            ),
            // Inner array elem1 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 7,
                    value: "sixty-six".to_owned().into(),
                },
                SourceRange([18, 29])
            ),
        ]
    );
}

#[test]
fn bind_arrays_with_objects_elements() {
    let program = r#"let x = [44, {a: 55, b: "sixty-six"}]"#;
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            // List header
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: ListHeader { count: 2, size: 7 }.into()
                },
                SourceRange([8, 37])
            ),
            // Array contents
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 1usize.into(),
                },
                SourceRange([8, 37])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 2,
                    value: 44i64.into(),
                },
                SourceRange([9, 11])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 3,
                    value: ObjectHeader {
                        size: 4,
                        properties: vec!["a".to_owned(), "b".to_owned(),]
                    }
                    .into(),
                },
                SourceRange([13, 36])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 4,
                    value: 1usize.into(),
                },
                SourceRange([13, 36])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 5,
                    value: 55i64.into()
                },
                SourceRange([17, 19])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 6,
                    value: 1usize.into(),
                },
                SourceRange([13, 36])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 7,
                    value: "sixty-six".to_owned().into()
                },
                SourceRange([24, 35])
            ),
        ]
    );
}

#[test]
fn statement_after_return() {
    let program = "fn f = () => {
        return 1
        let x = 2
    }
    f()";
    let err = should_not_compile(program);
    assert_eq!(err, CompileError::MultipleReturns);
}

#[test]
fn name_not_found() {
    // Users can't assign `y` to anything because `y` is undefined.
    let err = should_not_compile("let x = y");
    assert_eq!(err, CompileError::Undefined { name: "y".to_owned() });
}

#[test]
fn assign_bool() {
    // Check that Grackle properly compiles KCL bools to EP bools.
    for (str, val) in [("true", true), ("false", false)] {
        let program = format!("let x = {str}");
        let (plan, scope, _) = must_plan(&program);
        assert_eq!(
            plan,
            vec![Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: val.into(),
                },
                SourceRange([8, 8 + str.len()])
            )]
        );
        assert_eq!(scope.get("x"), Some(&EpBinding::Single(Address::ZERO)));
    }
}

#[test]
fn aliases() {
    let program = "
        let x = 1
        let y = x";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 1i64.into(),
            },
            SourceRange([17, 18])
        )]
    );
}

#[test]
fn use_native_function_add() {
    let program = "let x = add(1,2)";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: 1i64.into()
                },
                SourceRange([12, 13])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO.offset(1),
                    value: 2i64.into()
                },
                SourceRange([14, 15])
            ),
            Instruction::from(InstructionKind::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(Address::ZERO),
                    operand1: ep::Operand::Reference(Address::ZERO.offset(1))
                },
                destination: Destination::Address(Address::ZERO.offset(2)),
            },),
        ]
    );
}

#[test]
fn use_native_function_id() {
    let program = "let x = id(2)";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 2i64.into()
            },
            SourceRange([11, 12])
        )]
    );
}

#[tokio::test]
async fn computed_object_property() {
    let program = r#"
    let obj = {a: true, b: false}
    let prop0 = "a"
    let val = obj[prop0] // should be `true`
    "#;
    let (_plan, scope, _) = must_plan(program);
    let Some(EpBinding::Single(address_of_val)) = scope.get("val") else {
        panic!("Unexpected binding for variable 'val': {:?}", scope.get("val"));
    };
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    // Should be 'true', based on the above KCL program.
    assert_eq!(mem.get(address_of_val).unwrap(), &ept::Primitive::Bool(true));
}

#[tokio::test]
async fn computed_array_in_object() {
    let program = r#"
    let complicated = {a: [{b: true}]}
    let i = 0
    let prop0 = "a"
    let prop1 = "b"
    let val = complicated[prop0][i][prop1] // should be `true`
    "#;
    let (_plan, scope, _) = must_plan(program);
    let Some(EpBinding::Single(address_of_val)) = scope.get("val") else {
        panic!("Unexpected binding for variable 'val': {:?}", scope.get("val"));
    };
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    // Should be 'true', based on the above KCL program.
    assert_eq!(mem.get(address_of_val).unwrap(), &ept::Primitive::Bool(true));
}

#[tokio::test]
async fn computed_object_in_array() {
    let program = r#"
    let complicated = [{a: {b: true}}]
    let i = 0
    let prop0 = "a"
    let prop1 = "b"
    let val = complicated[i][prop0][prop1] // should be `true`
    "#;
    let (_plan, scope, _) = must_plan(program);
    let Some(EpBinding::Single(address_of_val)) = scope.get("val") else {
        panic!("Unexpected binding for variable 'val': {:?}", scope.get("val"));
    };
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    // Should be 'true', based on the above KCL program.
    assert_eq!(mem.get(address_of_val).unwrap(), &ept::Primitive::Bool(true));
}

#[tokio::test]
async fn computed_nested_object_property() {
    let program = r#"
    let obj = {a: {b: true}}
    let prop0 = "a"
    let prop1 = "b"
    let val = obj[prop0][prop1] // should be `true`
    "#;
    let (_plan, scope, _) = must_plan(program);
    let Some(EpBinding::Single(address_of_val)) = scope.get("val") else {
        panic!("Unexpected binding for variable 'val': {:?}", scope.get("val"));
    };
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    // Should be 'true', based on the above KCL program.
    assert_eq!(mem.get(address_of_val).unwrap(), &ept::Primitive::Bool(true));
}

#[tokio::test]
async fn computed_array_index() {
    let program = r#"
    let array = ["a", "b", "c"]
    let index = 1+1 // should be "c"
    let prop = array[index]
    "#;
    let (plan, scope, _) = must_plan(program);
    let expected_address_of_prop = Address::ZERO + 10;
    if let Some(EpBinding::Single(addr)) = scope.get("prop") {
        assert_eq!(*addr, expected_address_of_prop);
    } else {
        panic!("expected 'prop' bound to 0 but it was {:?}", scope.get("prop"));
    }
    assert_eq!(
        plan,
        vec![
            // Setting the array
            // First, the length of the array (number of elements).
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: ListHeader { count: 3, size: 6 }.into()
                },
                SourceRange([17, 32])
            ),
            // Elem 0 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 1usize.into()
                },
                SourceRange([17, 32])
            ),
            // Elem 0 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 2,
                    value: "a".to_owned().into()
                },
                SourceRange([18, 21])
            ),
            // Elem 1 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 3,
                    value: 1usize.into()
                },
                SourceRange([17, 32])
            ),
            // Elem 1 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 4,
                    value: "b".to_owned().into()
                },
                SourceRange([23, 26])
            ),
            // Elem 2 length
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 5,
                    value: 1usize.into()
                },
                SourceRange([17, 32])
            ),
            // Elem 2 value
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 6,
                    value: "c".to_owned().into()
                },
                SourceRange([28, 31])
            ),
            // Calculate the index (1+1)
            // First, the left operand
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 7,
                    value: 1i64.to_owned().into()
                },
                SourceRange([49, 50])
            ),
            // Then the right operand
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO + 8,
                    value: 1i64.to_owned().into()
                },
                SourceRange([51, 52])
            ),
            // Then index, which is left operand + right operand
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Add,
                        operand0: ep::Operand::Reference(Address::ZERO + 7),
                        operand1: ep::Operand::Reference(Address::ZERO + 8)
                    },
                    destination: Destination::Address(Address::ZERO + 9)
                },
                SourceRange([49, 52])
            ),
            // Get the element at the index
            Instruction::from_range(
                InstructionKind::AddrOfMember {
                    start: ep::Operand::Literal(Address::ZERO.into()),
                    member: ep::Operand::Reference(Address::ZERO + 9)
                },
                SourceRange([91, 96])
            ),
            // Write it to the next free address.
            Instruction::from_range(
                InstructionKind::CopyLen {
                    source_range: ep::Operand::StackPop,
                    destination_range: ep::Operand::Literal(expected_address_of_prop.into()),
                },
                SourceRange([85, 97])
            ),
        ]
    );
    // Now let's run the program and check what's actually in the memory afterwards.
    let tokens = kcl_lib::token::lexer(program).unwrap();
    let parser = kcl_lib::parser::Parser::new(tokens);
    let ast = parser.ast().unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    // Should be "b", as pointed out in the KCL program's comment.
    assert_eq!(
        mem.get(&expected_address_of_prop).unwrap(),
        &ept::Primitive::String("c".to_owned())
    );
}

#[test]
fn member_expressions_object() {
    let program = r#"
    let obj = {x: 1, y: 2}
    let prop = obj["y"]
    "#;
    let (_plan, scope, _) = must_plan(program);
    match scope.get("prop").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 4);
        }
        other => {
            panic!("expected 'prop' bound to 0x0 but it was bound to {other:?}");
        }
    }
}

#[test]
fn member_expressions_array() {
    let program = r#"
    let array = [["a", "b"],["c", "d"]]
    let first = array[0][0]
    let last = array[1][1]
    "#;
    /*
    Memory layout:
    Header(2, 10) // outer array
    Header(2, 4) // first inner array
    1
    a
    1
    b
    Header(2,4) // second inner array
    1
    c
    1
    d
     */
    let (_plan, scope, _) = must_plan(program);
    match scope.get("first").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 3);
        }
        other => {
            panic!("expected 'number' bound to addr 3 but it was bound to {other:?}");
        }
    }
    match scope.get("last").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 10);
        }
        other => {
            panic!("expected 'number' bound to addr 10 but it was bound to {other:?}");
        }
    }
}

#[test]
fn compile_flipped_sign() {
    let program = "let x = 3
    let y = -x";
    let (plan, _scope, _) = must_plan(program);
    let expected = vec![
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 3i64.into(),
            },
            SourceRange([8, 9]),
        ),
        Instruction::from_range(
            InstructionKind::UnaryArithmetic {
                arithmetic: UnaryArithmetic {
                    operation: ep::UnaryOperation::Neg,
                    operand: ep::Operand::Reference(Address::ZERO),
                },
                destination: Destination::Address(Address::ZERO + 1),
            },
            SourceRange([22, 24]),
        ),
    ];
    assert_eq!(plan, expected);
}

#[test]
fn add_literals() {
    let program = "let x = 1 + 2";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO,
                    value: 1i64.into()
                },
                SourceRange([8, 9])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: Address::ZERO.offset(1),
                    value: 2i64.into()
                },
                SourceRange([12, 13])
            ),
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Add,
                        operand0: ep::Operand::Reference(Address::ZERO),
                        operand1: ep::Operand::Reference(Address::ZERO.offset(1)),
                    },
                    destination: Destination::Address(Address::ZERO.offset(2)),
                },
                SourceRange([8, 13])
            ),
        ]
    );
}

#[test]
fn add_vars() {
    let program = "
        let one = 1
        let two = 2
        let x = one + two";
    let (plan, _bindings, _) = must_plan(program);
    let addr0 = Address::ZERO;
    let addr1 = Address::ZERO.offset(1);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr0,
                    value: 1i64.into(),
                },
                SourceRange([19, 20])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr1,
                    value: 2i64.into(),
                },
                SourceRange([39, 40])
            ),
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Add,
                        operand0: ep::Operand::Reference(addr0),
                        operand1: ep::Operand::Reference(addr1),
                    },
                    destination: Destination::Address(Address::ZERO.offset(2)),
                },
                SourceRange([57, 66])
            ),
        ]
    );
}

#[test]
fn composite_binary_exprs() {
    let program = "
        let x = 1
        let y = 2
        let z = 3
        let six = x + y + z
        ";
    let (plan, _bindings, _) = must_plan(program);
    let addr0 = Address::ZERO;
    let addr1 = Address::ZERO.offset(1);
    let addr2 = Address::ZERO.offset(2);
    let addr3 = Address::ZERO.offset(3);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr0,
                    value: 1i64.into(),
                },
                SourceRange([17, 18])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr1,
                    value: 2i64.into(),
                },
                SourceRange([35, 36]),
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr2,
                    value: 3i64.into(),
                },
                SourceRange([53, 54])
            ),
            // Adds 1 + 2
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Add,
                        operand0: ep::Operand::Reference(addr0),
                        operand1: ep::Operand::Reference(addr1),
                    },
                    destination: Destination::Address(addr3),
                },
                SourceRange([73, 78])
            ),
            // Adds `x` + 3, where `x` is (1 + 2)
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Add,
                        operand0: ep::Operand::Reference(addr3),
                        operand1: ep::Operand::Reference(addr2),
                    },
                    destination: Destination::Address(Address::ZERO.offset(4)),
                },
                SourceRange([73, 82])
            ),
        ]
    );
}

#[test]
fn use_kcl_functions_zero_params() {
    let (plan, scope, _) = must_plan(
        "fn triple = () => { return 123 }
    let x = triple()",
    );
    assert_eq!(
        plan,
        vec![Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 123i64.into()
            },
            SourceRange([27, 30])
        )]
    );
    match scope.get("x").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(addr, &Address::ZERO);
        }
        other => {
            panic!("expected 'x' bound to an address but it was bound to {other:?}");
        }
    }
}

#[test]
fn use_kcl_functions_with_optional_params() {
    for (i, program) in ["fn triple = (x, y?) => { return x*3 }
    let x = triple(1, 888)"]
    .into_iter()
    .enumerate()
    {
        let (plan, scope, _) = must_plan(program);
        let destination = Address::ZERO + 3;
        assert_eq!(
            plan,
            vec![
                Instruction::from_range(
                    InstructionKind::SetPrimitive {
                        address: Address::ZERO,
                        value: 1i64.into(),
                    },
                    SourceRange([57, 58])
                ),
                Instruction::from_range(
                    InstructionKind::SetPrimitive {
                        address: Address::ZERO + 1,
                        value: 888i64.into(),
                    },
                    SourceRange([60, 63])
                ),
                Instruction::from_range(
                    InstructionKind::SetPrimitive {
                        address: Address::ZERO + 2,
                        value: 3i64.into(),
                    },
                    SourceRange([34, 35])
                ),
                Instruction::from_range(
                    InstructionKind::BinaryArithmetic {
                        arithmetic: ep::BinaryArithmetic {
                            operation: ep::BinaryOperation::Mul,
                            operand0: ep::Operand::Reference(Address::ZERO),
                            operand1: ep::Operand::Reference(Address::ZERO + 2)
                        },
                        destination: Destination::Address(destination),
                    },
                    SourceRange([32, 35])
                ),
            ],
            "failed test {i}"
        );
        match scope.get("x").unwrap() {
            EpBinding::Single(addr) => {
                assert_eq!(addr, &destination, "failed test {i}");
            }
            other => {
                panic!("expected 'x' bound to an address but it was bound to {other:?}, so failed test {i}");
            }
        }
    }
}

#[test]
fn use_kcl_functions_with_too_many_params() {
    let program = "fn triple = (x, y?) => { return x*3 }
    let x = triple(1, 2, 3)";
    let err = should_not_compile(program);
    assert!(matches!(
        err,
        CompileError::TooManyArgs {
            maximum: 2,
            actual: 3,
            ..
        }
    ))
}

#[test]
fn use_kcl_function_as_return_value() {
    let program = "fn twotwotwo = () => {
            return () => { return 222 }
        }
        let f = twotwotwo()
        let x = f()";
    let (plan, scope, _) = must_plan(program);
    match scope.get("x").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(addr, &Address::ZERO);
        }
        other => {
            panic!("expected 'x' bound to an address but it was bound to {other:?}, so failed test");
        }
    }
    assert_eq!(
        plan,
        vec![Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 222i64.into()
            },
            SourceRange([57, 60])
        )]
    )
}

#[test]
fn define_recursive_function() {
    let program = "fn add_infinitely = (i) => {
            return add_infinitely(i+1)
        }";
    let (plan, _scope, _) = must_plan(program);
    assert_eq!(plan, Vec::new())
}
#[test]
fn use_kcl_function_as_param() {
    let program = "fn wrapper = (f) => {
            return f()
        }
        fn twotwotwo = () => { 
            return 222
        }
        let x = wrapper(twotwotwo)";
    let (plan, scope, _) = must_plan(program);
    match scope.get("x").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(addr, &Address::ZERO);
        }
        other => {
            panic!("expected 'x' bound to an address but it was bound to {other:?}, so failed test");
        }
    }
    assert_eq!(
        plan,
        vec![Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: 222i64.into()
            },
            SourceRange([106, 109])
        ),]
    )
}

#[test]
fn use_kcl_functions_with_params() {
    for (i, (program, expected_offsets)) in [
        (
            "fn triple = (x) => { return x*3 }
    let x = triple(1)",
            [[53, 54], [30, 31], [28, 31]],
        ),
        (
            "fn triple = (x,y?) => { return x*3 }
    let x = triple(1)",
            [[56, 57], [33, 34], [31, 34]],
        ),
    ]
    .into_iter()
    .enumerate()
    {
        let (plan, scope, _) = must_plan(program);
        let destination = Address::ZERO + 2;
        assert_eq!(
            plan,
            vec![
                Instruction::from_range(
                    InstructionKind::SetPrimitive {
                        address: Address::ZERO,
                        value: 1i64.into(),
                    },
                    SourceRange(expected_offsets[0])
                ),
                Instruction::from_range(
                    InstructionKind::SetPrimitive {
                        address: Address::ZERO + 1,
                        value: 3i64.into(),
                    },
                    SourceRange(expected_offsets[1])
                ),
                Instruction::from_range(
                    InstructionKind::BinaryArithmetic {
                        arithmetic: ep::BinaryArithmetic {
                            operation: ep::BinaryOperation::Mul,
                            operand0: ep::Operand::Reference(Address::ZERO),
                            operand1: ep::Operand::Reference(Address::ZERO.offset(1))
                        },
                        destination: Destination::Address(destination),
                    },
                    SourceRange(expected_offsets[2])
                ),
            ],
            "failed test {i}"
        );
        match scope.get("x").unwrap() {
            EpBinding::Single(addr) => {
                assert_eq!(addr, &destination, "failed test {i}");
            }
            other => {
                panic!("expected 'x' bound to an address but it was bound to {other:?}, so failed test {i}");
            }
        }
    }
}

#[test]
fn pipe_substitution_outside_pipe_expression() {
    let program = "let x = add(1, %)";
    let err = should_not_compile(program);
    assert!(matches!(err, CompileError::NotInPipeline));
}

#[test]
fn unsugar_pipe_expressions() {
    // These two programs should be equivalent,
    // because that's just the definition of the |> operator.
    let program2 = "
    fn double = (x) => { return x * 2 }
    fn triple = (x) => { return x * 3 }
    let x = 1 |> double(%) |> triple(%) // should be 6
    ";
    let program1 = "
    fn double = (x) => { return x * 2 }
    fn triple = (x) => { return x * 3 }
    let x = triple(double(1)) // should be 6
    ";
    // So, check that they are.
    let plan1 = must_plan(program1)
        .0
        .into_iter()
        .map(|instr| instr.kind)
        .collect::<Vec<_>>();
    let plan2 = must_plan(program2)
        .0
        .into_iter()
        .map(|instr| instr.kind)
        .collect::<Vec<_>>();
    assert_eq!(plan1, plan2);
}

#[test]
fn define_kcl_functions() {
    let (plan, scope, _) = must_plan("fn triple = (x) => { return x * 3 }");
    assert!(plan.is_empty());
    match scope.get("triple").unwrap() {
        EpBinding::Function(KclFunction::UserDefined(expr)) => {
            assert!(expr.params_optional.is_empty());
            assert_eq!(expr.params_required.len(), 1);
        }
        other => {
            panic!("expected 'triple' bound to a user-defined KCL function but it was bound to {other:?}");
        }
    }
}

#[test]
fn aliases_dont_affect_plans() {
    let (plan1, _scope, _) = must_plan(
        "let one = 1
            let two = 2
            let x = one + two",
    );
    let (plan2, _scope, _) = must_plan(
        "let one = 1
            let two = 2
            let y = two
            let x = one + y",
    );
    assert_eq!(
        plan1.into_iter().map(|instr| instr.kind).collect::<Vec<_>>(),
        plan2.into_iter().map(|instr| instr.kind).collect::<Vec<_>>(),
    );
}

#[test]
fn store_object() {
    let program = "const x0 = {a: 1, b: 2, c: {d: 3}}";
    let (actual, bindings, _) = must_plan(program);
    let expected = vec![
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: ObjectHeader {
                    properties: vec!["a".to_owned(), "b".to_owned(), "c".to_owned()],
                    size: 7,
                }
                .into(),
            },
            SourceRange([11, 34]),
        ),
        // Key a header
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 1,
                value: 1usize.into(),
            },
            SourceRange([11, 34]),
        ),
        // Key a value
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 2,
                value: 1i64.into(),
            },
            SourceRange([15, 16]),
        ),
        // Key b header
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 3,
                value: 1usize.into(),
            },
            SourceRange([11, 34]),
        ),
        // Key b value
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 4,
                value: 2i64.into(),
            },
            SourceRange([21, 22]),
        ),
        // Inner object (i.e. key c) header
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 5,
                value: ObjectHeader {
                    properties: vec!["d".to_owned()],
                    size: 2,
                }
                .into(),
            },
            SourceRange([27, 33]),
        ),
        // Key d header
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 6,
                value: 1usize.into(),
            },
            SourceRange([27, 33]),
        ),
        // Key d value
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 7,
                value: 3i64.into(),
            },
            SourceRange([31, 32]),
        ),
    ];
    assert_eq!(actual, expected);
    let actual = bindings.get("x0").unwrap();
    let expected = EpBinding::Map {
        length_at: Address::ZERO,
        properties: HashMap::from([
            ("a".to_owned(), EpBinding::Single(Address::ZERO + 2)),
            ("b".to_owned(), EpBinding::Single(Address::ZERO + 4)),
            (
                "c".to_owned(),
                EpBinding::Map {
                    length_at: Address::ZERO + 5,
                    properties: HashMap::from([("d".to_owned(), EpBinding::Single(Address::ZERO + 7))]),
                },
            ),
        ]),
    };
    assert_eq!(actual, &expected)
}

#[test]
fn store_object_with_array_property() {
    let program = "const x0 = {a: 1, b: [2, 3]}";
    let (actual, bindings, _) = must_plan(program);
    let expected = vec![
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: ObjectHeader {
                    properties: vec!["a".to_owned(), "b".to_owned()],
                    size: 7,
                }
                .into(),
            },
            SourceRange([11, 28]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 1,
                value: 1usize.into(),
            },
            SourceRange([11, 28]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 2,
                value: 1i64.into(),
            },
            SourceRange([15, 16]),
        ),
        // Array header
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 3,
                value: ListHeader { count: 2, size: 4 }.into(),
            },
            SourceRange([21, 27]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 4,
                value: 1usize.into(),
            },
            SourceRange([21, 27]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 5,
                value: 2i64.into(),
            },
            SourceRange([22, 23]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 6,
                value: 1usize.into(),
            },
            SourceRange([21, 27]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 7,
                value: 3i64.into(),
            },
            SourceRange([25, 26]),
        ),
    ];
    assert_eq!(actual, expected);
    assert_eq!(
        bindings.get("x0").unwrap(),
        &EpBinding::Map {
            length_at: Address::ZERO,
            properties: HashMap::from([
                ("a".to_owned(), EpBinding::Single(Address::ZERO + 2)),
                (
                    "b".to_owned(),
                    EpBinding::Sequence {
                        length_at: Address::ZERO + 3,
                        elements: vec![
                            EpBinding::Single(Address::ZERO + 5),
                            EpBinding::Single(Address::ZERO + 7),
                        ]
                    }
                ),
            ])
        }
    )
}

/// Write the program's plan to the KCVM debugger's normal input file.
#[allow(unused)]
fn kcvm_dbg(kcl_program: &str, path: &str) {
    let (plan, _scope, _) = must_plan(kcl_program);
    let plan_json = serde_json::to_string_pretty(&plan).unwrap();
    std::fs::write(path, plan_json).unwrap();
}

#[tokio::test]
async fn stdlib_cube_partial() {
    let program = r#"
    let cube = startSketchAt([10.0, 10.0], "adam")
        |> lineTo([210.0 ,  10.0], %, "side0")
        |> lineTo([210.0 , 210.0], %, "side1")
        |> lineTo([ 10.0 , 210.0], %, "side2")
        |> lineTo([ 10.0 ,  10.0], %, "side3")
        |> close(%)
        |> extrude(100.0, %)
    "#;
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mut client = Some(test_client().await);
    let mem = match crate::execute(ast, &mut client).await {
        Ok(mem) => mem,
        Err(e) => panic!("{e}"),
    };
    let sg = &mem.sketch_groups.last().unwrap();
    assert_eq!(
        sg.path_rest,
        vec![
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 10.0, y: 10.0 },
                    to: Point2d { x: 210.0, y: 10.0 },
                    name: "side0".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 10.0 },
                    to: Point2d { x: 210.0, y: 210.0 },
                    name: "side1".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 210.0 },
                    to: Point2d { x: 10.0, y: 210.0 },
                    name: "side2".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 10.0, y: 210.0 },
                    to: Point2d { x: 10.0, y: 10.0 },
                    name: "side3".into(),
                }
            },
        ]
    );
    use kittycad_modeling_cmds::{each_cmd, ok_response::OkModelingCmdResponse, ImageFormat};
    let out = client
        .unwrap()
        .run_command(
            uuid::Uuid::new_v4().into(),
            kittycad_modeling_cmds::ModelingCmd::from(each_cmd::TakeSnapshot {
                format: ImageFormat::Png,
            }),
        )
        .await
        .unwrap();

    let out = match out {
        OkModelingCmdResponse::TakeSnapshot(kittycad_modeling_cmds::output::TakeSnapshot { contents: b }) => b,
        other => panic!("wrong output: {other:?}"),
    };

    use image::io::Reader as ImageReader;
    let img = ImageReader::new(std::io::Cursor::new(out))
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap();
    twenty_twenty::assert_image("fixtures/cube_lineTo.png", &img, 0.9999);
}

#[tokio::test]
async fn stdlib_cube_xline_yline() {
    let program = r#"
    let cube = startSketchAt([0.0, 0.0], "adam")
        |> xLine(210.0, %, "side0")
        |> yLine(210.0, %, "side1")
        |> xLine(-210.0, %, "side2")
        |> yLine(-210.0, %, "side3")
        |> close(%)
        |> extrude(100.0, %)
    "#;
    let (_plan, _scope, _last_address) = must_plan(program);

    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mut client = Some(test_client().await);
    let mem = match crate::execute(ast, &mut client).await {
        Ok(mem) => mem,
        Err(e) => panic!("{e}"),
    };
    let sg = &mem.sketch_groups.last().unwrap();
    assert_eq!(
        sg.path_rest,
        vec![
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 0.0, y: 0.0 },
                    to: Point2d { x: 210.0, y: 0.0 },
                    name: "side0".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 0.0 },
                    to: Point2d { x: 210.0, y: 210.0 },
                    name: "side1".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 210.0 },
                    to: Point2d { x: 0.0, y: 210.0 },
                    name: "side2".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 0.0, y: 210.0 },
                    to: Point2d { x: 0.0, y: 0.0 },
                    name: "side3".into(),
                }
            },
        ]
    );
    use kittycad_modeling_cmds::{each_cmd, ok_response::OkModelingCmdResponse, ImageFormat};
    let out = client
        .unwrap()
        .run_command(
            uuid::Uuid::new_v4().into(),
            kittycad_modeling_cmds::ModelingCmd::from(each_cmd::TakeSnapshot {
                format: ImageFormat::Png,
            }),
        )
        .await
        .unwrap();

    let out = match out {
        OkModelingCmdResponse::TakeSnapshot(kittycad_modeling_cmds::output::TakeSnapshot { contents: b }) => b,
        other => panic!("wrong output: {other:?}"),
    };

    use image::io::Reader as ImageReader;
    let img = ImageReader::new(std::io::Cursor::new(out))
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap();
    twenty_twenty::assert_image("fixtures/cube_xyLine.png", &img, 0.9999);
}

#[tokio::test]
async fn stdlib_cube_with_tangential_arc_to() {
    let program = r#"
    let cube = startSketchAt([10.0, 10.0], "adam")
        |> lineTo([200.0 ,  10.0], %, "side0")
        |> tangentialArcTo([210.0, 20.0], %, "arc")
        |> lineTo([210.0 , 210.0], %, "side1")
        |> lineTo([ 10.0 , 210.0], %, "side2")
        |> lineTo([ 10.0 ,  10.0], %, "side3")
        |> close(%)
        |> extrude(100.0, %)
    "#;
    let (_plan, _scope, last_address) = must_plan(program);
    assert_eq!(last_address, Address::ZERO + 76);
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mut client = Some(test_client().await);
    let mem = match crate::execute(ast, &mut client).await {
        Ok(mem) => mem,
        Err(e) => panic!("{e}"),
    };
    let sg = &mem.sketch_groups.last().unwrap();
    assert_eq!(
        sg.path_rest,
        vec![
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 10.0, y: 10.0 },
                    to: Point2d { x: 200.0, y: 10.0 },
                    name: "side0".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 200.0, y: 10.0 },
                    to: Point2d { x: 210.0, y: 20.0 },
                    name: "arc".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 20.0 },
                    to: Point2d { x: 210.0, y: 210.0 },
                    name: "side1".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 210.0, y: 210.0 },
                    to: Point2d { x: 10.0, y: 210.0 },
                    name: "side2".into(),
                }
            },
            sketch_types::PathSegment::ToPoint {
                base: sketch_types::BasePath {
                    from: Point2d { x: 10.0, y: 210.0 },
                    to: Point2d { x: 10.0, y: 10.0 },
                    name: "side3".into(),
                }
            },
        ]
    );
    use kittycad_modeling_cmds::{each_cmd, ok_response::OkModelingCmdResponse, ImageFormat};
    let out = client
        .unwrap()
        .run_command(
            uuid::Uuid::new_v4().into(),
            kittycad_modeling_cmds::ModelingCmd::from(each_cmd::TakeSnapshot {
                format: ImageFormat::Png,
            }),
        )
        .await
        .unwrap();
    let out = match out {
        OkModelingCmdResponse::TakeSnapshot(kittycad_modeling_cmds::output::TakeSnapshot { contents: b }) => b,
        other => panic!("wrong output: {other:?}"),
    };
    use image::io::Reader as ImageReader;
    let img = ImageReader::new(std::io::Cursor::new(out))
        .with_guessed_format()
        .unwrap()
        .decode()
        .unwrap();
    twenty_twenty::assert_image("fixtures/cube_tangentialArcTo.png", &img, 0.9999);
}

async fn test_client() -> Session {
    let kittycad_api_token = env::var("KITTYCAD_API_TOKEN").expect("You must set $KITTYCAD_API_TOKEN");
    let kittycad_api_client = kittycad::Client::new(kittycad_api_token);
    let session_builder = SessionBuilder {
        client: kittycad_api_client,
        fps: Some(10),
        unlocked_framerate: Some(false),
        video_res_height: Some(720),
        video_res_width: Some(1280),
        buffer_reqs: None,
        await_response_timeout: None,
    };
    match Session::start(session_builder).await {
        Err(e) => match e {
            kittycad::types::error::Error::InvalidRequest(s) => panic!("Request did not meet requirements {s}"),
            kittycad::types::error::Error::CommunicationError(e) => {
                panic!(" A server error either due to the data, or with the connection: {e}")
            }
            kittycad::types::error::Error::RequestError(e) => panic!("Could not build request: {e}"),
            kittycad::types::error::Error::SerdeError { error, status } => {
                panic!("Serde error (HTTP {status}): {error}")
            }
            kittycad::types::error::Error::InvalidResponsePayload { error, response } => {
                panic!("Invalid response payload. Error {error}, response {response:?}")
            }
            kittycad::types::error::Error::Server { body, status } => panic!("Server error (HTTP {status}): {body}"),
            kittycad::types::error::Error::UnexpectedResponse(resp) => {
                let status = resp.status();
                let url = resp.url().to_owned();
                match resp.text().await {
                    Ok(body) => panic!(
                        "Unexpected response from KittyCAD API.
                        URL:{url}
                        HTTP {status}
                        ---Body----
                        {body}"
                    ),
                    Err(e) => panic!(
                        "Unexpected response from KittyCAD API.
                        URL:{url}
                        HTTP {status}
                        ---Body could not be read, the error is----
                        {e}"
                    ),
                }
            }
        },
        Ok(x) => x,
    }
}

#[ignore = "haven't done API calls or stdlib yet"]
#[test]
fn stdlib_api_calls() {
    let program = include_str!("../../tests/executor/inputs/cube.kcl");
    must_plan(program);
}

#[test]
fn objects_as_parameters() {
    let program = "fn identity = (x) => { return x }
    let obj = identity({x: 1})";
    let (plan, scope, _) = must_plan(program);
    let expected_plan = vec![
        // Object contents
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: ObjectHeader {
                    properties: vec!["x".to_owned()],
                    size: 2,
                }
                .into(),
            },
            SourceRange([57, 63]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 1,
                value: 1usize.into(),
            },
            SourceRange([57, 63]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 2,
                value: 1i64.into(),
            },
            SourceRange([61, 62]),
        ),
    ];
    assert_eq!(plan, expected_plan);
    assert_eq!(
        scope.get("obj").unwrap(),
        &EpBinding::Map {
            length_at: Address::ZERO,
            properties: HashMap::from([("x".to_owned(), EpBinding::Single(Address::ZERO + 2))])
        }
    )
}

#[test]
fn arrays_as_parameters() {
    let program = r#"fn identity = (x) => { return x }
    let array = identity(["a","b","c"])"#;
    let (plan, scope, _) = must_plan(program);
    const INDEX_OF_A: usize = 2;
    const INDEX_OF_B: usize = 4;
    const INDEX_OF_C: usize = 6;
    let expected_plan = vec![
        // Array length
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO,
                value: ListHeader { count: 3, size: 6 }.into(),
            },
            SourceRange([59, 72]),
        ),
        // Array contents
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 1,
                value: 1usize.into(),
            },
            SourceRange([59, 72]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + INDEX_OF_A,
                value: "a".to_owned().into(),
            },
            SourceRange([60, 63]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 3,
                value: 1usize.into(),
            },
            SourceRange([59, 72]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + INDEX_OF_B,
                value: "b".to_owned().into(),
            },
            SourceRange([64, 67]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + 5,
                value: 1usize.into(),
            },
            SourceRange([59, 72]),
        ),
        Instruction::from_range(
            InstructionKind::SetPrimitive {
                address: Address::ZERO + INDEX_OF_C,
                value: "c".to_owned().into(),
            },
            SourceRange([68, 71]),
        ),
    ];
    assert_eq!(plan, expected_plan);
    assert_eq!(
        scope.get("array").unwrap(),
        &EpBinding::Sequence {
            length_at: Address::ZERO,
            elements: vec![
                EpBinding::Single(Address::ZERO + INDEX_OF_A),
                EpBinding::Single(Address::ZERO + INDEX_OF_B),
                EpBinding::Single(Address::ZERO + INDEX_OF_C),
            ]
        }
    )
}

#[test]
fn mod_and_pow() {
    let program = "
        let x = 2
        let y = x^3
        let z = y % 5
        ";
    let (plan, _bindings, _) = must_plan(program);
    let addr0 = Address::ZERO;
    let addr1 = Address::ZERO.offset(1);
    let addr2 = Address::ZERO.offset(2);
    let addr3 = Address::ZERO.offset(3);
    let addr4 = Address::ZERO.offset(4);
    assert_eq!(
        plan,
        vec![
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr0,
                    value: 2i64.into(),
                },
                SourceRange([17, 18])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr1,
                    value: 3i64.into(),
                },
                SourceRange([37, 38])
            ),
            // x ^ 3, where x = 2
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Pow,
                        operand0: ep::Operand::Reference(addr0),
                        operand1: ep::Operand::Reference(addr1),
                    },
                    destination: Destination::Address(addr2),
                },
                SourceRange([35, 38])
            ),
            Instruction::from_range(
                InstructionKind::SetPrimitive {
                    address: addr3,
                    value: 5i64.into(),
                },
                SourceRange([59, 60])
            ),
            // y % 5, where y is 2^3
            Instruction::from_range(
                InstructionKind::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Mod,
                        operand0: ep::Operand::Reference(addr2),
                        operand1: ep::Operand::Reference(addr3),
                    },
                    destination: Destination::Address(addr4),
                },
                SourceRange([55, 60])
            ),
        ]
    );
}
#[tokio::test]
async fn cos_sin_pi() {
    let program = "
        let x = cos(45.0)*10
        let y = sin(45.0)*10
        let z = PI
        ";
    let (_plan, scope, _) = must_plan(program);
    let Some(EpBinding::Single(x)) = scope.get("x") else {
        panic!("Unexpected binding for variable 'x': {:?}", scope.get("x"));
    };
    let Some(EpBinding::Single(y)) = scope.get("y") else {
        panic!("Unexpected binding for variable 'y': {:?}", scope.get("y"));
    };
    let Some(EpBinding::Constant(z)) = scope.get("z") else {
        panic!("Unexpected binding for variable 'z': {:?}", scope.get("z"));
    };
    let ast = kcl_lib::parser::Parser::new(kcl_lib::token::lexer(program).unwrap())
        .ast()
        .unwrap();
    let mem = crate::execute(ast, &mut None).await.unwrap();
    use ept::ReadMemory;
    assert_eq!(*mem.get(x).unwrap(), Primitive::from(5.253219888177298));
    assert_eq!(*mem.get(y).unwrap(), Primitive::from(8.509035245341185));

    // Constants don't live in memory.
    assert_eq!(*z, constants::PI);
}
