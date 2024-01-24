mod binding_scope;
mod error;
mod kcl_value_group;
mod native_functions;
#[cfg(test)]
mod tests;

use std::collections::HashMap;

use kcl_lib::{
    ast,
    ast::types::{BodyItem, FunctionExpressionParts, KclNone, LiteralValue, Program},
};
use kittycad_execution_plan as ep;
use kittycad_execution_plan::{Address, Instruction};
use kittycad_execution_plan_traits as ept;
use kittycad_execution_plan_traits::NumericPrimitive;
use kittycad_modeling_session::Session;

use self::binding_scope::{BindingScope, EpBinding, GetFnResult};
use self::error::{CompileError, Error};
use self::kcl_value_group::{KclValueGroup, SingleValue};

/// Execute a KCL program by compiling into an execution plan, then running that.
pub async fn execute(ast: Program, session: Session) -> Result<(), Error> {
    let mut planner = Planner::new();
    let (plan, _retval) = planner.build_plan(ast)?;
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

    /// If successful, return the KCEP instructions for executing the given program.
    /// If the program is a function with a return, then it also returns the KCL function's return value.
    fn build_plan(&mut self, program: Program) -> Result<(Vec<Instruction>, Option<EpBinding>), CompileError> {
        program
            .body
            .into_iter()
            .try_fold((Vec::new(), None), |(mut instructions, mut retval), item| {
                if retval.is_some() {
                    return Err(CompileError::MultipleReturns);
                }
                let mut ctx = Context::default();
                let instructions_for_this_node = match item {
                    BodyItem::ExpressionStatement(node) => match KclValueGroup::from(node.expression) {
                        KclValueGroup::Single(value) => self.plan_to_compute_single(&mut ctx, value)?.instructions,
                        KclValueGroup::ArrayExpression(_) => todo!(),
                        KclValueGroup::ObjectExpression(_) => todo!(),
                    },
                    BodyItem::VariableDeclaration(node) => self.plan_to_bind(node)?,
                    BodyItem::ReturnStatement(node) => match KclValueGroup::from(node.argument) {
                        KclValueGroup::Single(value) => {
                            let EvalPlan { instructions, binding } = self.plan_to_compute_single(&mut ctx, value)?;
                            retval = Some(binding);
                            instructions
                        }
                        KclValueGroup::ArrayExpression(_) => todo!(),
                        KclValueGroup::ObjectExpression(_) => todo!(),
                    },
                };
                instructions.extend(instructions_for_this_node);
                Ok((instructions, retval))
            })
    }

    /// Emits instructions which, when run, compute a given KCL value and store it in memory.
    /// Returns the instructions, and the destination address of the value.
    fn plan_to_compute_single(&mut self, ctx: &mut Context, value: SingleValue) -> Result<EvalPlan, CompileError> {
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
            SingleValue::FunctionExpression(expr) => {
                let FunctionExpressionParts {
                    start: _,
                    end: _,
                    params_required,
                    params_optional,
                    body,
                } = expr.into_parts().map_err(CompileError::BadParamOrder)?;
                Ok(EvalPlan {
                    instructions: Vec::new(),
                    binding: EpBinding::from(KclFunction::UserDefined(UserDefinedFunction {
                        params_optional,
                        params_required,
                        body,
                    })),
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
                // The KCL parser interprets bools as identifiers.
                // Consider changing them to be KCL literals instead.
                let b = if expr.name == "true" {
                    Some(true)
                } else if expr.name == "false" {
                    Some(false)
                } else {
                    None
                };
                if let Some(b) = b {
                    let address = self.next_addr.offset_by(1);
                    return Ok(EvalPlan {
                        instructions: vec![Instruction::SetPrimitive {
                            address,
                            value: ept::Primitive::Bool(b),
                        }],
                        binding: EpBinding::Single(address),
                    });
                }

                // This identifier is just duplicating a binding.
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
            SingleValue::UnaryExpression(expr) => {
                let operand = self.plan_to_compute_single(ctx, SingleValue::from(expr.argument))?;
                let EpBinding::Single(binding) = operand.binding else {
                    return Err(CompileError::InvalidOperand(
                        "you tried to use a composite value (e.g. array or object) as the operand to some math",
                    ));
                };
                let destination = self.next_addr.offset_by(1);
                let mut plan = operand.instructions;
                plan.push(Instruction::UnaryArithmetic {
                    arithmetic: ep::UnaryArithmetic {
                        operation: match expr.operator {
                            ast::types::UnaryOperator::Neg => ep::UnaryOperation::Neg,
                            ast::types::UnaryOperator::Not => ep::UnaryOperation::Not,
                        },
                        operand: ep::Operand::Reference(binding),
                    },
                    destination,
                });
                Ok(EvalPlan {
                    instructions: plan,
                    binding: EpBinding::Single(destination),
                })
            }
            SingleValue::BinaryExpression(expr) => {
                let l = self.plan_to_compute_single(ctx, SingleValue::from(expr.left))?;
                let r = self.plan_to_compute_single(ctx, SingleValue::from(expr.right))?;
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
                plan.push(Instruction::BinaryArithmetic {
                    arithmetic: ep::BinaryArithmetic {
                        operation: match expr.operator {
                            ast::types::BinaryOperator::Add => ep::BinaryOperation::Add,
                            ast::types::BinaryOperator::Sub => ep::BinaryOperation::Sub,
                            ast::types::BinaryOperator::Mul => ep::BinaryOperation::Mul,
                            ast::types::BinaryOperator::Div => ep::BinaryOperation::Div,
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
                // Make a plan to compute all the arguments to this call.
                let (mut instructions, args) = expr.arguments.into_iter().try_fold(
                    (Vec::new(), Vec::new()),
                    |(mut acc_instrs, mut acc_args), argument| {
                        let EvalPlan {
                            instructions: new_instructions,
                            binding: arg,
                        } = match KclValueGroup::from(argument) {
                            KclValueGroup::Single(value) => self.plan_to_compute_single(ctx, value)?,
                            KclValueGroup::ArrayExpression(expr) => self.plan_to_bind_array(ctx, *expr)?,
                            KclValueGroup::ObjectExpression(_) => todo!(),
                        };
                        acc_instrs.extend(new_instructions);
                        acc_args.push(arg);
                        Ok((acc_instrs, acc_args))
                    },
                )?;
                // Look up the function being called.
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

                // Emit instructions to call that function with the given arguments.
                use native_functions::Callable;
                let EvalPlan {
                    instructions: eval_instrs,
                    binding,
                } = match callee {
                    KclFunction::Id(f) => f.call(&mut self.next_addr, args)?,
                    KclFunction::StartSketchAt(f) => f.call(&mut self.next_addr, args)?,
                    KclFunction::Add(f) => f.call(&mut self.next_addr, args)?,
                    KclFunction::UserDefined(f) => {
                        let UserDefinedFunction {
                            params_optional,
                            params_required,
                            body: function_body,
                        } = f.clone();
                        let num_required_params = params_required.len();
                        self.binding_scope.add_scope();

                        // Bind the call's arguments to the names of the function's parameters.
                        let num_actual_params = args.len();
                        let mut arg_iter = args.into_iter();
                        let max_params = params_required.len() + params_optional.len();
                        if num_actual_params > max_params {
                            return Err(CompileError::TooManyArgs {
                                fn_name: "".into(),
                                maximum: max_params,
                                actual: num_actual_params,
                            });
                        }

                        // Bind required parameters
                        for param in params_required {
                            let arg = arg_iter.next().ok_or(CompileError::NotEnoughArgs {
                                fn_name: "".into(),
                                required: num_required_params,
                                actual: num_actual_params,
                            })?;
                            self.binding_scope.bind(param.identifier.name, arg);
                        }

                        // Bind optional parameters
                        for param in params_optional {
                            let Some(arg) = arg_iter.next() else {
                                break;
                            };
                            self.binding_scope.bind(param.identifier.name, arg);
                        }

                        let (instructions, retval) = self.build_plan(function_body)?;
                        let Some(retval) = retval else {
                            return Err(CompileError::NoReturnStmt);
                        };
                        self.binding_scope.remove_scope();
                        EvalPlan {
                            instructions,
                            binding: retval,
                        }
                    }
                };

                // Combine the "evaluate arguments" plan with the "call function" plan.
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
                        todo!("Support computed properties like '{:?}'", property);
                    } else {
                        binding = binding.property_of(property)?;
                    }
                }
                Ok(EvalPlan {
                    instructions: Vec::new(),
                    binding: binding.clone(),
                })
            }
            SingleValue::PipeSubstitution(_expr) => {
                if let Some(ref binding) = ctx.pipe_substitution {
                    Ok(EvalPlan {
                        instructions: Vec::new(),
                        binding: binding.clone(),
                    })
                } else {
                    Err(CompileError::NotInPipeline)
                }
            }
            SingleValue::PipeExpression(expr) => {
                let mut bodies = expr.body.into_iter();

                // Get the first expression (i.e. body) of the pipeline.
                let first = bodies.next().expect("Pipe expression must have > 1 item");
                let EvalPlan {
                    mut instructions,
                    binding: mut current_value,
                } = match KclValueGroup::from(first) {
                    KclValueGroup::Single(v) => self.plan_to_compute_single(ctx, v)?,
                    KclValueGroup::ArrayExpression(_) => todo!(),
                    KclValueGroup::ObjectExpression(_) => todo!(),
                };

                // Handle the remaining bodies.
                for body in bodies {
                    let value = match KclValueGroup::from(body) {
                        KclValueGroup::Single(v) => v,
                        KclValueGroup::ArrayExpression(_) => todo!(),
                        KclValueGroup::ObjectExpression(_) => todo!(),
                    };
                    // This body will probably contain a % (pipe substitution character).
                    // So it needs to know what the previous pipeline body's value is,
                    // to replace the % with that value.
                    ctx.pipe_substitution = Some(current_value.clone());
                    let EvalPlan {
                        instructions: instructions_for_this_body,
                        binding,
                    } = self.plan_to_compute_single(ctx, value)?;
                    instructions.extend(instructions_for_this_body);
                    current_value = binding;
                }
                // Before we return, clear the pipe substitution, because nothing outside this
                // pipeline should be able to use it anymore.
                ctx.pipe_substitution = None;
                Ok(EvalPlan {
                    instructions,
                    binding: current_value,
                })
            }
        }
    }

    /// Emits instructions which, when run, compute a given KCL value and store it in memory.
    /// Returns the instructions.
    /// Also binds the value to a name.
    fn plan_to_bind(
        &mut self,
        declarations: ast::types::VariableDeclaration,
    ) -> Result<Vec<Instruction>, CompileError> {
        let mut ctx = Context::default();
        declarations
            .declarations
            .into_iter()
            .try_fold(Vec::new(), |mut acc, declaration| {
                let EvalPlan { instructions, binding } = self.plan_to_bind_one(&mut ctx, declaration.init)?;
                self.binding_scope.bind(declaration.id.name, binding);
                acc.extend(instructions);
                Ok(acc)
            })
    }

    fn plan_to_bind_one(
        &mut self,
        ctx: &mut Context,
        value_being_bound: ast::types::Value,
    ) -> Result<EvalPlan, CompileError> {
        match KclValueGroup::from(value_being_bound) {
            KclValueGroup::Single(init_value) => {
                // Simple! Just evaluate it, note where the final value will be stored in KCEP memory,
                // and bind it to the KCL identifier.
                self.plan_to_compute_single(ctx, init_value)
            }
            KclValueGroup::ArrayExpression(expr) => self.plan_to_bind_array(ctx, *expr),
            KclValueGroup::ObjectExpression(expr) => {
                // Convert the object to a sequence of key-value pairs.
                let mut kvs = expr.properties.into_iter().map(|prop| (prop.key, prop.value));
                let (instructions, each_property_binding) = kvs.try_fold(
                    (Vec::new(), HashMap::new()),
                    |(mut acc_instrs, mut acc_bindings), (key, value)| {
                        match KclValueGroup::from(value) {
                            KclValueGroup::Single(value) => {
                                let EvalPlan { instructions, binding } = self.plan_to_compute_single(ctx, value)?;
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
                                        let EvalPlan { instructions, binding } =
                                            self.plan_to_bind_one(ctx, child_element)?;
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
                                        let EvalPlan { instructions, binding } =
                                            self.plan_to_bind_one(ctx, property.value)?;
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
                Ok(EvalPlan {
                    instructions,
                    binding: EpBinding::Map(each_property_binding),
                })
            }
        }
    }

    fn plan_to_bind_array(
        &mut self,
        ctx: &mut Context,
        expr: ast::types::ArrayExpression,
    ) -> Result<EvalPlan, CompileError> {
        // First, emit a plan to compute each element of the array.
        // Collect all the bindings from each element too.
        let (instructions, bindings) = expr.elements.into_iter().try_fold(
            (Vec::new(), Vec::new()),
            |(mut acc_instrs, mut acc_bindings), element| {
                match KclValueGroup::from(element) {
                    KclValueGroup::Single(value) => {
                        // If this element of the array is a single value, then binding it is
                        // straightforward -- you got a single binding, no need to change anything.
                        let EvalPlan { instructions, binding } = self.plan_to_compute_single(ctx, value)?;
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
                                let EvalPlan { instructions, binding } = self.plan_to_bind_one(ctx, child_element)?;
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
                                let EvalPlan { instructions, binding } = self.plan_to_bind_one(ctx, property.value)?;
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
        Ok(EvalPlan {
            instructions,
            binding: EpBinding::Sequence(bindings),
        })
    }
}

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

/// Either an owned string, or a static string. Either way it can be read and moved around.
pub type String2 = std::borrow::Cow<'static, str>;

#[derive(Debug, Clone)]
struct UserDefinedFunction {
    params_optional: Vec<ast::types::Parameter>,
    params_required: Vec<ast::types::Parameter>,
    body: ast::types::Program,
}

impl PartialEq for UserDefinedFunction {
    fn eq(&self, other: &Self) -> bool {
        self.params_optional == other.params_optional && self.params_required == other.params_required
    }
}

impl Eq for UserDefinedFunction {}

#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
enum KclFunction {
    Id(native_functions::Id),
    StartSketchAt(native_functions::StartSketchAt),
    Add(native_functions::Add),
    UserDefined(UserDefinedFunction),
}

/// Context used when compiling KCL.
#[derive(Default, Debug)]
struct Context {
    pipe_substitution: Option<EpBinding>,
}
