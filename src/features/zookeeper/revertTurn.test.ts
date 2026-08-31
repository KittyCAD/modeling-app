import { ChangeSet, Text } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  type AppliedChange,
  inverseForTurn,
} from '@src/features/zookeeper/revertTurn'

const TURN = 'turn-1'

/**
 * A growing record of what has been applied to one document, as the app would
 * accumulate it from the buffer's change events.
 */
const history = (start: string) => {
  const applied: AppliedChange[] = []
  let doc = Text.of(start.split('\n'))

  return {
    applied,
    push(
      turnId: string | null,
      specs: readonly { from: number; to: number; insert: string }[]
    ) {
      const changes = ChangeSet.of([...specs], doc.length)
      applied.push({ changes, docBefore: doc, turnId })
      doc = changes.apply(doc)
    },
    current: () => doc,
    text: () => doc.toString(),
  }
}

const revert = (log: ReturnType<typeof history>) => {
  const inverse = inverseForTurn({ applied: log.applied, turnId: TURN })
  const changes = inverse.changes
  return {
    ...inverse,
    text:
      changes === null ? log.text() : changes.apply(log.current()).toString(),
  }
}

describe('inverseForTurn', () => {
  it('has nothing to undo for a turn that changed nothing', () => {
    const log = history('width = 10\n')
    log.push(null, [{ from: 0, to: 5, insert: 'thickness' }])

    expect(inverseForTurn({ applied: log.applied, turnId: TURN })).toEqual({
      changes: null,
      stranded: [],
    })
  })

  it('restores the document when the turn is the only thing that happened', () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])

    expect(log.text()).toBe('width = 10\ndepth = 2\n')
    expect(revert(log).text).toBe('width = 10\n')
  })

  it('keeps an edit the user made after the turn', () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])
    log.push(null, [{ from: 0, to: 0, insert: '// mine\n' }])

    const undone = revert(log)
    expect(undone.text).toBe('// mine\nwidth = 10\n')
    expect(undone.stranded).toEqual([])
  })

  it('keeps an edit the user made before the turn', () => {
    const log = history('width = 10\n')
    log.push(null, [{ from: 0, to: 0, insert: '// mine\n' }])
    log.push(TURN, [{ from: 19, to: 19, insert: 'depth = 2\n' }])

    expect(log.text()).toBe('// mine\nwidth = 10\ndepth = 2\n')
    expect(revert(log).text).toBe('// mine\nwidth = 10\n')
  })

  /**
   * The shape live-apply actually produces: a turn lands as several changes, with
   * the user's typing interleaved between them.
   */
  it('undoes every change a streaming turn made, keeping what came between', () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])
    log.push(null, [{ from: 0, to: 0, insert: '// mine\n' }])
    log.push(TURN, [{ from: 29, to: 29, insert: 'height = 4\n' }])

    expect(log.text()).toBe('// mine\nwidth = 10\ndepth = 2\nheight = 4\n')

    const undone = revert(log)
    expect(undone.text).toBe('// mine\nwidth = 10\n')
    expect(undone.stranded).toEqual([])
  })

  it("leaves another turn's work alone", () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])
    log.push('turn-2', [{ from: 21, to: 21, insert: 'height = 4\n' }])

    expect(revert(log).text).toBe('width = 10\nheight = 4\n')
  })

  /**
   * The case that cannot be resolved cleanly — and the one where the mechanism
   * turned out to be kinder than the design assumed.
   *
   * The expectation going in was that reverting would delete the agent's block
   * *including* whatever the user had typed inside it, on the grounds that the
   * text has no meaning without its surroundings. It does not: mapping a deletion
   * over an insertion that sits inside it preserves the insertion, which is
   * standard operational-transform behaviour and the right call — an undo of
   * somebody else's work should not destroy yours.
   *
   * So the user's text survives, stranded without the lines that framed it. That
   * is a mess to look at and not a loss, which makes it a different warning.
   */
  it("preserves, but strands, text the user typed inside the turn's insertion", () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])
    // Typing inside the line the agent just inserted.
    log.push(null, [{ from: 16, to: 16, insert: '00' }])

    expect(log.text()).toBe('width = 10\ndepth00 = 2\n')

    const undone = revert(log)
    expect(undone.stranded).toHaveLength(1)
    expect(undone.stranded[0]).toEqual({ from: 11, to: 21 })
    // The agent's line is gone; the two characters the user typed are not.
    expect(undone.text).toBe('width = 10\n00')
  })

  it("does not report an edit that merely abuts the turn's insertion", () => {
    const log = history('width = 10\n')
    log.push(TURN, [{ from: 11, to: 11, insert: 'depth = 2\n' }])
    // Immediately after the inserted block, not inside it.
    log.push(null, [{ from: 21, to: 21, insert: '// mine\n' }])

    const undone = revert(log)
    expect(undone.stranded).toEqual([])
    expect(undone.text).toBe('width = 10\n// mine\n')
  })

  it('undoes a replacement the turn made', () => {
    const log = history('width = 10\ndepth = 2\n')
    log.push(TURN, [{ from: 11, to: 20, insert: 'depth = 7' }])

    expect(log.text()).toBe('width = 10\ndepth = 7\n')
    expect(revert(log).text).toBe('width = 10\ndepth = 2\n')
  })

  it('undoes a deletion the turn made', () => {
    const log = history('width = 10\ndepth = 2\n')
    log.push(TURN, [{ from: 11, to: 21, insert: '' }])

    expect(log.text()).toBe('width = 10\n')
    expect(revert(log).text).toBe('width = 10\ndepth = 2\n')
  })

  it('ignores an empty change attributed to the turn', () => {
    const log = history('width = 10\n')
    log.push(TURN, [])

    expect(
      inverseForTurn({ applied: log.applied, turnId: TURN }).changes
    ).toBeNull()
  })
})
