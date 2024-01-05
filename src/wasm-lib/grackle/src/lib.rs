mod native_functions;
#[cfg(test)]
mod tests;

use std::borrow::Cow;
use std::collections::HashMap;

use kcl_lib::ast::types::KclNone;
use kittycad_execution_plan as ep;
use kittycad_execution_plan::{Address, ExecutionError, Instruction};
use kittycad_execution_plan_traits as ept;
use kittycad_execution_plan_traits::NumericPrimitive;
use kittycad_modeling_session::Session;

use kcl_lib::{
    ast,
    ast::types::{BinaryPart, BodyItem, LiteralValue, Program, VariableDeclaration},
};

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
    binding_scope: BindingScope,
    next_addr: Address,
}

enum SingleValue {
    Literal(Box<ast::types::Literal>),
    Identifier(Box<ast::types::Identifier>),
    BinaryExpression(Box<ast::types::BinaryExpression>),
    CallExpression(Box<ast::types::CallExpression>),
    PipeExpression(Box<ast::types::PipeExpression>),
    UnaryExpression(Box<ast::types::UnaryExpression>),
    KclNoneExpression(ast::types::KclNone),
    MemberExpression(Box<ast::types::MemberExpression>),
}

enum MultipleValue {
    ArrayExpression(Box<ast::types::ArrayExpression>),
}

enum KclValueBySize {
    Single(SingleValue),
    Multiple(MultipleValue),
}

impl From<ast::types::BinaryPart> for KclValueBySize {
    fn from(value: ast::types::BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(e) => Self::Single(SingleValue::Literal(e)),
            BinaryPart::Identifier(e) => Self::Single(SingleValue::Identifier(e)),
            BinaryPart::BinaryExpression(e) => Self::Single(SingleValue::BinaryExpression(e)),
            BinaryPart::CallExpression(e) => Self::Single(SingleValue::CallExpression(e)),
            BinaryPart::UnaryExpression(e) => Self::Single(SingleValue::UnaryExpression(e)),
            BinaryPart::MemberExpression(e) => Self::Single(SingleValue::MemberExpression(e)),
        }
    }
}

impl From<ast::types::BinaryPart> for SingleValue {
    fn from(value: ast::types::BinaryPart) -> Self {
        match value {
            BinaryPart::Literal(e) => Self::Literal(e),
            BinaryPart::Identifier(e) => Self::Identifier(e),
            BinaryPart::BinaryExpression(e) => Self::BinaryExpression(e),
            BinaryPart::CallExpression(e) => Self::CallExpression(e),
            BinaryPart::UnaryExpression(e) => Self::UnaryExpression(e),
            BinaryPart::MemberExpression(_) => todo!("support member expressions"),
        }
    }
}

impl From<ast::types::Value> for KclValueBySize {
    fn from(value: ast::types::Value) -> Self {
        match value {
            ast::types::Value::Literal(e) => Self::Single(SingleValue::Literal(e)),
            ast::types::Value::Identifier(e) => Self::Single(SingleValue::Identifier(e)),
            ast::types::Value::BinaryExpression(e) => Self::Single(SingleValue::BinaryExpression(e)),
            ast::types::Value::CallExpression(e) => Self::Single(SingleValue::CallExpression(e)),
            ast::types::Value::PipeExpression(e) => Self::Single(SingleValue::PipeExpression(e)),
            ast::types::Value::None(e) => Self::Single(SingleValue::KclNoneExpression(e)),
            ast::types::Value::UnaryExpression(e) => Self::Single(SingleValue::UnaryExpression(e)),
            ast::types::Value::ArrayExpression(e) => Self::Multiple(MultipleValue::ArrayExpression(e)),
            ast::types::Value::ObjectExpression(_)
            | ast::types::Value::PipeSubstitution(_)
            | ast::types::Value::FunctionExpression(_)
            | ast::types::Value::MemberExpression(_) => todo!(),
        }
    }
}

impl Planner {
    pub fn new() -> Self {
        Self {
            binding_scope: BindingScope::prelude(),
            next_addr: Address::ZERO,
        }
    }

    fn build_plan(&mut self, program: Program) -> PlanRes {
        let mut instructions = Vec::new();
        for item in program.body {
            instructions.extend(self.visit_body_item(item)?);
        }
        Ok(instructions)
    }

