import { invertedEffects } from '@codemirror/commands'
import type { Extension, Transaction } from '@codemirror/state'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import type { TransactionSpecNoChanges } from '@src/editor/HistoryView'
import type { KclManager } from '@src/lang/KclManager'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { EditorView } from 'codemirror'
import type { ActorRefFrom } from 'xstate'

const fsEffectCompartment = new Compartment()
export const fsIgnoreAnnotationType = Annotation.define<true>()

type FSEffectProps = { src: string; target: string }
const restoreFile = StateEffect.define<FSEffectProps>()
const archiveFile = StateEffect.define<FSEffectProps>()
const moveFile = StateEffect.define<FSEffectProps>()

function getSuccessMessage(e: StateEffect<unknown>, tr: Transaction): string {
  if (e.is(restoreFile)) {
    return 'Restored successfully'
  } else if (e.is(archiveFile)) {
    return 'Archived successfully'
  } else if (
    e.is(moveFile) &&
    (tr.isUserEvent('undo') || tr.isUserEvent('redo'))
  ) {
    return 'Moved back successfully'
  } else if (e.is(moveFile)) {
    return 'Moved successfully'
  }
  return 'Unknown file operation'
}

/** helper function that builds a transaction with a default annotation */
const h = <T>(e: StateEffect<T>): TransactionSpecNoChanges => ({
  effects: e,
  annotations: [fsIgnoreAnnotationType.of(true)],
})

/** CodeMirror transaction to mark a "restore" file action */
export const fsRestoreFile = (props: FSEffectProps) => h(restoreFile.of(props))
/** CodeMirror transaction to mark an "archive" file action */
export const fsArchiveFile = (props: FSEffectProps) => h(archiveFile.of(props))
/** CodeMirror transaction to mark a "move" file action */
export const fsMoveFile = (props: FSEffectProps) => h(moveFile.of(props))

/**
 * Builder function to provide necessary system dependencies for the
 * FS history extension. This is where FS un/redo editor events
 * actually call systemIO APIs.
 */
export function buildFSEffectExtension(
  systemIOActor: ActorRefFrom<typeof systemIOMachine>,
  kclManager: KclManager
) {
  const fsWiredListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      if (tr.annotation(fsIgnoreAnnotationType)) {
        continue
      }
      for (const e of tr.effects) {
        if (e.is(restoreFile) || e.is(archiveFile) || e.is(moveFile)) {
          const type = e.is(moveFile)
            ? SystemIOMachineEvents.moveRecursive
            : SystemIOMachineEvents.moveRecursiveAndNavigate

          systemIOActor.send({
            type,
            data: {
              ...e.value,
              successMessage: getSuccessMessage(e, tr),
            },
          })
        }
      }
    }
  })

  // Note that the FS history extension is not on the EditorView for the code editor itself,
  // but rather the globalHistoryView.
  kclManager.globalHistoryView.dispatch(
    {
      effects: [fsEffectCompartment.reconfigure(fsWiredListener)],
    },
    // Prevent this configuration step from adding to our history!
    { shouldForwardToLocalHistory: false }
  )
  // Teardown
  return () => {
    kclManager.globalHistoryView.dispatch(
      {
        effects: [fsEffectCompartment.reconfigure([])],
      },
      { shouldForwardToLocalHistory: false }
    )
  }
}

/**
 * An extension that provides a mechanism for dispatching file system operations
 * to CodeMirror in a way that works with CM's normal history flow,
 * making things like archiving files and folders un/redoable.
 */
export function fsEffectExtension(): Extension {
  const undoableFs = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(restoreFile)) {
        found.push(
          archiveFile.of({
            ...e.value,
            src: e.value.target,
            target: e.value.src,
          })
        )
      } else if (e.is(archiveFile)) {
        found.push(
          restoreFile.of({
            ...e.value,
            src: e.value.target,
            target: e.value.src,
          })
        )
      } else if (e.is(moveFile)) {
        found.push(
          moveFile.of({ ...e.value, src: e.value.target, target: e.value.src })
        )
      }
    }
    return found
  })

  return [undoableFs, fsEffectCompartment.of([])]
}
