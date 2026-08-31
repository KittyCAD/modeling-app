import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'
import { inverseForContribution } from '@src/lib/collab/revert'

const PATH = 'main.kcl'
const WRITER = 'zookeeper:conversation-1'
const CONTRIBUTION = 'turn-1'

const bufferWith = (contents: string, path = PATH) =>
  createFileBackedTextBuffer({
    path,
    contents,
    languageId: 'kcl',
    capabilities: combineCapabilities([] as EditorCapability[]),
  })

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

const asWriter = (
  buffer: FileBackedTextBuffer,
  spec: { from: number; to?: number; insert: string },
  contributionId = CONTRIBUTION
) => {
  buffer.dispatch({
    changes: spec,
    annotations: bufferOrigin.of({
      role: 'semantic',
      author: WRITER,
      contributionId,
    }),
  })
}

describe('createChangeHistory', () => {
  it('has nothing for a path it never followed', () => {
    expect(createChangeHistory().entries(PATH)).toEqual([])
  })

  it('records the user typing, untagged', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })

    const entries = history.entries(PATH)
    expect(entries).toHaveLength(1)
    expect(entries[0].contributionId).toBeNull()
    expect(entries[0].docBefore.toString()).toBe('width = 10\n')
  })

  it('records a writer’s edit with its contribution', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    asWriter(buffer, { from: 0, insert: 'depth = 2\n' })

    expect(history.entries(PATH)[0].contributionId).toBe(CONTRIBUTION)
  })

  it('keeps entries in the order they were applied', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    asWriter(buffer, { from: 0, insert: 'a\n' })
    buffer.dispatch({ changes: { from: 0, insert: 'b\n' } })
    asWriter(buffer, { from: 0, insert: 'c\n' }, 'turn-2')

    expect(history.entries(PATH).map((entry) => entry.contributionId)).toEqual([
      CONTRIBUTION,
      null,
      'turn-2',
    ])
  })

  it('ignores a change that moved no text', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    buffer.dispatch({ selection: { anchor: 3 } })

    expect(history.entries(PATH)).toEqual([])
  })

  /**
   * The bug this guards against is invisible until a revert overshoots: two
   * subscriptions on one path record every change twice, and the inverse then
   * removes the same text two times over.
   */
  it('does not double-record when a path is followed twice', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)
    history.follow(PATH, buffer)

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })

    expect(history.entries(PATH)).toHaveLength(1)
  })

  it('stops recording when the follow is disposed', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    const dispose = history.follow(PATH, buffer)
    dispose()

    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })

    expect(history.entries(PATH)).toEqual([])
  })

  it('tracks separate paths separately', () => {
    const main = bufferWith('width = 10\n', 'main.kcl')
    const lid = bufferWith('// lid\n', 'lid.kcl')
    const history = createChangeHistory()
    history.follow('main.kcl', main)
    history.follow('lid.kcl', lid)

    main.dispatch({ changes: { from: 0, insert: 'a' } })

    expect(history.entries('main.kcl')).toHaveLength(1)
    expect(history.entries('lid.kcl')).toEqual([])
  })

  it('forgets a path on request', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)
    buffer.dispatch({ changes: { from: 0, insert: 'a' } })

    history.forget(PATH)
    buffer.dispatch({ changes: { from: 0, insert: 'b' } })

    expect(history.entries(PATH)).toEqual([])
  })

  it('stops everything on dispose', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    history.dispose()
    buffer.dispatch({ changes: { from: 0, insert: 'a' } })

    expect(history.entries(PATH)).toEqual([])
  })

  /**
   * What the log is for. Nothing here was assembled by hand: the writer's edit
   * and the user's typing were both recorded by watching the buffer, and the
   * inverse removes only the writer's work.
   */
  it('supports reverting one contribution out of a mixed history', () => {
    const buffer = bufferWith('width = 10\n')
    const history = createChangeHistory()
    history.follow(PATH, buffer)

    asWriter(buffer, {
      from: 'width = 10\n'.length,
      insert: 'depth = 2\n',
    })
    buffer.dispatch({ changes: { from: 0, insert: '// mine\n' } })
    asWriter(buffer, { from: 0, insert: '// theirs\n' }, 'turn-2')

    const inverse = inverseForContribution({
      applied: history.entries(PATH),
      contributionId: CONTRIBUTION,
    })
    expect(inverse.changes).not.toBeNull()
    if (inverse.changes === null) return

    buffer.dispatch({ changes: inverse.changes })

    // The first contribution is gone; the user's line and turn-2's both remain.
    expect(textOf(buffer)).not.toContain('depth = 2')
    expect(textOf(buffer)).toContain('// mine')
    expect(textOf(buffer)).toContain('// theirs')
    expect(textOf(buffer)).toContain('width = 10')
  })
})
