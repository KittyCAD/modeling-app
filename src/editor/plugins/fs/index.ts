import type { MemoryFileDeletion } from '@src/lib/fileSystem/deletionHistory'
import { cloudStorageService } from '@src/registry/contracts/fileOperations'
import type { CloudFileDeletion } from '@src/lib/fs-zds/cloud/deletion'
import type { App } from '@src/lib/app'
import { trap } from '@src/lib/trap'
import toast from 'react-hot-toast'
import { invertedEffects } from '@codemirror/commands'
import type { Extension, Transaction } from '@codemirror/state'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import type { TransactionSpecNoChanges } from '@src/editor/HistoryView'
import type { KclManager } from '@src/lang/KclManager'
import { EditorView } from 'codemirror'

const fsEffectCompartment = new Compartment()
export const fsIgnoreAnnotationType = Annotation.define<true>()

type FSEffectProps = {
  src: string
  target: string
  requestedProjectName: string
  requestedFileName?: string
}
type FileDeletion =
  | {
      readonly kind: 'cloud'
      readonly projectPath: string
      readonly snapshot: CloudFileDeletion
    }
  | {
      readonly kind: 'local'
      readonly projectPath: string
      readonly snapshot: MemoryFileDeletion
    }
const fileDeletion = StateEffect.define<{
  deletion: FileDeletion
  restore: boolean
}>()
const moveFile = StateEffect.define<FSEffectProps>()

function getSuccessMessage(e: StateEffect<unknown>, tr: Transaction): string {
  if (e.is(moveFile) && (tr.isUserEvent('undo') || tr.isUserEvent('redo'))) {
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

/** History holds a cloud revision reference or a local snapshot in memory. */
export const fsFileDeletion = (deletion: FileDeletion) =>
  h(fileDeletion.of({ deletion, restore: false }))
/** CodeMirror transaction to mark a "move" file action */
export const fsMoveFile = (props: FSEffectProps) => h(moveFile.of(props))

/**
 * Builder function to provide necessary system dependencies for the
 * FS history extension. This is where FS un/redo editor events
 * apply file operations.
 */
export function buildFSHistoryExtension(app: App, kclManager: KclManager) {
  let restoringHistoryAfterFailure = false
  const fsWiredListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      if (tr.annotation(fsIgnoreAnnotationType)) {
        continue
      }
      for (const e of tr.effects) {
        if (e.is(fileDeletion)) {
          if (restoringHistoryAfterFailure) continue
          const current = app.project
          kclManager.globalHistoryView.setOperationInProgress(true)
          void (async () => {
            const { deletion, restore } = e.value
            if (!current || current.path !== deletion.projectPath)
              return Promise.reject(
                new Error('The deletion belongs to a different project.')
              )
            if (deletion.kind === 'cloud') {
              const cloud = app.registry.get(cloudStorageService)
              if (restore) await cloud.restoreDeletedPath(deletion.snapshot)
              else await cloud.redoPathDeletion(deletion.snapshot)
            } else {
              await app.fileOperations.replayDeletion(
                deletion.snapshot,
                restore
              )
            }
            if (app.project !== current) return
            await app.projectSession.refreshProject()
            await current.reloadFilesFromStorage(() => app.project === current)
            toast.success(
              e.value.restore ? 'Restored successfully' : 'Deleted successfully'
            )
          })()
            .catch((error: unknown) => {
              restoringHistoryAfterFailure = true
              try {
                if (e.value.restore)
                  kclManager.globalHistoryView.restoreAfterFailedUndo()
                else kclManager.globalHistoryView.restoreAfterFailedRedo()
              } finally {
                restoringHistoryAfterFailure = false
              }
              trap(error)
            })
            .finally(() =>
              kclManager.globalHistoryView.setOperationInProgress(false)
            )
        } else if (e.is(moveFile)) {
          const current = app.project
          const { src, target } = e.value
          void (async () => {
            await app.fileOperations.move(src, target)
            await app.refreshProjects()
            if (app.project !== current) return
            toast.success(getSuccessMessage(e, tr))
          })().catch(trap)
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
 * making file/folder deletions and file moves undoable.
 */
export function fsHistoryExtension(): Extension {
  const undoableFs = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(fileDeletion)) {
        found.push(fileDeletion.of({ ...e.value, restore: !e.value.restore }))
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
