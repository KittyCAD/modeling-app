import type { EditorView } from '@codemirror/view'
import type { FileEntry } from '@src/lib/project'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Every `LanguageServerClient` the service builds, so a test can drive the
 * initialized callback and inspect the notifications it was sent.
 */
const clients: FakeLanguageServerClient[] = []

class FakeLanguageServerClient {
  initializedCallback: () => void
  textDocumentDidOpen = vi.fn()
  textDocumentDidClose = vi.fn()
  workspaceDidChangeWorkspaceFolders = vi.fn()
  close = vi.fn()

  constructor(options: { initializedCallback: () => void }) {
    this.initializedCallback = options.initializedCallback
    clients.push(this)
  }
}

vi.mock('@kittycad/codemirror-lsp-client', () => ({
  FromServer: { create: () => ({ add: vi.fn() }) },
  IntoServer: class {},
  LanguageServerClient: FakeLanguageServerClient,
  LspWorkerEventType: { Init: 'init' },
}))

vi.mock('@src/lang/lsp/worker.ts?worker', () => ({
  default: class {
    onmessage: ((event: MessageEvent) => void) | null = null
    postMessage = vi.fn()
    terminate = vi.fn()
  },
}))

vi.mock('@src/lang/wasmUtils', () => ({ wasmUrl: () => 'wasm://test' }))
vi.mock('@src/lib/withBaseURL', () => ({
  withAPIBaseURL: () => 'https://test',
}))

/** Disposers handed back by each `attachKclLspToCodeMirror` call, in order. */
const disposers: ReturnType<typeof vi.fn>[] = []
const attachKclLspToCodeMirror = vi.fn((_editor: unknown, _client: unknown) => {
  const dispose = vi.fn()
  disposers.push(dispose)
  return dispose
})

vi.mock('@src/lang/lsp/codeMirror', () => ({
  attachKclLspToCodeMirror: (editor: unknown, client: unknown) =>
    attachKclLspToCodeMirror(editor, client),
  getKclLspDocumentPath: (editor: { path: string }) => editor.path,
}))

const { createLspService } = await import('@src/lang/lsp/service')

function fakeEditor(path: string, code: string) {
  const editor = {
    path,
    code,
    clearGlobalHistory: vi.fn(),
    editorView: undefined as unknown as EditorView,
  }
  editor.editorView = {
    get state() {
      return { doc: { toString: () => editor.code } }
    },
  } as unknown as EditorView
  return editor
}

function fakeAuth() {
  return {
    actor: {
      subscribe: () => ({ unsubscribe: vi.fn() }),
      getSnapshot: () => ({ context: { token: 'a-token' } }),
    },
  } as never
}

function fileEntry(path: string): FileEntry {
  return { path, name: path.replace(/^.*\//, ''), children: null }
}

/**
 * Boots a service with a ready language server runtime attached to `editor`,
 * mirroring what the app does on startup.
 */
function bootService(editor: ReturnType<typeof fakeEditor>) {
  const { service, dispose } = createLspService({ getAuth: fakeAuth })
  service.attachKclManager(editor)
  // The runtime only attaches to CodeMirror once the worker reports ready.
  clients[clients.length - 1].initializedCallback()
  return { service, dispose }
}

describe('createLspService', () => {
  beforeEach(() => {
    clients.length = 0
    disposers.length = 0
    attachKclLspToCodeMirror.mockClear()
    // `canStartWorkerRuntime` gates on this existing.
    if (typeof globalThis.Worker === 'undefined') {
      // @ts-expect-error -- stubbing the runtime check for the mocked worker
      globalThis.Worker = class {}
    }
  })

  it('does not rebuild the CodeMirror attachment when the same project is re-opened', () => {
    const editor = fakeEditor('/p/a.kcl', 'x = 1')
    const { service } = bootService(editor)
    expect(attachKclLspToCodeMirror).toHaveBeenCalledTimes(1)

    const project = { name: 'p', path: '/p' }
    service.onProjectOpen(project, fileEntry('/p/a.kcl'))
    service.onProjectOpen(project, fileEntry('/p/a.kcl'))

    // Tearing the attachment down and rebuilding it drops every decoration the
    // language server owns — semantic-token highlighting, folding ranges, color
    // pickers — which reads as the editor flashing unhighlighted for a round
    // trip. Re-opening the project already open must not pay that cost.
    expect(attachKclLspToCodeMirror).toHaveBeenCalledTimes(1)
    expect(disposers[0]).not.toHaveBeenCalled()
  })

  it('rebuilds the CodeMirror attachment when the open file changes', () => {
    const editor = fakeEditor('/p/a.kcl', 'x = 1')
    const { service } = bootService(editor)

    const project = { name: 'p', path: '/p' }
    editor.path = '/p/b.kcl'
    service.onProjectOpen(project, fileEntry('/p/b.kcl'))

    expect(attachKclLspToCodeMirror).toHaveBeenCalledTimes(2)
    expect(disposers[0]).toHaveBeenCalledTimes(1)
  })

  it('rebuilds the CodeMirror attachment when the editor is replaced at the same path', () => {
    const editor = fakeEditor('/p/a.kcl', 'x = 1')
    const { service } = bootService(editor)

    // Same document path, different editor: the live attachment is wired to the
    // outgoing editor's view, so reusing it would leave the incoming editor
    // without any language server integration at all.
    const replacement = fakeEditor('/p/a.kcl', 'x = 1')
    service.attachKclManager(replacement)
    service.onProjectOpen({ name: 'p', path: '/p' }, fileEntry('/p/a.kcl'))

    expect(attachKclLspToCodeMirror).toHaveBeenCalledTimes(2)
    expect(attachKclLspToCodeMirror.mock.calls[1][0]).toBe(replacement)
    expect(disposers[0]).toHaveBeenCalledTimes(1)
  })

  it('announces the open document with the text the editor holds', () => {
    const editor = fakeEditor('/p/a.kcl', 'x = 1')
    const { service } = bootService(editor)
    const client = clients[clients.length - 1]
    client.textDocumentDidOpen.mockClear()

    service.onProjectOpen({ name: 'p', path: '/p' }, fileEntry('/p/a.kcl'))

    // `didOpen` is a full-text sync: announcing the editor's own document as
    // empty wipes the server's copy of it, so diagnostics and semantic tokens
    // come back describing an empty file.
    expect(client.textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({ text: 'x = 1' }),
    })
  })

  it('announces an unknown document as empty', () => {
    const editor = fakeEditor('/p/a.kcl', 'x = 1')
    const { service } = bootService(editor)
    const client = clients[clients.length - 1]
    client.textDocumentDidOpen.mockClear()

    service.onFileOpen('/p/other.kcl', '/p')

    expect(client.textDocumentDidOpen).toHaveBeenCalledWith({
      textDocument: expect.objectContaining({ text: '' }),
    })
  })
})
