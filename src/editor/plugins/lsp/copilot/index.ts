/// Thanks to the Cursor folks for their heavy lifting here.
import { indentUnit } from '@codemirror/language'
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
} from '@codemirror/view'
import {
  Annotation,
  EditorState,
  Extension,
  StateEffect,
  StateField,
  Transaction,
} from '@codemirror/state'
import { completionStatus } from '@codemirror/autocomplete'
import { offsetToPos, posToOffset } from 'editor/plugins/lsp/util'
import { LanguageServerOptions, LanguageServerClient } from 'editor/plugins/lsp'
import { deferExecution } from 'lib/utils'
import {
  LanguageServerPlugin,
  TransactionAnnotation,
  docPathFacet,
  languageId,
  updateInfo,
  workspaceFolders,
  RelevantUpdate,
} from 'editor/plugins/lsp/plugin'

const copilotPluginAnnotation = Annotation.define<null>()
export const copilotPluginEvent = copilotPluginAnnotation.of(null)

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

export const completionDecoration = StateField.define<CompletionState>({
  create(_state: EditorState) {
    return { ghostText: null }
  },
  update(state: CompletionState, transaction: Transaction) {
    // We only care about events from this plugin.
    if (transaction.annotation(copilotPluginEvent.type) === undefined) {
      return state
    }

    // We only care about transactions with effects.
    if (!transaction.effects) {
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

export const relevantUpdate = (update: ViewUpdate): RelevantUpdate => {
  const infos = updateInfo(update)

  // Make sure we are not in a snippet
  if (infos.some((info) => info.inSnippet)) {
    return {
      overall: false,
      userSelect: false,
      time: null,
    }
  }

  return {
    overall: infos.some(
      (info) =>
        info.docChanged ||
        info.annotations.includes(TransactionAnnotation.UserSelect) ||
        info.annotations.includes(TransactionAnnotation.UserInput) ||
        info.annotations.includes(TransactionAnnotation.UserDelete) ||
        info.annotations.includes(TransactionAnnotation.UserUndo) ||
        info.annotations.includes(TransactionAnnotation.UserRedo) ||
        info.annotations.includes(TransactionAnnotation.UserMove) ||
        info.annotations.includes(TransactionAnnotation.CodeManager) ||
        info.annotations.includes(TransactionAnnotation.Copoilot)
    ),
    userSelect: infos.some((info) =>
      info.annotations.includes(TransactionAnnotation.UserSelect)
    ),
    time: infos.length ? infos[0].time : null,
  }
}

// A view plugin that requests completions from the server after a delay
export class CompletionRequester implements PluginValue {
  private client: LanguageServerClient
  private lastPos: number = 0
  private viewUpdate: ViewUpdate | null = null

  private _deffererCodeUpdate = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    this.viewCompletion()
    this.requestCompletions()
  }, changesDelay)

  private _deffererUserSelect = deferExecution(() => {
    if (this.viewUpdate === null) {
      return
    }

    this.rejectSuggestionCommand()
  }, changesDelay)

  constructor(client: LanguageServerClient) {
    this.client = client
  }

  update(viewUpdate: ViewUpdate) {
    this.viewUpdate = viewUpdate

    const isRelevant = relevantUpdate(viewUpdate)
    if (!isRelevant.overall) {
      return
    }

    // If we have a user select event, we want to clear the ghost text.
    if (isRelevant.userSelect) {
      this._deffererUserSelect(true)
      return
    }

    this.lastPos = this.viewUpdate.state.selection.main.head

    this._deffererCodeUpdate(true)
  }

  ghostText(): GhostText | null {
    if (!this.viewUpdate) {
      return null
    }

    return (
      this.viewUpdate.view.state.field(completionDecoration)?.ghostText || null
    )
  }

  containsGhostText(): boolean {
    return this.ghostText() !== null
  }

  autocompleting(): boolean {
    if (!this.viewUpdate) {
      return false
    }

    return completionStatus(this.viewUpdate.state) === 'active'
  }

  notFocused(): boolean {
    if (!this.viewUpdate) {
      return true
    }

    return !this.viewUpdate.view.hasFocus
  }

  async requestCompletions(): Promise<void> {
    if (
      this.viewUpdate === null ||
      this.containsGhostText() ||
      this.autocompleting() ||
      this.notFocused() ||
      !this.viewUpdate.docChanged
    ) {
      return
    }

    const pos = this.viewUpdate.state.selection.main.head

    // Check if the position has changed
    if (pos !== this.lastPos) {
      return
    }

    // Get the current position and source
    const state = this.viewUpdate.state
    const dUri = state.facet(docPathFacet)

    // Request completion from the server
    const completionResult = await this.client.getCompletion({
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
    const line = this.viewUpdate.view.state.doc.lineAt(pos)
    if (line.to !== pos) {
      const ending = this.viewUpdate.view.state.doc.sliceString(pos, line.to)
      if (displayText.endsWith(ending)) {
        displayText = displayText.slice(0, displayText.length - ending.length)
      } else if (displayText.includes(ending)) {
        // Remove the ending
        this.viewUpdate.view.dispatch({
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

    this.viewUpdate.view.dispatch({
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

  viewCompletion() {
    if (!this.viewUpdate) {
      return
    }

    if (!this.containsGhostText()) {
      return
    }

    if (this.viewUpdate.focusChanged) {
      this.rejectSuggestionCommand()
    }
  }

  acceptSuggestionCommand(): boolean {
    if (!this.viewUpdate) {
      return false
    }

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

    this.viewUpdate.view.dispatch({
      changes: {
        from: ghostTextStart,
        to: ghostTextEnd,
        insert: '',
      },
      effects: acceptSuggestion.of(null),
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
    })

    const tmpTextEnd = replacementEnd - (ghostTextEnd - ghostTextStart)

    this.viewUpdate.view.dispatch({
      changes: {
        from: actualTextStart,
        to: tmpTextEnd,
        insert: suggestion,
      },
      selection: { anchor: actualTextEnd },
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(true)],
    })

    this.client.accept(ghostText.uuid)
    return true
  }

  rejectSuggestionCommand(): boolean {
    if (!this.viewUpdate) {
      return false
    }

    const ghostText = this.ghostText()
    if (!ghostText) {
      return false
    }

    // We delete the suggestion, then carry through with the original keypress
    const ghostTextStart = ghostText.displayPos
    const ghostTextEnd = ghostText.endGhostText

    this.viewUpdate.view.dispatch({
      changes: {
        from: ghostTextStart,
        to: ghostTextEnd,
        insert: '',
      },
      effects: clearSuggestion.of(null),
      annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
    })

    this.client.reject()
    return false
  }

  sameKeyCommand(key: string) {
    if (!this.viewUpdate) {
      return false
    }

    const ghostText = this.ghostText()
    if (!ghostText) {
      return false
    }

    const tabKey = 'Tab'

    // When we type a key that is the same as the first letter of the suggestion, we delete the first letter of the suggestion and carry through with the original keypress
    const ghostTextStart = ghostText.displayPos
    const indent = this.viewUpdate.view.state.facet(indentUnit)

    if (key === tabKey && ghostText.displayText.startsWith(indent)) {
      this.viewUpdate.view.dispatch({
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
      this.viewUpdate.view.dispatch({
        selection: { anchor: ghostTextStart + 1 },
        effects: typeFirst.of(1),
        annotations: [copilotPluginEvent, Transaction.addToHistory.of(false)],
      })

      return true
    }
  }
}

export const copilotPlugin = (options: LanguageServerOptions): Extension => {
  const completionPlugin = ViewPlugin.define((view) => {
    return new CompletionRequester(options.client)
  })

  const domHandlers = EditorView.domEventHandlers({
    keydown(event, view) {
      if (
        event.key !== 'Shift' &&
        event.key !== 'Control' &&
        event.key !== 'Alt' &&
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

  return [
    docPathFacet.of(options.documentUri),
    languageId.of('kcl'),
    workspaceFolders.of(options.workspaceFolders),
    ViewPlugin.define(
      (view) =>
        new LanguageServerPlugin(options.client, view, options.allowHTMLContent)
    ),
    completionPlugin,
    domHandlers,
    completionDecoration,
  ]
}
