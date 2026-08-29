import type { StdLibCommandShape } from '@rust/kcl-lib/bindings/StdLibCommandTypes'
import type { OperationSpec } from '@src/features/modelingOperations/operations/derive'
import { freeName } from '@src/lib/kclStdlib/program'

/**
 * What a sketch block takes.
 *
 * Declared rather than generated, because `sketch { … }` is a language construct
 * and kcl-lib generates shapes for functions. Everything above this line works in
 * shapes, so declaring one keeps the construct on the same path as the 201
 * functions: the same argument derivation, the same resolvers, the same prompt.
 *
 * `on` is the keyword the parser wants and the types are what kcl-lib's own
 * "start sketch" accepts — a plane, or a face of something already built.
 */
const SKETCH_BLOCK: StdLibCommandShape = {
  name: 'sketch',
  preferredName: 'sketch',
  qualName: 'sketch',
  moduleName: '',
  returnType: 'Sketch',
  deprecated: false,
  deprecatedSince: null,
  experimental: false,
  docHidden: false,
  args: [
    {
      name: 'on',
      ty: 'Plane | Face | TaggedFace',
      docs: 'The plane or face the sketch is drawn on.',
      required: true,
      // What the operation acts on, which is what `special` means. The call is
      // still written with the keyword, because the block's parser wants it.
      special: true,
      experimental: false,
      deprecated: false,
      deprecatedSince: null,
    },
  ],
}

/**
 * Start a sketch.
 *
 * Writes an empty sketch block and leaves the cursor inside it. That is the
 * whole operation — and it is what makes sketching reachable without a mode
 * switch anywhere in the code: the block is a place, the cursor is in it, and
 * the mode follows from the file on the next run.
 *
 * Empty on purpose, and not an oversight: kcl-lib's own frontend adds exactly
 * this and then executes, because the run is what creates the plane to draw on.
 * A block with a starter segment in it would be guessing at the first line
 * somebody meant to draw.
 *
 * The block is appended like every other statement. A sketch consumes nothing,
 * so the end of the file is always valid, and it is the one insertion point that
 * cannot reorder anybody else's code.
 */
export const startSketchSpec: OperationSpec = {
  stdlib: 'sketch',
  shape: SKETCH_BLOCK,
  title: 'Start sketch',
  past: 'Started a sketch on',
  description: 'Open an empty sketch on a plane or a face, and draw in it.',
  icon: 'sketch',
  stem: 'sketch',

  plan: ({ resolved, program, path }) => {
    const on = resolved.on?.source ?? ''
    const name = freeName(program.ast, 'sketch')

    /*
     * The exact shape kcl-lib's formatter produces for an empty block: the
     * header, a blank line, the brace. Writing anything else means the first
     * format reflows a statement nobody has touched.
     */
    const header = `${name} = sketch(on = ${on}) {\n`
    const source = program.source
    const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n'

    return {
      label: `Started a sketch on ${on}`,
      /*
       * And then edit it, once the run has landed.
       *
       * Starting a sketch and being in it are one intention, and the app used to
       * infer the second from the cursor arriving in the block. That inference
       * had to go — entering now opens a sketch session and costs a real
       * execution, which is not something a cursor move may buy. Saying it here
       * is the honest version: the operation whose point is to put you in a
       * sketch is the operation that asks to be put there.
       */
      then: 'sketch.enter',
      changes: {
        [path]: [
          {
            from: source.length,
            to: source.length,
            insert: `${separator}${header}\n}\n`,
          },
        ],
      },
      /*
       * The blank line between the header and the brace.
       *
       * An empty sketch block is an invitation, and leaving the cursor at the end
       * of the file would be handing over a form with the pen still in your
       * pocket. It is also what puts the app in sketch mode, since being in a
       * sketch is read from where the cursor is rather than from an event.
       */
      focus: {
        path,
        offset: source.length + separator.length + header.length,
      },
    }
  },
}
