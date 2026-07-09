import {
  invertedEffects,
  isolateHistory,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import {
  Annotation,
  Compartment,
  type EditorState,
  type Extension,
  StateEffect,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'

import { createHistoryExtension } from '@src/editor/historyConfig'
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

type HistoryCommandTarget = {
  state: EditorState
  dispatch: (transaction: Transaction) => void
}

type HistoryCommand = (target: HistoryCommandTarget) => boolean

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
  private localHistoryTargetView: EditorView | undefined
  private operationInProgress = false
  private invalidGlobalRedoDepth = 0
  private suppressNextLocalGlobalHistoryRequest = false
  private historyChangedListeners = new Set<() => void>()
  historyCompartment = new Compartment()

  constructor(extensions: Extension[]) {
    this.editorView = new EditorView({
      extensions: [
        // Placing this in a compartment allows us to clear history at runtime
        this.historyCompartment.of([createHistoryExtension()]),
        globalHistory.of([]),
        ...extensions,
        EditorView.updateListener.of(() => {
          this.notifyHistoryChanged()
        }),
      ],
    })
  }

  destroy() {
    this.historyChangedListeners.clear()
    this.localHistoryTargetView = undefined
    this.editorView.destroy()
  }

  private static doNotForward = Annotation.define<boolean>()

  registerLocalHistoryTarget(target: EditorView) {
    this.localHistoryTargetView = target
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
    this.invalidGlobalRedoDepth = 0
    this.editorView.dispatch({
      ...spec,
      annotations,
    })
  }

  /**
   * Record a global redo point before applying the paired local transaction.
   * The local transaction stores this returned marker so later local undo/redo
   * commands can replay the already-recorded global effect in the same order.
   */
  recordGlobalRedoEventForLocalTransaction(spec: TransactionSpecNoChanges) {
    this.dispatch(spec, { shouldForwardToLocalHistory: false })
    return globalHistoryRequest.of({
      historySource: this.editorView,
      request: 'redo',
    })
  }

  /** Undo local history target if possible, fallback to global history */
  undo(localHistoryTarget: EditorView) {
    if (this.operationInProgress) return false
    const result = undo(localHistoryTarget)
    if (!result) {
      return undo(this.editorView)
    }
    return result
  }
  /** Redo local history target if possible, fallback to global history */
  redo(localHistoryTarget: EditorView) {
    if (this.operationInProgress) return false
    const result = redo(localHistoryTarget)
    if (!result) {
      return this.redoGlobalIfValid()
    }
    return result
  }

  setOperationInProgress(inProgress: boolean) {
    this.operationInProgress = inProgress
    this.notifyHistoryChanged()
  }

  get isOperationInProgress() {
    return this.operationInProgress
  }

  get undoDepth() {
    return undoDepth(this.editorView.state)
  }

  get redoDepth() {
    return Math.max(
      0,
      redoDepth(this.editorView.state) - this.invalidGlobalRedoDepth
    )
  }

  subscribeToHistoryChanges(listener: () => void) {
    this.historyChangedListeners.add(listener)
    return () => this.historyChangedListeners.delete(listener)
  }

  private notifyHistoryChanged() {
    for (const listener of this.historyChangedListeners) listener()
  }

  restoreAfterFailedUndo() {
    const restoredLocal = this.localHistoryTargetView
      ? redo(this.localHistoryTargetView)
      : false
    return restoredLocal || redo(this.editorView)
  }

  restoreAfterFailedRedo() {
    const restoredLocal = this.localHistoryTargetView
      ? undo(this.localHistoryTargetView)
      : false
    return restoredLocal || undo(this.editorView)
  }

  /**
   * Replay the local redo marker after a direct global redo has already run.
   * This is used when restoring a captured local editor state around a file
   * switch; the local stack must catch up without echoing the global redo.
   */
  synchronizeLocalHistoryAfterDirectGlobalRedo() {
    if (!this.localHistoryTargetView) {
      return false
    }

    return this.synchronizeLocalHistoryTargetAfterDirectGlobalCommand(
      this.localHistoryTargetView,
      redo
    )
  }

  /**
   * Replay the local undo marker after a direct global undo has already run.
   * This is used when restoring a captured local editor state around a file
   * switch; the local stack must catch up without echoing the global undo.
   */
  synchronizeLocalHistoryAfterDirectGlobalUndo() {
    if (!this.localHistoryTargetView) {
      return false
    }

    return this.synchronizeLocalHistoryTargetAfterDirectGlobalCommand(
      this.localHistoryTargetView,
      undo
    )
  }

  synchronizeLocalHistoryStateAfterDirectGlobalRedo(state: EditorState) {
    return this.synchronizeLocalHistoryStateAfterDirectGlobalCommand(
      state,
      redo
    )
  }

  synchronizeLocalHistoryStateAfterDirectGlobalUndo(state: EditorState) {
    return this.synchronizeLocalHistoryStateAfterDirectGlobalCommand(
      state,
      undo
    )
  }

  private synchronizeLocalHistoryStateAfterDirectGlobalCommand(
    state: EditorState,
    command: HistoryCommand
  ) {
    let synchronizedState = state
    const target = {
      get state() {
        return synchronizedState
      },
      dispatch(transaction: Transaction) {
        synchronizedState = transaction.state
      },
    }
    const restored = this.synchronizeLocalHistoryTargetAfterDirectGlobalCommand(
      target,
      command
    )
    return restored ? synchronizedState : undefined
  }

  private synchronizeLocalHistoryTargetAfterDirectGlobalCommand(
    target: HistoryCommandTarget,
    command: HistoryCommand
  ) {
    this.suppressNextLocalGlobalHistoryRequest = true
    try {
      return command(target)
    } finally {
      this.suppressNextLocalGlobalHistoryRequest = false
    }
  }

  /** Extensions attached to a local history target */
  private localHistoryExtension(): Extension {
    const invalidateAbandonedGlobalRedo = EditorView.updateListener.of(
      (update) => {
        for (const transaction of update.transactions) {
          if (
            !transaction.docChanged ||
            transaction.isUserEvent('undo') ||
            transaction.isUserEvent('redo') ||
            transaction.annotation(Transaction.addToHistory) === false ||
            transaction.effects.some((effect) =>
              effect.is(globalHistoryRequest)
            )
          ) {
            continue
          }
          const invalidRedoDepth = redoDepth(this.editorView.state)
          if (this.invalidGlobalRedoDepth !== invalidRedoDepth) {
            this.invalidGlobalRedoDepth = invalidRedoDepth
            this.notifyHistoryChanged()
          }
        }
      }
    )

    /**
     * Extension attached to a local history source to turn effects pointing
     * to "global history requests" into actual history commands on the global history.
     */
    const localHistoryEffect = EditorView.updateListener.of((vu) => {
      for (const tr of vu.transactions) {
        for (const e of tr.effects) {
          if (e.is(globalHistoryRequest)) {
            if (this.suppressNextLocalGlobalHistoryRequest) {
              this.suppressNextLocalGlobalHistoryRequest = false
              continue
            }
            if (e.value.request === 'undo') {
              undo(e.value.historySource)
            } else {
              this.redoGlobalIfValid()
            }
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

    return [
      invalidateAbandonedGlobalRedo,
      localHistoryEffect,
      localHistoryInvertedEffect,
    ]
  }

  private redoGlobalIfValid() {
    if (this.redoDepth === 0) {
      return false
    }
    return redo(this.editorView)
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
