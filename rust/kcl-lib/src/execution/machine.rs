//! The CEK machine executor: evaluates KCL on an explicit, heap-allocated
//! continuation stack instead of the native call stack.
//!
//! The recursive executor (`execute_expr` and friends in `exec_ast.rs`) grows
//! the native stack proportionally to KCL nesting depth, which overflows in
//! wasm. This module re-expresses evaluation as a CEK abstract machine with an
//! ambient mutable store:
//!
//! - C (control): [`Control`] -- either descend into an expression
//!   ([`Control::Eval`]), hand a finished value to the innermost continuation
//!   ([`Control::Apply`]), or unwind an `exit()` ([`Control::Exit`]).
//! - E (environment): already reified as `EnvironmentRef` plus the mutable
//!   env-stack arena, exactly as the recursive executor uses it.
//! - K (continuations): a `Vec<Kont>`, one defunctionalized variant per
//!   recursion site of the recursive executor.
//!
//! The store (artifacts, operations log, id generators, engine connection) is
//! ambient `&mut ExecState`, threaded through every step -- so this is a CEK
//! machine with an ambient mutable store, not a pure CESK machine.
//!
//! Async stays async: engine I/O and ordinary stdlib calls remain flat
//! `.await` leaves inside the loop. They do not grow the native stack with KCL
//! depth. Only recursion on evaluating KCL expressions moved onto the explicit
//! stack.
//!
//! Semantics contract: this machine replicates the recursive executor
//! byte-for-byte -- including evaluation order (ids and engine commands are
//! order-dependent), the operations log, ambient-state save/restore, error
//! paths (including their historical asymmetries), and the deliberate
//! write-and-continue behavior of `return` statements. The simulation-test
//! suite runs under both executors and requires identical snapshots.
//!
//! Bounded native re-entry still exists in two places, by design:
//! - Module execution (imports, module-value results) runs the module body in
//!   a fresh machine root via `exec_module_body`, adding O(1) native frames
//!   per module nesting level.
//! - Until the resumable-callback phase lands, higher-order stdlib functions
//!   (`map`, `reduce`, `patternTransform`) call back into KCL through
//!   `call_kw`, which fresh-roots a machine run per callback, adding O(1)
//!   native frames per callback nesting level (bounded by the recursive
//!   executor's call-stack cap, which still guards that path).

use std::sync::Arc;

use indexmap::IndexMap;

use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::ArtifactId;
use crate::execution::BodyType;
use crate::execution::ExecState;
use crate::execution::ExecutorContext;
use crate::execution::KclValue;
use crate::execution::KclValueControlFlow;
use crate::execution::Metadata;
use crate::execution::ModelingCmdMeta;
use crate::execution::SketchSurface;
use crate::execution::cad_op::Operation;
use crate::execution::exec_ast::Property;
use crate::execution::fn_call::Arg;
use crate::execution::fn_call::Args;
use crate::execution::fn_call::CallState;
use crate::execution::kcl_value::FunctionBody;
use crate::execution::kcl_value::FunctionSource;
use crate::execution::kcl_value::KclObjectFields;
use crate::execution::state::SketchBlockState;
use crate::execution::types::PrimitiveType;
use crate::execution::types::RuntimeType;
use crate::front::ObjectId;
use crate::parsing::ast::types::Annotation;
use crate::parsing::ast::types::ArrayExpression;
use crate::parsing::ast::types::ArrayRangeExpression;
use crate::parsing::ast::types::AscribedExpression;
use crate::parsing::ast::types::BinaryExpression;
use crate::parsing::ast::types::BinaryPart;
use crate::parsing::ast::types::Block;
use crate::parsing::ast::types::BodyItem;
use crate::parsing::ast::types::CallExpressionKw;
use crate::parsing::ast::types::CodeBlock;
use crate::parsing::ast::types::Expr;
use crate::parsing::ast::types::FunctionExpression;
use crate::parsing::ast::types::IfExpression;
use crate::parsing::ast::types::LabelledExpression;
use crate::parsing::ast::types::MemberExpression;
use crate::parsing::ast::types::Node;
use crate::parsing::ast::types::ObjectExpression;
use crate::parsing::ast::types::PipeExpression;
use crate::parsing::ast::types::Program;
use crate::parsing::ast::types::SketchBlock;
use crate::parsing::ast::types::UnaryExpression;

/// Which executor evaluates KCL. Crate-internal: set on
/// [`ExecutorContext`] at construction time and immutable during a run.
/// Cloning the context (fresh roots, `Args`) inherits the same kind, so every
/// module and callback runs on the same executor.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum ExecutorKind {
    /// The historical recursive tree-walking evaluator.
    #[default]
    Recursive,
    /// The CEK machine in this module.
    Machine,
}

impl ExecutorKind {
    /// Test-harness selection of the executor via the `KCL_EXECUTOR` env var
    /// (`machine` or `recursive`). Used only by test context factories so the
    /// simulation suite can run under both executors; production contexts are
    /// never configured from the environment.
    pub(crate) fn from_test_env() -> Self {
        match std::env::var("KCL_EXECUTOR").as_deref() {
            Ok("machine") => ExecutorKind::Machine,
            _ => ExecutorKind::Recursive,
        }
    }
}

/// Default limit for the machine executor's call-depth guard. This replaces
/// the recursive executor's native-stack-motivated cap for machine-native
/// calls: depth is heap-bounded, so the limit is purely a runaway-recursion
/// policy. It must remain correct when internally raised to 50,000 or more.
pub(crate) const DEFAULT_MACHINE_CALL_DEPTH_LIMIT: usize = 1000;

/// Convert an entry block into an owned handle the machine can keep in a
/// continuation without lifetimes.
pub(crate) trait ToMachineBlock {
    fn to_machine_block(&self) -> BlockRef;
}

impl ToMachineBlock for Node<Program> {
    fn to_machine_block(&self) -> BlockRef {
        // One shallow clone per fresh root: children are Arc-backed, so this
        // copies one Vec of enum discriminants, not the tree.
        BlockRef::Program(Arc::new(self.clone()))
    }
}

impl ToMachineBlock for Node<Block> {
    fn to_machine_block(&self) -> BlockRef {
        BlockRef::Block(Arc::new(self.clone()))
    }
}

/// An owned handle to a block of statements. Function and sketch bodies are
/// projected out of their enclosing node's `Arc` so pushing a call costs no
/// clone.
#[derive(Debug, Clone)]
pub(crate) enum BlockRef {
    Program(Arc<Node<Program>>),
    Block(Arc<Node<Block>>),
    FnBody(Arc<Node<FunctionExpression>>),
    SketchBody(Arc<Node<SketchBlock>>),
}

impl BlockRef {
    fn body(&self) -> &[BodyItem] {
        match self {
            BlockRef::Program(p) => p.body(),
            BlockRef::Block(b) => b.body(),
            BlockRef::FnBody(f) => f.body.body(),
            BlockRef::SketchBody(s) => s.body.body(),
        }
    }

    fn to_source_range(&self) -> SourceRange {
        match self {
            BlockRef::Program(p) => p.to_source_range(),
            BlockRef::Block(b) => b.to_source_range(),
            BlockRef::FnBody(f) => f.body.to_source_range(),
            BlockRef::SketchBody(s) => s.body.to_source_range(),
        }
    }
}

/// A node the machine can evaluate. `BinaryPart` is a distinct enum from
/// `Expr` (binary operands are `BinaryPart`s), so the machine's eval step
/// takes this union.
// Variant sizes intentionally differ: these are the machine's heap frames,
// and boxing every payload would add an allocation per step.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone)]
enum EvalNode {
    Expr(Expr),
    BinaryPart(BinaryPart),
}

/// One evaluation request: the node plus the context the recursive executor
/// passed as parameters to `execute_expr`.
#[derive(Debug)]
struct EvalRequest {
    node: EvalNode,
    metadata: Metadata,
    /// `Some(name)` when this is the top-level init of `name = ...`, i.e. the
    /// recursive executor's `StatementKind::Declaration`. Everything else is
    /// `StatementKind::Expression`.
    decl_name: Option<String>,
    /// Outer annotations of the enclosing declaration; consumed by function
    /// expressions. Empty everywhere else.
    annotations: Vec<Node<Annotation>>,
}

