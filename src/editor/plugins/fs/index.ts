import { invertedEffects } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import type { TransactionSpecNoChanges } from '@src/editor/HistoryView'
import type { KclManager } from '@src/lang/KclManager'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import {
  RequestedKCLFile,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import { EditorView } from 'codemirror'
import type { ActorRefFrom } from 'xstate'

const fsEffectCompartment = new Compartment()
export const fsIgnoreAnnotationType = Annotation.define<true>()

type FSArchiveProps = { src: string; target: string }
const restoreFile = StateEffect.define<FSArchiveProps>()
const archiveFile = StateEffect.define<FSArchiveProps>()
type FSBulkCreateDeleteProps = {
  create: RequestedKCLFile[]
  delete: RequestedKCLFile[]
  projectName: string
}
const bulkCreateAndDeleteFiles = StateEffect.define<FSBulkCreateDeleteProps>()

/** helper function that builds a transaction with a default annotation */
const h = <T>(e: StateEffect<T>): TransactionSpecNoChanges => ({
  effects: e,
  // makes initial transactions ignored and undo/redo not ignored.
  annotations: [fsIgnoreAnnotationType.of(true)],
})

/** CodeMirror transaction to mark a "restore" file action */
export const fsRestoreFile = (props: FSArchiveProps) => h(restoreFile.of(props))
/** CodeMirror transaction to mark an "archive" file action */
export const fsArchiveFile = (props: FSArchiveProps) => h(archiveFile.of(props))
/** CodeMirror transaction to mark a file action as bulk creation and deletion */
export const fsBulkCreateAndDelete = (props: FSBulkCreateDeleteProps) =>
  h(bulkCreateAndDeleteFiles.of(props))

/**
 * Builder function to provide necessary system dependencies for the
 * FS history extension. This is where FS un/redo editor events
 * actually call systemIO APIs.
 */
export function buildFSHistoryExtension(
  systemIOActor: ActorRefFrom<typeof systemIOMachine>,
  kclManager: KclManager
) {
  const fsWiredListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      if (tr.annotation(fsIgnoreAnnotationType)) {
        continue
      }
      for (const e of tr.effects) {
        if (e.is(restoreFile) || e.is(archiveFile)) {
          systemIOActor.send({
            type: SystemIOMachineEvents.moveRecursive,
            data: {
              ...e.value,
              successMessage: e.is(restoreFile)
                ? 'Restored successfully'
                : 'Archived successfully',
            },
          })
        } else if (e.is(bulkCreateAndDeleteFiles)) {
          systemIOActor.send({
            type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
            data: {
              files: e.value.create,
              requestedProjectName: e.value.projectName,
              override: true,
              // The API seems to fall back to main.kcl if we provide an empty string
              requestedFileNameWithExtension: '',
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
export function fsHistoryExtension(): Extension {
  const undoableFs = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(restoreFile)) {
        found.push(archiveFile.of({ src: e.value.target, target: e.value.src }))
      } else if (e.is(archiveFile)) {
        found.push(restoreFile.of({ src: e.value.target, target: e.value.src }))
      } else if (e.is(bulkCreateAndDeleteFiles)) {
        found.push(
          bulkCreateAndDeleteFiles.of({
            ...e.value,
            create: e.value.delete,
            delete: e.value.create,
          })
        )
      }
    }
    return found
  })

  return [undoableFs, fsEffectCompartment.of([])]
}