    /// Emits instructions which, when run, compute a given KCL value and store it in memory.
    /// Returns the instructions, and the destination address of the value.
    fn plan_to_compute_single(&mut self, value: SingleValue) -> Result<(Vec<Instruction>, EpBinding), CompileError> {
        match value {
            SingleValue::KclNoneExpression(KclNone { start: _, end: _ }) => {
                let address = self.next_addr.offset_by(1);
                Ok((
                    vec![Instruction::SetPrimitive {
                        address,
                        value: ept::Primitive::Nil,
                    }],
                    EpBinding::Single(address),
                ))
            }
            SingleValue::Literal(expr) => {
                let kcep_val = kcl_literal_to_kcep_literal(expr.value);
                // KCEP primitives always have size of 1, because each address holds 1 primitive.
                let size = 1;
                let address = self.next_addr.offset_by(size);
                Ok((
                    vec![Instruction::SetPrimitive {
                        address,
                        value: kcep_val,
                    }],
                    EpBinding::Single(address),
                ))
            }
            SingleValue::Identifier(expr) => {
                // This is just duplicating a binding.
                // So, don't emit any instructions, because the value has already been computed.
                // Just return the address that it was stored at after being computed.
                let previously_bound_to = self
                    .binding_scope
                    .get(&expr.name)
                    .ok_or(CompileError::Undefined { name: expr.name })?;
                Ok((Vec::new(), previously_bound_to.clone()))
            }
            SingleValue::BinaryExpression(expr) => {
                let l = SingleValue::from(expr.left);
                let r = SingleValue::from(expr.right);
                let (l_plan, l_binding) = self.plan_to_compute_single(l)?;
                let (r_plan, r_binding) = self.plan_to_compute_single(r)?;
                let EpBinding::Single(l_binding) = l_binding else {
                    return Err(CompileError::InvalidOperand(
                        "you tried to use a composite value (e.g. array or object) as the operand to some math",
                    ));
                };
                let EpBinding::Single(r_binding) = r_binding else {
                    return Err(CompileError::InvalidOperand(
                        "you tried to use a composite value (e.g. array or object) as the operand to some math",
                    ));
                };
                let destination = self.next_addr.offset_by(1);
                let mut plan = Vec::with_capacity(l_plan.len() + r_plan.len() + 1);
                plan.extend(l_plan);
                plan.extend(r_plan);
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
                Ok((plan, EpBinding::Single(destination)))
            }
            SingleValue::CallExpression(expr) => {
                let (mut instructions, args) = expr.arguments.into_iter().try_fold(
                    (Vec::new(), Vec::new()),
                    |(mut acc_instrs, mut acc_args), argument| {
                        let (new_instructions, arg_address) = match KclValueBySize::from(argument) {
                            KclValueBySize::Single(value) => self.plan_to_compute_single(value)?,
                            KclValueBySize::Multiple(_) => todo!(),
                        };
                        acc_instrs.extend(new_instructions);
                        acc_args.push(arg_address);
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
                Ok((instructions, binding))
            }
            SingleValue::PipeExpression(_) => todo!(),
            SingleValue::UnaryExpression(_) => todo!(),
            SingleValue::MemberExpression(_) => todo!(),
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
                match KclValueBySize::from(declaration.init) {
                    KclValueBySize::Single(init_value) => {
                        let (instructions, binding) = self.plan_to_compute_single(init_value)?;
                        self.binding_scope.bind(declaration.id.name, binding);
                        acc.extend(instructions);
                        Ok(acc)
                    }
                    KclValueBySize::Multiple(MultipleValue::ArrayExpression(expr)) => {
                        let (instructions, addresses) = expr.elements.into_iter().try_fold(
                            (Vec::new(), Vec::new()),
                            |(mut acc_instrs, mut acc_addrs), element| {
                                let value = match KclValueBySize::from(element) {
                                    KclValueBySize::Single(v) => v,
                                    KclValueBySize::Multiple(_) => todo!("handle arrays of composite values"),
                                };
                                let (instructions, dst) = self.plan_to_compute_single(value)?;
                                acc_instrs.extend(instructions);
                                acc_addrs.extend(Vec::from(dst));
                                Ok((acc_instrs, acc_addrs))
                            },
                        )?;
                        self.binding_scope
                            .bind(declaration.id.name.clone(), EpBinding::Composite(addresses));
                        Ok(instructions)
                    }
                }
            })
    }
}

#[derive(Debug, thiserror::Error, Eq, PartialEq, Clone)]
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
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Compile(#[from] CompileError),
    #[error("{0}")]
    Execution(#[from] ExecutionError),
}

/// Something that can traverse expression trees, visiting nodes.
/// When a node gets visited, it returns some type R.
trait ExprVisitor<R> {
    fn visit_body_item(&mut self, item: BodyItem) -> R;
    fn visit_variable_declaration(&mut self, vd: VariableDeclaration) -> R;
}

type PlanRes = Result<Vec<Instruction>, CompileError>;

impl ExprVisitor<PlanRes> for Planner {
    fn visit_body_item(&mut self, item: BodyItem) -> PlanRes {
        match item {
            BodyItem::VariableDeclaration(vd) => self.visit_variable_declaration(vd),
            BodyItem::ExpressionStatement(_) => todo!(),
            BodyItem::ReturnStatement(_) => todo!(),
        }
    }

    fn visit_variable_declaration(&mut self, variable_declaration: VariableDeclaration) -> PlanRes {
        self.plan_to_bind(variable_declaration)
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

trait KclFunction {
    fn call(&self, next_addr: &mut Address, args: Vec<EpBinding>) -> Result<EvalPlan, CompileError>;
}

/// KCL values which can be written to KCEP memory.
#[derive(Clone)]
enum EpBinding {
    /// A KCL value which gets stored in a particular address in KCEP memory.
    Single(Address),
    /// A sequence of KCL values which get stored in a consecutive set of addresses in KCEP memory.
    Composite(Vec<Address>),
}

impl From<EpBinding> for Vec<Address> {
    fn from(value: EpBinding) -> Self {
        match value {
            EpBinding::Single(addr) => vec![addr],
            EpBinding::Composite(addrs) => addrs,
        }
    }
}

/// A set of bindings in a particular scope.
/// Bindings are KCL values that get "compiled" into KCEP values, which are stored in KCEP memory
/// at a particular KCEP address.
/// Bindings are referenced by the name of their KCL identifier.
///
/// KCL has multiple scopes -- each function has a scope for its own local variables and parameters.
/// So when referencing a variable, it might be in this scope, or the parent scope. So, each environment
/// has to keep track of parent environments. The root environment has no parent, and is used for KCL globals
/// (e.g. the prelude of stdlib functions).
///
/// These are called "Environments" in the "Crafting Interpreters" book.
struct BindingScope {
    // KCL value which are stored in EP memory.
    ep_bindings: HashMap<String, EpBinding>,
    /// KCL functions. They do NOT get stored in EP memory.
    function_bindings: HashMap<String2, Box<dyn KclFunction>>,
    parent: Option<Box<BindingScope>>,
}

/// Either an owned string, or a static string. Either way it can be read and moved around.
type String2 = Cow<'static, str>;

impl BindingScope {
    /// The parent scope for every program, before the user has defined anything.
    /// Only includes some stdlib functions.
    /// This is usually known as the "prelude" in other languages. It's the stdlib functions that
    /// are already imported for you when you start coding.
    pub fn prelude() -> Self {
        Self {
            // TODO: Actually put the stdlib prelude in here,
            // things like `startSketchAt` and `line`.
            function_bindings: HashMap::from([
                ("id".into(), Box::new(native_functions::Id) as _),
                ("add".into(), Box::new(native_functions::Add) as _),
            ]),
            ep_bindings: Default::default(),
            parent: None,
        }
    }

    /// Add a new scope, e.g. for new function calls.
    #[allow(dead_code)] // TODO: when we implement function expressions.
    pub fn add_scope(self) -> Self {
        Self {
            function_bindings: Default::default(),
            ep_bindings: Default::default(),
            parent: Some(Box::new(self)),
        }
    }

    //// Remove a scope, e.g. when exiting a function call.
    #[allow(dead_code)] // TODO: when we implement function expressions.
    pub fn remove_scope(self) -> Self {
        *self.parent.unwrap()
    }

    /// Add a binding (e.g. defining a new variable)
    pub fn bind(&mut self, identifier: String, binding: EpBinding) {
        self.ep_bindings.insert(identifier, binding);
    }

    /// Look up a binding.
    pub fn get(&self, identifier: &str) -> Option<&EpBinding> {
        if let Some(b) = self.ep_bindings.get(identifier) {
            // The name was found in this scope.
            Some(b)
        } else if let Some(ref parent) = self.parent {
            // Check the next scope outwards.
            parent.get(identifier)
        } else {
            // There's no outer scope, and it wasn't found, so there's nowhere else to look.
            None
        }
    }

    /// Look up a function bound to the given identifier.
    fn get_fn(&self, identifier: &str) -> GetFnResult {
        if let Some(f) = self.function_bindings.get(identifier) {
            GetFnResult::Found(f.as_ref())
        } else if self.get(identifier).is_some() {
            GetFnResult::NonCallable
        } else if let Some(ref parent) = self.parent {
            parent.get_fn(identifier)
        } else {
            GetFnResult::NotFound
        }
    }
}

enum GetFnResult<'a> {
    Found(&'a dyn KclFunction),
    NonCallable,
    NotFound,
}
