import type { Program } from '@rust/kcl-lib/bindings/Program'
import { describe, expect, it } from 'vitest'
import type { ExecutedProgram } from '@src/contracts/kclScene'
import { sketchContextAt } from '@src/features/sketchMode/sketchContext'

/** A cursor that counts: one in the buffer being executed. */
const at = (offset: number) => ({ offset, executing: true })

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
    expect(sketchContextAt(program, [], at(130))?.name).toBe('slot')
  })

  /* Clicking geometry is deliberate; the cursor is wherever it was left. */
  it('prefers the selection to the cursor', () => {
    expect(sketchContextAt(program, [[50, 60, 0]], at(130))?.name).toBe(
      'triangle'
    )
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
    expect(sketchContextAt(program, [[110, 110, 0]], at(105))).toBeNull()
  })

  it('finds nothing before anything has been executed', () => {
    expect(sketchContextAt(null, [[50, 60, 0]], at(50))).toBeNull()
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

    expect(sketchContextAt(short, [], at(50))).toBeNull()
  })
})

/*
 * Leaving is said, not inferred. Focus was tried as the condition and took the
 * mode away from the case that needs it most — Start sketch with the code panel
 * closed, where there is no view to hold focus at all.
 */
describe('which cursors count', () => {
  it('counts a cursor whether or not anything has focus', () => {
    expect(sketchContextAt(program, [], at(50))?.name).toBe('triangle')
  })

  it('ignores a cursor in a buffer that is not the one being executed', () => {
    expect(
      sketchContextAt(program, [], { offset: 50, executing: false })
    ).toBeNull()
  })

  /* A scene selection is not the cursor's, and outlives it. */
  it('keeps a scene selection when the cursor does not count', () => {
    expect(
      sketchContextAt(program, [[50, 60, 0]], { offset: 130, executing: false })
        ?.name
    ).toBe('triangle')
  })
})
