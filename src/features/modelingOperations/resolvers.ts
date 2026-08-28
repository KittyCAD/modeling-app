import type { ArgumentResolver } from '@src/contracts/modelingOperations'
import { bindingsProducing } from '@src/lib/kclStdlib/program'
import { namedTypesIn } from '@src/lib/kclStdlib/types'

/**
 * The resolvers that need nothing but the program itself.
 *
 * Each claims a *type*, never an operation. Between them they can fill in every
 * argument `extrude` asks for, and they were written for `extrude` only in the
 * sense that it was the first operation to need them.
 */

/** KCL types that a stdlib call can produce, and so that a binding can hold. */
const REFERENCEABLE = [
  'Sketch',
  'Solid',
  'Plane',
  'Face',
  'Segment',
  'Edge',
  'ImportedGeometry',
]

/**
 * A value already in the program, chosen by name.
 *
 * The candidates are derived twice over: which types can be referenced comes
 * from what stdlib functions return, and which bindings hold one comes from
 * what each binding's initialiser called. So a new sketch-producing function in
 * kcl-lib becomes selectable here without anything being added to a list.
 *
 * This is the resolver geometry selection will eventually sit beside — picking a
 * face in the viewport answers the same question a different way, and neither
 * the operation nor this resolver has to know which one was used.
 */
export const bindingResolver: ArgumentResolver = {
  id: 'modeling.resolver.binding',
  label: 'Existing value',
  order: 0,

  handles: (input) =>
    namedTypesIn(input.type).some((name) => REFERENCEABLE.includes(name)),

  prompt: ({ input, program }) => {
    const wanted = namedTypesIn(input.type).filter((name) =>
      REFERENCEABLE.includes(name)
    )

    const seen = new Map<
      string,
      { value: string; label: string; detail: string }
    >()
    for (const typeName of wanted) {
      for (const binding of bindingsProducing(program.ast, typeName)) {
        seen.set(binding.name, {
          value: binding.name,
          label: binding.name,
          detail: `${typeName} from ${binding.via}`,
        })
      }
    }

    return {
      kind: 'choice',
      options: [...seen.values()],
      empty: `Nothing in this file produces a ${wanted.join(' or ')} yet.`,
    }
  },
}

/**
 * A number, typed as KCL.
 *
 * An expression rather than a number input, because KCL numbers are expressions:
 * `10`, `width / 2`, `2 * thickness`. Validating it here would mean a second
 * opinion about KCL's grammar, so what is typed is passed through and the parse
 * that follows is the arbiter.
 */
export const expressionResolver: ArgumentResolver = {
  id: 'modeling.resolver.expression',
  label: 'Expression',
  order: 10,

  handles: (input) => input.type.kind === 'number',

  prompt: ({ input }) => ({
    kind: 'expression',
    unit: input.type.kind === 'number' ? input.type.unit : null,
    placeholder: input.type.kind === 'number' && input.type.unit ? '10' : '0',
  }),
}

/** A flag. Its source text is the word, which is all KCL wants. */
export const booleanResolver: ArgumentResolver = {
  id: 'modeling.resolver.boolean',
  label: 'Flag',
  order: 10,

  handles: (input) => input.type.kind === 'named' && input.type.name === 'bool',

  prompt: () => ({ kind: 'boolean' }),
}

export const builtInResolvers = [
  bindingResolver,
  expressionResolver,
  booleanResolver,
]