impl EvalRequest {
    fn expr(node: &Expr) -> Self {
        EvalRequest {
            node: EvalNode::Expr(node.clone()),
            metadata: Metadata {
                source_range: SourceRange::from(node),
            },
            decl_name: None,
            annotations: Vec::new(),
        }
    }

    fn binary_part(part: &BinaryPart) -> Self {
        EvalRequest {
            node: EvalNode::BinaryPart(part.clone()),
            metadata: Metadata {
                source_range: SourceRange::from(part),
            },
            decl_name: None,
            annotations: Vec::new(),
        }
    }
}

/// "C": what the machine does next.
// Variant sizes intentionally differ: these are the machine's heap frames,
// and boxing every payload would add an allocation per step.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
enum Control {
    /// Descend into an expression.
    Eval(Box<EvalRequest>),
    /// A value is ready; hand it to the innermost continuation.
    Apply(Applied),
    /// `exit()` was called (or an edited sketch block finished): unwind every
    /// continuation -- running cleanups, and the exit flavor of call_finish on
    /// call boundaries -- out to the fresh root, which returns the carried
    /// control-flow value.
    Exit(KclValueControlFlow),
}

/// What a finished sub-computation produced.
// Variant sizes intentionally differ: these are the machine's heap frames,
// and boxing every payload would add an allocation per step.
#[allow(clippy::large_enum_variant)]
#[derive(Debug)]
enum Applied {
    /// An expression's value.
    Value(KclValue),
    /// A completed block's result: the recursive executor's
    /// `exec_block` return value (`last_expr`).
    Block(Option<KclValueControlFlow>),
}

impl Applied {
    fn expect_value(self) -> Result<KclValue, KclError> {
        match self {
            Applied::Value(v) => Ok(v),
            Applied::Block(_) => Err(KclError::new_internal(KclErrorDetails::new(
                "machine executor: expected an expression value, found a block result".to_owned(),
                Vec::new(),
            ))),
        }
    }

    fn expect_block(self) -> Result<Option<KclValueControlFlow>, KclError> {
        match self {
            Applied::Block(b) => Ok(b),
            Applied::Value(_) => Err(KclError::new_internal(KclErrorDetails::new(
                "machine executor: expected a block result, found an expression value".to_owned(),
                Vec::new(),
            ))),
        }
    }
}

/// Which statement of a block is in flight, with any ambient state to restore
/// when it finishes or unwinds.
#[derive(Debug)]
enum InFlight {
    /// No statement is mid-evaluation.
    None,
    Expression,
    /// A variable declaration's init is being evaluated; holds the
    /// `being_declared` value to restore.
    Declaration {
        prev_being_declared: Option<String>,
    },
    Return,
}

/// The defunctionalized continuation: one variant per recursion site of the
/// recursive executor. Every variant holds owned handles (Arcs or values), no
/// lifetimes.
#[derive(Debug)]
enum Kont {
    /// Statement sequencing: replaces `exec_block`'s `for` loop.
    BlockSeq {
        block: BlockRef,
        body_type: BodyType,
        /// Index of the statement currently in flight (when `in_flight` is not
        /// `None`) or the next statement to run.
        index: usize,
        in_flight: InFlight,
        last: Option<KclValueControlFlow>,
    },

    // ---- binary / unary ----
    /// Have the LHS; evaluate the RHS next.
    BinaryLhsDone {
        node: Arc<Node<BinaryExpression>>,
    },
    /// Have both operands; apply the operator (may await a CSG engine call).
    BinaryRhsDone {
        node: Arc<Node<BinaryExpression>>,
        left: KclValue,
    },
    UnaryDone {
        node: Arc<Node<UnaryExpression>>,
    },

    // ---- aggregates ----
    ArrayElems {
        node: Arc<Node<ArrayExpression>>,
        index: usize,
        done: Vec<KclValue>,
    },
    ObjectProps {
        node: Arc<Node<ObjectExpression>>,
        index: usize,
        done: KclObjectFields,
    },
    RangeStartDone {
        node: Arc<Node<ArrayRangeExpression>>,
    },
    RangeEndDone {
        node: Arc<Node<ArrayRangeExpression>>,
        start: KclValue,
    },

    // ---- access / control / pipes ----
    /// Computed member property evaluated next (property before object,
    /// replicating the recursive executor's evaluation order).
    MemberPropDone {
        node: Arc<Node<MemberExpression>>,
    },
    MemberObjDone {
        node: Arc<Node<MemberExpression>>,
        property: Property,
    },
    IfCondDone {
        node: Arc<Node<IfExpression>>,
        /// 0 = the main condition; 1..=n = else-if conditions.
        arm: usize,
    },
    /// An if arm's block completed; unwrap its value as the if's result.
    IfArmDone {
        node: Arc<Node<IfExpression>>,
    },
    AscribeDone {
        node: Arc<Node<AscribedExpression>>,
    },
    LabelDone {
        node: Arc<Node<LabelledExpression>>,
    },
    /// The pipe's first element evaluated under the PARENT pipe value.
    PipeFirstDone {
        node: Arc<Node<PipeExpression>>,
    },
    PipeSeq {
        node: Arc<Node<PipeExpression>>,
        index: usize,
        saved_pipe_value: Option<KclValue>,
    },

    // ---- calls ----
    CallArgs(Box<CallArgsState>),
    /// A KCL function call boundary. `call_finish` runs on normal completion,
    /// on `Exit` (exit flavor: restores and op-finalize, no tags/coercion),
    /// and on error unwind.
    CallBoundary(Box<BoundaryState>),

    // ---- sketch blocks ----
    SketchArgs(Box<SketchArgsState>),
    SketchBody(Box<SketchBodyState>),
}

/// Argument-evaluation state for a call: mirrors the argument loop of
/// `CallExpressionKw::execute`.
#[derive(Debug)]
struct CallArgsState {
    node: Arc<Node<CallExpressionKw>>,
    fn_src: FunctionSource,
    /// Source ranges of the function value, for the undefined-result error.
    fn_meta: Vec<Metadata>,
    /// None while the unlabeled arg (if any) is in flight; Some(i) while
    /// arguments[i] is.
    cursor: Option<usize>,
    unlabeled: Vec<(Option<String>, Arg)>,
    labeled: IndexMap<String, Arg>,
}

/// Everything a call boundary needs to finish the call and decorate errors.
#[derive(Debug)]
struct BoundaryState {
    state: CallState,
    fn_src: FunctionSource,
    fn_name: Option<String>,
    callsite: SourceRange,
    fn_meta: Vec<Metadata>,
}

/// Argument-evaluation state for a sketch block (non-sketch-mode).
#[derive(Debug)]
struct SketchArgsState {
    node: Arc<Node<SketchBlock>>,
    index: usize,
    labeled: IndexMap<String, Arg>,
}

/// Ambient state a sketch-block body wraps; restored on every exit path.
#[derive(Debug)]
struct SketchBodyState {
    node: Arc<Node<SketchBlock>>,
    sketch_id: ObjectId,
    sketch_surface: SketchSurface,
    sketch_block_artifact_id: ArtifactId,
    saved_sketch_block: Option<SketchBlockState>,
    saved_sketch_mode: bool,
    /// Whether the body's child environment was pushed (the sketch2 alias
    /// environment always is, before this kont exists).
    child_env_pushed: bool,
}

impl ExecutorContext {
    pub(crate) fn is_machine_executor(&self) -> bool {
        self.executor_kind == ExecutorKind::Machine
    }
}

