import { history, isolateHistory, undo } from '@codemirror/commands'
import { describe, expect, it } from 'vitest'
import {
  type EditorCapability,
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { baselineCapability } from '@src/features/editorCapabilities/baseline'
import {
  createProjectUndoCapability,
  projectUndoCommand,
} from '@src/features/editorCapabilities/projectUndo'
import { createProjectActionHistory } from '@src/features/projectHistory/createProjectActionHistory'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'

const ROOT = '/projects/bracket'

const historyCapability: EditorCapability = {
  id: 'history',
  extension: () => history(),
}

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

/**
 * A project whose buffers are followed by one shared change log, with the
 * project's action stack over it — the arrangement the real feature builds.
 */
function project(files: Record<string, string>) {
  const changeHistory = createChangeHistory()
  const buffers = new Map<string, FileBackedTextBuffer>()

  for (const [path, contents] of Object.entries(files)) {
    const buffer = createFileBackedTextBuffer({
      path: `${ROOT}/${path}`,
      contents,
      languageId: 'kcl',
      capabilities: combineCapabilities([historyCapability]),
    })
    buffers.set(path, buffer)
    changeHistory.follow(path, buffer)
  }

  const buffer = (path: string) => {
    const found = buffers.get(path)
    if (found === undefined) throw new Error(`${path} is not open.`)
    return found
  }

  const projectHistory = createProjectActionHistory({
    changeHistory,
    bufferForPath: (path) => buffers.get(path),
  })

  /** Write as a coordinated writer does, then record it. */
  const act = (
    id: string,
    label: string,
    edits: Record<string, { from: number; to?: number; insert: string }>
  ) => {
    for (const [path, spec] of Object.entries(edits)) {
      buffer(path).dispatch({
        changes: spec,
        annotations: [
          bufferOrigin.of({ role: 'semantic', contributionId: id }),
          isolateHistory.of('full'),
        ],
      })
    }
    projectHistory.record({
      id,
      label,
      at: 0,
      author: null,
      paths: Object.keys(edits),
    })
  }

  const command = (path: string) =>
    projectUndoCommand({
      history: () => projectHistory,
      // The real one asks the session; here the mapping is just the root.
      relativePathFor: (absolute) =>
        absolute.startsWith(`${ROOT}/`)
          ? absolute.slice(ROOT.length + 1)
          : null,
      absolute: `${ROOT}/${path}`,
    })

  /** Ctrl-Z as the keymap resolves it: ours first, then the buffer's own. */
  const pressUndo = (path: string) => {
    const handled = buffer(path).runCommand(command(path))
    if (!handled) buffer(path).runCommand(undo)
    return handled
  }

  return { buffer, act, projectHistory, changeHistory, pressUndo, command }
}

describe('project undo on Ctrl-Z', () => {
  /** The whole point: one keystroke, every file the action touched. */
  it('undoes a two-file action from either of its files', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    expect(app.pressUndo('main.kcl')).toBe(true)

    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')
  })

  /**
   * Declining is the important half. A keystroke that took the user's own edit
   * away from them would make the feature worse than not having it.
   */
  it('leaves the keystroke alone while the user has newer typing', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 11, insert: 'depth = 2\n' },
    })
    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 0, insert: '// mine\n' } })

    expect(app.pressUndo('main.kcl')).toBe(false)

    // The buffer's own undo ran instead: the typing went, the action stayed.
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\ndepth = 2\n')
    expect(app.projectHistory.entries.value).toHaveLength(1)
  })

  /**
   * The case that rules out asking "was the newest transaction part of the
   * action?" — after undoing their own typing the newest transaction is an undo,
   * but the action is once again what the next Ctrl-Z reaches.
   */
  it('takes over again once the user has undone their own typing', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })
    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 0, insert: '// mine\n' } })

    expect(app.pressUndo('main.kcl')).toBe(false)
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')

    // Second press: the action is on top again, and now it goes project-wide.
    expect(app.pressUndo('main.kcl')).toBe(true)
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')
  })

  /** Ctrl-Z is a question about the file in front of you. */
  it('ignores an action that did not touch this buffer', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Deepened the bracket', {
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    expect(app.pressUndo('main.kcl')).toBe(false)
    // Untouched: neither file was reverted by a keystroke in the wrong one.
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 4\n')
  })

  it('undoes the newest action in this buffer, not the newest overall', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Widened', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })
    app.act('op-2', 'Deepened', {
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    expect(app.pressUndo('main.kcl')).toBe(true)

    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    // The newer action in the other file is untouched, and still undoable there.
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 4\n')
    expect(app.projectHistory.undoable.value?.id).toBe('op-2')
  })

  /** Typing inside the reverted block survives, as `revertContribution` promises. */
  it('keeps text the user typed after the action', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 11, insert: 'depth = 2\n' },
    })
    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 0, insert: '// mine\n' } })
    app.buffer('main.kcl').runCommand(undo)

    expect(app.pressUndo('main.kcl')).toBe(true)
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
  })

  it('declines in a build with no project history', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })

    const command = projectUndoCommand({
      history: () => null,
      relativePathFor: () => 'main.kcl',
      absolute: `${ROOT}/main.kcl`,
    })

    expect(app.buffer('main.kcl').runCommand(command)).toBe(false)
  })

  it('declines for a buffer the project cannot name', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })

    const command = projectUndoCommand({
      history: () => app.projectHistory,
      // A scratch buffer, or one outside the open project.
      relativePathFor: () => null,
      absolute: '/elsewhere/main.kcl',
    })

    expect(app.buffer('main.kcl').runCommand(command)).toBe(false)
  })

  /** Nothing on the stack, nothing recorded: an ordinary buffer, untouched. */
  it('declines with an empty undo stack', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })

    expect(app.pressUndo('main.kcl')).toBe(false)
  })

  /**
   * A buffer whose history has been forgotten cannot be reverted exactly, and the
   * keystroke must fall through rather than doing something weaker while claiming
   * to have undone the action.
   */
  it('declines once the change history for the action is gone', () => {
    const app = project({ 'main.kcl': 'width = 10\n' })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
    })
    app.changeHistory.forget('main.kcl')

    expect(app.buffer('main.kcl').runCommand(app.command('main.kcl'))).toBe(
      false
    )
  })

  /**
   * The documented limitation, pinned so it cannot change unnoticed.
   *
   * The revert has to enter the buffer's own history — keeping it out corrupts
   * the document, see `revertContribution` — so the next Ctrl-Z is an ordinary
   * buffer undo of the revert and puts the action back *in this file only*. A
   * third press resolves it. Alternating project-wide instead was rejected: it
   * would make repeated Ctrl-Z bounce between undo and redo forever.
   */
  it('hands the next keystroke back to the buffer after a revert', () => {
    const app = project({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    app.pressUndo('main.kcl')
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')

    // Buffer-local, and it says so by declining.
    expect(app.pressUndo('main.kcl')).toBe(false)
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 20\n')
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')

    // And a third press walks the rest of the way back, coherently.
    expect(app.pressUndo('main.kcl')).toBe(false)
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
  })
})

