import { appendValueSpec, defineContract } from '@kittycad/registry'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { StdLibCommandShape } from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import type {
  DerivedInput,
  OperationAnnotations,
} from '@src/lib/kclStdlib/shapes'

/**
 * One replacement in one file, as plain data.
 *
 * Deliberately not a CodeMirror `ChangeSpec`: an edit has to survive being
 * shown in a review, recorded in history, and — when the edit moves into
 * kcl-lib — arriving as an LSP `WorkspaceEdit` computed somewhere else. Offsets
 * and text are the common denominator of all three.
 */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/**
 * What an operation would change.
 *
 * Keyed by project-relative path because an operation is allowed to touch more
 * than one file, and because that makes this exactly the shape a coordinated
 * multi-file mutation needs — the thing an undo ledger wants to record as one
 * entry.
 *
 * Returned rather than applied. A plan that has not been applied can be
 * previewed, diffed, refused, or recorded first; one that applies itself can
 * only be undone.
 */
export interface ProjectEdit {
  /** Past tense and specific: "Extruded profile001 by 10". */
  label: string
  changes: Readonly<Record<string, readonly TextEdit[]>>
}

/** A KCL program, parsed, with the source it was parsed from. */
export interface ParsedProgram {
  source: string
  ast: Program
}

/** Source text for one argument's value: `profile001`, `10`, `[0, 0]`. */
export interface ResolvedArgument {
  source: string
  /** For the operation's label, when the source text is not what to say. */
  label?: string
  /**
   * Edits that make `source` valid, elsewhere in the same file.
   *
   * Most answers need none: a name already in the program, a number typed in.
   * Some references cannot exist without one — naming an unnamed segment so a
   * region can refer to it, or binding a generated expression above the
   * statement that uses it. That edit belongs to whoever produced the reference,
   * because the operation must not learn how its argument was picked.
   *
   * Measured against the same original document as everything else, and applied
   * in the same transaction: so it composes with the operation's own statement
   * without position mapping, and the whole thing is one undo entry. It is
   * never applied at selection time — clicking must not edit the file, and
   * cancelling must leave nothing behind.
   */
  prerequisites?: readonly TextEdit[]
}

export type ResolvedInputs = Readonly<Record<string, ResolvedArgument>>

/**
 * What to ask the user for.
 *
 * A small closed set of *interaction shapes*, so one component can render every
 * argument of every operation. A resolver maps a KCL type onto one of these; it
 * never renders anything itself, which is what keeps the prompt UI from growing
 * a case per stdlib function.
 *
 * The set grows when a genuinely new interaction appears — picking geometry in
 * the viewport will be one — and not when a new type does.
 */
export type ArgumentPrompt =
  | {
      kind: 'choice'
      options: readonly { value: string; label: string; detail?: string }[]
      /** Said when there is nothing to choose from, e.g. no sketch in the file. */
      empty?: string
    }
  | { kind: 'expression'; placeholder?: string; unit?: string | null }
  | { kind: 'boolean' }

export interface ResolveRequest {
  input: DerivedInput
  program: ParsedProgram
  /** Answers so far, so a later argument can depend on an earlier one. */
  resolved: ResolvedInputs
}

/**
 * How a value for one kind of argument gets supplied.
 *
 * Keyed on the argument's *derived type*, so nothing is declared per operation:
 * a `number(Length)` is asked for as an expression because it is a number, not
 * because `extrude` said so. This is the headless half of what a command bar's
 * argument step does — the interaction shape it returns is rendered by one
 * component, and the resolver never sees a DOM node.
 *
 * Contributed, which is the whole point. When selection lands it contributes a
 * resolver for `Sketch | Face | Solid` and no operation changes — it becomes one
 * more method for an argument that already had one.
 */
export interface ArgumentResolver {
  id: string
  /**
   * How this way of answering is offered, when an argument has more than one.
   *
   * "Pick a sketch" and "click a region in the scene" both answer a `Sketch`
   * argument, and the user chooses between them — so a resolver is a *method*,
   * not just a handler.
   */
  label: string
  /** Lower sorts earlier in the list of methods. */
  order?: number
  handles: (input: DerivedInput) => boolean
  prompt: (request: ResolveRequest) => ArgumentPrompt | Promise<ArgumentPrompt>
  /**
   * Turn the answer into an argument.
   *
   * Defaults to the answer as source text, which is right for a choice whose
   * values are already names. A resolver that produces a reference which does
   * not exist yet answers with the prerequisites that make it valid — which is
   * the only way `prerequisites` can be produced, and why this returns an
   * argument rather than a string.
   */
  toArgument?: (answer: string, request: ResolveRequest) => ResolvedArgument
}

export interface PlanContext {
  command: StdLibCommandShape
  inputs: readonly DerivedInput[]
  resolved: ResolvedInputs
  program: ParsedProgram
  /** Project-relative path of the file being edited. */
  path: string
}

/**
 * One modelling operation.
 *
 * Derived from a stdlib command, so it declares almost nothing: its arguments,
 * their types, their docs and which one it acts on all come from the generated
 * shape. What is left is a title, the exceptions, and how to write the call.
 *
 * `plan` returns an edit and never applies one, which is what lets the same
 * operation be reached from the palette today, from a code action later, and
 * from a toolbar button after that — none of which has to know how the others
 * gathered their arguments.
 */
export interface ModelingOperation {
  id: string
  /** The stdlib command this derives from. */
  stdlib: string
  title: string
  category?: string
  annotations?: OperationAnnotations
  plan: (context: PlanContext) => ProjectEdit | Promise<ProjectEdit>
}

export const modelingOperationsContract = defineContract({
  modelingOperationsValueSpec: appendValueSpec<ModelingOperation>(
    'modeling.operations'
  ),
  argumentResolversValueSpec: appendValueSpec<ArgumentResolver>(
    'modeling.argumentResolvers'
  ),
})

export const { modelingOperationsValueSpec, argumentResolversValueSpec } =
  modelingOperationsContract
