import {
  history,
  invertedEffects,
  isolateHistory,
  redo,
  undo,
} from '@codemirror/commands'
import {
  Annotation,
  Compartment,
  StateEffect,
  Transaction,
  type Extension,
  type TransactionSpec,
} from '@codemirror/state'

import { EditorView } from 'codemirror'

/** Any EditorView that wants to be a local history target must use this extension compartment */
export const localHistoryTarget = new Compartment()
/**
 * Extensions which want to dispatch global history transactions
 * must use this limited transaction type. We don't want any developers
 * mistaking the globalHistoryView for a normal document-oriented EditorView.
 */
export type TransactionSpecNoChanges = TransactionSpec & {
  changes?: undefined
  selection?: undefined
}

const globalHistory = new Compartment()
type HistoryRequest = {
  historySource: EditorView
  request: 'new' | 'undo' | 'redo'
}
const globalHistoryRequest = StateEffect.define<HistoryRequest>()

type GlobalHistoryDispatchOptions = {
  shouldForwardToLocalHistory: boolean
}

/**
 * A locked-down CodeMirror EditorView that is meant for
 * global application effects that we want to be un/redoable.
 *
 * It can be created without a "local target history" EditorView registered,
 * and receive transactions that are un/redoable. If it has a registered "local target history",
 * any transactions the HistoryView receives will be interleaved into the local target's history
 * as "global history request" StateEffects.
 *
 * The HistoryView is then intended to be used as a fallback for "local history" un/redo commands:
 *  - If there is un/redo available, the local history only fires
 *    - If this is a forwarded "global history request", then yay we un/redo the global history.
 *  - If there is no local history, we try out the global history.
 *
 * This allows us to do keep around this global history for longer than the life of any given
 * "local history" EditorView, but still get to interleave them with normal local history!
 */
export class HistoryView {
  private editorView: EditorView
  historyCompartment = new Compartment()

  constructor(extensions: Extension[]) {
    this.editorView = new EditorView({
      extensions: [
        // Placing this in a compartment allows us to clear history at runtime
        this.historyCompartment.of([history()]),
        globalHistory.of([]),
        ...extensions,
      ],
    })
  }

  private static doNotForward = Annotation.define<boolean>()

  registerLocalHistoryTarget(target: EditorView) {
    this.editorView.dispatch({
      effects: [
        globalHistory.reconfigure([this.buildForwardingExtension(target)]),
      ],
      annotations: [HistoryView.doNotForward.of(true)],
    })
    target.dispatch({
      effects: [localHistoryTarget.reconfigure(this.localHistoryExtension())],
      annotations: [Transaction.addToHistory.of(false)],
    })
  }

  // Used by `undo()` function
  get state() {
    return this.editorView.state
  }

  get defaultDispatchOptions(): GlobalHistoryDispatchOptions {
    return {
      shouldForwardToLocalHistory: true,
    }
  }

  /**
   * Type errors will occur if a developer tries to include `changes` or `selection`.
   * The HistoryView should really only contain effectful, reversible transactions.
   *
   * if `shouldForwardToLocalHistory` option is `false`, the local history target will not receive an update
   */
  dispatch = (
    spec: TransactionSpecNoChanges,
    options: Partial<GlobalHistoryDispatchOptions> = this.defaultDispatchOptions
  ) => {
    const resolvedOptions: GlobalHistoryDispatchOptions = Object.assign(
      this.defaultDispatchOptions,
      options
    )
    const skip = HistoryView.doNotForward.of(
      !resolvedOptions.shouldForwardToLocalHistory
    )
    const annotations: readonly Annotation<any>[] = spec.annotations
      ? 'length' in spec.annotations
        ? [...spec.annotations, skip]
        : [spec.annotations, skip]
      : [skip]
    this.editorView.dispatch({
      ...spec,
      annotations,
    })
  }

  /** Undo local history target if possible, fallback to global history */
  undo(localHistoryTarget: EditorView) {
    const result = undo(localHistoryTarget)
    if (!result) {
      undo(this.editorView)
    }
  }
  /** Redo local history target if possible, fallback to global history */
  redo(localHistoryTarget: EditorView) {
    const result = redo(localHistoryTarget)
    if (!result) {
      redo(this.editorView)
    }
  }

  /** Extensions attached to a local history target */
  private localHistoryExtension(): Extension {
    /**
     * Extension attached to a local history source to turn effects pointing
     * to "global history requests" into actual history commands on the global history.
     */
    const localHistoryEffect = EditorView.updateListener.of((vu) => {
      for (const tr of vu.transactions) {
        for (const e of tr.effects) {
          if (e.is(globalHistoryRequest)) {
            e.value.request === 'undo'
              ? undo(e.value.historySource)
              : redo(e.value.historySource)
          }
        }
      }
    })

    /**
     * Extension attached to local history source to make "global history request"
     * effects undoable. The value simply changes whether an undo or redo is called
     * on the global history source.
     */
    const localHistoryInvertedEffect = invertedEffects.of((tr) => {
      const found: StateEffect<unknown>[] = []
      for (const e of tr.effects) {
        if (e.is(globalHistoryRequest)) {
          found.push(
            globalHistoryRequest.of({
              historySource: e.value.historySource,
              request: e.value.request === 'undo' ? 'redo' : 'undo',
            })
          )
        }
      }
      return found
    })

    return [localHistoryEffect, localHistoryInvertedEffect]
  }

  /**
   * Extension attached to global history source that will
   * forward any updates it receives to a `targetView` with local history.
   */
  private buildForwardingExtension(targetView: EditorView): Extension {
    return EditorView.updateListener.of((vu) => {
      for (const tr of vu.transactions) {
        // We don't want to forward undo and redo events because then
        // we'll just be in a loop with our target local history.
        if (
          tr.isUserEvent('undo') ||
          tr.isUserEvent('redo') ||
          tr.annotation(HistoryView.doNotForward)
        ) {
          continue
        }

        targetView.dispatch({
          effects: [
            globalHistoryRequest.of({
              historySource: this.editorView,
              request: 'redo',
            }),
          ],
          annotations: [
            // These "global history request" transactions should never be grouped.
            isolateHistory.of('full'),
          ],
        })
      }
    })
  }
}
