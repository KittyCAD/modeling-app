import STD_LIB_COMMANDS from '@rust/kcl-lib/bindings/StdLibCommands'
import type {
  StdLibCommandArgShape,
  StdLibCommandShape,
} from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import { type KclType, parseKclType } from '@src/lib/kclStdlib/types'

/**
 * The generated description of KCL's standard library.
 *
 * 201 commands, each with its arguments, their types, their docs, and whether
 * they are required, experimental or deprecated — generated from kcl-lib by the
 * same `export_bindings` run that produces the AST types. This module is the only
 * place that reads it, so everything above works in parsed types rather than
 * strings.
 *
 * The point of deriving rather than declaring: the existing app hand-wrote its
 * modelling command flows and then added a reconciler to notice when the
 * generated shapes drifted from them. Starting from the shapes means there is
 * only one description, and an operation's config is nothing but its exceptions.
 */

const commands = STD_LIB_COMMANDS as unknown as Record<
  string,
  StdLibCommandShape
>

export type StdLibCommandName = keyof typeof STD_LIB_COMMANDS & string

export function stdLibCommand(name: string): StdLibCommandShape | undefined {
  return commands[name]
}

/** The commands whose return type mentions a named KCL type. */
export function commandsReturning(typeName: string): StdLibCommandShape[] {
  return Object.values(commands).filter((command) =>
    command.returnType?.includes(typeName)
  )
}

/**
 * One argument, with its type parsed and its role worked out.
 *
 * `special` is the argument the value flows into — always exactly one, always
 * first, in 155 of the 201 commands. It is what the operation *acts on*, so it
 * is resolved from context or a selection rather than typed into a form, and
 * calling it out here is what keeps every operation from having to say so.
 */
export interface DerivedInput {
  name: string
  type: KclType
  docs: string | null
  required: boolean
  /** The piped argument: what the operation acts on. */
  special: boolean
  experimental: boolean
  deprecated: boolean
}

/**
 * Exceptions to the derivation, as data.
 *
 * Every field here is something the generated shape cannot know. Deliberately
 * small, and deliberately not a second description of the command: `extrude` has
 * fifteen arguments and a useful flow asks for two, but which two is a product
 * decision rather than a fact about KCL.
 */
export interface OperationAnnotations {
  /**
   * Optional arguments to ask for, in this order.
   *
   * Required arguments are always asked for. Everything else is omitted unless
   * named here — the opposite of a list of exclusions, because the arguments
   * worth asking for are the short list.
   */
  prompt?: readonly string[]
  /** Arguments never asked for, even though they are required. Rare. */
  omit?: readonly string[]
  /** A different label than the KCL argument name. */
  labels?: Readonly<Record<string, string>>
}

const toDerived = (arg: StdLibCommandArgShape): DerivedInput => ({
  name: arg.name,
  type: parseKclType(arg.ty ?? 'any'),
  docs: arg.docs,
  required: arg.required,
  special: arg.special,
  experimental: arg.experimental,
  deprecated: arg.deprecated,
})

/**
 * The inputs an operation should collect, derived and then annotated.
 *
 * The rule, rather than a list: required arguments are in, named optional ones
 * are in, and deprecated or experimental arguments stay out unless named. That
 * way a new optional argument appearing in kcl-lib does not silently appear in
 * a flow, and a newly deprecated one does not silently vanish from it.
 */
export function derivedInputs(
  command: StdLibCommandShape,
  annotations: OperationAnnotations = {}
): readonly DerivedInput[] {
  const omitted = new Set(annotations.omit ?? [])
  const prompted = annotations.prompt ?? []

  const inputs = command.args
    .filter((arg) => !omitted.has(arg.name))
    .filter(
      (arg) =>
        (arg.required || prompted.includes(arg.name)) &&
        (!arg.deprecated || prompted.includes(arg.name)) &&
        (!arg.experimental || prompted.includes(arg.name))
    )
    .map(toDerived)

  // Required first, in declaration order, then the prompted ones in the order
  // the operation asked for them: the special argument is what you pick before
  // anything else makes sense.
  return [
    ...inputs.filter((input) => input.required),
    ...prompted.flatMap((name) => {
      const found = inputs.find(
        (input) => input.name === name && !input.required
      )
      return found ? [found] : []
    }),
  ]
}

/** The argument the operation acts on, if it has one. */
export function specialInput(
  inputs: readonly DerivedInput[]
): DerivedInput | undefined {
  return inputs.find((input) => input.special)
}
