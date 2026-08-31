import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { createProjectActionHistory } from '@src/features/projectHistory/createProjectActionHistory'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

/** A project whose open buffers are all followed by one shared change log. */
function project(files: Record<string, string>, depth?: number) {
  const changeHistory = createChangeHistory()
  const buffers = new Map<string, FileBackedTextBuffer>()

  for (const [path, contents] of Object.entries(files)) {
    const buffer = createFileBackedTextBuffer({
      path,
      contents,
      languageId: 'kcl',
      capabilities: combineCapabilities([] as EditorCapability[]),
    })
    buffers.set(path, buffer)
    changeHistory.follow(path, buffer)
  }

  const buffer = (path: string) => {
    const found = buffers.get(path)
    if (found === undefined) throw new Error(`${path} is not open.`)
    return found
  }

  const history = createProjectActionHistory({
    changeHistory,
    bufferForPath: (path) => buffers.get(path),
    ...(depth === undefined ? {} : { depth }),
  })

  /** Write as a coordinated writer would, then record what it did. */
  const act = (
    id: string,
    label: string,
    edits: Record<string, { from: number; to?: number; insert: string }>
  ) => {
    for (const [path, spec] of Object.entries(edits)) {
      buffer(path).dispatch({
        changes: spec,
        annotations: bufferOrigin.of({ role: 'semantic', contributionId: id }),
      })
    }
    history.record({
      id,
      label,
      at: 0,
      author: null,
      paths: Object.keys(edits),
    })
  }

  const type = (path: string, spec: { from: number; insert: string }) => {
    buffer(path).dispatch({ changes: spec })
  }

  return { changeHistory, history, buffer, act, type, buffers }
}

describe('createProjectActionHistory', () => {
  it('starts empty, with nothing to undo', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    expect(app.history.entries.value).toEqual([])
    expect(app.history.undoable.value).toBeNull()
  })

  it('offers the newest action first', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 11, insert: 'a\n' },
    })
    app.act('op-2', 'Filleted edge', {
      'main.kcl': { from: 13, insert: 'b\n' },
    })

    expect(app.history.entries.value.map((each) => each.label)).toEqual([
      'Extruded profile001',
      'Filleted edge',
    ])
    expect(app.history.undoable.value?.id).toBe('op-2')
  })

  /** The point of the whole feature: one entry, every file it touched. */
  it('undoes an action across two files at once', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    const outcome = app.history.revert('op-1')

    expect(outcome.reverted).toEqual(['main.kcl', 'bracket.kcl'])
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')
  })

  it('keeps typing that happened after the action', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 11, insert: 'depth = 2\n' },
    })
    app.type('main.kcl', { from: 0, insert: '// mine\n' })

    app.history.revert('op-1')

    expect(textOf(app.buffer('main.kcl'))).toBe('// mine\nwidth = 10\n')
  })

  it('drops an action once it is undone', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })

    app.history.revert('op-1')

    expect(app.history.entries.value).toEqual([])
    expect(app.history.undoable.value).toBeNull()
  })

  it('undoes actions newest first, one at a time', () => {
    const app = project({ 'main.kcl': 'a\n' })
    app.act('op-1', 'First', { 'main.kcl': { from: 2, insert: 'b\n' } })
    app.act('op-2', 'Second', { 'main.kcl': { from: 4, insert: 'c\n' } })

    app.history.revert(app.history.undoable.peek()!.id)
    expect(textOf(app.buffer('main.kcl'))).toBe('a\nb\n')

    app.history.revert(app.history.undoable.peek()!.id)
    expect(textOf(app.buffer('main.kcl'))).toBe('a\n')
  })

  /** An action that changed nothing would shadow the one somebody meant. */
  it('ignores an action that touched no files', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    app.history.record({
      id: 'op-1',
      label: 'Did nothing',
      at: 0,
      author: null,
      paths: [],
    })

    expect(app.history.entries.value).toEqual([])
  })

  /**
   * One contribution is one action. Writers persist and re-persist their work at
   * more moments than they finish it, so the same turn can be offered twice.
   */
  it('records an action once, even if it is offered twice', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })

    app.history.record({
      id: 'op-1',
      label: 'Extruded profile001',
      at: 0,
      author: null,
      paths: ['main.kcl'],
    })

    expect(app.history.entries.value).toHaveLength(1)
  })

  /**
   * Asked of the change log rather than answered from a flag, so forgetting the
   * history is enough to make the offer go away.
   */
  it('stops offering an action whose history is gone', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })
    expect(app.history.canRevert('op-1').value).toBe(true)

    app.changeHistory.forget('main.kcl')

    expect(app.history.canRevert('op-1').value).toBe(false)
    expect(app.history.undoable.value).toBeNull()
    // Still listed: it happened, and saying otherwise would be a lie about the
    // project's past. Only the offer to undo it is withdrawn.
    expect(app.history.entries.value).toHaveLength(1)
  })

  it('cannot revert an action it never saw', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    expect(app.history.canRevert('op-nope').value).toBe(false)
    expect(app.history.revert('op-nope')).toEqual({
      reverted: [],
      missing: [],
      stranded: [],
    })
  })

  /** Bounded by depth, so an all-day session does not accumulate forever. */
  it('forgets the oldest actions past its depth', () => {
    const app = project({ 'main.kcl': 'a\n' }, 2)
    app.act('op-1', 'First', { 'main.kcl': { from: 2, insert: 'b' } })
    app.act('op-2', 'Second', { 'main.kcl': { from: 3, insert: 'c' } })
    app.act('op-3', 'Third', { 'main.kcl': { from: 4, insert: 'd' } })

    expect(app.history.entries.value.map((each) => each.id)).toEqual([
      'op-2',
      'op-3',
    ])
    // Dropping an action does not undo it.
    expect(textOf(app.buffer('main.kcl'))).toBe('a\nbcd')
  })

  it('forgets an action on request', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })

    app.history.forget('op-1')

    expect(app.history.entries.value).toEqual([])
    // The text stays: forgetting is not undoing.
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')
  })
})