/// Run a block to completion on the machine. This is the machine's fresh-root
/// entry, with `exec_block`'s exact contract: the returned value is the
/// block's `last_expr` (which the module wrapper, call protocol, and sketch
/// handling consume exactly as they do for the recursive executor). An
/// `exit()` unwinds to this root and is returned as an `Exit`-flavored
/// control-flow value.
pub(super) async fn run_block(
    ctx: &ExecutorContext,
    block: BlockRef,
    exec_state: &mut ExecState,
    body_type: BodyType,
) -> Result<Option<KclValueControlFlow>, KclError> {
    let mut konts: Vec<Kont> = Vec::new();
    // Kick the root block sequence off: stepping a block with no statement in
    // flight advances to its first statement.
    let root = Kont::BlockSeq {
        block,
        body_type,
        index: 0,
        in_flight: InFlight::None,
        last: None,
    };
    let mut control = match step_block(root, None, &mut konts, exec_state, ctx).await {
        Ok(c) => c,
        Err(e) => return Err(unwind_error(e, &mut konts, exec_state)),
    };

    loop {
        control = match control {
            Control::Eval(req) => match step_eval(*req, &mut konts, exec_state, ctx).await {
                Ok(c) => c,
                Err(e) => return Err(unwind_error(e, &mut konts, exec_state)),
            },
            Control::Apply(applied) => match konts.pop() {
                None => {
                    // The fresh root is done; the root BlockSeq's result is the
                    // block result.
                    return applied.expect_block();
                }
                Some(kont) => match step_apply(kont, applied, &mut konts, exec_state, ctx).await {
                    Ok(c) => c,
                    Err(e) => return Err(unwind_error(e, &mut konts, exec_state)),
                },
            },
            Control::Exit(cf) => {
                let cf = unwind_exit(cf, &mut konts, exec_state)?;
                return Ok(Some(cf));
            }
        };
    }
}

/// Unwind every continuation for an `exit()`: cleanups on non-boundaries, the
/// exit flavor of `call_finish` on call boundaries (restore ambient flags, pop
/// the callee env, finalize the operation -- skipping tags and coercion), and
/// the balancing sketch cleanup (including its feature-tree `GroupEnd`).
fn unwind_exit(
    mut cf: KclValueControlFlow,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
) -> Result<KclValueControlFlow, KclError> {
    while let Some(kont) = konts.pop() {
        match kont {
            Kont::CallBoundary(b) => {
                exec_state.mod_local.machine_call_depth = exec_state.mod_local.machine_call_depth.saturating_sub(1);
                // The exit flavor: call_finish's Exit bypass runs restores,
                // pop_env, and op finalization, then returns the Exit
                // unchanged before tags/coercion.
                match b.fn_src.call_finish(b.state, Ok(Some(cf)), exec_state) {
                    Ok(Some(v)) => cf = v,
                    Ok(None) => {
                        return Err(KclError::new_internal(KclErrorDetails::new(
                            "machine executor: exit vanished at a call boundary".to_owned(),
                            vec![b.callsite],
                        )));
                    }
                    Err(e) => {
                        // pop_env failed; propagate through the error unwind.
                        return Err(unwind_error(
                            e.add_unwind_location(b.fn_name.clone(), b.callsite),
                            konts,
                            exec_state,
                        ));
                    }
                }
            }
            Kont::SketchBody(sb) => {
                sketch_body_cleanup(*sb, exec_state);
                // Balance the GroupBegin operation pushed by scene_setup so
                // the feature tree stays well-formed (matches the recursive
                // executor's exit path; its error path deliberately skips
                // this).
                exec_state.push_op(Operation::GroupEnd);
            }
            other => cleanup(other, exec_state),
        }
    }
    Ok(cf)
}

/// Unwind every continuation for an error: cleanups on non-boundaries,
/// `call_finish` with the error on call boundaries (which finalizes the
/// operation with `is_error = true`), and per-boundary backtrace decoration
/// via `add_unwind_location`, innermost first -- exactly like errors bubbling
/// out of the recursive executor's nested calls.
fn unwind_error(mut e: KclError, konts: &mut Vec<Kont>, exec_state: &mut ExecState) -> KclError {
    while let Some(kont) = konts.pop() {
        match kont {
            Kont::CallBoundary(b) => {
                exec_state.mod_local.machine_call_depth = exec_state.mod_local.machine_call_depth.saturating_sub(1);
                match b.fn_src.call_finish(b.state, Err(e), exec_state) {
                    Err(finished) => {
                        e = finished.add_unwind_location(b.fn_name.clone(), b.callsite);
                    }
                    Ok(_) => {
                        e = KclError::new_internal(KclErrorDetails::new(
                            "machine executor: error vanished at a call boundary".to_owned(),
                            vec![b.callsite],
                        ));
                    }
                }
            }
            Kont::SketchBody(sb) => {
                // The recursive executor's error path restores ambient sketch
                // state and pops both envs but does NOT push the balancing
                // GroupEnd (a historical asymmetry with the exit path).
                sketch_body_cleanup(*sb, exec_state);
            }
            other => cleanup(other, exec_state),
        }
    }
    e
}

/// Restore ambient state for a non-boundary continuation popped during
/// unwinding. Continuations without ambient state are simply dropped.
fn cleanup(kont: Kont, exec_state: &mut ExecState) {
    match kont {
        Kont::BlockSeq { in_flight, .. } => {
            if let InFlight::Declaration { prev_being_declared } = in_flight {
                exec_state.mod_local.being_declared = prev_being_declared;
            }
        }
        Kont::PipeSeq { saved_pipe_value, .. } => {
            exec_state.mod_local.pipe_value = saved_pipe_value;
        }
        // Evaluation-only continuations hold no ambient state.
        Kont::BinaryLhsDone { .. }
        | Kont::BinaryRhsDone { .. }
        | Kont::UnaryDone { .. }
        | Kont::ArrayElems { .. }
        | Kont::ObjectProps { .. }
        | Kont::RangeStartDone { .. }
        | Kont::RangeEndDone { .. }
        | Kont::MemberPropDone { .. }
        | Kont::MemberObjDone { .. }
        | Kont::IfCondDone { .. }
        | Kont::IfArmDone { .. }
        | Kont::AscribeDone { .. }
        | Kont::LabelDone { .. }
        | Kont::PipeFirstDone { .. }
        | Kont::CallArgs(_)
        | Kont::SketchArgs(_) => {}
        // Handled by the unwind loops directly.
        Kont::CallBoundary(_) | Kont::SketchBody(_) => unreachable!("boundaries are handled by the unwind loops"),
    }
}

/// Restore the ambient state wrapped around a sketch-block body, in the
/// recursive executor's exact order: pop the body's child environment (if it
/// was pushed), restore sketch_mode, take the sketch-block state back out,
/// pop the sketch2 alias environment. Finalization is skipped entirely --
/// that's the point on unwind paths.
fn sketch_body_cleanup(sb: SketchBodyState, exec_state: &mut ExecState) {
    if sb.child_env_pushed {
        let _ = exec_state.mut_stack().pop_env();
    }
    exec_state.mod_local.sketch_mode = sb.saved_sketch_mode;
    let _ = std::mem::replace(&mut exec_state.mod_local.sketch_block, sb.saved_sketch_block);
    let _ = exec_state.mut_stack().pop_env();
}

