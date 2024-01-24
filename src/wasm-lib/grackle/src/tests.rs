use ep::UnaryArithmetic;
use pretty_assertions::assert_eq;

use super::*;

fn must_plan(program: &str) -> (Vec<Instruction>, BindingScope) {
    let tokens = kcl_lib::token::lexer(program);
    let parser = kcl_lib::parser::Parser::new(tokens);
    let ast = parser.ast().unwrap();
    let mut p = Planner::new();
    let (instrs, _) = p.build_plan(ast).unwrap();
    (instrs, p.binding_scope)
}

fn should_not_compile(program: &str) -> CompileError {
    let tokens = kcl_lib::token::lexer(program);
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
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 1i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO.offset(1),
                value: 2i64.into(),
            }
        ]
    );
}

#[test]
fn bind_array() {
    let program = r#"let x = [44, 55, "sixty-six"]"#;
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            // Arrays start with the length.
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 3usize.into(),
            },
            // Then the elements follow.
            Instruction::SetPrimitive {
                address: Address::ZERO + 1,
                value: 44i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 2,
                value: 55i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 3,
                value: "sixty-six".to_owned().into(),
            }
        ]
    );
}

#[test]
fn bind_nested_array() {
    let program = r#"let x = [44, [55, "sixty-six"]]"#;
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 2usize.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 1,
                value: 44i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 2,
                value: 2usize.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 3,
                value: 55i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 4,
                value: "sixty-six".to_owned().into(),
            }
        ]
    );
}

#[test]
fn bind_arrays_with_objects_elements() {
    let program = r#"let x = [44, {a: 55, b: "sixty-six"}]"#;
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 2usize.into()
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 1,
                value: 44i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 2,
                value: 55i64.into(),
            },
            Instruction::SetPrimitive {
                address: Address::ZERO + 3,
                value: "sixty-six".to_owned().into(),
            }
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
        let (plan, scope) = must_plan(&program);
        assert_eq!(
            plan,
            vec![Instruction::SetPrimitive {
                address: Address::ZERO,
                value: val.into(),
            }]
        );
        assert_eq!(scope.get("x"), Some(&EpBinding::Single(Address::ZERO)));
    }
}

#[test]
fn aliases() {
    let program = "
        let x = 1
        let y = x";
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 1i64.into(),
        }]
    );
}

#[test]
fn use_native_function_add() {
    let program = "let x = add(1,2)";
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 1i64.into()
            },
            Instruction::SetPrimitive {
                address: Address::ZERO.offset(1),
                value: 2i64.into()
            },
            Instruction::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(Address::ZERO),
                    operand1: ep::Operand::Reference(Address::ZERO.offset(1))
                },
                destination: Address::ZERO.offset(2),
            }
        ]
    );
}

#[test]
fn arrays_as_parameters() {
    let program = "fn identity = (x) => { return x }
    let x = identity([1,2,3])";
    must_plan(program);
}

#[test]
fn use_native_function_id() {
    let program = "let x = id(2)";
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 2i64.into()
        }]
    );
}

#[test]
#[ignore = "haven't done computed properties yet"]
fn computed_array_index() {
    let program = r#"
    let array = ["a", "b", "c"]
    let index = 1+1
    let prop = array[index]
    "#;
    let (_plan, scope) = must_plan(program);
    match scope.get("prop").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 1);
        }
        other => {
            panic!("expected 'prop' bound to 0x0 but it was bound to {other:?}");
        }
    }
}

#[test]
#[ignore = "haven't done computed properties yet"]
fn computed_member_expressions() {
    let program = r#"
    let obj = {x: 1, y: 2}
    let index = "x"
    let prop = obj[index]
    "#;
    let (_plan, scope) = must_plan(program);
    match scope.get("prop").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 1);
        }
        other => {
            panic!("expected 'prop' bound to 0x0 but it was bound to {other:?}");
        }
    }
}

#[test]
fn member_expressions_object() {
    let program = r#"
    let obj = {x: 1, y: 2}
    let prop = obj["y"]
    "#;
    let (_plan, scope) = must_plan(program);
    match scope.get("prop").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 1);
        }
        other => {
            panic!("expected 'prop' bound to 0x0 but it was bound to {other:?}");
        }
    }
}

