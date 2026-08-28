import type { ArgumentResolver } from '@src/contracts/modelingOperations'
import { bindingsProducing } from '@src/lib/kclStdlib/program'
import type { KclType } from '@src/lib/kclStdlib/types'
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

/**
 * The planes every KCL file has.
 *
 * `XY`, `XZ`, `YZ` and their negatives are values, not bindings — they are not
 * declared anywhere, so no amount of reading the program finds them, and a fresh
 * file offered "nothing in this file produces a Plane yet" for the one argument
 * it certainly could answer.
 *
 * The negatives are the same planes facing the other way, which is how you sketch
 * on the underside of something without writing a rotation.
 *
 * First among the methods, because on an empty file this is the only one that can
 * answer: there is no binding to pick and nothing rendered to click.
 */
const STANDARD_PLANES: readonly { value: string; detail: string }[] = [
  { value: 'XY', detail: 'Top, looking down the Z axis' },
  { value: 'XZ', detail: 'Front, looking along the Y axis' },
  { value: 'YZ', detail: 'Right, looking along the X axis' },
  { value: '-XY', detail: 'Bottom' },
  { value: '-XZ', detail: 'Back' },
  { value: '-YZ', detail: 'Left' },
]

export const standardPlaneResolver: ArgumentResolver = {
  id: 'modeling.resolver.standardPlane',
  label: 'Standard plane',
  order: -20,

  handles: (input) => namedTypesIn(input.type).includes('Plane'),

  prompt: () => ({
    kind: 'choice',
    options: STANDARD_PLANES.map((plane) => ({
      value: plane.value,
      label: plane.value,
      detail: plane.detail,
    })),
  }),
}

/**
 * What a value of this type looks like written down.
 *
 * A placeholder, not validation. Some KCL types have a canonical short form that
 * is worth showing — a plane is `XY`, an axis is `Z` — and for everything else the
 * type's own name is more use than an empty box.
 */
const EXAMPLES: Readonly<Record<string, string>> = {
  Plane: 'XY',
  Axis3d: 'Z',
  Axis2d: 'X',
  Point3d: '[0, 0, 0]',
  Point2d: '[0, 0]',
  TagDecl: '$edge1',
  string: '"text"',
  bool: 'true',
}

function exampleFor(type: KclType): string {
  switch (type.kind) {
    case 'number':
      return '10'
    case 'named':
      return EXAMPLES[type.name] ?? type.name
    case 'array':
      return `[${exampleFor(type.element)}]`
    case 'union':
      // The first member, which is the one KCL's own docs lead with.
      return type.members.length > 0 ? exampleFor(type.members[0]) : ''
  }
}

/**
 * Anything, typed as KCL source.
 *
 * The escape hatch, and a load-bearing one. An argument whose type nothing else
 * claims — an axis, a plane, a list of datum letters, a string — would otherwise
 * dead-end at "nothing knows how to supply this", and the operation would be a
 * button that cannot be finished. Typing the value is always a valid way to
 * answer a KCL argument, because KCL is what is being written.
 *
 * Offered last, so it never displaces a resolver that knows something: pick an
 * existing value, or click the model, and *then* type it if neither fits. It also
 * covers the case the others structurally cannot — an argument that wants two of
 * something, where `[a, b]` is the only answer the argument layer can express
 * until multi-selection exists.
 *
 * Nothing is validated here. Checking KCL's grammar in a form field means a
 * second opinion about the language; the parse that follows is the arbiter, and
 * it reports through the same diagnostics as everything else.
 */
export const sourceResolver: ArgumentResolver = {
  id: 'modeling.resolver.source',
  label: 'Type it',
  order: 100,

  /*
   * Everything except what already has a plain-text prompt of its own. A number
   * and a flag are answered by typing too, and offering "Expression" and "Type
   * it" side by side would be two names for one field.
   */
  handles: (input) =>
    input.type.kind !== 'number' &&
    !(input.type.kind === 'named' && input.type.name === 'bool'),

  prompt: ({ input }) => ({
    kind: 'expression',
    unit: null,
    placeholder: exampleFor(input.type),
  }),
}

export const builtInResolvers = [
  standardPlaneResolver,
  bindingResolver,
  expressionResolver,
  booleanResolver,
  sourceResolver,
]
