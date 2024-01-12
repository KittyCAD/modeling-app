mod binding_scope;
mod kcl_value_group;
mod native_functions;
#[cfg(test)]
mod tests;

use std::collections::HashMap;

use kcl_lib::{
    ast,
    ast::types::{BodyItem, KclNone, LiteralValue, Program},
};
use kittycad_execution_plan as ep;
use kittycad_execution_plan::{Address, ExecutionError, Instruction};
use kittycad_execution_plan_traits as ept;
use kittycad_execution_plan_traits::NumericPrimitive;
use kittycad_modeling_session::Session;

use self::binding_scope::{BindingScope, EpBinding, GetFnResult};
use self::kcl_value_group::{KclValueGroup, SingleValue};

/// Execute a KCL program by compiling into an execution plan, then running that.
pub async fn execute(ast: Program, session: Session) -> Result<(), Error> {
    let mut planner = Planner::new();
    let plan = planner.build_plan(ast)?;
    let mut mem = kittycad_execution_plan::Memory::default();
    kittycad_execution_plan::execute(&mut mem, plan, session).await?;
    Ok(())
}

/// Compiles KCL programs into Execution Plans.
struct Planner {
    /// Maps KCL identifiers to what they hold, and where in KCEP virtual memory they'll be written to.
    binding_scope: BindingScope,
    /// Next available KCEP virtual machine memory address.
    next_addr: Address,
}

impl Planner {
    pub fn new() -> Self {
        Self {
            binding_scope: BindingScope::prelude(),
            next_addr: Address::ZERO,
        }
    }

    fn build_plan(&mut self, program: Program) -> PlanRes {
        program.body.into_iter().try_fold(Vec::new(), |mut instructions, item| {
            let instructions_for_this_node = match item {
                BodyItem::ExpressionStatement(node) => match KclValueGroup::from(node.expression) {
                    KclValueGroup::Single(value) => self.plan_to_compute_single(value)?.instructions,
                    KclValueGroup::ArrayExpression(_) => todo!(),
                    KclValueGroup::ObjectExpression(_) => todo!(),
                },
                BodyItem::VariableDeclaration(node) => self.plan_to_bind(node)?,
                BodyItem::ReturnStatement(_) => todo!(),
            };
            instructions.extend(instructions_for_this_node);
            Ok(instructions)
        })
    }