describe('the project undo capability', () => {
  /**
   * The precedence mechanism, asserted on the number that decides it.
   *
   * `historyKeymap` is inside `editor.baseline`, and lower order is earlier in
   * the resolved array — which is what CodeMirror reads as higher precedence. Get
   * this backwards and the binding silently never fires, because `undo` handles
   * the key first and returns true.
   */
  it('resolves ahead of the baseline keymap', () => {
    const capability = createProjectUndoCapability({
      history: () => null,
      relativePathFor: () => null,
    })
    const resolver = combineCapabilities([baselineCapability, capability])

    const ids = resolver.capabilities.map((each) => each.id)
    expect(ids.indexOf('editor.projectUndo')).toBeLessThan(
      ids.indexOf('editor.baseline')
    )
  })

  /** No path, nothing to look an action up by; read-only takes no edits at all. */
  it('applies only to a writable file-backed buffer', () => {
    const capability = createProjectUndoCapability({
      history: () => null,
      relativePathFor: () => null,
    })

    const context = {
      bufferId: 'b1',
      path: `${ROOT}/main.kcl`,
      languageId: 'kcl',
      fileBacked: true,
      executing: false,
      readOnly: false,
    } as const

    expect(capability.appliesTo?.(context)).toBe(true)
    expect(capability.appliesTo?.({ ...context, readOnly: true })).toBe(false)
    expect(capability.appliesTo?.({ ...context, path: null })).toBe(false)
  })
})
