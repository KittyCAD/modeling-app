import {
  interactiveEditHistory,
  replayInteractiveEdit,
  committedInteractiveEdit,
} from '@src/lib/editors/historyReplay'
import { Transaction } from '@codemirror/state'
import {
  ChangeSet,
  EditorState,
  StateEffect,
  type TransactionSpec,
} from '@codemirror/state'
import { history, isolateHistory, undo, redo } from '@codemirror/commands'
import { batch, signal } from '@preact/signals-core'
import type { Editor, EditorUpdate } from '@src/lib/editors/registry/contract'
import { documentChanges } from '@src/lib/editors/changes'

/** Document transactions and undo history exist without a mounted CodeMirror surface. */
export function createEditorDocument(
  contents: string,
  canEdit: () => boolean = () => true
) {
  const text = signal(contents)
  const lifetime = new AbortController()
  let state = EditorState.create({
    doc: contents,
    extensions: [
      history(),
      interactiveEditHistory,
      EditorState.allowMultipleSelections.of(true),
    ],
  })
  const listeners = new Set<(update: EditorUpdate) => void>()
  let unrecordedBase: EditorState | undefined
  const apply = (input: Transaction) => {
    const transactions = replayInteractiveEdit(input)
    const docChanged = transactions.some(
      (transaction) => transaction.docChanged
    )
    if (lifetime.signal.aborted || (docChanged && !canEdit())) return
    const changes = transactions.reduce(
      (changes, transaction) => changes.compose(transaction.changes),
      ChangeSet.empty(state.doc.length)
    )
    const previous = state
    const final = transactions[transactions.length - 1].state
    const committedEdit = input.effects.find((effect) =>
      effect.is(committedInteractiveEdit)
    )
    const configuration = input.effects.filter(
      (effect) =>
        effect.is(StateEffect.appendConfig) ||
        effect.is(StateEffect.reconfigure)
    )
    const withConfiguration = (base: EditorState) =>
      configuration.length
        ? base.update({
            effects: configuration,
            annotations: Transaction.addToHistory.of(false),
          }).state
        : base
    if (unrecordedBase) unrecordedBase = withConfiguration(unrecordedBase)
    const replaying = input.isUserEvent('undo') || input.isUserEvent('redo')
    if (
      committedEdit &&
      !replaying &&
      input.annotation(Transaction.addToHistory) !== false &&
      unrecordedBase?.doc.toString() === committedEdit.value.before
    ) {
      // The interaction's updates were excluded from history. Record the completed
      // edit from its starting state, preserving earlier edits that those temporary
      // updates may have overwritten. Observers still receive the actual input
      // transactions from their current document, never a visible rollback.
      state = unrecordedBase.update({
        changes: documentChanges(unrecordedBase.doc, final.doc.toString()),
        selection: final.selection,
        effects: input.effects.filter(
          (effect) => !configuration.includes(effect)
        ),
        annotations: [
          isolateHistory.of(input.annotation(isolateHistory) ?? 'full'),
          Transaction.userEvent.of(
            input.annotation(Transaction.userEvent) ?? 'input'
          ),
        ],
      }).state
      unrecordedBase = undefined
    } else if (
      unrecordedBase &&
      input.docChanged &&
      input.annotation(Transaction.addToHistory) === false &&
      final.doc.eq(unrecordedBase.doc)
    ) {
      // Cancelling an interactive edit restores the history from before its temporary
      // edits, not the history already remapped through those edits.
      state = unrecordedBase.update({
        selection: final.selection,
        annotations: Transaction.addToHistory.of(false),
      }).state
      unrecordedBase = undefined
    } else {
      state = final
      if (
        replaying ||
        committedEdit ||
        (input.docChanged &&
          input.annotation(Transaction.addToHistory) !== false)
      )
        unrecordedBase = undefined
      else if (input.docChanged && !unrecordedBase)
        unrecordedBase = withConfiguration(previous)
    }
    const update: EditorUpdate = { transactions, state, changes, docChanged }
    batch(() => {
      if (docChanged) text.value = state.doc.toString()
      for (const listener of [...listeners]) listener(update)
    })
  }

  const document: Pick<
    Editor,
    'state' | 'contents' | 'signal' | 'dispatch' | 'subscribe' | 'undo' | 'redo'
  > = {
    get state() {
      return state
    },
    contents: text,
    signal: lifetime.signal,
    dispatch: (...specs: TransactionSpec[]) => {
      if (!lifetime.signal.aborted) apply(state.update(...specs))
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    undo: () =>
      !lifetime.signal.aborted &&
      canEdit() &&
      undo({
        get state() {
          return state
        },
        dispatch: apply,
      }),
    redo: () =>
      !lifetime.signal.aborted &&
      canEdit() &&
      redo({
        get state() {
          return state
        },
        dispatch: apply,
      }),
  }
  return {
    document,
    dispose: () => {
      lifetime.abort()
      unrecordedBase = undefined
      listeners.clear()
    },
  }
}