    /// Emits instructions which, when run, compute a given KCL value and store it in memory.
    /// Returns the instructions, and the destination address of the value.
    fn plan_to_compute_single(&mut self, value: SingleValue) -> Result<EvalPlan, CompileError> {
        match value {
            SingleValue::KclNoneExpression(KclNone { start: _, end: _ }) => {
                let address = self.next_addr.offset_by(1);
                Ok(EvalPlan {
                    instructions: vec![Instruction::SetPrimitive {
                        address,
                        value: ept::Primitive::Nil,
                    }],
                    binding: EpBinding::Single(address),
                })
            }
            SingleValue::Literal(expr) => {
                let kcep_val = kcl_literal_to_kcep_literal(expr.value);
                // KCEP primitives always have size of 1, because each address holds 1 primitive.
                let size = 1;
                let address = self.next_addr.offset_by(size);
                Ok(EvalPlan {
                    instructions: vec![Instruction::SetPrimitive {
                        address,
                        value: kcep_val,
                    }],
                    binding: EpBinding::Single(address),
                })
            }
            SingleValue::Identifier(expr) => {
                // This is just duplicating a binding.
                // So, don't emit any instructions, because the value has already been computed.
                // Just return the address that it was stored at after being computed.
                let previously_bound_to = self
                    .binding_scope
                    .get(&expr.name)
                    .ok_or(CompileError::Undefined { name: expr.name })?;
                Ok(EvalPlan {
                    instructions: Vec::new(),
                    binding: previously_bound_to.clone(),
                })
            }
            SingleValue::BinaryExpression(expr) => {
                let l = self.plan_to_compute_single(SingleValue::from(expr.left))?;
                let r = self.plan_to_compute_single(SingleValue::from(expr.right))?;
                let EpBinding::Single(l_binding) = l.binding else {
                    return Err(CompileError::InvalidOperand(
                        "you tried to use a composite value (e.g. array or object) as the operand to some math",
                    ));
                };
                let EpBinding::Single(r_binding) = r.binding else {
                    return Err(CompileError::InvalidOperand(
                        "you tried to use a composite value (e.g. array or object) as the operand to some math",
                    ));
                };
                let destination = self.next_addr.offset_by(1);
                let mut plan = Vec::with_capacity(l.instructions.len() + r.instructions.len() + 1);
                plan.extend(l.instructions);
                plan.extend(r.instructions);
                plan.push(Instruction::Arithmetic {
                    arithmetic: ep::Arithmetic {
                        operation: match expr.operator {
                            ast::types::BinaryOperator::Add => ep::Operation::Add,
                            ast::types::BinaryOperator::Sub => ep::Operation::Sub,
                            ast::types::BinaryOperator::Mul => ep::Operation::Mul,
                            ast::types::BinaryOperator::Div => ep::Operation::Div,
                            ast::types::BinaryOperator::Mod => {
                                todo!("execution plan instruction set doesn't support Mod yet")
                            }
                            ast::types::BinaryOperator::Pow => {
                                todo!("execution plan instruction set doesn't support Pow yet")
                            }
                        },
                        operand0: ep::Operand::Reference(l_binding),
                        operand1: ep::Operand::Reference(r_binding),
                    },
                    destination,
                });
                Ok(EvalPlan {
                    instructions: plan,
                    binding: EpBinding::Single(destination),
                })
            }
            SingleValue::CallExpression(expr) => {
                let (mut instructions, args) = expr.arguments.into_iter().try_fold(
                    (Vec::new(), Vec::new()),
                    |(mut acc_instrs, mut acc_args), argument| {
                        let EvalPlan {
                            instructions: new_instructions,
                            binding: arg,
                        } = match KclValueGroup::from(argument) {
                            KclValueGroup::Single(value) => self.plan_to_compute_single(value)?,
                            KclValueGroup::ArrayExpression(_) => todo!(),
                            KclValueGroup::ObjectExpression(_) => todo!(),
                        };
                        acc_instrs.extend(new_instructions);
                        acc_args.push(arg);
                        Ok((acc_instrs, acc_args))
                    },
                )?;
                let callee = match self.binding_scope.get_fn(&expr.callee.name) {
                    GetFnResult::Found(f) => f,
                    GetFnResult::NonCallable => {
                        return Err(CompileError::NotCallable {
                            name: expr.callee.name.clone(),
                        });
                    }
                    GetFnResult::NotFound => {
                        return Err(CompileError::Undefined {
                            name: expr.callee.name.clone(),
                        })
                    }
                };

                let EvalPlan {
                    instructions: eval_instrs,
                    binding,
                } = callee.call(&mut self.next_addr, args)?;
                instructions.extend(eval_instrs);
                Ok(EvalPlan { instructions, binding })
            }
            SingleValue::MemberExpression(mut expr) => {
                let parse = move || {
                    let mut stack = Vec::new();
                    loop {
                        stack.push((expr.property, expr.computed));
                        match expr.object {
                            ast::types::MemberObject::MemberExpression(subexpr) => {
                                expr = subexpr;
                            }
                            ast::types::MemberObject::Identifier(id) => return (stack, id),
                        }
                    }
                };
                let (properties, id) = parse();
                let name = id.name;
                let mut binding = self.binding_scope.get(&name).ok_or(CompileError::Undefined { name })?;
                for (property, computed) in properties {
                    if computed {
                        todo!("Support computed properties");
                    }
                    binding = binding.property_of(property)?;
                }
                Ok(EvalPlan {
                    instructions: Vec::new(),
                    binding: binding.clone(),
                })
            }
            SingleValue::PipeExpression(_) => todo!(),
            SingleValue::UnaryExpression(_) => todo!(),
        }
    }

    /// Emits instructions which, when run, compute a given KCL value and store it in memory.
    /// Returns the instructions.
    /// Also binds the value to a name.
    fn plan_to_bind(
        &mut self,
        declarations: ast::types::VariableDeclaration,
    ) -> Result<Vec<Instruction>, CompileError> {
        declarations
            .declarations
            .into_iter()
            .try_fold(Vec::new(), |mut acc, declaration| {
                let (instrs, binding) = self.plan_to_bind_one(declaration.init)?;
                self.binding_scope.bind(declaration.id.name, binding);
                acc.extend(instrs);
                Ok(acc)
            })
    }