/// One eval step: the recursive executor's `execute_expr` dispatch, pushing a
/// continuation and descending instead of awaiting recursively. Leaves
/// produce `Apply` directly (some via flat awaits).
async fn step_eval(
    req: EvalRequest,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let EvalRequest {
        node,
        metadata,
        decl_name,
        annotations,
    } = req;
    let expr = match node {
        EvalNode::Expr(e) => e,
        EvalNode::BinaryPart(part) => {
            // BinaryPart is a strict subset of Expr's variants; route through
            // the same arms.
            match part {
                BinaryPart::Literal(literal) => {
                    return Ok(Control::Apply(Applied::Value(KclValue::from_literal(
                        literal.as_ref().clone(),
                        exec_state,
                    ))));
                }
                BinaryPart::Name(name) => {
                    let value = ctx.resolve_name_for_eval(&name, &metadata, exec_state).await?;
                    return Ok(Control::Apply(Applied::Value(value)));
                }
                BinaryPart::BinaryExpression(node) => Expr::BinaryExpression(node),
                BinaryPart::CallExpressionKw(node) => Expr::CallExpressionKw(node),
                BinaryPart::UnaryExpression(node) => Expr::UnaryExpression(node),
                BinaryPart::MemberExpression(node) => Expr::MemberExpression(node),
                BinaryPart::ArrayExpression(node) => Expr::ArrayExpression(node),
                BinaryPart::ArrayRangeExpression(node) => Expr::ArrayRangeExpression(node),
                BinaryPart::ObjectExpression(node) => Expr::ObjectExpression(node),
                BinaryPart::IfExpression(node) => Expr::IfExpression(node),
                BinaryPart::AscribedExpression(node) => Expr::AscribedExpression(node),
                BinaryPart::SketchVar(node) => Expr::SketchVar(node),
            }
        }
    };

    match expr {
        // ---- leaves ----
        Expr::None(none) => Ok(Control::Apply(Applied::Value(KclValue::from(&none)))),
        Expr::Literal(literal) => Ok(Control::Apply(Applied::Value(KclValue::from_literal(
            literal.as_ref().clone(),
            exec_state,
        )))),
        Expr::TagDeclarator(tag) => {
            let value = tag.execute(exec_state).await?;
            Ok(Control::Apply(Applied::Value(value)))
        }
        Expr::Name(name) => {
            let value = ctx.resolve_name_for_eval(&name, &metadata, exec_state).await?;
            Ok(Control::Apply(Applied::Value(value)))
        }
        Expr::FunctionExpression(function_expression) => {
            let statement_kind = match &decl_name {
                Some(name) => crate::execution::StatementKind::Declaration { name },
                None => crate::execution::StatementKind::Expression,
            };
            let value = ctx.create_function_closure(
                &function_expression,
                &annotations,
                &metadata,
                statement_kind,
                exec_state,
            )?;
            Ok(Control::Apply(Applied::Value(value)))
        }
        Expr::PipeSubstitution(pipe_substitution) => match &decl_name {
            Some(name) => {
                let message =
                    format!("you cannot declare variable {name} as %, because % can only be used in function calls");
                Err(KclError::new_semantic(KclErrorDetails::new(
                    message,
                    vec![pipe_substitution.as_ref().into()],
                )))
            }
            None => match exec_state.mod_local.pipe_value.clone() {
                Some(x) => Ok(Control::Apply(Applied::Value(x))),
                None => Err(KclError::new_semantic(KclErrorDetails::new(
                    "cannot use % outside a pipe expression".to_owned(),
                    vec![pipe_substitution.as_ref().into()],
                ))),
            },
        },
        Expr::SketchVar(expr) => {
            let value = expr.get_result(exec_state, ctx).await?;
            Ok(Control::Apply(Applied::Value(value)))
        }

        // ---- aggregates ----
        Expr::ArrayExpression(node) => {
            let node = node.arc();
            if node.elements.is_empty() {
                return Ok(Control::Apply(Applied::Value(KclValue::HomArray {
                    value: Vec::new(),
                    ty: RuntimeType::Primitive(PrimitiveType::Any),
                })));
            }
            let first = EvalRequest::expr(&node.elements[0]);
            konts.push(Kont::ArrayElems {
                node,
                index: 0,
                done: Vec::new(),
            });
            Ok(Control::Eval(Box::new(first)))
        }
        Expr::ObjectExpression(node) => {
            let node = node.arc();
            if node.properties.is_empty() {
                return Ok(Control::Apply(Applied::Value(KclValue::Object {
                    value: KclObjectFields::with_capacity(0),
                    meta: vec![Metadata {
                        source_range: SourceRange::from(node.as_ref()),
                    }],
                    constrainable: false,
                    object_kind: crate::execution::kcl_value::KclObjectKind::Default,
                })));
            }
            let first = EvalRequest::expr(&node.properties[0].value);
            konts.push(Kont::ObjectProps {
                node,
                index: 0,
                done: KclObjectFields::default(),
            });
            Ok(Control::Eval(Box::new(first)))
        }
        Expr::ArrayRangeExpression(node) => {
            let node = node.arc();
            let start = EvalRequest::expr(&node.start_element);
            konts.push(Kont::RangeStartDone { node });
            Ok(Control::Eval(Box::new(start)))
        }

        // ---- operators ----
        Expr::BinaryExpression(node) => {
            let node = node.arc();
            let left = EvalRequest::binary_part(&node.left);
            konts.push(Kont::BinaryLhsDone { node });
            Ok(Control::Eval(Box::new(left)))
        }
        Expr::UnaryExpression(node) => {
            let node = node.arc();
            let operand = EvalRequest::binary_part(&node.argument);
            konts.push(Kont::UnaryDone { node });
            Ok(Control::Eval(Box::new(operand)))
        }

        // ---- access / control ----
        Expr::MemberExpression(node) => {
            let node = node.arc();
            if node.computed {
                let prop = EvalRequest::expr(&node.property);
                konts.push(Kont::MemberPropDone { node });
                Ok(Control::Eval(Box::new(prop)))
            } else {
                // Non-computed properties are identifier names, not evaluated.
                let Expr::Name(identifier) = &node.property else {
                    // Should actually be impossible because the parser would reject it.
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Object expressions like `obj.property` must use simple identifier names, not complex expressions"
                            .to_owned(),
                        vec![SourceRange::from(node.as_ref())],
                    )));
                };
                let property = Property::String(identifier.to_string());
                let object = EvalRequest::expr(&node.object);
                konts.push(Kont::MemberObjDone { node, property });
                Ok(Control::Eval(Box::new(object)))
            }
        }
        Expr::IfExpression(node) => {
            let node = node.arc();
            let cond = EvalRequest {
                node: EvalNode::Expr((*node.cond).clone()),
                metadata: Metadata::from(node.as_ref()),
                decl_name: None,
                annotations: Vec::new(),
            };
            konts.push(Kont::IfCondDone { node, arm: 0 });
            Ok(Control::Eval(Box::new(cond)))
        }
        Expr::AscribedExpression(node) => {
            let node = node.arc();
            let inner = EvalRequest {
                node: EvalNode::Expr(node.expr.clone()),
                metadata: Metadata {
                    source_range: SourceRange::from(node.as_ref()),
                },
                decl_name: None,
                annotations: Vec::new(),
            };
            konts.push(Kont::AscribeDone { node });
            Ok(Control::Eval(Box::new(inner)))
        }
        Expr::LabelledExpression(node) => {
            let node = node.arc();
            let inner = EvalRequest {
                node: EvalNode::Expr(node.expr.clone()),
                metadata,
                decl_name: None,
                annotations: Vec::new(),
            };
            konts.push(Kont::LabelDone { node });
            Ok(Control::Eval(Box::new(inner)))
        }

        // ---- pipes ----
        Expr::PipeExpression(node) => {
            let node = node.arc();
            let Some(first) = node.body.first() else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Pipe expressions cannot be empty".to_owned(),
                    vec![SourceRange::from(node.as_ref())],
                )));
            };
            // The first element is evaluated under the PARENT's pipe value
            // (a nested pipe expression sees the outer %).
            let first = EvalRequest::expr(first);
            konts.push(Kont::PipeFirstDone { node });
            Ok(Control::Eval(Box::new(first)))
        }

        // ---- calls ----
        Expr::CallExpressionKw(node) => {
            let node = node.arc();
            start_call(node, konts, exec_state, ctx).await
        }

        // ---- sketch blocks ----
        Expr::SketchBlock(node) => {
            let node = node.arc();
            start_sketch_block(node, konts, exec_state, ctx).await
        }
    }
}

