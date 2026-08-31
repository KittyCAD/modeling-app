import { history, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { revertContribution } from '@src/lib/collab/revertContribution'

const WRITER = 'zookeeper:conversation-1'
const CONTRIBUTION = 'turn-1'

/*
 * With a real history extension, because two of these assert what `addToHistory`
 * does. An empty capability set has no history at all, which would make `undo` a
 * no-op and both of those tests pass without testing anything.
 */
const undoable: EditorCapability = {
  id: 'test.history',
  extension: () => history(),
}

const bufferWith = (contents: string, path: string) =>
  createFileBackedTextBuffer({
    path,
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities([undoable]),
  })

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

const asWriter = (
  buffer: FileBackedTextBuffer,
  spec: { from: number; to?: number; insert: string }
) => {
  buffer.dispatch({
    changes: spec,
    annotations: bufferOrigin.of({
      role: 'semantic',
      author: WRITER,
      contributionId: CONTRIBUTION,
    }),
  })
}

/** A project with files open, all followed by one shared history. */
function project(files: Record<string, string>) {
  const history = createChangeHistory()
  const buffers = new Map<string, FileBackedTextBuffer>()

  for (const [path, contents] of Object.entries(files)) {
    const buffer = bufferWith(contents, path)
    buffers.set(path, buffer)
    history.follow(path, buffer)
  }

  const buffer = (path: string) => {
    const found = buffers.get(path)
    if (found === undefined) throw new Error(`${path} is not open.`)
    return found
  }

  return {
    history,
    buffer,
    revert: (paths: readonly string[]) =>
      revertContribution({
        contributionId: CONTRIBUTION,
        paths,
        changeHistory: history,
        bufferForPath: (path) => buffers.get(path),
      }),
  }
}

describe('revertContribution', () => {
  it('undoes one contribution across every file it touched', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    asWriter(app.buffer('main.kcl'), { from: 8, to: 10, insert: '20' })
    asWriter(app.buffer('bracket.kcl'), { from: 8, to: 9, insert: '4' })

    const outcome = app.revert(['main.kcl', 'bracket.kcl'])

    expect(outcome.reverted).toEqual(['main.kcl', 'bracket.kcl'])
    expect(outcome.missing).toEqual([])
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')
  })

  /** The whole reason this uses change algebra rather than a stored snapshot. */
  it('keeps what was typed afterwards', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    asWriter(app.buffer('main.kcl'), { from: 11, insert: 'depth = 2\n' })
    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 0, insert: '// mine\n' } })

    app.revert(['main.kcl'])

    expect(textOf(app.buffer('main.kcl'))).toBe('// mine\nwidth = 10\n')
  })

  /**
   * Text typed *inside* the reverted block survives, stranded. Mapping a deletion
   * over an insertion inside it preserves the insertion — an undo of somebody
   * else's work has no business destroying yours.
   */
  it('reports text left stranded, and does not delete it', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    asWriter(app.buffer('main.kcl'), {
      from: 11,
      insert: 'depth = 2\nheight = 4\n',
    })
    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 21, insert: '// note\n' } })

    const outcome = app.revert(['main.kcl'])

    expect(outcome.stranded).toHaveLength(1)
    expect(outcome.stranded[0].path).toBe('main.kcl')
    expect(textOf(app.buffer('main.kcl'))).toContain('// note')
    expect(textOf(app.buffer('main.kcl'))).not.toContain('depth = 2')
  })

  /** Partial success is the normal outcome, not an error. */
  it('leaves a file it cannot undo alone and names it', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    asWriter(app.buffer('main.kcl'), { from: 8, to: 10, insert: '20' })

    const outcome = app.revert(['main.kcl', 'gone.kcl'])

    expect(outcome.reverted).toEqual(['main.kcl'])
    expect(outcome.missing).toEqual(['gone.kcl'])
  })

  it('does nothing for a contribution the history never saw', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.buffer('main.kcl').dispatch({ changes: { from: 0, insert: 'x' } })

    const outcome = app.revert(['main.kcl'])

    expect(outcome.reverted).toEqual([])
    expect(outcome.missing).toEqual(['main.kcl'])
    expect(textOf(app.buffer('main.kcl'))).toBe('xwidth = 10\n')
  })

  /**
   * The revert is a change to the buffer like any other. Asserted because the
   * alternative was tried: hiding it from history left the buffer's own undo entry
   * for the reverted edit in place, CodeMirror mapped that entry through the
   * revert, and the next Ctrl-Z applied an inverse that had already been applied —
   * turning `width = 10` into `width = 1010`.
   */
  it('is itself undoable, putting the reverted work back', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    asWriter(app.buffer('main.kcl'), { from: 8, to: 10, insert: '20' })

    app.revert(['main.kcl'])
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')

    app.buffer('main.kcl').runCommand(undo)
    // The writer's edit is back: undoing an undo is a thing a user may want.
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')
  })
})