#[test]
fn member_expressions_array() {
    let program = "
    let array = [[1,2],[3,4]]
    let first = array[0][0]
    let last = array[1][1]
    ";
    let (_plan, scope) = must_plan(program);
    match scope.get("first").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 2);
        }
        other => {
            panic!("expected 'number' bound to 0x0 but it was bound to {other:?}");
        }
    }
    match scope.get("last").unwrap() {
        EpBinding::Single(addr) => {
            assert_eq!(*addr, Address::ZERO + 6);
        }
        other => {
            panic!("expected 'number' bound to 0x3 but it was bound to {other:?}");
        }
    }
}

#[test]
fn compile_flipped_sign() {
    let program = "let x = 3
    let y = -x";
    let (plan, _scope) = must_plan(program);
    let expected = vec![
        Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 3i64.into(),
        },
        Instruction::UnaryArithmetic {
            arithmetic: UnaryArithmetic {
                operation: ep::UnaryOperation::Neg,
                operand: ep::Operand::Reference(Address::ZERO),
            },
            destination: Address::ZERO + 1,
        },
    ];
    assert_eq!(plan, expected);
}

#[test]
fn add_literals() {
    let program = "let x = 1 + 2";
    let (plan, _scope) = must_plan(program);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: Address::ZERO,
                value: 1i64.into()
            },
            Instruction::SetPrimitive {
                address: Address::ZERO.offset(1),
                value: 2i64.into()
            },
            Instruction::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(Address::ZERO),
                    operand1: ep::Operand::Reference(Address::ZERO.offset(1)),
                },
                destination: Address::ZERO.offset(2),
            }
        ]
    );
}

#[test]
fn add_vars() {
    let program = "
        let one = 1
        let two = 2
        let x = one + two";
    let (plan, _bindings) = must_plan(program);
    let addr0 = Address::ZERO;
    let addr1 = Address::ZERO.offset(1);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: addr0,
                value: 1i64.into(),
            },
            Instruction::SetPrimitive {
                address: addr1,
                value: 2i64.into(),
            },
            Instruction::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(addr0),
                    operand1: ep::Operand::Reference(addr1),
                },
                destination: Address::ZERO.offset(2),
            }
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
    let (plan, _bindings) = must_plan(program);
    let addr0 = Address::ZERO;
    let addr1 = Address::ZERO.offset(1);
    let addr2 = Address::ZERO.offset(2);
    let addr3 = Address::ZERO.offset(3);
    assert_eq!(
        plan,
        vec![
            Instruction::SetPrimitive {
                address: addr0,
                value: 1i64.into(),
            },
            Instruction::SetPrimitive {
                address: addr1,
                value: 2i64.into(),
            },
            Instruction::SetPrimitive {
                address: addr2,
                value: 3i64.into(),
            },
            // Adds 1 + 2
            Instruction::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(addr0),
                    operand1: ep::Operand::Reference(addr1),
                },
                destination: addr3,
            },
            // Adds `x` + 3, where `x` is (1 + 2)
            Instruction::BinaryArithmetic {
                arithmetic: ep::BinaryArithmetic {
                    operation: ep::BinaryOperation::Add,
                    operand0: ep::Operand::Reference(addr3),
                    operand1: ep::Operand::Reference(addr2),
                },
                destination: Address::ZERO.offset(4),
            }
        ]
    );
}

#[test]
fn use_kcl_functions_zero_params() {
    let (plan, scope) = must_plan(
        "fn triple = () => { return 123 }
    let x = triple()",
    );
    assert_eq!(
        plan,
        vec![Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 123i64.into()
        }]
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
        let (plan, scope) = must_plan(program);
        let destination = Address::ZERO + 3;
        assert_eq!(
            plan,
            vec![
                Instruction::SetPrimitive {
                    address: Address::ZERO,
                    value: 1i64.into(),
                },
                Instruction::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 888i64.into(),
                },
                Instruction::SetPrimitive {
                    address: Address::ZERO + 2,
                    value: 3i64.into(),
                },
                Instruction::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Mul,
                        operand0: ep::Operand::Reference(Address::ZERO),
                        operand1: ep::Operand::Reference(Address::ZERO + 2)
                    },
                    destination,
                }
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
    let (plan, scope) = must_plan(program);
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
        vec![Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 222i64.into()
        }]
    )
}

#[test]
fn define_recursive_function() {
    let program = "fn add_infinitely = (i) => {
            return add_infinitely(i+1)
        }";
    let (plan, _scope) = must_plan(program);
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
    let (plan, scope) = must_plan(program);
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
        vec![Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 222i64.into()
        }]
    )
}