/// One apply step: hand a finished value to the innermost continuation. The
/// recursive executor's post-await code for each recursion site.
async fn step_apply(
    kont: Kont,
    applied: Applied,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    match kont {
        Kont::BlockSeq { .. } => step_block(kont, Some(applied), konts, exec_state, ctx).await,

        Kont::BinaryLhsDone { node } => {
            let left = applied.expect_value()?;
            let right = EvalRequest::binary_part(&node.right);
            konts.push(Kont::BinaryRhsDone { node, left });
            Ok(Control::Eval(Box::new(right)))
        }
        Kont::BinaryRhsDone { node, left } => {
            let right = applied.expect_value()?;
            let value = node.apply_operator(exec_state, ctx, left, right).await?;
            Ok(Control::Apply(Applied::Value(value)))
        }
        Kont::UnaryDone { node } => {
            let operand = applied.expect_value()?;
            let value = node.apply_unary(operand, exec_state)?;
            Ok(Control::Apply(Applied::Value(value)))
        }

        Kont::ArrayElems { node, index, mut done } => {
            done.push(applied.expect_value()?);
            let next = index + 1;
            if next < node.elements.len() {
                let elem = EvalRequest::expr(&node.elements[next]);
                konts.push(Kont::ArrayElems {
                    node,
                    index: next,
                    done,
                });
                Ok(Control::Eval(Box::new(elem)))
            } else {
                Ok(Control::Apply(Applied::Value(KclValue::HomArray {
                    value: done,
                    ty: RuntimeType::Primitive(PrimitiveType::Any),
                })))
            }
        }
        Kont::ObjectProps { node, index, mut done } => {
            let value = applied.expect_value()?;
            done.insert(node.properties[index].key.name.clone(), value);
            let next = index + 1;
            if next < node.properties.len() {
                let prop = EvalRequest::expr(&node.properties[next].value);
                konts.push(Kont::ObjectProps {
                    node,
                    index: next,
                    done,
                });
                Ok(Control::Eval(Box::new(prop)))
            } else {
                Ok(Control::Apply(Applied::Value(KclValue::Object {
                    value: done,
                    meta: vec![Metadata {
                        source_range: SourceRange::from(node.as_ref()),
                    }],
                    constrainable: false,
                    object_kind: crate::execution::kcl_value::KclObjectKind::Default,
                })))
            }
        }
        Kont::RangeStartDone { node } => {
            let start = applied.expect_value()?;
            let end = EvalRequest::expr(&node.end_element);
            konts.push(Kont::RangeEndDone { node, start });
            Ok(Control::Eval(Box::new(end)))
        }
        Kont::RangeEndDone { node, start } => {
            let end = applied.expect_value()?;
            let value = node.build_range(start, end, exec_state)?;
            Ok(Control::Apply(Applied::Value(value)))
        }

        Kont::MemberPropDone { node } => {
            let prop_value = applied.expect_value()?;
            let property = Property::from_value(prop_value, SourceRange::from(node.as_ref()))?;
            let object = EvalRequest::expr(&node.object);
            konts.push(Kont::MemberObjDone { node, property });
            Ok(Control::Eval(Box::new(object)))
        }
        Kont::MemberObjDone { node, property } => {
            let object = applied.expect_value()?;
            let cf = node.apply_member(object, property, exec_state, ctx).await?;
            // apply_member only ever produces Continue values.
            Ok(Control::Apply(Applied::Value(cf.into_value())))
        }

        Kont::IfCondDone { node, arm } => {
            let cond_value = applied.expect_value()?;
            if cond_value.get_bool()? {
                let block = if arm == 0 {
                    BlockRef::Program(node.then_val.arc())
                } else {
                    BlockRef::Program(node.else_ifs[arm - 1].then_val.arc())
                };
                konts.push(Kont::IfArmDone { node });
                push_block(block, BodyType::Block, konts);
                step_block_kick(konts, exec_state, ctx).await
            } else if arm < node.else_ifs.len() {
                let cond = EvalRequest {
                    node: EvalNode::Expr(node.else_ifs[arm].cond.clone()),
                    metadata: Metadata::from(node.as_ref()),
                    decl_name: None,
                    annotations: Vec::new(),
                };
                konts.push(Kont::IfCondDone { node, arm: arm + 1 });
                Ok(Control::Eval(Box::new(cond)))
            } else {
                let block = BlockRef::Program(node.final_else.arc());
                konts.push(Kont::IfArmDone { node });
                push_block(block, BodyType::Block, konts);
                step_block_kick(konts, exec_state, ctx).await
            }
        }
        Kont::IfArmDone { node } => {
            let block_result = applied.expect_block()?;
            // Blocks used as if arms must end in an expression (enforced by
            // the parser), so this is always Some.
            let Some(cf) = block_result else {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "if-expression arm produced no value".to_owned(),
                    vec![SourceRange::from(node.as_ref())],
                )));
            };
            Ok(Control::Apply(Applied::Value(cf.into_value())))
        }

        Kont::AscribeDone { node } => {
            let value = applied.expect_value()?;
            let value = crate::execution::exec_ast::apply_ascription(
                &value,
                &node.ty,
                exec_state,
                SourceRange::from(node.as_ref()),
            )?;
            Ok(Control::Apply(Applied::Value(value)))
        }
        Kont::LabelDone { node } => {
            let value = applied.expect_value()?;
            exec_state
                .mut_stack()
                .add(node.label.name.clone(), value.clone(), SourceRange::from(node.as_ref()))?;
            // TODO this lets us use the label as a variable name, but not as a tag in most cases
            Ok(Control::Apply(Applied::Value(value)))
        }

        Kont::PipeFirstDone { node } => {
            let output = applied.expect_value()?;
            // Now that the first element is evaluated, following elements use
            // it as %; the parent's pipe value is restored when this pipe
            // finishes (or unwinds).
            let saved_pipe_value = exec_state.mod_local.pipe_value.replace(output);
            pipe_advance(node, 1, saved_pipe_value, konts, exec_state)
        }
        Kont::PipeSeq {
            node,
            index,
            saved_pipe_value,
        } => {
            let output = applied.expect_value()?;
            exec_state.mod_local.pipe_value = Some(output);
            pipe_advance(node, index + 1, saved_pipe_value, konts, exec_state)
        }

        Kont::CallArgs(state) => call_args_step(*state, applied, konts, exec_state, ctx).await,
        Kont::CallBoundary(boundary) => {
            let block_result = applied.expect_block()?;
            exec_state.mod_local.machine_call_depth = exec_state.mod_local.machine_call_depth.saturating_sub(1);
            let BoundaryState {
                state,
                fn_src,
                fn_name,
                callsite,
                fn_meta,
            } = *boundary;
            // Read __return from the callee env (still pushed), then finish.
            let result = fn_src.kcl_body_result(Ok(block_result), exec_state);
            let finished = fn_src
                .call_finish(state, result, exec_state)
                .map_err(|e| e.add_unwind_location(fn_name.clone(), callsite))?;
            finish_call_value(finished, fn_name, callsite, fn_meta)
        }

        Kont::SketchArgs(state) => sketch_args_step(*state, applied, konts, exec_state, ctx).await,
        Kont::SketchBody(state) => sketch_body_finish(*state, applied, exec_state, ctx).await,
    }
}

/// Push a block-sequencing continuation.
fn push_block(block: BlockRef, body_type: BodyType, konts: &mut Vec<Kont>) {
    konts.push(Kont::BlockSeq {
        block,
        body_type,
        index: 0,
        in_flight: InFlight::None,
        last: None,
    });
}

/// Immediately step the just-pushed block so it starts its first statement
/// (or completes immediately when empty).
async fn step_block_kick(
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let kont = konts.pop().expect("block was just pushed");
    step_block(kont, None, konts, exec_state, ctx).await
}

