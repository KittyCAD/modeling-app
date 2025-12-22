import { invertedEffects } from '@codemirror/commands'
import {
  Annotation,
  Compartment,
  Extension,
  StateEffect,
  Transaction,
  TransactionSpec,
} from '@codemirror/state'
import { KclManager } from '@src/lang/KclManager'
import { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { EditorView } from 'codemirror'
import { ActorRefFrom } from 'xstate'

const fsEffectCompartment = new Compartment()
export const fsIgnoreAnnotationType = Annotation.define<true>()

const createBlankFile = StateEffect.define<string>()
const deleteFile = StateEffect.define<string>()
const h = <T>(e: StateEffect<T>): TransactionSpec => ({
  effects: e,
  // Hopefully, makes initial transactions ignored and undo/redo not ignored.
  annotations: [fsIgnoreAnnotationType.of(true)],
})
export const fsCreateBlankFile = (path: string) => h(createBlankFile.of(path))
export const fsDeleteFile = (path: string) => h(deleteFile.of(path))

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
        if (e.is(createBlankFile)) {
          console.log('got a create effect!')
          systemIOActor.send({
            type: SystemIOMachineEvents.createBlankFile,
            data: { requestedAbsolutePath: e.value },
          })
        } else if (e.is(deleteFile)) {
          console.log('got a delete!')
          systemIOActor.send({
            type: SystemIOMachineEvents.deleteFileOrFolder,
            data: { requestedPath: e.value },
          })
        }
      }
    }
  })

  console.log('wiring up!')
  kclManager.editorView.dispatch({
    effects: [fsEffectCompartment.reconfigure(fsWiredListener)],
  })
  // Teardown
  return () => {
    kclManager.editorView.dispatch({
      effects: [fsEffectCompartment.reconfigure([])],
    })
  }
}

export function fsEffectExtension(): Extension {
  const undoableFs = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(createBlankFile)) {
        found.push(deleteFile.of(e.value))
      } else if (e.is(deleteFile)) {
        found.push(createBlankFile.of(e.value))
      }
    }
    return found
  })

  return [undoableFs, fsEffectCompartment.of([])]
}
