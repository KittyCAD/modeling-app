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

import { copilotPlugin } from '@src/editor/plugins/lsp/copilot'

const copilotRequestDelayMs = 600

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
  // Copilot returns text for acceptance, but the plugin immediately inserts
  // displayText into the document and decorates it as ghost text.
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
  // These tests dispatch keydown and input separately because JSDOM does not
  // synthesize browser text input after a non-prevented keydown.
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

async function waitForCopilotSuggestion() {
  await vi.advanceTimersByTimeAsync(copilotRequestDelayMs)
}

describe('copilotPlugin', () => {
  let view: EditorView | null = null

  afterEach(() => {
    view?.destroy()
    view = null
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  // Regression coverage for https://github.com/KittyCAD/modeling-app/issues/12133,
  // where Copilot ghost text swallowed ` = ` while editing function arguments.
  it('rejects ghost text before ordinary keys when CodeMirror autocomplete is active', async () => {
    vi.useFakeTimers()

    const typedText = 'length'
    const client = createClient({
      text: '=)',
      character: typedText.length,
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
      doc: '',
      selection: 0,
      client,
      extensions: [
        autocompletion({
          override: [explicitCompletionSource],
        }),
      ],
    })
    view.focus()

    dispatchInput(view, 0, typedText)
    await waitForCopilotSuggestion()

    expect(view.state.doc.toString()).toBe('length=)')
    expect(view.state.selection.main.head).toBe(typedText.length)

    expect(startCompletion(view)).toBe(true)
    expect(completionStatus(view.state)).not.toBeNull()

    const event = dispatchKeydown(view, '=')

    expect(event.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('length')
    expect(view.state.selection.main.head).toBe(typedText.length)

    dispatchInput(view, typedText.length, '=')

    expect(view.state.doc.toString()).toBe('length=')
    expect(view.state.selection.main.head).toBe(typedText.length + 1)
  })

  it('rejects punctuation-leading ghost text instead of typing through it', async () => {
    vi.useFakeTimers()

    const typedText = 'foo'
    const client = createClient({
      text: ' =)',
      character: typedText.length,
      uuid: 'ghost-assignment',
    })

    view = createCopilotView({
      doc: '',
      selection: 0,
      client,
    })
    view.focus()

    dispatchInput(view, 0, typedText)
    await waitForCopilotSuggestion()

    expect(view.state.doc.toString()).toBe('foo =)')
    expect(view.state.selection.main.head).toBe(typedText.length)

    const spaceEvent = dispatchKeydown(view, ' ')

    expect(spaceEvent.defaultPrevented).toBe(false)
    expect(view.state.doc.toString()).toBe('foo')
    expect(view.state.selection.main.head).toBe(typedText.length)

    dispatchInput(view, typedText.length, ' ')
    dispatchInput(view, typedText.length + 1, '=')

    expect(view.state.doc.toString()).toBe('foo =')
    expect(view.state.selection.main.head).toBe(typedText.length + 2)
  })

  it('keeps type-through behavior for word-leading ghost text', async () => {
    vi.useFakeTimers()

    const typedText = 'foo'
    const client = createClient({
      text: 'bar',
      character: typedText.length,
      uuid: 'ghost-word',
    })

    view = createCopilotView({
      doc: '',
      selection: 0,
      client,
    })
    view.focus()

    dispatchInput(view, 0, typedText)
    await waitForCopilotSuggestion()

    expect(view.state.doc.toString()).toBe('foobar')
    expect(view.state.selection.main.head).toBe(typedText.length)

    const event = dispatchKeydown(view, 'b')

    expect(event.defaultPrevented).toBe(true)
    expect(view.state.doc.toString()).toBe('foobar')
    expect(view.state.selection.main.head).toBe(typedText.length + 1)
  })
})
