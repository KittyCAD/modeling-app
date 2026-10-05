import { Transaction } from '@codemirror/state'
import { EditorView, ViewPlugin } from '@codemirror/view'
import {
  FromServer,
  IntoServer,
  LanguageServerClient,
  LanguageServerPlugin,
  LanguageServerPluginSpec,
  docPathFacet,
} from '@kittycad/codemirror-lsp-client'
import type { MockInstance } from 'vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SignatureHelp } from 'vscode-languageserver-protocol'

const signature: SignatureHelp = {
  signatures: [
    {
      label: 'translate(objects, x)',
      documentation: 'Move a solid, a sketch, or a helix.',
    },
  ],
}

describe('LSP signature help', () => {
  let view: EditorView
  let plugin: LanguageServerPlugin
  let request: MockInstance<LanguageServerClient['textDocumentSignatureHelp']>

  const tooltip = () => document.querySelector('.cm-signature-tooltip')

  beforeEach(() => {
    // Exercise the editor extension with an in-memory language server.
    vi.spyOn(LanguageServerClient.prototype, 'initialize').mockResolvedValue()
    const fromServer = FromServer.create()
    if (fromServer instanceof Error) throw fromServer
    const client = new LanguageServerClient({
      name: 'signature-help-test',
      fromServer,
      intoServer: new IntoServer(),
      initializedCallback: () => {},
    })
    client.ready = true
    vi.spyOn(client, 'getServerCapabilities').mockReturnValue({
      signatureHelpProvider: { triggerCharacters: ['(', ','] },
    })
    vi.spyOn(client, 'textDocumentDidOpen').mockImplementation(() => {})
    vi.spyOn(client, 'textDocumentDidChange').mockImplementation(() => {})
    request = vi
      .spyOn(client, 'textDocumentSignatureHelp')
      .mockResolvedValue(signature)

    const extension = ViewPlugin.define(
      (editor) =>
        new LanguageServerPlugin(
          {
            client,
            documentUri: '/test.kcl',
            workspaceFolders: [],
            allowHTMLContent: true,
          },
          editor
        ),
      new LanguageServerPluginSpec()
    )
    view = new EditorView({
      doc: 'translate',
      selection: { anchor: 9 },
      extensions: [docPathFacet.of('/test.kcl'), extension],
      parent: document.body,
    })
    const value = view.plugin(extension)
    if (!value) throw new Error('Language server plugin was not created')
    plugin = value
    view.focus()
  })

  afterEach(() => {
    plugin.ensureDocSent()
    view.destroy()
    view.dom.remove()
    vi.restoreAllMocks()
  })

  it('does not request signature help when pasting or repasting a program', async () => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  a = line(start = [0, 0], end = [4, 0])
  b = line(start = [4, 0], end = [4, 3])
  c = line(start = [4, 3], end = [0, 0])
}

profile001 = region(segments = [sketch001.a, sketch001.b])

extrude(profile001, length = 6)
  |> translate(x = 10)`
    for (let paste = 0; paste < 2; paste++) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: code },
        selection: { anchor: code.length },
        annotations: Transaction.userEvent.of('input.paste'),
      })

      await Promise.resolve()
      expect(request).not.toHaveBeenCalled()
      expect(tooltip()).toBeNull()
    }
  })

  it('still opens signature help when typing a trigger character', async () => {
    view.dispatch({
      changes: { from: 9, insert: '(' },
      selection: { anchor: 10 },
      annotations: Transaction.userEvent.of('input.type'),
    })

    await vi.waitFor(() => {
      expect(tooltip()?.textContent).toContain('Move a solid')
    })
    expect(request).toHaveBeenCalledOnce()
  })

  it('closes help when a body selection selects and scrolls to code', async () => {
    await plugin.showSignatureHelpTooltip(view, 9)
    expect(tooltip()).not.toBeNull()

    view.dispatch({
      selection: { anchor: 0 },
      effects: EditorView.scrollIntoView(0, { y: 'center' }),
    })

    expect(tooltip()).toBeNull()
  })

  it('closes help when focus leaves the editor', async () => {
    await plugin.showSignatureHelpTooltip(view, 9)
    expect(tooltip()).not.toBeNull()

    view.contentDOM.blur()

    expect(tooltip()).toBeNull()
  })

  it.each(['keydown', 'mousedown'])(
    'still closes help on editor %s',
    async (event) => {
      await plugin.showSignatureHelpTooltip(view, 9)
      expect(tooltip()).not.toBeNull()

      if (event === 'keydown') {
        view.contentDOM.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
        )
      } else {
        view.dom.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      }

      expect(tooltip()).toBeNull()
    }
  )

  it('still closes help after ten seconds', async () => {
    vi.useFakeTimers()
    try {
      await plugin.showSignatureHelpTooltip(view, 9)
      expect(tooltip()).not.toBeNull()

      vi.advanceTimersByTime(9999)
      expect(tooltip()).not.toBeNull()

      vi.advanceTimersByTime(1)
      expect(tooltip()).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('cleans up help when the editor is destroyed', async () => {
    await plugin.showSignatureHelpTooltip(view, 9)
    expect(tooltip()).not.toBeNull()

    view.destroy()

    expect(tooltip()).toBeNull()
  })
})
