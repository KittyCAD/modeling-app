import type { IconName } from '@kittycad/ui-kit'
import type {
  ModelingOperation,
  ProjectEdit,
} from '@src/contracts/modelingOperations'
import type { OperationAnnotations } from '@src/lib/kclStdlib/shapes'
import { freeName } from '@src/lib/kclStdlib/program'

/**
 * One operation, as its exceptions.
 *
 * Everything a stdlib function already says about itself — its arguments, their
 * types, their documentation, which one it acts on, whether they are required —
 * is read from the generated shape. What is left is what KCL cannot know: an
 * English title, which optional arguments a person means when they name the
 * operation, and what to call the result.
 */
export interface OperationSpec extends OperationAnnotations {
  /** The stdlib function: `extrude`, `gdt::flatness`. */
  stdlib: string
  /** Imperative and specific: "Extrude". */
  title: string
  /**
   * How the edit describes itself afterwards: "Extruded".
   *
   * A phrase rather than a verb, so an operation that acts on nothing in
   * particular can still say what it did — "Added a flatness callout" reads, and
   * "Flattened" would be a lie.
   */
  past: string
  icon?: IconName
  category?: string
  /** Variable name stem. Defaults to the function's own name. */
  stem?: string
}

/** `gdt::flatness` → `flatness`, which is both the stem and the id's tail. */
const baseName = (stdlib: string) => stdlib.split('::').pop() ?? stdlib

/**
 * The id an operation gets from the function it derives from.
 *
 * Exported because a toolbar item and a keybinding both have to name the command
 * without holding a second list of ids: the operation's identity is its stdlib
 * function, and this is the one place that turns one into the other.
 */
export const operationIdFor = (stdlib: string) =>
  `modeling.${stdlib.replace(/::/g, '.')}`

/**
 * An operation, derived.
 *
 * One `plan` for every operation, because writing a KCL call is not per-function
 * work: the special argument goes in unlabelled, everything answered goes in as
 * `name = value`, and the statement is appended. `extrude` wrote exactly this by
 * hand, and the second operation would have written it again.
 *
 * Appended, and only appended. KCL is order-dependent and everything an
 * operation consumes is already defined above it, so the end of the program is
 * always a valid home — and it is the one insertion point that cannot reorder
 * somebody else's code. Placing a statement next to what it consumes reads
 * better and can come later; it is a change to this function, not to any
 * operation.
 */
export function derivedOperation(spec: OperationSpec): ModelingOperation {
  const stem = spec.stem ?? baseName(spec.stdlib)

  return {
    id: operationIdFor(spec.stdlib),
    stdlib: spec.stdlib,
    title: spec.title,
    category: spec.category ?? 'Model',
    annotations: {
      ...(spec.prompt ? { prompt: spec.prompt } : {}),
      ...(spec.omit ? { omit: spec.omit } : {}),
      ...(spec.labels ? { labels: spec.labels } : {}),
    },

    plan: ({ command, inputs, resolved, program, path }): ProjectEdit => {
      const name = freeName(program.ast, stem)

      /*
       * The special argument is written unlabelled, which is how KCL reads "the
       * thing this acts on" — and what makes the call pipeable later without
       * being rewritten.
       */
      const special = inputs.find((input) => input.special)
      const target = special ? resolved[special.name]?.source : undefined

      const args = [
        ...(target ? [target] : []),
        ...inputs
          .filter((input) => !input.special)
          .flatMap((input) => {
            const answer = resolved[input.name]
            // An argument that was skipped is left out of the call entirely
            // rather than written empty.
            return answer ? [`${input.name} = ${answer.source}`] : []
          }),
      ]

      // `preferredName` is the callee as it is written in source, which for a
      // module function is qualified: `gdt::flatness`.
      const callee = command.preferredName ?? command.name
      const statement = `${name} = ${callee}(${args.join(', ')})`

      const source = program.source
      const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n'

      return {
        label: target ? `${spec.past} ${target}` : spec.past,
        changes: {
          [path]: [
            {
              from: source.length,
              to: source.length,
              insert: `${separator}${statement}\n`,
            },
          ],
        },
      }
    },
  }
}
