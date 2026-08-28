import type { ModelingOperation } from '@src/contracts/modelingOperations'
import { freeName } from '@src/lib/kclStdlib/program'

/**
 * Extrude a sketch into a solid.
 *
 * The first operation, and it declares almost nothing. Its fifteen arguments,
 * their types, their documentation and which one it acts on all come from the
 * generated stdlib shape; what is here is a title, the two arguments worth
 * asking for, and how to write the call.
 *
 * `length` is optional in KCL — it is incompatible with `to` — but it is what a
 * person means by "extrude", so it is prompted for. The other thirteen are
 * reachable by editing the call afterwards, which is the point of generating
 * code rather than holding the model in a machine.
 */
export const extrudeOperation: ModelingOperation = {
  id: 'modeling.extrude',
  stdlib: 'extrude',
  title: 'Extrude',
  category: 'Model',

  annotations: {
    prompt: ['length'],
    labels: { sketches: 'Sketch' },
  },

  plan: ({ resolved, program, path }) => {
    const sketch = resolved.sketches?.source ?? ''
    const length = resolved.length?.source

    const name = freeName(program.ast, 'extrude')

    const args = [sketch, ...(length ? [`length = ${length}`] : [])]
    const statement = `${name} = extrude(${args.join(', ')})`

    /*
     * Appended, and only appended.
     *
     * KCL is order-dependent, and everything this consumes is already defined
     * above — so the end of the program is always a valid home, and it is the
     * one insertion point that cannot reorder somebody else's code. Placing it
     * next to the sketch it consumes would read better and can come later; it is
     * a change to this line, not to the contract.
     */
    const source = program.source
    const separator = source.length === 0 || source.endsWith('\n') ? '' : '\n'

    return {
      label: length ? `Extruded ${sketch} by ${length}` : `Extruded ${sketch}`,
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
