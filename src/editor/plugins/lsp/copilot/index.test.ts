import {
  type CompletionContext,
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState, Transaction } from '@codemirror/state'
import { EditorView } from 'codemirror'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type LanguageServerClient,
  docPathFacet,
  languageId,
} from '@kittycad/codemirror-lsp-client'
import type { KclManager } from '@src/lang/KclManager'

import { copilotPlugin } from './index'

describe('copilotPlugin', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('rejects ghost text before ordinary keys when CodeMirror autocomplete is active', async () => {
    vi.useFakeTimers()

    const client = {
      ready: true,
      requestCustom: vi.fn(async () => ({
        completions: [
          {
            text: '=)',
            displayText: '=)',
            range: { start: { line: 0, character: 6 } },
            position: { line: 0, character: 6 },
            uuid: 'ghost-equals',
          },
        ],
      })),
      notifyCustom: vi.fn(),
    } as unknown as LanguageServerClient

    const kclManager = { copilotEnabled: true } as KclManager
    const parent = document.body.appendChild(document.createElement('div'))
    const explicitCompletionSource = (context: CompletionContext) => {
      if (!context.explicit) return null
      const word = context.matchBefore(/\w*/)
      return {
        from: word?.from ?? context.pos,
        options: [{ label: 'length' }],
      }
    }

    view = new EditorView({
      state: EditorState.create({
        doc: 'lengt',
        selection: { anchor: 5 },
        extensions: [
          docPathFacet.of('/test.kcl'),
          languageId.of('kcl'),
          autocompletion({
            override: [explicitCompletionSource],
          }),
          copilotPlugin(
            {
              client,
              documentUri: 'file:///test.kcl',
              workspaceFolders: [],
              allowHTMLContent: true,
            },
            kclManager
          ),
        ],
      }),
      parent,
    })
    view.focus()

    view.dispatch({
      changes: { from: 5, insert: 'h' },
      selection: { anchor: 6 },
      annotations: Transaction.userEvent.of('input.type'),
    })
    await vi.advanceTimersByTimeAsync(600)

    expect(view.state.doc.toString()).toBe('length=)')
    expect(view.state.selection.main.head).toBe(6)

    expect(startCompletion(view)).toBe(true)
    expect(completionStatus(view.state)).not.toBeNull()

    const event = new KeyboardEvent('keydown', {
      key: '=',
      bubbles: true,
      cancelable: true,
    })
    view.contentDOM.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('length')
    expect(view.state.selection.main.head).toBe(6)

    view.dispatch({
      changes: { from: 6, insert: '=' },
      selection: { anchor: 7 },
      annotations: Transaction.userEvent.of('input.type'),
    })

    expect(view.state.doc.toString()).toBe('length=')
    expect(view.state.selection.main.head).toBe(7)
  })

  it('rejects punctuation-leading ghost text instead of typing through it', async () => {
    vi.useFakeTimers()

    const client = {
      ready: true,
      requestCustom: vi.fn(async () => ({
        completions: [
          {
            text: ' =)',
            displayText: ' =)',
            range: { start: { line: 0, character: 3 } },
            position: { line: 0, character: 3 },
            uuid: 'ghost-assignment',
          },
        ],
      })),
      notifyCustom: vi.fn(),
    } as unknown as LanguageServerClient

    const kclManager = { copilotEnabled: true } as KclManager
    const parent = document.body.appendChild(document.createElement('div'))

    view = new EditorView({
      state: EditorState.create({
        doc: 'fo',
        selection: { anchor: 2 },
        extensions: [
          docPathFacet.of('/test.kcl'),
          languageId.of('kcl'),
          copilotPlugin(
            {
              client,
              documentUri: 'file:///test.kcl',
              workspaceFolders: [],
              allowHTMLContent: true,
            },
            kclManager
          ),
        ],
      }),
      parent,
    })
    view.focus()

    view.dispatch({
      changes: { from: 2, insert: 'o' },
      selection: { anchor: 3 },
      annotations: Transaction.userEvent.of('input.type'),
    })
    await vi.advanceTimersByTimeAsync(600)

    expect(view.state.doc.toString()).toBe('foo =)')
    expect(view.state.selection.main.head).toBe(3)

    const spaceEvent = new KeyboardEvent('keydown', {
      key: ' ',
      bubbles: true,
      cancelable: true,
    })
    view.contentDOM.dispatchEvent(spaceEvent)

    expect(spaceEvent.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('foo')
    expect(view.state.selection.main.head).toBe(3)

    view.dispatch({
      changes: { from: 3, insert: ' ' },
      selection: { anchor: 4 },
      annotations: Transaction.userEvent.of('input.type'),
    })
    view.dispatch({
      changes: { from: 4, insert: '=' },
      selection: { anchor: 5 },
      annotations: Transaction.userEvent.of('input.type'),
    })

    expect(view.state.doc.toString()).toBe('foo =')
    expect(view.state.selection.main.head).toBe(5)
  })
})