/// Advance a block: apply the in-flight statement's value (if any), then run
/// statements until one needs an expression evaluated (returning `Eval`) or
/// the block completes (returning `Apply(Block(last))`). Flat statements
/// (imports, type declarations) execute inline.
async fn step_block(
    kont: Kont,
    applied: Option<Applied>,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let Kont::BlockSeq {
        block,
        body_type,
        mut index,
        mut in_flight,
        mut last,
    } = kont
    else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "machine executor: step_block on a non-block continuation".to_owned(),
            Vec::new(),
        )));
    };

    // Finish the in-flight statement.
    if let Some(applied) = applied {
        let value = applied.expect_value()?;
        match std::mem::replace(&mut in_flight, InFlight::None) {
            InFlight::None => {
                return Err(KclError::new_internal(KclErrorDetails::new(
                    "machine executor: value applied to a block with no statement in flight".to_owned(),
                    Vec::new(),
                )));
            }
            InFlight::Expression => {
                // Exit control flow never arrives here as a value: it takes
                // the Exit unwind path instead. A normal value continues.
                last = Some(value.continue_());
                index += 1;
            }
            InFlight::Declaration { prev_being_declared } => {
                // Declaration over, so unset this context.
                exec_state.mod_local.being_declared = prev_being_declared;
                let BodyItem::VariableDeclaration(variable_declaration) = &block.body()[index] else {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        "machine executor: in-flight declaration is not a declaration".to_owned(),
                        Vec::new(),
                    )));
                };
                let rhs = ctx.bind_variable_declaration(variable_declaration, value, body_type, exec_state)?;
                // Variable declaration can be the return value of a module.
                last = matches!(body_type, BodyType::Root).then_some(rhs.continue_());
                index += 1;
            }
            InFlight::Return => {
                let BodyItem::ReturnStatement(return_statement) = &block.body()[index] else {
                    return Err(KclError::new_internal(KclErrorDetails::new(
                        "machine executor: in-flight return is not a return".to_owned(),
                        Vec::new(),
                    )));
                };
                crate::execution::ExecutorContext::bind_return_value(return_statement, value, exec_state)?;
                last = None;
                index += 1;
            }
        }
    }

    // Run statements until one needs an Eval.
    loop {
        let Some(statement) = block.body().get(index) else {
            // Block complete.
            if matches!(body_type, BodyType::Root) {
                // Flush the batch queue.
                exec_state
                    .flush_batch(
                        ModelingCmdMeta::new(exec_state, ctx, block.to_source_range()),
                        // True here tells the engine to flush all the end commands as well like fillets
                        // and chamfers where the engine would otherwise eat the ID of the segments.
                        true,
                    )
                    .await?;
            }
            return Ok(Control::Apply(Applied::Block(last)));
        };

        match statement {
            BodyItem::ImportStatement(import_stmt) => {
                if exec_state.sketch_mode() {
                    index += 1;
                    continue;
                }
                ctx.exec_import_statement(import_stmt, body_type, exec_state).await?;
                last = None;
                index += 1;
            }
            BodyItem::TypeDeclaration(ty) => {
                if exec_state.sketch_mode() {
                    index += 1;
                    continue;
                }
                ctx.exec_type_declaration(ty, exec_state)?;
                last = None;
                index += 1;
            }
            BodyItem::ExpressionStatement(expression_statement) => {
                if exec_state.sketch_mode()
                    && crate::execution::exec_ast::sketch_mode_should_skip(&expression_statement.expression)
                {
                    index += 1;
                    continue;
                }
                let req = EvalRequest {
                    node: EvalNode::Expr(expression_statement.expression.clone()),
                    metadata: Metadata::from(expression_statement),
                    decl_name: None,
                    annotations: Vec::new(),
                };
                konts.push(Kont::BlockSeq {
                    block,
                    body_type,
                    index,
                    in_flight: InFlight::Expression,
                    last,
                });
                return Ok(Control::Eval(Box::new(req)));
            }
            BodyItem::VariableDeclaration(variable_declaration) => {
                if exec_state.sketch_mode()
                    && crate::execution::exec_ast::sketch_mode_should_skip(&variable_declaration.declaration.init)
                {
                    index += 1;
                    continue;
                }
                let var_name = variable_declaration.declaration.id.name.to_string();
                let source_range = SourceRange::from(&variable_declaration.declaration.init);

                // During the evaluation of the variable's RHS, set context that this is all happening inside a variable
                // declaration, for the given name. This helps improve user-facing error messages.
                let lhs = variable_declaration.inner.name().to_owned();
                let prev_being_declared = exec_state.mod_local.being_declared.take();
                exec_state.mod_local.being_declared = Some(lhs);

                let req = EvalRequest {
                    node: EvalNode::Expr(variable_declaration.declaration.init.clone()),
                    metadata: Metadata { source_range },
                    decl_name: Some(var_name),
                    annotations: variable_declaration.outer_attrs.clone(),
                };
                konts.push(Kont::BlockSeq {
                    block,
                    body_type,
                    index,
                    in_flight: InFlight::Declaration { prev_being_declared },
                    last,
                });
                return Ok(Control::Eval(Box::new(req)));
            }
            BodyItem::ReturnStatement(return_statement) => {
                if exec_state.sketch_mode()
                    && crate::execution::exec_ast::sketch_mode_should_skip(&return_statement.argument)
                {
                    index += 1;
                    continue;
                }
                let metadata = Metadata::from(return_statement);
                if matches!(body_type, BodyType::Root) {
                    return Err(KclError::new_semantic(KclErrorDetails::new(
                        "Cannot return from outside a function.".to_owned(),
                        vec![metadata.source_range],
                    )));
                }
                let req = EvalRequest {
                    node: EvalNode::Expr(return_statement.argument.clone()),
                    metadata,
                    decl_name: None,
                    annotations: Vec::new(),
                };
                konts.push(Kont::BlockSeq {
                    block,
                    body_type,
                    index,
                    in_flight: InFlight::Return,
                    last,
                });
                return Ok(Control::Eval(Box::new(req)));
            }
        }
    }
}

/// Advance a pipe to `index`: check the element (tag declarators are not
/// allowed in pipe tails), evaluate it, or finish the pipe when past the end.
fn pipe_advance(
    node: Arc<Node<PipeExpression>>,
    index: usize,
    saved_pipe_value: Option<KclValue>,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
) -> Result<Control, KclError> {
    if index >= node.body.len() {
        // Safe to unwrap here, because pipe_value always has something pushed in when the pipe starts.
        let final_output = exec_state.mod_local.pipe_value.take().ok_or_else(|| {
            KclError::new_internal(KclErrorDetails::new(
                "machine executor: pipe finished with no pipe value".to_owned(),
                vec![SourceRange::from(node.as_ref())],
            ))
        })?;
        // Restore the previous pipe value.
        exec_state.mod_local.pipe_value = saved_pipe_value;
        return Ok(Control::Apply(Applied::Value(final_output)));
    }
    let expression = &node.body[index];
    if let Expr::TagDeclarator(_) = expression {
        let e = KclError::new_semantic(KclErrorDetails::new(
            format!("This cannot be in a PipeExpression: {expression:?}"),
            vec![expression.into()],
        ));
        // Restore before erroring; the continuation holding the saved value
        // hasn't been pushed yet.
        exec_state.mod_local.pipe_value = saved_pipe_value;
        return Err(e);
    }
    let req = EvalRequest::expr(expression);
    konts.push(Kont::PipeSeq {
        node,
        index,
        saved_pipe_value,
    });
    Ok(Control::Eval(Box::new(req)))
}

/// Begin a call: resolve the callee (before evaluating arguments, exactly
/// like the recursive executor), then start evaluating arguments -- or
/// dispatch immediately for zero-argument calls.
async fn start_call(
    node: Arc<Node<CallExpressionKw>>,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let callsite: SourceRange = SourceRange::from(node.as_ref());

    // Resolve the function before evaluating arguments so calls can mutate
    // exec_state without holding a memory borrow.
    let func: KclValue = node.callee.get_result(exec_state, ctx).await?;

    let Some(fn_src) = func.as_function() else {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "cannot call this because it isn't a function".to_string(),
            vec![callsite],
        )));
    };
    let fn_src = fn_src.clone();
    let fn_meta = match &func {
        KclValue::Function { meta, .. } => meta.clone(),
        _ => Vec::new(),
    };

    let state = CallArgsState {
        node,
        fn_src,
        fn_meta,
        cursor: None,
        unlabeled: Vec::new(),
        labeled: IndexMap::new(),
    };

    // Evaluate the unlabeled first param, if any exists; otherwise the
    // labeled arguments in order; otherwise dispatch with no arguments.
    if let Some(arg_expr) = &state.node.unlabeled {
        let req = EvalRequest::expr(arg_expr);
        konts.push(Kont::CallArgs(Box::new(state)));
        Ok(Control::Eval(Box::new(req)))
    } else if !state.node.arguments.is_empty() {
        let mut state = state;
        state.cursor = Some(0);
        let req = EvalRequest::expr(&state.node.arguments[0].arg);
        konts.push(Kont::CallArgs(Box::new(state)));
        Ok(Control::Eval(Box::new(req)))
    } else {
        dispatch_call(state, konts, exec_state, ctx).await
    }
}

