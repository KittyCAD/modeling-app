import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import type { ExecutedProgram } from '@src/contracts/kclScene'
import { sketchContextAt } from '@src/features/sketchMode/sketchContext'

const node = { start: 0, end: 0, moduleId: 0, commentStart: 0 }

const sketchBlock = (name: string, start: number, end: number) => ({
  ...node,
  type: 'VariableDeclaration',
  start,
  end,
  kind: 'const',
  declaration: {
    ...node,
    type: 'VariableDeclarator',
    id: { ...node, type: 'Identifier', name },
    init: {
      ...node,
      type: 'SketchBlock',
      arguments: [],
      body: { ...node, type: 'Block', items: [] },
    },
  },
})

const executed = (source: string, ...body: unknown[]): ExecutedProgram => ({
  source,
  ast: { body } as unknown as Program,
})

const program = executed(
  'x'.repeat(200),
  sketchBlock('triangle', 0, 100),
  sketchBlock('slot', 120, 180)
)

describe('finding the sketch the user is in', () => {
  it('reads it from a scene selection', () => {
    expect(sketchContextAt(program, [[50, 60, 0]], null)?.name).toBe('triangle')
  })

  it('reads it from the cursor when nothing is selected', () => {
    expect(sketchContextAt(program, [], 130)?.name).toBe('slot')
  })

  /* Clicking geometry is deliberate; the cursor is wherever it was left. */
  it('prefers the selection to the cursor', () => {
    expect(sketchContextAt(program, [[50, 60, 0]], 130)?.name).toBe('triangle')
  })

  it('walks past a selection that is not in any sketch', () => {
    expect(
      sketchContextAt(
        program,
        [
          [110, 110, 0],
          [130, 130, 0],
        ],
        null
      )?.name
    ).toBe('slot')
  })

  it('finds nothing when neither is in a sketch', () => {
    expect(sketchContextAt(program, [[110, 110, 0]], 105)).toBeNull()
  })

  it('finds nothing before anything has been executed', () => {
    expect(sketchContextAt(null, [[50, 60, 0]], 50)).toBeNull()
  })

  it('finds nothing with no selection and no cursor', () => {
    expect(sketchContextAt(program, [], null)).toBeNull()
  })

  /*
   * The buffer has grown since the run, so the offset addresses a program that no
   * longer exists.
   */
  it('ignores a cursor past the end of what was executed', () => {
    const short = executed('short', sketchBlock('triangle', 0, 100))

    expect(sketchContextAt(short, [], 50)).toBeNull()
  })
})
