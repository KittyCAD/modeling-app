/// Thanks to the Cursor folks for their heavy lifting here.
/// This has been heavily modified from their original implementation but we are
/// still grateful.
import { completionStatus } from '@codemirror/autocomplete'
import { indentUnit } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import {
  Annotation,
  EditorState,
  Prec,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import type {
  DecorationSet,
  KeyBinding,
  PluginValue,
  ViewUpdate,
} from '@codemirror/view'
import { Decoration, EditorView, ViewPlugin, keymap } from '@codemirror/view'
import type {
  LanguageServerClient,
  LanguageServerOptions,
} from '@kittycad/codemirror-lsp-client'
import {
  docPathFacet,
  languageId,
  offsetToPos,
  posToOffset,
} from '@kittycad/codemirror-lsp-client'
import { editorManager } from '@src/lib/singletons'
import { reportRejection } from '@src/lib/trap'
import { deferExecution } from '@src/lib/utils'

import type { CopilotAcceptCompletionParams } from '@rust/kcl-lib/bindings/CopilotAcceptCompletionParams'
import type { CopilotCompletionResponse } from '@rust/kcl-lib/bindings/CopilotCompletionResponse'
import type { CopilotLspCompletionParams } from '@rust/kcl-lib/bindings/CopilotLspCompletionParams'
import type { CopilotRejectCompletionParams } from '@rust/kcl-lib/bindings/CopilotRejectCompletionParams'

const copilotPluginAnnotation = Annotation.define<boolean>()
export const copilotPluginEvent = copilotPluginAnnotation.of(true)

const rejectSuggestionAnnotation = Annotation.define<boolean>()
export const rejectSuggestionCommand = rejectSuggestionAnnotation.of(true)

// Effects to tell StateEffect what to do with GhostText
const addSuggestion = StateEffect.define<Suggestion>()
const acceptSuggestion = StateEffect.define<null>()
const clearSuggestion = StateEffect.define<null>()
const typeFirst = StateEffect.define<number>()

const ghostMark = Decoration.mark({ class: 'cm-ghostText' })

const changesDelay = 600

interface Suggestion {
  text: string
  displayText: string
  cursorPos: number
  startPos: number
  endPos: number
  endReplacement: number
  uuid: string
}

interface CompletionState {
  ghostText: GhostText | null
}

interface GhostText {
  text: string
  displayText: string
  displayPos: number
  startPos: number
  endGhostText: number
  endReplacement: number
  endPos: number
  decorations: DecorationSet
  weirdInsert: boolean
  uuid: string
}

const completionDecoration = StateField.define<CompletionState>({
  create(_state: EditorState) {
    return { ghostText: null }
  },
  update(state: CompletionState, transaction: Transaction) {
    // We only care about events from this plugin.
    if (
      transaction.annotation(copilotPluginEvent.type) === undefined &&
      transaction.annotation(rejectSuggestionCommand.type) === undefined
    ) {
      return state
    }

    for (const effect of transaction.effects) {
      if (effect.is(addSuggestion)) {
        // When adding a suggestion, we set th ghostText
        const {
          text,
          displayText,
          endReplacement,
          cursorPos,
          startPos,
          endPos,
          uuid,
        } = effect.value
        const endGhostText = cursorPos + displayText.length
        const decorations = Decoration.set([
          ghostMark.range(cursorPos, endGhostText),
        ])
        return {
          ghostText: {
            text,
            displayText,
            startPos,
            endPos,
            decorations,
            displayPos: cursorPos,
            endReplacement,
            endGhostText,
            weirdInsert: false,
            uuid,
          },
        }
      } else if (effect.is(acceptSuggestion)) {
        if (state.ghostText) {
          return { ghostText: null }
        }
      } else if (effect.is(typeFirst)) {
        const numChars = effect.value
        if (state.ghostText && !state.ghostText.weirdInsert) {
          let {
            text,
            displayText,
            displayPos,
            startPos,
            endPos,
            endGhostText,
            decorations,
            endReplacement,
            uuid,
          } = state.ghostText

          displayPos += numChars

          displayText = displayText.slice(numChars)

          if (startPos === endGhostText) {
            return { ghostText: null }
          } else {
            decorations = Decoration.set([
              ghostMark.range(displayPos, endGhostText),
            ])
            return {
              ghostText: {
                text,
                displayText,
                startPos,
                endPos,
                decorations,
                endGhostText,
                endReplacement,
                uuid,
                displayPos,
                weirdInsert: false,
              },
            }
          }
        }
      } else if (effect.is(clearSuggestion)) {
        return { ghostText: null }
      }
    }

    // if (transaction.docChanged && state.ghostText) {
    //     if (transaction.
    //     onsole.log({changes: transaction.changes, transaction})
    //     const newGhostText = state.ghostText.decorations.map(transaction.changes)
    //     return {ghostText: {...state.ghostText, decorations: newGhostText}};
    // }

    return state
  },
  provide: (field) =>
    EditorView.decorations.from(field, (value) =>
      value.ghostText ? value.ghostText.decorations : Decoration.none
    ),
})

// A view plugin that requests completions from the server after a delay
export class CompletionRequester implements PluginValue {
  private client: LanguageServerClient
  private lastPos: number = 0

  private queuedUids: string[] = []

  private _deffererUserSelect = deferExecution(() => {
    this.rejectSuggestionCommand()
  }, changesDelay)

  // When a doc update needs to be sent to the server, this holds the
  // timeout handle for it. When null, the server has the up-to-date
  // document.
  private sendScheduledInput: number | null = null

  constructor(
    readonly view: EditorView,
    client: LanguageServerClient
  ) {
    this.client = client
  }

  update(viewUpdate: ViewUpdate) {
    // Make sure we are in a state where we can request completions.
    if (!editorManager.copilotEnabled) {
      return
    }

    let isUserSelect = false
    let isRelevant = false
    for (const tr of viewUpdate.transactions) {
      if (tr.isUserEvent('select')) {
        isUserSelect = true
        break
      } else if (tr.isUserEvent('input')) {
        isRelevant = true
      } else if (tr.isUserEvent('delete')) {
        isRelevant = true
      } else if (tr.isUserEvent('undo')) {
        isRelevant = true
      } else if (tr.isUserEvent('redo')) {
        isRelevant = true
      } else if (tr.isUserEvent('move')) {
        isRelevant = true
      } else if (tr.annotation(copilotPluginEvent.type)) {
        isRelevant = true
      }
    }

    // If we have a user select event, we want to clear the ghost text.
    if (isUserSelect) {
      this._deffererUserSelect(true)
      return
    }

    if (!isRelevant) {
      return
    }

    this.lastPos = this.view.state.selection.main.head
    if (viewUpdate.docChanged) this.scheduleUpdateDoc()
  }

  scheduleUpdateDoc() {
    if (this.sendScheduledInput != null)
      window.clearTimeout(this.sendScheduledInput)
    this.sendScheduledInput = window.setTimeout(
      () => this.updateDoc(),
      changesDelay
    )
  }

  updateDoc() {
    if (this.sendScheduledInput != null) {
      window.clearTimeout(this.sendScheduledInput)
      this.sendScheduledInput = null
    }

    if (!this.client.ready) return
    try {
      this.requestCompletions().catch(reportRejection)
    } catch (e) {
      console.error(e)
    }
  }

  ensureDocUpdated() {
    if (this.sendScheduledInput != null) this.updateDoc()
  }

  ghostText(): GhostText | null {
    return this.view.state.field(completionDecoration)?.ghostText || null
  }

  containsGhostText(): boolean {
    return this.ghostText() !== null
  }

  autocompleting(): boolean {
    return completionStatus(this.view.state) === 'active'
  }

  notFocused(): boolean {
    return !this.view.hasFocus
  }

  async requestCompletions(): Promise<void> {
    if (
      this.containsGhostText() ||
      this.autocompleting() ||
      this.notFocused()
    ) {
      return
    }

    const pos = this.view.state.selection.main.head

    // Check if the position has changed
    if (pos !== this.lastPos) {
      return
    }

    // Get the current position and source
    const state = this.view.state
    const dUri = state.facet(docPathFacet)

    // Request completion from the server
    const completionResult = await this.getCompletion({
      doc: {
        source: state.doc.toString(),
        tabSize: state.facet(EditorState.tabSize),
        indentSize: 1,
        insertSpaces: true,
        path: dUri.split('/').pop()!,
        uri: dUri,
        relativePath: dUri.replace('file://', ''),
        languageId: state.facet(languageId),
        position: offsetToPos(state.doc, pos),
      },
    })

    if (completionResult.completions.length === 0) {
      return
    }

    let {
      text,
      displayText,
      range: { start },
      position,
      uuid,
    } = completionResult.completions[0]

    if (text.length === 0 || displayText.length === 0) {
      return
    }

    const startPos = posToOffset(state.doc, {
      line: start.line,
      character: start.character,
    })

    if (startPos === undefined) {
      return
    }

    const endGhostOffset = posToOffset(state.doc, {
      line: position.line,
      character: position.character,
    })
    if (endGhostOffset === undefined) {
      return
    }
    const endGhostPos = endGhostOffset + displayText.length
    // EndPos is the position that marks the complete end
    // of what is to be replaced when we accept a completion
    // result
    const endPos = startPos + text.length

    // Check if they changed position.
    if (pos !== this.lastPos) {
      return
    }

    // Make sure we are not currently completing.
    if (this.autocompleting() || this.notFocused()) {
      return
    }

    // Dispatch an effect to add the suggestion
    // If the completion starts before the end of the line, check the end of the line with the end of the completion.
    const line = this.view.state.doc.lineAt(pos)
    if (line.to !== pos) {
      const ending = this.view.state.doc.sliceString(pos, line.to)
      if (displayText.endsWith(ending)) {
        displayText = displayText.slice(0, displayText.length - ending.length)
      } else if (displayText.includes(ending)) {
        // Remove the ending
        this.view.dispatch({
          changes: {
            from: pos,
            to: line.to,
            insert: '',
          },
          selection: { anchor: pos },
          effects: typeFirst.of(ending.length),
          annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
        })
      }
    }

    this.view.dispatch({
      changes: {
        from: pos,
        to: pos,
        insert: displayText,
      },
      effects: [
        addSuggestion.of({
          displayText,
          endReplacement: endGhostPos,
          text,
          cursorPos: pos,
          startPos,
          endPos,
          uuid,
        }),
      ],
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
    })

    this.lastPos = pos

    return
  }

  acceptSuggestionCommand(): boolean {
    const ghostText = this.ghostText()
    if (!ghostText) {
      return false
    }

    // We delete the ghost text and insert the suggestion.
    // We also set the cursor to the end of the suggestion.
    const ghostTextStart = ghostText.displayPos
    const ghostTextEnd = ghostText.endGhostText

    const actualTextStart = ghostText.startPos
    const actualTextEnd = ghostText.endPos

    const replacementEnd = ghostText.endReplacement

    const suggestion = ghostText.text

    this.view.dispatch({
      changes: {
        from: ghostTextStart,
        to: ghostTextEnd,
        insert: '',
      },
      effects: acceptSuggestion.of(null),
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
    })

    const tmpTextEnd = replacementEnd - (ghostTextEnd - ghostTextStart)

    this.view.dispatch({
      changes: {
        from: actualTextStart,
        to: tmpTextEnd,
        insert: suggestion,
      },
      selection: { anchor: actualTextEnd },
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(true)],
    })

    this.accept(ghostText.uuid).catch(reportRejection)
    return true
  }

  rejectSuggestionCommand(): boolean {
    const ghostText = this.ghostText()
    if (!ghostText) {
      return false
    }

    // We delete the suggestion, then carry through with the original keypress
    const ghostTextStart = ghostText.displayPos
    const ghostTextEnd = ghostText.endGhostText

    this.view.dispatch({
      changes: {
        from: ghostTextStart,
        to: ghostTextEnd,
        insert: '',
      },
      effects: clearSuggestion.of(null),
      annotations: [
        rejectSuggestionCommand,
        copilotPluginEvent,
        Transaction.addToHistory.of(false),
      ],
    })

    this.reject().catch(reportRejection)
    return false
  }

  sameKeyCommand(key: string) {
    const ghostText = this.ghostText()
    if (!ghostText) {
      return false
    }

    const tabKey = 'Tab'

    // When we type a key that is the same as the first letter of the suggestion, we delete the first letter of the suggestion and carry through with the original keypress
    const ghostTextStart = ghostText.displayPos
    const indent = this.view.state.facet(indentUnit)

    if (key === tabKey && ghostText.displayText.startsWith(indent)) {
      this.view.dispatch({
        selection: { anchor: ghostTextStart + indent.length },
        effects: typeFirst.of(indent.length),
        annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
      })
      return true
    } else if (key === tabKey) {
      return this.acceptSuggestionCommand()
    } else if (ghostText.weirdInsert || key !== ghostText.displayText[0]) {
      return this.rejectSuggestionCommand()
    } else if (ghostText.displayText.length === 1) {
      return this.acceptSuggestionCommand()
    } else {
      // Use this to delete the first letter of the suggestion
      this.view.dispatch({
        selection: { anchor: ghostTextStart + 1 },
        effects: typeFirst.of(1),
        annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
      })

      return true
    }
  }

  async getCompletion(
    params: CopilotLspCompletionParams
  ): Promise<CopilotCompletionResponse> {
    const response: CopilotCompletionResponse = await this.client.requestCustom(
      'copilot/getCompletions',
      params
    )
    //
    this.queuedUids = [...response.completions.map((c) => c.uuid)]
    return response
  }

  async accept(uuid: string) {
    const badUids = this.queuedUids.filter((u) => u !== uuid)
    this.queuedUids = []
    this.acceptCompletion({ uuid })
    this.rejectCompletions({ uuids: badUids })
  }

  async reject() {
    const badUids = this.queuedUids
    this.queuedUids = []
    this.rejectCompletions({ uuids: badUids })
  }

  acceptCompletion(params: CopilotAcceptCompletionParams) {
    this.client.notifyCustom('copilot/notifyAccepted', params)
  }

  rejectCompletions(params: CopilotRejectCompletionParams) {
    this.client.notifyCustom('copilot/notifyRejected', params)
  }
}

