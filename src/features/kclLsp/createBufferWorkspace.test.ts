import type { LSPClient } from '@codemirror/lsp-client'
import type { EditorView } from '@codemirror/view'
import { signal } from '@preact/signals'
import { describe, expect, it } from 'vitest'
import { combineCapabilities } from '@src/contracts/buffers'
import type { FileBackedTextBuffer } from '@src/contracts/buffers'
import type { ProjectSession } from '@src/contracts/projectSession'
import { createFileBackedTextBuffer } from '@src/lib/buffers/createFileBackedTextBuffer'
import { BufferWorkspace } from '@src/features/kclLsp/createBufferWorkspace'

const buffer = (path: string | null, languageId = 'kcl', contents = 'x = 1') =>
  createFileBackedTextBuffer({
    path,
    contents,
    languageId,
    capabilities: combineCapabilities([]),
  })

function setup(initial: FileBackedTextBuffer[] = []) {
  const buffers = signal<readonly FileBackedTextBuffer[]>(initial)
  const active: string[] = []

  const session = {
    buffers,
    setActiveBuffer: (id: string | null) => {
      if (id) active.push(id)
    },
  } as unknown as ProjectSession

  const opened: string[] = []
  const closed: string[] = []
  const client = {
    didOpen: (file: { uri: string }) => opened.push(file.uri),
    didClose: (uri: string) => closed.push(uri),
  } as unknown as LSPClient

  const workspace = new BufferWorkspace(client, () => session)

  return { workspace, buffers, opened, closed, active }
}

/** A view only has to be distinguishable; the workspace never calls into it. */
const fakeView = () => ({}) as EditorView

describe('the buffer workspace', () => {
  it('takes its files from the session, view or no view', () => {
    const { workspace, opened } = setup([buffer('/p/main.kcl')])

    workspace.syncFiles()

    expect(workspace.files.map((file) => file.uri)).toEqual([
      'file:///p/main.kcl',
    ])
    expect(opened).toEqual(['file:///p/main.kcl'])
    // No view, and that is a normal state rather than a missing one.
    expect(workspace.files[0].getView()).toBeNull()
  })

  it('leaves alone what the server does not serve', () => {
    const { workspace } = setup([
      buffer('/p/readme.md', 'markdown'),
      // A scratch buffer has no path, so there is no URI to address it by.
      buffer(null),
    ])

    workspace.syncFiles()
    expect(workspace.files).toEqual([])
  })

  it('reports the changes that happened, composed', () => {
    const source = buffer('/p/main.kcl')
    const { workspace } = setup([source])
    workspace.syncFiles()

    const before = workspace.files[0].doc
    source.dispatch({ changes: { from: 0, insert: '// one\n' } })
    source.dispatch({ changes: { from: 0, insert: '// two\n' } })

    const updates = workspace.syncFiles()

    expect(updates).toHaveLength(1)
    expect(updates[0].prevDoc).toBe(before)
    expect(updates[0].file.doc.toString()).toBe('// two\n// one\nx = 1')
    // Composed, so applying it to the old document produces the new one — which
    // is what lets the client map a stale position forward.
    expect(updates[0].changes.apply(before).toString()).toBe(
      '// two\n// one\nx = 1'
    )
    expect(updates[0].file.version).toBe(source.version.peek())
  })

  it('reports nothing when nothing moved', () => {
    const source = buffer('/p/main.kcl')
    const { workspace } = setup([source])
    workspace.syncFiles()

    expect(workspace.syncFiles()).toEqual([])
  })

  /**
   * The whole reason for a custom workspace. The default one closes a file when
   * its editor goes away; here the document outlives the view, and an import
   * still resolves to it.
   */
  it('keeps a file open when its view goes away', () => {
    const source = buffer('/p/main.kcl')
    const { workspace, closed } = setup([source])
    workspace.syncFiles()

    const view = fakeView()
    workspace.openFile('file:///p/main.kcl', 'kcl', view)
    expect(workspace.files[0].getView()).toBe(view)

    workspace.closeFile('file:///p/main.kcl', view)

    expect(workspace.files).toHaveLength(1)
    expect(workspace.files[0].getView()).toBeNull()
    expect(closed).toEqual([])
  })

  it('closes a file when the buffer is gone', () => {
    const source = buffer('/p/main.kcl')
    const { workspace, buffers, closed } = setup([source])
    workspace.syncFiles()

    buffers.value = []
    workspace.syncFiles()

    expect(workspace.files).toEqual([])
    expect(closed).toEqual(['file:///p/main.kcl'])
  })

  it('reopens when a different buffer takes the same path', () => {
    const first = buffer('/p/main.kcl')
    const { workspace, buffers, opened, closed } = setup([first])
    workspace.syncFiles()

    buffers.value = [buffer('/p/main.kcl')]
    workspace.syncFiles()

    expect(closed).toEqual(['file:///p/main.kcl'])
    expect(opened).toEqual(['file:///p/main.kcl', 'file:///p/main.kcl'])
  })

  /**
   * A server-initiated edit — a rename, a format — goes through the buffer, so it
   * lands in a file with no pane open and lands in its undo history.
   */
  it('applies a server edit through the buffer', () => {
    const source = buffer('/p/main.kcl')
    const { workspace } = setup([source])
    workspace.syncFiles()

    workspace.updateFile('file:///p/main.kcl', {
      changes: { from: 0, insert: 'renamed\n' },
    })

    expect(source.text.peek()).toBe('renamed\nx = 1')
  })

  it('ignores a server edit for a file it does not have', () => {
    const { workspace } = setup([])
    expect(() =>
      workspace.updateFile('file:///p/gone.kcl', { changes: [] })
    ).not.toThrow()
  })

  it('brings an open file forward, and admits when it cannot', async () => {
    const source = buffer('/p/main.kcl')
    const { workspace, active } = setup([source])
    workspace.syncFiles()

    await workspace.displayFile('file:///p/main.kcl')
    expect(active).toEqual([source.id])

    await expect(
      workspace.displayFile('file:///p/other.kcl')
    ).resolves.toBeNull()
  })

  it('stops watching what it lets go of', () => {
    const source = buffer('/p/main.kcl')
    const { workspace } = setup([source])
    workspace.syncFiles()

    workspace.dispose()
    source.dispatch({ changes: { from: 0, insert: 'after\n' } })

    expect(workspace.files).toEqual([])
  })
})
