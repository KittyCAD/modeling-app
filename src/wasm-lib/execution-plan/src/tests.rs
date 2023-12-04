use super::*;

#[test]
fn write_addr_to_memory() {
    let plan = vec![Instruction::Set {
        address: Address(0),
        value: 3.4.into(),
    }];
    let out = execute(plan).unwrap();
    assert_eq!(out.get(&Address(0)), Some(&3.4.into()))
}

#[test]
fn add_literals() {
    let plan = vec![Instruction::Arithmetic {
        arithmetic: Arithmetic {
            operation: Operation::Add,
            operand0: Operand::Literal(3.into()),
            operand1: Operand::Literal(2.into()),
        },
        destination: Address(1),
    }];
    let out = execute(plan).unwrap();
    assert_eq!(out.get(&Address(1)), Some(&5.into()))
}

#[test]
fn add_literal_to_reference() {
    let plan = vec![
        // Memory addr 0 contains 450
        Instruction::Set {
            address: Address(0),
            value: 450.into(),
        },
        // Add 20 to addr 0
        Instruction::Arithmetic {
            arithmetic: Arithmetic {
                operation: Operation::Add,
                operand0: Operand::Reference(Address(0)),
                operand1: Operand::Literal(20.into()),
            },
            destination: Address(1),
        },
    ];
    // 20 + 450 = 470
    let out = execute(plan).unwrap();
    assert_eq!(out.get(&Address(1)), Some(&470.into()))
}
