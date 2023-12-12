//! A KittyCAD execution plan (KCEP) is a list of
//! - KittyCAD API requests to make
//! - Values to send in API requests
//! - Values to assign from API responses
//! - Computation to perform on values
//! You can think of it as a domain-specific language for making KittyCAD API calls and using
//! the results to make other API calls.

use self::arithmetic::Arithmetic;
use self::value::Value;
use composite::Composite;
use serde::{Deserialize, Serialize};
use std::fmt;

mod arithmetic;
mod composite;
#[cfg(test)]
mod tests;
mod value;

/// KCEP's program memory. A flat, linear list of values.
#[derive(Debug)]
#[cfg_attr(test, derive(PartialEq))]
pub struct Memory(Vec<Option<Value>>);

impl Default for Memory {
    fn default() -> Self {
        Self(vec![None; 1024])
    }
}

/// An address in KCEP's program memory.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Address(usize);

impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(f)
    }
}

impl From<usize> for Address {
    fn from(value: usize) -> Self {
        Self(value)
    }
}

impl Memory {
    /// Get a value from KCEP's program memory.
    pub fn get(&self, Address(addr): &Address) -> Option<&Value> {
        self.0[*addr].as_ref()
    }

    /// Store a value in KCEP's program memory.
    pub fn set(&mut self, Address(addr): Address, value: Value) {
        // If isn't big enough for this value, double the size of memory until it is.
        while addr > self.0.len() {
            self.0.extend(vec![None; self.0.len()]);
        }
        self.0[addr] = Some(value);
    }

    /// Store a composite value (i.e. a value which takes up multiple addresses in memory).
    /// Store its parts in consecutive memory addresses starting at `start`.
    pub fn set_composite<T: Composite>(&mut self, composite_value: T, start: Address) {
        let parts = composite_value.into_parts().into_iter();
        for (value, addr) in parts.zip(start.0..) {
            self.0[addr] = Some(value);
        }
    }

    /// Get a composite value (i.e. a value which takes up multiple addresses in memory).
    /// Its parts are stored in consecutive memory addresses starting at `start`.
    pub fn get_composite<T: Composite>(&self, start: Address) -> Result<T, ExecutionError> {
        let values = &self.0[start.0..];
        T::from_parts(values)
    }
}

/// One step of the execution plan.
#[derive(Serialize, Deserialize)]
pub enum Instruction {
    /// Call the KittyCAD API.
    ApiRequest {
        /// Which ModelingCmd to call.
        /// It's a composite value starting at the given address.
        endpoint: Address,
        /// Which address should the response be stored in?
        store_response: Option<usize>,
        /// Look up each API request in this register number.
        arguments: Vec<Address>,
    },
    /// Set a value in memory.
    Set {
        /// Which memory address to set.
        address: Address,
        /// What value to set the memory address to.
        value: Value,
    },
    /// Perform arithmetic on values in memory.
    Arithmetic {
        /// What to do.
        arithmetic: Arithmetic,
        /// Write the output to this memory address.
        destination: Address,
    },
}

/// Operations that can be applied to values in memory.
#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
pub enum Operation {
    Add,
    Mul,
    Sub,
    Div,
}

impl fmt::Display for Operation {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Operation::Add => "+",
            Operation::Mul => "*",
            Operation::Sub => "-",
            Operation::Div => "/",
        }
        .fmt(f)
    }
}

/// Argument to an operation.
#[derive(Deserialize, Serialize)]
pub enum Operand {
    Literal(Value),
    Reference(Address),
}

impl Operand {
    /// Evaluate the operand, getting its value.
    fn eval(&self, mem: &Memory) -> Result<Value, ExecutionError> {
        match self {
            Operand::Literal(v) => Ok(v.to_owned()),
            Operand::Reference(addr) => match mem.get(addr) {
                None => Err(ExecutionError::MemoryEmpty { addr: *addr }),
                Some(v) => Ok(v.to_owned()),
            },
        }
    }
}

/// Execute the plan.
pub fn execute(mem: &mut Memory, plan: Vec<Instruction>) -> Result<(), ExecutionError> {
    for step in plan {
        match step {
            Instruction::ApiRequest { .. } => todo!("Execute API calls"),
            Instruction::Set { address, value } => {
                mem.set(address, value);
            }
            Instruction::Arithmetic {
                arithmetic,
                destination,
            } => {
                let out = arithmetic.calculate(mem)?;
                mem.set(destination, out);
            }
        }
    }
    Ok(())
}

/// Errors that could occur when executing a KittyCAD execution plan.
#[derive(Debug, thiserror::Error, Clone)]
pub enum ExecutionError {
    #[error("Memory address {addr} was not set")]
    MemoryEmpty { addr: Address },
    #[error("Cannot apply operation {op} to operands {operands:?}")]
    CannotApplyOperation { op: Operation, operands: Vec<Value> },
    #[error("Tried to read a '{expected}' from KCEP program memory, found an '{actual}' instead")]
    MemoryWrongType { expected: &'static str, actual: String },
    #[error("Wanted {expected} values but did not get enough")]
    MemoryWrongSize { expected: usize },
    #[error("No endpoint {0} recognized")]
    UnrecognizedEndpoint(String),
}
