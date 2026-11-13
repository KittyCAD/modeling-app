import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
} from '@kittycad/codemirror-lsp-client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  FoldingRange,
  SemanticTokens,
} from 'vscode-languageserver-protocol'

describe('LSP document update ownership', () => {
  const views: EditorView[] = []

  beforeEach(() => {
    vi.spyOn(LanguageServerClient.prototype, 'initialize').mockResolvedValue()
  })

  afterEach(() => {
    for (const view of views.splice(0)) {
      view.destroy()
      view.dom.remove()
    }
    vi.restoreAllMocks()
  })

  function createEditor(
    initialization?: Promise<void>,
    delayedFeatures = false
  ) {
    const fromServer = FromServer.create()
    if (fromServer instanceof Error) expect.fail(fromServer.message)
    const client = new LanguageServerClient({
      name: 'document-update-test',
      fromServer,
      intoServer: new IntoServer(),
      initializedCallback: () => {},
    })
    client.ready = !initialization
    if (initialization) client.initializePromise = initialization
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue(
      delayedFeatures
        ? {
            semanticTokensProvider: {
              legend: { tokenTypes: ['keyword'], tokenModifiers: [] },
            },
            foldingRangeProvider: true,
          }
        : {}
    )
    const tokens: Array<(response: SemanticTokens | null) => void> = []
    const folding: Array<(response: FoldingRange[] | null) => void> = []
    vi.spyOn(client, 'textDocumentSemanticTokensFull').mockImplementation(
      () =>
        new Promise<SemanticTokens | null>((resolve) => tokens.push(resolve))
    )
    vi.spyOn(client, 'textDocumentFoldingRange').mockImplementation(
      () =>
        new Promise<FoldingRange[] | null>((resolve) => folding.push(resolve))
    )
    const opened = vi
      .spyOn(client, 'textDocumentDidOpen')
      .mockImplementation(() => {})
    const changed = vi
      .spyOn(client, 'textDocumentDidChange')
      .mockImplementation(() => {})
    const extension = ViewPlugin.define(
      (editor) =>
        new LanguageServerPlugin(
          {
            client,
            documentUri: '/document.kcl',
            workspaceFolders: [],
            allowHTMLContent: true,
            doSemanticTokens: delayedFeatures,
            doFoldingRanges: delayedFeatures,
          },
          editor
        ),
      new LanguageServerPluginSpec()
    )
    const view = new EditorView({
      doc: 'length = 1',
      extensions: [
        docPathFacet.of('/document.kcl'),
        syntaxHighlighting(defaultHighlightStyle),
        extension,
      ],
      parent: document.body,
    })
    views.push(view)
    const plugin = view.plugin(extension)
    if (!plugin) expect.fail('The real language-server plugin must be mounted')
    const replace = (code: string) =>
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
      })
    return { view, plugin, client, opened, changed, replace, tokens, folding }
  }

  async function settleResponses() {
    await Promise.resolve()
    await Promise.resolve()
  }

  it('sends the latest same-turn editor changes on the next microtask, without a timer', async () => {
    const { replace, changed } = createEditor()
    await Promise.resolve()
    replace('length = 2')
    replace('length = 3')
    expect(changed).not.toHaveBeenCalled()

    await Promise.resolve()
    expect(changed).toHaveBeenCalledExactlyOnceWith({
      textDocument: { uri: 'file:///document.kcl', version: 0 },
      contentChanges: [{ text: 'length = 3' }],
    })
  })

  it('flushes immediately for a request without resending the queued update', async () => {
    const { replace, changed, plugin } = createEditor()
    await Promise.resolve()
    replace('length = 4')
    plugin.ensureDocSent()
    expect(changed).toHaveBeenCalledOnce()
    await Promise.resolve()
    expect(changed).toHaveBeenCalledOnce()
    expect(changed.mock.calls[0][0].contentChanges).toEqual([
      { text: 'length = 4' },
    ])
  })

  it('does not send a queued change after its editor is destroyed', async () => {
    const { replace, changed, view } = createEditor()
    await Promise.resolve()
    replace('length = 5')
    view.destroy()
    await Promise.resolve()
    expect(changed).not.toHaveBeenCalled()
  })

  it('opens the latest source after initialization rather than the old constructor snapshot', async () => {
    const initialization = Promise.withResolvers<undefined>()
    const { replace, opened, client } = createEditor(initialization.promise)
    replace('length = 6')
    await Promise.resolve()
    client.ready = true
    initialization.resolve(undefined)
    await Promise.resolve()
    expect(opened).toHaveBeenCalledExactlyOnceWith({
      textDocument: {
        uri: 'file:///document.kcl',
        languageId: '',
        text: 'length = 6',
        version: 0,
      },
    })
  })

  it('does not open an editor that was destroyed while initialization was pending', async () => {
    const initialization = Promise.withResolvers<undefined>()
    const { view, opened } = createEditor(initialization.promise)
    view.destroy()
    initialization.resolve(undefined)
    await Promise.resolve()
    expect(opened).not.toHaveBeenCalled()
  })

  it('does not let an older token reply replace highlighting from a newer source', async () => {
    const { view, replace, tokens } = createEditor(undefined, true)
    await settleResponses()
    expect(tokens).toHaveLength(1)
    replace('length = 3')
    await settleResponses()
    expect(tokens).toHaveLength(2)
    tokens[1]({ data: [0, 0, 6, 0, 0] })
    await settleResponses()
    expect(view.contentDOM.querySelector('.cm-line span')).toHaveTextContent(
      'length'
    )

    tokens[0]({ data: [0, 0, 2, 0, 0] })
    await settleResponses()
    expect(view.contentDOM.querySelector('.cm-line span')).toHaveTextContent(
      'length'
    )
  })

  it('does not let an older folding reply replace the current source ranges', async () => {
    const { plugin, replace, folding } = createEditor(undefined, true)
    await settleResponses()
    expect(folding).toHaveLength(1)
    replace('length = 3\nwidth = 4\nheight = 5')
    await settleResponses()
    expect(folding).toHaveLength(2)
    folding[1]([{ startLine: 0, endLine: 2 }])
    await settleResponses()
    expect(plugin.foldingRange(0, 0)).toEqual({ from: 0, to: 2 })

    folding[0]([{ startLine: 0, endLine: 1 }])
    await settleResponses()
    expect(plugin.foldingRange(0, 0)).toEqual({ from: 0, to: 2 })
  })

  it('does not publish token replies after its editor is destroyed', async () => {
    const { view, tokens } = createEditor(undefined, true)
    await settleResponses()
    expect(tokens).toHaveLength(1)
    view.destroy()
    const dispatch = vi.spyOn(view, 'dispatch')
    tokens[0]({ data: [0, 0, 2, 0, 0] })
    await settleResponses()
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('does not publish folding replies after its editor is destroyed', async () => {
    const { view, plugin, folding } = createEditor(undefined, true)
    await settleResponses()
    expect(folding).toHaveLength(1)
    view.destroy()
    folding[0]([{ startLine: 0, endLine: 1 }])
    await settleResponses()
    expect(plugin.foldingRange(0, 0)).toBeNull()
  })
})
