import { invertedEffects } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
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
const h = <T>(e: StateEffect<T>): TransactionSpecNoChanges => ({
  effects: e,
  // Hopefully, makes initial transactions ignored and undo/redo not ignored.
  annotations: [fsIgnoreAnnotationType.of(true)],
})
export const fsRestoreFile = (props: FSEffectProps) => h(restoreFile.of(props))
export const fsArchiveFile = (props: FSEffectProps) => h(archiveFile.of(props))

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
        }
      }
    }
  })

  kclManager.globalHistoryView.dispatch(
    {
      effects: [fsEffectCompartment.reconfigure(fsWiredListener)],
    },
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

export function fsEffectExtension(): Extension {
  const undoableFs = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(restoreFile)) {
        found.push(archiveFile.of({ src: e.value.target, target: e.value.src }))
      } else if (e.is(archiveFile)) {
        found.push(restoreFile.of({ src: e.value.target, target: e.value.src }))
      }
    }
    return found
  })

  return [undoableFs, fsEffectCompartment.of([])]
}
