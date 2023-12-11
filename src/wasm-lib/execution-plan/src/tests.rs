use kittycad_modeling_cmds::{id::ModelingCmdId, shared::Point3d, ModelingCmd, MovePathPen};

use super::*;

#[test]
fn write_addr_to_memory() {
    let plan = vec![Instruction::Set {
        address: Address(0),
        value: 3.4.into(),
    }];
    let mut mem = Memory::default();
    execute(&mut mem, plan).unwrap();
    assert_eq!(mem.get(&Address(0)), Some(&3.4.into()))
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
    let mut mem = Memory::default();
    execute(&mut mem, plan).unwrap();
    assert_eq!(mem.get(&Address(1)), Some(&5.into()))
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
    let mut mem = Memory::default();
    execute(&mut mem, plan).unwrap();
    assert_eq!(mem.get(&Address(1)), Some(&470.into()))
}

#[test]
fn add_to_composite_value() {
    let mut mem = Memory::default();

    // Write a point to memory.
    let point_before = Point3d {
        x: 2.0f64,
        y: 3.0,
        z: 4.0,
    };
    let start_addr = Address(0);
    mem.set_composite(point_before, start_addr);
    assert_eq!(mem.0[0], Some(2.0.into()));
    assert_eq!(mem.0[1], Some(3.0.into()));
    assert_eq!(mem.0[2], Some(4.0.into()));

    // Update the point's x-value in memory.
    execute(
        &mut mem,
        vec![Instruction::Arithmetic {
            arithmetic: Arithmetic {
                operation: Operation::Add,
                operand0: Operand::Reference(start_addr),
                operand1: Operand::Literal(40.into()),
            },
            destination: start_addr,
        }],
    )
    .unwrap();

    // Read the point out of memory, validate it.
    let point_after: Point3d<f64> = mem.get_composite(start_addr).unwrap();
    assert_eq!(
        point_after,
        Point3d {
            x: 42.0,
            y: 3.0,
            z: 4.0
        }
    )
}

#[test]
fn api_types() {
    let mut mem = Memory::default();
    let start_addr = Address(0);
    let id = ModelingCmdId(Uuid::parse_str("6306afa2-3999-4b03-af30-1efad7cdc6fc").unwrap());
    let p = Point3d {
        x: 2.0f64,
        y: 3.0,
        z: 4.0,
    };
    let val_in = ModelingCmd::MovePathPen(MovePathPen { path: id, to: p });
    mem.set_composite(val_in, start_addr);
    let val_out: ModelingCmd = mem.get_composite(start_addr).unwrap();
    match val_out {
        ModelingCmd::MovePathPen(params) => {
            assert_eq!(params.to, p);
            assert_eq!(params.path, id);
        }
        _ => panic!("unexpected ModelingCmd variant"),
    }
}