/// Record an evaluated argument and evaluate the next, or dispatch the call
/// when all arguments are done.
async fn call_args_step(
    mut state: CallArgsState,
    applied: Applied,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let value = applied.expect_value()?;
    match state.cursor {
        None => {
            let arg_expr = state.node.unlabeled.as_ref().ok_or_else(|| {
                KclError::new_internal(KclErrorDetails::new(
                    "machine executor: unlabeled argument vanished".to_owned(),
                    vec![SourceRange::from(state.node.as_ref())],
                ))
            })?;
            let source_range = SourceRange::from(arg_expr);
            let label = arg_expr.ident_name().map(str::to_owned);
            state.unlabeled.push((label, Arg::new(value, source_range)));
        }
        Some(i) => {
            let arg_expr = &state.node.arguments[i];
            let source_range = SourceRange::from(&arg_expr.arg);
            let arg = Arg::new(value, source_range);
            match &arg_expr.label {
                Some(l) => {
                    state.labeled.insert(l.name.clone(), arg);
                }
                None => {
                    state
                        .unlabeled
                        .push((arg_expr.arg.ident_name().map(str::to_owned), arg));
                }
            }
        }
    }

    let next = match state.cursor {
        None => 0,
        Some(i) => i + 1,
    };
    if next < state.node.arguments.len() {
        state.cursor = Some(next);
        let req = EvalRequest::expr(&state.node.arguments[next].arg);
        konts.push(Kont::CallArgs(Box::new(state)));
        Ok(Control::Eval(Box::new(req)))
    } else {
        dispatch_call(state, konts, exec_state, ctx).await
    }
}

/// All arguments evaluated: build `Args`, run call setup, and either await a
/// Rust builtin inline (a flat leaf) or push a call boundary plus the KCL
/// function body (no native recursion).
async fn dispatch_call(
    state: CallArgsState,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let CallArgsState {
        node,
        fn_src,
        fn_meta,
        cursor: _,
        unlabeled,
        labeled,
    } = state;
    let callsite: SourceRange = SourceRange::from(node.as_ref());
    let fn_name_node = &node.callee;
    let fn_name = Some(fn_name_node.name.name.clone());
    let fn_display_name = Some(fn_name_node.to_string());

    let args = Args::new(
        labeled,
        unlabeled,
        callsite,
        node.node_path.clone(),
        exec_state,
        ctx.clone(),
        fn_name.clone(),
    );

    // Guard against runaway recursion: machine-native calls do not grow the
    // native stack, so this is policy, not a native-stack limit. It must
    // behave when raised to 50,000 or more.
    if exec_state.mod_local.machine_call_depth >= ctx.machine_call_depth_limit {
        return Err(KclError::new_semantic(KclErrorDetails::new(
            format!(
                "Call depth limit ({}) exceeded. This usually means a function is recursing without a base case.",
                ctx.machine_call_depth_limit
            ),
            vec![callsite],
        )));
    }

    match &fn_src.body {
        FunctionBody::Rust(f) => {
            // A flat leaf: setup, await the builtin, finish. Higher-order
            // builtins (map/reduce/patternTransform) re-enter KCL through
            // call_kw, which fresh-roots a machine run per callback until the
            // resumable-callback phase lands.
            let (call_state, args) = fn_src
                .call_setup(&fn_display_name, exec_state, args, callsite)
                .map_err(|e| e.add_unwind_location(fn_name.clone(), callsite))?;
            let result = f(exec_state, args).await.map(Some);
            let finished = fn_src
                .call_finish(call_state, result, exec_state)
                .map_err(|e| e.add_unwind_location(fn_name.clone(), callsite))?;
            finish_call_value(finished, fn_display_name, callsite, fn_meta)
        }
        FunctionBody::Kcl(_) => {
            let (call_state, args) = fn_src
                .call_setup(&fn_display_name, exec_state, args, callsite)
                .map_err(|e| e.add_unwind_location(fn_name.clone(), callsite))?;
            if let Err(e) = crate::execution::fn_call::assign_args_to_params_kw(&fn_src, args, exec_state) {
                let e = FunctionSource::call_abort_on_arg_binding_failure(call_state, e, exec_state);
                return Err(e.add_unwind_location(fn_name.clone(), callsite));
            }
            exec_state.mod_local.machine_call_depth += 1;
            let body = BlockRef::FnBody(fn_src.ast.arc());
            konts.push(Kont::CallBoundary(Box::new(BoundaryState {
                state: call_state,
                fn_src,
                fn_name: fn_display_name,
                callsite,
                fn_meta,
            })));
            push_block(body, BodyType::Block, konts);
            step_block_kick(konts, exec_state, ctx).await
        }
    }
}

/// Convert a finished call's result into machine control: Exit control flow
/// starts an exit unwind; a missing result is the "undefined function result"
/// error; a value applies normally.
fn finish_call_value(
    finished: Option<KclValueControlFlow>,
    fn_name: Option<String>,
    callsite: SourceRange,
    fn_meta: Vec<Metadata>,
) -> Result<Control, KclError> {
    match finished {
        Some(cf) if cf.is_some_return() => Ok(Control::Exit(cf)),
        Some(cf) => Ok(Control::Apply(Applied::Value(cf.into_value()))),
        None => {
            let mut source_ranges: Vec<SourceRange> = vec![callsite];
            // We want to send the source range of the original function.
            if !fn_meta.is_empty() {
                source_ranges = fn_meta.iter().map(|m| m.source_range).collect();
            }
            let name = fn_name.unwrap_or_else(|| "unknown function".to_owned());
            Err(KclError::new_undefined_value(
                KclErrorDetails::new(
                    format!("Result of user-defined function {name} is undefined"),
                    source_ranges,
                ),
                None,
            ))
        }
    }
}

/// Begin a sketch block: nested check, then argument evaluation (or the
/// sketch-mode cache path), mirroring `Node<SketchBlock>::get_result`.
async fn start_sketch_block(
    node: Arc<Node<SketchBlock>>,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    if exec_state.mod_local.sketch_block.is_some() {
        // Disallow nested sketch blocks for now.
        return Err(KclError::new_semantic(KclErrorDetails::new(
            "Cannot execute a sketch block from within another sketch block".to_owned(),
            vec![SourceRange::from(node.as_ref())],
        )));
    }

    if exec_state.sketch_mode() {
        let (sketch_id, sketch_surface) = match node.arguments_from_cache(exec_state) {
            Ok(x) => x,
            Err(crate::execution::EarlyReturn::Value(cf)) => return Ok(Control::Exit(cf)),
            Err(crate::execution::EarlyReturn::Error(e)) => return Err(e),
        };
        return sketch_block_body_setup(node, sketch_id, sketch_surface, konts, exec_state, ctx).await;
    }

    // Evaluate arguments (engine execution creates planes/faces here).
    let state = SketchArgsState {
        node,
        index: 0,
        labeled: IndexMap::new(),
    };
    if state.node.arguments.is_empty() {
        return sketch_args_finish(state, konts, exec_state, ctx).await;
    }
    let req = EvalRequest::expr(&state.node.arguments[0].arg);
    konts.push(Kont::SketchArgs(Box::new(state)));
    Ok(Control::Eval(Box::new(req)))
}

/// Record an evaluated sketch-block argument and evaluate the next, or finish
/// the arguments.
async fn sketch_args_step(
    mut state: SketchArgsState,
    applied: Applied,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let value = applied.expect_value()?;
    let labeled_arg = &state.node.arguments[state.index];
    let source_range = SourceRange::from(&labeled_arg.arg);
    let arg = Arg::new(value, source_range);
    match &labeled_arg.label {
        Some(label) => {
            state.labeled.insert(label.name.clone(), arg);
        }
        None => {
            let name = labeled_arg.arg.ident_name();
            if let Some(name) = name {
                state.labeled.insert(name.to_owned(), arg);
            } else {
                return Err(KclError::new_semantic(KclErrorDetails::new(
                    "Arguments to sketch blocks must be either labeled or simple identifiers".to_owned(),
                    vec![SourceRange::from(&labeled_arg.arg)],
                )));
            }
        }
    }
    state.index += 1;
    if state.index < state.node.arguments.len() {
        let req = EvalRequest::expr(&state.node.arguments[state.index].arg);
        konts.push(Kont::SketchArgs(Box::new(state)));
        Ok(Control::Eval(Box::new(req)))
    } else {
        sketch_args_finish(state, konts, exec_state, ctx).await
    }
}