export const copilotPlugin = (options: LanguageServerOptions): Extension => {
  let plugin: CompletionRequester | null = null
  const completionPlugin = ViewPlugin.define(
    (view) => (plugin = new CompletionRequester(view, options.client))
  )

  const domHandlers = EditorView.domEventHandlers({
    keydown(event, view) {
      if (
        event.key !== 'Shift' &&
        event.key !== 'Control' &&
        event.key !== 'Alt' &&
        event.key !== 'Backspace' &&
        event.key !== 'Delete' &&
        event.key !== 'Meta'
      ) {
        if (view.plugin === null) return false

        // Get the current plugin from the map.
        const p = view.plugin(completionPlugin)
        if (p === null) return false

        return p.sameKeyCommand(event.key)
      } else {
        return false
      }
    },
  })

  const rejectSuggestionCommand = (view: EditorView): boolean => {
    // Get the current plugin from the map.
    const p = view.plugin(completionPlugin)
    if (p === null) return false

    return p.rejectSuggestionCommand()
  }

  const copilotAutocompleteKeymap: readonly KeyBinding[] = [
    {
      key: 'Tab',
      run: (view: EditorView): boolean => {
        if (view.plugin === null) return false

        // Get the current plugin from the map.
        const p = view.plugin(completionPlugin)
        if (p === null) return false

        return p.sameKeyCommand('Tab')
      },
    },
    {
      key: 'Backspace',
      run: rejectSuggestionCommand,
    },
    {
      key: 'Delete',
      run: rejectSuggestionCommand,
    },
    { key: 'Mod-z', run: rejectSuggestionCommand, preventDefault: true },
    {
      key: 'Mod-y',
      mac: 'Mod-Shift-z',
      run: rejectSuggestionCommand,
      preventDefault: true,
    },
    {
      linux: 'Ctrl-Shift-z',
      run: rejectSuggestionCommand,
      preventDefault: true,
    },
    { key: 'Mod-u', run: rejectSuggestionCommand, preventDefault: true },
    {
      key: 'Alt-u',
      mac: 'Mod-Shift-u',
      run: rejectSuggestionCommand,
      preventDefault: true,
    },
  ]

  const copilotAutocompleteKeymapExt = Prec.highest(
    keymap.computeN([], () => [copilotAutocompleteKeymap])
  )

  return [
    completionPlugin,
    copilotAutocompleteKeymapExt,
    domHandlers,
    completionDecoration,
    EditorView.focusChangeEffect.of((_, focusing) => {
      if (plugin === null) return null

      plugin.rejectSuggestionCommand()

      return null
    }),
  ]
}
