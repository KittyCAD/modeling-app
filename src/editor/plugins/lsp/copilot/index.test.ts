import {
  type CompletionContext,
  autocompletion,
  completionStatus,
  startCompletion,
} from '@codemirror/autocomplete'
import { EditorState, type Extension, Transaction } from '@codemirror/state'
import { EditorView } from 'codemirror'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type LanguageServerClient,
  docPathFacet,
  languageId,
} from '@kittycad/codemirror-lsp-client'
import type { KclManager } from '@src/lang/KclManager'

import { copilotPlugin } from './index'

function createClient({
  text,
  displayText = text,
  character,
  uuid,
}: {
  text: string
  displayText?: string
  character: number
  uuid: string
}): LanguageServerClient {
  return {
    ready: true,
    requestCustom: vi.fn(async () => ({
      completions: [
        {
          text,
          displayText,
          range: { start: { line: 0, character } },
          position: { line: 0, character },
          uuid,
        },
      ],
    })),
    notifyCustom: vi.fn(),
  } as unknown as LanguageServerClient
}

function createCopilotView({
  doc,
  selection,
  client,
  extensions = [],
}: {
  doc: string
  selection: number
  client: LanguageServerClient
  extensions?: Extension[]
}): EditorView {
  const kclManager = { copilotEnabled: true } as KclManager
  const parent = document.body.appendChild(document.createElement('div'))

  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor: selection },
      extensions: [
        docPathFacet.of('/test.kcl'),
        languageId.of('kcl'),
        ...extensions,
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
}

function dispatchInput(view: EditorView, from: number, insert: string) {
  view.dispatch({
    changes: { from, insert },
    selection: { anchor: from + insert.length },
    annotations: Transaction.userEvent.of('input.type'),
  })
}

function dispatchKeydown(view: EditorView, key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
  })
  view.contentDOM.dispatchEvent(event)
  return event
}

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

    const client = createClient({
      text: '=)',
      character: 6,
      uuid: 'ghost-equals',
    })
    const explicitCompletionSource = (context: CompletionContext) => {
      if (!context.explicit) return null
      const word = context.matchBefore(/\w*/)
      return {
        from: word?.from ?? context.pos,
        options: [{ label: 'length' }],
      }
    }

    view = createCopilotView({
      doc: 'lengt',
      selection: 5,
      client,
      extensions: [
        autocompletion({
          override: [explicitCompletionSource],
        }),
      ],
    })
    view.focus()

    dispatchInput(view, 5, 'h')
    await vi.advanceTimersByTimeAsync(600)

    expect(view.state.doc.toString()).toBe('length=)')
    expect(view.state.selection.main.head).toBe(6)

    expect(startCompletion(view)).toBe(true)
    expect(completionStatus(view.state)).not.toBeNull()

    const event = dispatchKeydown(view, '=')

    expect(event.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('length')
    expect(view.state.selection.main.head).toBe(6)

    dispatchInput(view, 6, '=')

    expect(view.state.doc.toString()).toBe('length=')
    expect(view.state.selection.main.head).toBe(7)
  })

  it('rejects punctuation-leading ghost text instead of typing through it', async () => {
    vi.useFakeTimers()

    const client = createClient({
      text: ' =)',
      character: 3,
      uuid: 'ghost-assignment',
    })

    view = createCopilotView({
      doc: 'fo',
      selection: 2,
      client,
    })
    view.focus()

    dispatchInput(view, 2, 'o')
    await vi.advanceTimersByTimeAsync(600)

    expect(view.state.doc.toString()).toBe('foo =)')
    expect(view.state.selection.main.head).toBe(3)

    const spaceEvent = dispatchKeydown(view, ' ')

    expect(spaceEvent.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('foo')
    expect(view.state.selection.main.head).toBe(3)

    dispatchInput(view, 3, ' ')
    dispatchInput(view, 4, '=')

    expect(view.state.doc.toString()).toBe('foo =')
    expect(view.state.selection.main.head).toBe(5)
  })

  it('keeps type-through behavior for word-leading ghost text', async () => {
    vi.useFakeTimers()

    const client = createClient({
      text: 'bar',
      character: 3,
      uuid: 'ghost-word',
    })

    view = createCopilotView({
      doc: 'fo',
      selection: 2,
      client,
    })
    view.focus()

    dispatchInput(view, 2, 'o')
    await vi.advanceTimersByTimeAsync(600)

    expect(view.state.doc.toString()).toBe('foobar')
    expect(view.state.selection.main.head).toBe(3)

    const event = dispatchKeydown(view, 'b')

    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe('foobar')
    expect(view.state.selection.main.head).toBe(4)
  })
})
