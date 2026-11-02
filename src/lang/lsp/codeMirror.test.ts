import { EditorView } from '@codemirror/view'
import {
  FromServer,
  IntoServer,
  LanguageServerClient,
} from '@kittycad/codemirror-lsp-client'
import { signal, type Signal } from '@preact/signals-core'
import { createProjectLspExtension } from '@src/lang/lsp/codeMirror'
import { afterEach, expect, it, vi } from 'vitest'

const views: EditorView[] = []
afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
  vi.restoreAllMocks()
})

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

function createClient(initialized = Promise.resolve()) {
  vi.spyOn(LanguageServerClient.prototype, 'initialize').mockReturnValueOnce(
    initialized
  )
  const fromServer = FromServer.create()
  if (fromServer instanceof Error) throw fromServer
  const client = new LanguageServerClient({
    name: 'test',
    fromServer,
    intoServer: new IntoServer(),
    initializedCallback: () => {},
  })
  client.ready = true
  const open = vi
    .spyOn(client, 'textDocumentDidOpen')
    .mockImplementation(() => {})
  const close = vi
    .spyOn(client, 'textDocumentDidClose')
    .mockImplementation(() => {})
  const change = vi
    .spyOn(client, 'textDocumentDidChange')
    .mockImplementation(() => {})
  return { client, open, close, change }
}

function createView(
  client: Signal<LanguageServerClient | null>,
  uri: string,
  doc = 'buffer'
) {
  const view = new EditorView({
    doc,
    extensions: createProjectLspExtension({
      client,
      documentUri: uri,
      start: () => {},
    }),
  })
  views.push(view)
  return view
}

it('opens each editor once with its buffer and closes only its own document', async () => {
  const { client, open, close } = createClient()
  const current = signal<LanguageServerClient | null>(client)
  const first = createView(current, 'file:///project/first.kcl', 'first buffer')
  createView(current, 'file:///project/nested/second.kcl', 'second buffer')
  await flush()
  expect(open).toHaveBeenCalledTimes(2)
  expect(open).toHaveBeenCalledWith({
    textDocument: {
      uri: 'file:///project/first.kcl',
      text: 'first buffer',
      languageId: 'kcl',
      version: 0,
    },
  })
  first.destroy()
  views.splice(views.indexOf(first), 1)
  expect(close).toHaveBeenCalledExactlyOnceWith({
    textDocument: { uri: 'file:///project/first.kcl' },
  })
  expect(client.plugins).toHaveLength(1)
})

it('does not reopen a destroyed editor after initialization finishes', async () => {
  let finish = () => {}
  const initialized = new Promise<void>((resolve) => {
    finish = resolve
  })
  const { client, open, close } = createClient(initialized)
  const view = createView(signal(client), 'file:///project/main.kcl')
  await flush()
  view.destroy()
  views.splice(views.indexOf(view), 1)
  finish()
  await flush()
  expect(open).not.toHaveBeenCalled()
  expect(close).not.toHaveBeenCalled()
  expect(client.plugins).toHaveLength(0)
})

it('opens the latest buffer after initialization and cancels changes on close', async () => {
  vi.useFakeTimers()
  let finish = () => {}
  const initialized = new Promise<void>((resolve) => {
    finish = resolve
  })
  const { client, open, change } = createClient(initialized)
  const view = createView(signal(client), 'file:///project/main.kcl')
  try {
    await flush()
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'latest buffer' },
    })
    finish()
    await flush()
    expect(open).toHaveBeenCalledExactlyOnceWith({
      textDocument: {
        uri: 'file:///project/main.kcl',
        text: 'latest buffer',
        languageId: 'kcl',
        version: 0,
      },
    })
    view.destroy()
    views.splice(views.indexOf(view), 1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(change).not.toHaveBeenCalled()
  } finally {
    vi.useRealTimers()
  }
})

it('rebinds surviving views after restart and ignores a queued binding for a closed view', async () => {
  const first = createClient()
  const current = signal<LanguageServerClient | null>(first.client)
  const view = createView(current, 'file:///project/main.kcl')
  await flush()
  const second = createClient()
  current.value = second.client
  await flush()
  expect(first.close).toHaveBeenCalledTimes(1)
  expect(second.open).toHaveBeenCalledTimes(1)
  const third = createClient()
  current.value = third.client
  view.destroy()
  views.splice(views.indexOf(view), 1)
  await flush()
  expect(second.close).toHaveBeenCalledTimes(1)
  expect(third.open).not.toHaveBeenCalled()
})