#[test]
fn use_kcl_functions_with_params() {
    for (i, program) in [
        "fn triple = (x) => { return x*3 }
    let x = triple(1)",
        "fn triple = (x,y?) => { return x*3 }
    let x = triple(1)",
    ]
    .into_iter()
    .enumerate()
    {
        let (plan, scope) = must_plan(program);
        let destination = Address::ZERO + 2;
        assert_eq!(
            plan,
            vec![
                Instruction::SetPrimitive {
                    address: Address::ZERO,
                    value: 1i64.into(),
                },
                Instruction::SetPrimitive {
                    address: Address::ZERO + 1,
                    value: 3i64.into(),
                },
                Instruction::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: ep::BinaryOperation::Mul,
                        operand0: ep::Operand::Reference(Address::ZERO),
                        operand1: ep::Operand::Reference(Address::ZERO.offset(1))
                    },
                    destination,
                }
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
    let (plan1, _) = must_plan(program1);
    let (plan2, _) = must_plan(program2);
    assert_eq!(plan1, plan2);
}

#[test]
fn define_kcl_functions() {
    let (plan, scope) = must_plan("fn triple = (x) => { return x * 3 }");
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
    let (plan1, _) = must_plan(
        "let one = 1
            let two = 2
            let x = one + two",
    );
    let (plan2, _) = must_plan(
        "let one = 1
            let two = 2
            let y = two
            let x = one + y",
    );
    assert_eq!(plan1, plan2);
}

#[test]
fn store_object() {
    let program = "const x0 = {a: 1, b: 2, c: {d: 3}}";
    let (actual, bindings) = must_plan(program);
    let expected = vec![
        Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 1i64.into(),
        },
        Instruction::SetPrimitive {
            address: Address::ZERO.offset(1),
            value: 2i64.into(),
        },
        Instruction::SetPrimitive {
            address: Address::ZERO.offset(2),
            value: 3i64.into(),
        },
    ];
    assert_eq!(actual, expected);
    eprintln!("{bindings:#?}");
    assert_eq!(
        bindings.get("x0").unwrap(),
        &EpBinding::Map(HashMap::from([
            ("a".to_owned(), EpBinding::Single(Address::ZERO),),
            ("b".to_owned(), EpBinding::Single(Address::ZERO.offset(1))),
            (
                "c".to_owned(),
                EpBinding::Map(HashMap::from([(
                    "d".to_owned(),
                    EpBinding::Single(Address::ZERO.offset(2))
                )]))
            ),
        ]))
    )
}

#[test]
fn store_object_with_array_property() {
    let program = "const x0 = {a: 1, b: [22, 33]}";
    let (actual, bindings) = must_plan(program);
    let expected = vec![
        Instruction::SetPrimitive {
            address: Address::ZERO,
            value: 1i64.into(),
        },
        Instruction::SetPrimitive {
            address: Address::ZERO + 1,
            value: 2usize.into(),
        },
        Instruction::SetPrimitive {
            address: Address::ZERO + 2,
            value: 22i64.into(),
        },
        Instruction::SetPrimitive {
            address: Address::ZERO + 3,
            value: 33i64.into(),
        },
    ];
    assert_eq!(actual, expected);
    eprintln!("{bindings:#?}");
    assert_eq!(
        bindings.get("x0").unwrap(),
        &EpBinding::Map(HashMap::from([
            ("a".to_owned(), EpBinding::Single(Address::ZERO),),
            (
                "b".to_owned(),
                EpBinding::Sequence {
                    length_at: Address::ZERO.offset(1),
                    elements: vec![
                        EpBinding::Single(Address::ZERO.offset(2)),
                        EpBinding::Single(Address::ZERO.offset(3)),
                    ]
                }
            ),
        ]))
    )
}

#[ignore = "haven't done API calls or stdlib yet"]
#[test]
fn stdlib_api_calls() {
    let program = "const x0 = startSketchAt([0, 0])
        const x1 = line([0, 10], x0)
        const x2 = line([10, 0], x1)
        const x3 = line([0, -10], x2)
        const x4 = line([0, 0], x3)
        const x5 = close(x4)
        const x6 = extrude(20, x5)
      show(x6)";
    must_plan(program);
}
