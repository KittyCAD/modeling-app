use kcl_lib::ast::types::RequiredParamAfterOptionalParam;
use kittycad_execution_plan::ExecutionError;

use crate::String2;

#[derive(Debug, thiserror::Error, PartialEq, Clone)]
pub enum CompileError {
    #[error("the name {name} was not defined")]
    Undefined { name: String },
    #[error("the function {fn_name} requires at least {required} arguments but you only supplied {actual}")]
    NotEnoughArgs {
        fn_name: String2,
        required: usize,
        actual: usize,
    },
    #[error("the function {fn_name} accepts at most {maximum} arguments but you supplied {actual}")]
    TooManyArgs {
        fn_name: String2,
        maximum: usize,
        actual: usize,
    },
    #[error("you tried to call {name} but it's not a function")]
    NotCallable { name: String },
    #[error("you're trying to use an operand that isn't compatible with the given arithmetic operator: {0}")]
    InvalidOperand(&'static str),
    #[error("you cannot use the value {0} as an index")]
    InvalidIndex(String),
    #[error("you tried to index into a value that isn't an array. Only arrays have numeric indices!")]
    CannotIndex,
    #[error("you tried to get the element {i} but that index is out of bounds. The array only has a length of {len}")]
    IndexOutOfBounds { i: usize, len: usize },
    #[error("you tried to access the property of a value that doesn't have any properties")]
    NoProperties,
    #[error("you tried to access a property of an array, but arrays don't have properties. They do have numeric indexes though, try using an index e.g. [0]")]
    ArrayDoesNotHaveProperties,
    #[error(
        "you tried to read the '.{property}' of an object, but the object doesn't have any properties with that key"
    )]
    UndefinedProperty { property: String },
    #[error("{0}")]
    BadParamOrder(RequiredParamAfterOptionalParam),
    #[error("A KCL function cannot have anything after its return value")]
    MultipleReturns,
    #[error("A KCL function must end with a return statement, but your function doesn't have one.")]
    NoReturnStmt,
    #[error("You used the %, which means \"substitute this argument for the value to the left in this |> pipeline\". But there is no such value, because you're not calling a pipeline.")]
    NotInPipeline,
    #[error("The function '{fn_name}' expects a parameter of type {expected} as argument number {arg_number} but you supplied {actual}")]
    ArgWrongType {
        fn_name: &'static str,
        expected: &'static str,
        actual: String,
        arg_number: usize,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Compile(#[from] CompileError),
    #[error("{0}")]
    Execution(#[from] ExecutionError),
}
