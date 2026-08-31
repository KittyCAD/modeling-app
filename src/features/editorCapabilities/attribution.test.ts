import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  attributionCapability,
  attributionField,
  authoredRanges,
} from '@src/features/editorCapabilities/attribution'
import { bufferOrigin } from '@src/lib/buffers/annotations'

const WRITER = 'zookeeper:c1'
const OTHER = 'zookeeper:c2'

const stateWith = (doc: string) =>
  EditorState.create({
    doc,
    // The capability's extensions, exactly as a buffer would resolve them.
    extensions: [attributionField],
  })

const asRemote = (
  state: EditorState,
  spec: { from: number; to?: number; insert: string },
  author = WRITER
) =>
  state.update({
    changes: spec,
    annotations: bufferOrigin.of({
      role: 'semantic',
      author,
      contributionId: 'turn-1',
    }),
  }).state

const asUser = (
  state: EditorState,
  spec: { from: number; to?: number; insert: string }
) => state.update({ changes: spec }).state

describe('attribution', () => {
  it('starts with nothing attributed', () => {
    expect(authoredRanges(stateWith('width = 10\n'))).toEqual([])
  })

  it('leaves the user’s own typing unattributed', () => {
    const state = asUser(stateWith('width = 10\n'), {
      from: 0,
      insert: '// mine\n',
    })

    expect(authoredRanges(state)).toEqual([])
  })

  it('marks what a remote writer inserted', () => {
    const state = asRemote(stateWith('width = 10\n'), {
      from: 11,
      insert: 'depth = 2\n',
    })

    expect(authoredRanges(state)).toEqual([
      { from: 11, to: 21, author: WRITER },
    ])
  })

  it('records which writer it was', () => {
    let state = asRemote(stateWith('a\n'), { from: 2, insert: 'b\n' }, WRITER)
    state = asRemote(state, { from: 4, insert: 'c\n' }, OTHER)

    expect(authoredRanges(state, OTHER)).toHaveLength(1)
    expect(authoredRanges(state, WRITER)).toHaveLength(1)
  })

  /**
   * The reason this is a `StateField` mapped through changes rather than a side
   * table: a mark has to follow the text it belongs to, and a side table would
   * have to be told about every edit separately.
   */
  it('follows the text when the user edits above it', () => {
    let state = asRemote(stateWith('width = 10\n'), {
      from: 11,
      insert: 'depth = 2\n',
    })
    state = asUser(state, { from: 0, insert: '// mine\n' })

    // Shifted by the eight characters inserted above, not left behind.
    expect(authoredRanges(state)).toEqual([
      { from: 19, to: 29, author: WRITER },
    ])
  })

  it('attributes nothing for a pure deletion', () => {
    const state = asRemote(stateWith('width = 10\ndepth = 2\n'), {
      from: 11,
      to: 21,
      insert: '',
    })

    expect(authoredRanges(state)).toEqual([])
  })

  it('attributes the replacement text of a replacement', () => {
    const state = asRemote(stateWith('width = 10\n'), {
      from: 0,
      to: 5,
      insert: 'thickness',
    })

    expect(authoredRanges(state)).toEqual([{ from: 0, to: 9, author: WRITER }])
  })

  it('drops a mark whose text the user deleted', () => {
    let state = asRemote(stateWith('width = 10\n'), {
      from: 11,
      insert: 'depth = 2\n',
    })
    state = asUser(state, { from: 11, to: 21, insert: '' })

    expect(authoredRanges(state)).toEqual([])
  })

  it('keeps a mark across a change that moved no text', () => {
    let state = asRemote(stateWith('width = 10\n'), {
      from: 11,
      insert: 'depth = 2\n',
    })
    state = state.update({ selection: { anchor: 0 } }).state

    expect(authoredRanges(state)).toHaveLength(1)
  })

  it('is contributed to every buffer, whatever the language', () => {
    expect(attributionCapability.appliesTo).toBeUndefined()
    expect(attributionCapability.id).toBe('editor.attribution')
  })

  /**
   * `BufferStructuralContext` is explicitly not for volatile values, and there is
   * a test elsewhere asserting typing never rebuilds the capability bundle. The
   * extension therefore has to be independent of anything that changes per edit.
   */
  it('builds the same extension every time, so typing cannot rebuild it', () => {
    const context = {
      bufferId: 'buffer-1',
      path: '/projects/bracket/main.kcl',
      languageId: 'kcl',
      fileBacked: true,
      executing: true,
      readOnly: false,
    }

    const first = attributionCapability.extension?.(context)
    const second = attributionCapability.extension?.(context)

    // Literally the same value, so nothing about it can imply a reconfigure.
    expect(first).toBeDefined()
    expect(first).toBe(second)
  })
})
