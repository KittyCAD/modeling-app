import { isolateHistory } from '@codemirror/commands'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type FileBackedTextBuffer,
  combineCapabilities,
} from '@src/contracts/buffers'
import { baselineCapability } from '@src/features/editorCapabilities/baseline'
import { createProjectUndoCapability } from '@src/features/editorCapabilities/projectUndo'
import { createProjectActionHistory } from '@src/features/projectHistory/createProjectActionHistory'
import { bufferOrigin } from '@src/lib/buffers/annotations'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { createChangeHistory } from '@src/lib/collab/changeHistory'

/**
 * The keystroke, through a mounted editor.
 *
 * The unit tests run the command directly, which proves what it decides but not
 * that it is ever *asked*. Precedence is the risk this file covers: `undo` is
 * bound to the same chord inside `historyKeymap`, it returns true whenever there
 * is anything at all to undo, and if the baseline keymap were consulted first
 * this binding would silently never fire — with every unit test still green.
 */

const ROOT = '/projects/bracket'

const textOf = (buffer: FileBackedTextBuffer) =>
  buffer.state.peek().doc.toString()

const teardown: (() => void)[] = []
afterEach(() => {
  while (teardown.length > 0) teardown.pop()?.()
})

function mountedProject(files: Record<string, string>) {
  const changeHistory = createChangeHistory()
  const buffers = new Map<string, FileBackedTextBuffer>()
  let history: ReturnType<typeof createProjectActionHistory>

  const capabilities = combineCapabilities([
    baselineCapability,
    createProjectUndoCapability({
      history: () => history,
      relativePathFor: (absolute) =>
        absolute.startsWith(`${ROOT}/`)
          ? absolute.slice(ROOT.length + 1)
          : null,
    }),
  ])

  for (const [path, contents] of Object.entries(files)) {
    const buffer = createFileBackedTextBuffer({
      path: `${ROOT}/${path}`,
      contents,
      languageId: 'kcl',
      capabilities,
    })
    buffers.set(path, buffer)
    changeHistory.follow(path, buffer)
  }

  history = createProjectActionHistory({
    changeHistory,
    bufferForPath: (path) => buffers.get(path),
  })

  const buffer = (path: string) => {
    const found = buffers.get(path)
    if (found === undefined) throw new Error(`${path} is not open.`)
    return found
  }

  /** Mount into a real element, which is what installs the keymap handlers. */
  const mount = (path: string) => {
    const host = document.createElement('div')
    document.body.append(host)
    const detach = buffer(path).attachView(host)
    teardown.push(() => {
      detach()
      host.remove()
    })
    return host
  }

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
    history.record({
      id,
      label,
      at: 0,
      author: null,
      paths: Object.keys(edits),
    })
  }

  return { buffer, mount, act, projectHistory: () => history }
}

/**
 * A Ctrl/Cmd-Z on the editor's content element, as a user's would arrive.
 *
 * One modifier, not both: CodeMirror names the chord from every modifier that is
 * down, so `ctrlKey` *and* `metaKey` together read as `Ctrl-Meta-z` and match
 * nothing. Which one `Mod-` means depends on the platform CodeMirror detected, so
 * both are tried and the helper reports whether either was handled.
 */
const pressUndo = (host: HTMLElement): boolean => {
  const content = host.querySelector('.cm-content')
  expect(content).not.toBeNull()

  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    const event = new KeyboardEvent('keydown', {
      key: 'z',
      code: 'KeyZ',
      keyCode: 90,
      [modifier]: true,
      bubbles: true,
      cancelable: true,
    })
    content?.dispatchEvent(event)
    if (event.defaultPrevented) return true
  }
  return false
}

describe('Ctrl-Z in a mounted editor', () => {
  it('reaches the project binding before the baseline undo', () => {
    const app = mountedProject({
      'main.kcl': 'width = 10\n',
      'bracket.kcl': 'depth = 2\n',
    })
    const host = app.mount('main.kcl')

    app.act('op-1', 'Extruded profile001', {
      'main.kcl': { from: 8, to: 10, insert: '20' },
      'bracket.kcl': { from: 8, to: 9, insert: '4' },
    })

    pressUndo(host)

    // The other file is the proof: a plain buffer undo could not have touched it.
    expect(textOf(app.buffer('bracket.kcl'))).toBe('depth = 2\n')
    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
    expect(app.projectHistory().entries.value).toEqual([])
  })

  it('still undoes the user’s own typing normally', () => {
    const app = mountedProject({ 'main.kcl': 'width = 10\n' })
    const host = app.mount('main.kcl')

    app
      .buffer('main.kcl')
      .dispatch({ changes: { from: 0, insert: '// mine\n' } })

    pressUndo(host)

    expect(textOf(app.buffer('main.kcl'))).toBe('width = 10\n')
  })
})