    fn plan_to_bind_one(
        &mut self,
        value_being_bound: ast::types::Value,
    ) -> Result<(Vec<Instruction>, EpBinding), CompileError> {
        match KclValueGroup::from(value_being_bound) {
            KclValueGroup::Single(init_value) => {
                // Simple! Just evaluate it, note where the final value will be stored in KCEP memory,
                // and bind it to the KCL identifier.
                let EvalPlan { instructions, binding } = self.plan_to_compute_single(init_value)?;
                Ok((instructions, binding))
            }
            KclValueGroup::ArrayExpression(expr) => {
                // First, emit a plan to compute each element of the array.
                // Collect all the bindings from each element too.
                let (instructions, bindings) = expr.elements.into_iter().try_fold(
                    (Vec::new(), Vec::new()),
                    |(mut acc_instrs, mut acc_bindings), element| {
                        match KclValueGroup::from(element) {
                            KclValueGroup::Single(value) => {
                                // If this element of the array is a single value, then binding it is
                                // straightforward -- you got a single binding, no need to change anything.
                                let EvalPlan { instructions, binding } = self.plan_to_compute_single(value)?;
                                acc_instrs.extend(instructions);
                                acc_bindings.push(binding);
                            }
                            KclValueGroup::ArrayExpression(expr) => {
                                // If this element of the array is _itself_ an array, then we need to
                                // emit a plan to calculate each element of this child array.
                                // Then we collect the child array's bindings, and bind them to one
                                // element of the parent array.
                                let binding = expr
                                    .elements
                                    .into_iter()
                                    .try_fold(Vec::new(), |mut seq, child_element| {
                                        let (instructions, binding) = self.plan_to_bind_one(child_element)?;
                                        acc_instrs.extend(instructions);
                                        seq.push(binding);
                                        Ok(seq)
                                    })
                                    .map(EpBinding::Sequence)?;
                                acc_bindings.push(binding);
                            }
                            KclValueGroup::ObjectExpression(expr) => {
                                // If this element of the array is an object, then we need to
                                // emit a plan to calculate each value of each property of the object.
                                // Then we collect the bindings for each child value, and bind them to one
                                // element of the parent array.
                                let map = HashMap::with_capacity(expr.properties.len());
                                let binding = expr
                                    .properties
                                    .into_iter()
                                    .try_fold(map, |mut map, property| {
                                        let (instructions, binding) = self.plan_to_bind_one(property.value)?;
                                        map.insert(property.key.name, binding);
                                        acc_instrs.extend(instructions);
                                        Ok(map)
                                    })
                                    .map(EpBinding::Map)?;
                                acc_bindings.push(binding);
                            }
                        };
                        Ok((acc_instrs, acc_bindings))
                    },
                )?;
                Ok((instructions, EpBinding::Sequence(bindings)))
            }
            KclValueGroup::ObjectExpression(expr) => {
                // Convert the object to a sequence of key-value pairs.
                let mut kvs = expr.properties.into_iter().map(|prop| (prop.key, prop.value));
                let (instructions, each_property_binding) = kvs.try_fold(
                    (Vec::new(), HashMap::new()),
                    |(mut acc_instrs, mut acc_bindings), (key, value)| {
                        match KclValueGroup::from(value) {
                            KclValueGroup::Single(value) => {
                                let EvalPlan { instructions, binding } = self.plan_to_compute_single(value)?;
                                acc_instrs.extend(instructions);
                                acc_bindings.insert(key.name, binding);
                            }
                            KclValueGroup::ArrayExpression(expr) => {
                                // If this value of the object is an array, then emit a plan to calculate
                                // each element of that array. Collect their bindings, and bind them all
                                // under one property of the parent object.
                                let n = expr.elements.len();
                                let binding = expr
                                    .elements
                                    .into_iter()
                                    .try_fold(Vec::with_capacity(n), |mut seq, child_element| {
                                        let (instructions, binding) = self.plan_to_bind_one(child_element)?;
                                        seq.push(binding);
                                        acc_instrs.extend(instructions);
                                        Ok(seq)
                                    })
                                    .map(EpBinding::Sequence)?;
                                acc_bindings.insert(key.name, binding);
                            }
                            KclValueGroup::ObjectExpression(expr) => {
                                // If this value of the object is _itself_ an object, then we need to
                                // emit a plan to calculate each value of each property of the child object.
                                // Then we collect the bindings for each child value, and bind them to one
                                // property of the parent object.
                                let n = expr.properties.len();
                                let binding = expr
                                    .properties
                                    .into_iter()
                                    .try_fold(HashMap::with_capacity(n), |mut map, property| {
                                        let (instructions, binding) = self.plan_to_bind_one(property.value)?;
                                        map.insert(property.key.name, binding);
                                        acc_instrs.extend(instructions);
                                        Ok(map)
                                    })
                                    .map(EpBinding::Map)?;
                                acc_bindings.insert(key.name, binding);
                            }
                        };
                        Ok((acc_instrs, acc_bindings))
                    },
                )?;
                Ok((instructions, EpBinding::Map(each_property_binding)))
            }
        }
    }
}

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
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Compile(#[from] CompileError),
    #[error("{0}")]
    Execution(#[from] ExecutionError),
}

type PlanRes = Result<Vec<Instruction>, CompileError>;

/// Every KCL literal value is equivalent to an Execution Plan value, and therefore can be
/// bound to some KCL name and Execution Plan address.
fn kcl_literal_to_kcep_literal(expr: LiteralValue) -> ept::Primitive {
    match expr {
        LiteralValue::IInteger(x) => ept::Primitive::NumericValue(NumericPrimitive::Integer(x)),
        LiteralValue::Fractional(x) => ept::Primitive::NumericValue(NumericPrimitive::Float(x)),
        LiteralValue::String(x) => ept::Primitive::String(x),
    }
}

/// Instructions that can compute some value.
struct EvalPlan {
    /// The instructions which will compute the value.
    instructions: Vec<Instruction>,
    /// Where the value will be stored.
    binding: EpBinding,
}

trait KclFunction: std::fmt::Debug {
    fn call(&self, next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError>;
}

/// Either an owned string, or a static string. Either way it can be read and moved around.
pub type String2 = std::borrow::Cow<'static, str>;