async fn sketch_args_finish(
    state: SketchArgsState,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let SketchArgsState { node, labeled, .. } = state;
    let (sketch_id, sketch_surface) = match node.finish_arguments_after_eval(labeled, exec_state, ctx).await {
        Ok(x) => x,
        Err(crate::execution::EarlyReturn::Value(cf)) => return Ok(Control::Exit(cf)),
        Err(crate::execution::EarlyReturn::Error(e)) => return Err(e),
    };
    sketch_block_body_setup(node, sketch_id, sketch_surface, konts, exec_state, ctx).await
}

/// Scene setup, ambient sketch state, the sketch2 alias scope, and the body's
/// child environment -- then start the body. Mirrors the middle of
/// `Node<SketchBlock>::get_result`, with the same ordering of pushes so
/// unwinding restores in exactly the reverse order.
async fn sketch_block_body_setup(
    node: Arc<Node<SketchBlock>>,
    sketch_id: ObjectId,
    sketch_surface: SketchSurface,
    konts: &mut Vec<Kont>,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let range = SourceRange::from(node.as_ref());
    let sketch_block_artifact_id = node.scene_setup(sketch_id, &sketch_surface, exec_state)?;

    // Don't early return until the stack frame is popped!
    node.prep_mem(exec_state.mut_stack().snapshot()?, exec_state)?;

    // Track that we're executing a sketch block.
    let initial_sketch_block_state = SketchBlockState {
        sketch_id: Some(sketch_id),
        ..Default::default()
    };
    let saved_sketch_block = exec_state.mod_local.sketch_block.replace(initial_sketch_block_state);
    // When executing the body of the sketch block, we no longer want to
    // skip any code.
    let saved_sketch_mode = std::mem::replace(&mut exec_state.mod_local.sketch_mode, false);

    let mut body_state = SketchBodyState {
        node: node.clone(),
        sketch_id,
        sketch_surface,
        sketch_block_artifact_id,
        saved_sketch_block,
        saved_sketch_mode,
        child_env_pushed: false,
    };

    // Load `sketch2::*` into the sketch block's parent scope, so calls like
    // `line(...)` resolve to sketch2 functions. On failure, unwind exactly
    // like the recursive executor: restore ambient state and pop the alias
    // env, skipping the body and finalization.
    if let Err(e) = node.load_sketch2_into_current_scope(exec_state, ctx, range).await {
        sketch_body_cleanup(body_state, exec_state);
        return Err(e);
    }

    // Execute the user body in a child scope, so the aliases aren't included
    // in the returned sketch object.
    let parent = match exec_state.mut_stack().snapshot() {
        Ok(p) => p,
        Err(e) => {
            sketch_body_cleanup(body_state, exec_state);
            return Err(e);
        }
    };
    if let Err(e) = exec_state.mut_stack().push_new_env_for_call(parent) {
        sketch_body_cleanup(body_state, exec_state);
        return Err(e);
    }
    body_state.child_env_pushed = true;

    let body = BlockRef::SketchBody(node);
    konts.push(Kont::SketchBody(Box::new(body_state)));
    push_block(body, BodyType::Block, konts);
    step_block_kick(konts, exec_state, ctx).await
}

/// The sketch-block body finished normally: collect the block's variables,
/// restore ambient state (popping both environments), then solve and finalize
/// -- or exit the whole program when this sketch block is being edited.
async fn sketch_body_finish(
    state: SketchBodyState,
    applied: Applied,
    exec_state: &mut ExecState,
    ctx: &ExecutorContext,
) -> Result<Control, KclError> {
    let block_result = applied.expect_block()?;

    // Collect the block's variables before popping its env; a failure here
    // still unwinds ambient state like the recursive executor.
    let variables = match exec_state.stack().find_all_in_current_env() {
        Ok(block_variables) => block_variables.into_iter().collect::<IndexMap<_, _>>(),
        Err(e) => {
            sketch_body_cleanup(state, exec_state);
            return Err(e);
        }
    };

    let node = state.node.clone();
    let sketch_id = state.sketch_id;
    let sketch_surface = state.sketch_surface.clone();
    let sketch_block_artifact_id = state.sketch_block_artifact_id;

    // Restore ambient state and pop both envs (child, then alias), taking the
    // sketch-block state back out for finalization.
    let child_popped = state.child_env_pushed;
    if child_popped {
        exec_state.mut_stack().pop_env()?;
    }
    exec_state.mod_local.sketch_mode = state.saved_sketch_mode;
    let sketch_block_state = std::mem::replace(&mut exec_state.mod_local.sketch_block, state.saved_sketch_block);
    exec_state.mut_stack().pop_env()?;

    // The body completed normally (an Exit would have unwound instead), so
    // block_result carries no control flow of interest.
    let _ = block_result;

    let Some(sketch_block_state) = sketch_block_state else {
        return Err(KclError::new_internal(KclErrorDetails::new(
            "Sketch block state should still be set to Some from just above".to_owned(),
            vec![SourceRange::from(node.as_ref())],
        )));
    };

    let return_value = node
        .finalize_sketch_block(
            sketch_id,
            &sketch_surface,
            sketch_block_artifact_id,
            variables,
            sketch_block_state,
            exec_state,
            ctx,
        )
        .await?;

    if node.is_being_edited {
        // When the sketch block is being edited, we exit the program
        // immediately.
        Ok(Control::Exit(return_value.exit()))
    } else {
        Ok(Control::Apply(Applied::Value(return_value)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::execution::parse_execute_with_executor_kind;

    async fn run_machine(code: &str) -> Result<crate::execution::ExecTestResults, KclError> {
        parse_execute_with_executor_kind(code, None, ExecutorKind::Machine).await
    }

    /// The machine's whole point: recursion depth well past the recursive
    /// executor's native-stack cap runs fine on the heap.
    #[tokio::test(flavor = "multi_thread")]
    async fn deep_recursion_well_past_recursive_cap() {
        let code = r#"fn countdown(@n) {
  return if n == 0 {
    0
  } else {
    countdown(n - 1)
  }
}
result = countdown(900)
"#;
        let result = run_machine(code).await.unwrap();
        let value = result
            .exec_state
            .stack()
            .memory
            .get_from_owned("result", result.mem_env, SourceRange::default(), 0)
            .unwrap();
        let KclValue::Number { value, .. } = value else {
            panic!("expected a number, found {value:?}");
        };
        assert_eq!(value, 0.0);
    }

    /// Runaway recursion trips the depth guard with an error instead of
    /// hanging or overflowing the native stack.
    #[tokio::test(flavor = "multi_thread")]
    async fn infinite_recursion_trips_depth_guard() {
        let code = r#"fn forever(@n) {
  return 1 + forever(n)
}
forever(1)
"#;
        let err = run_machine(code).await.unwrap_err();
        assert!(err.to_string().contains("Call depth limit"), "actual: {err:?}");
    }

    /// Deep pipelines ride the continuation stack, not the native stack.
    #[tokio::test(flavor = "multi_thread")]
    async fn long_pipeline() {
        let mut code = String::from("fn bump(@n) {\n  return n + 1\n}\nx = 0");
        for _ in 0..500 {
            code.push_str("\n  |> bump(%)");
        }
        code.push('\n');
        let result = run_machine(&code).await.unwrap();
        let value = result
            .exec_state
            .stack()
            .memory
            .get_from_owned("x", result.mem_env, SourceRange::default(), 0)
            .unwrap();
        let KclValue::Number { value, .. } = value else {
            panic!("expected a number, found {value:?}");
        };
        assert_eq!(value, 500.0);
    }
}
