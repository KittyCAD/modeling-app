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
import { getProjectDirectoryFromKCLFilePath } from '@src/lib/paths'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import type { systemIOMachine } from '@src/machines/systemIO/systemIOMachine'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { EditorView } from 'codemirror'
import type { ActorRefFrom } from 'xstate'

const fsEffectCompartment = new Compartment()
export const fsIgnoreAnnotationType = Annotation.define<true>()

type FSEffectProps = { path: string; contents: string }
const createFile = StateEffect.define<FSEffectProps>()
const deleteFile = StateEffect.define<FSEffectProps>()
const h = <T>(e: StateEffect<T>): TransactionSpec => ({
  effects: e,
  // Hopefully, makes initial transactions ignored and undo/redo not ignored.
  annotations: [fsIgnoreAnnotationType.of(true)],
})
export const fsCreateFile = (props: FSEffectProps) => h(createFile.of(props))
export const fsDeleteFile = (props: FSEffectProps) => h(deleteFile.of(props))

export function buildFSEffectExtension(
  systemIOActor: ActorRefFrom<typeof systemIOMachine>,
  kclManager: KclManager,
  settingsActor: SettingsActorType
) {
  const applicationProjectDirectory =
    settingsActor.getSnapshot().context.app.projectDirectory.current
  const fsWiredListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      if (tr.annotation(fsIgnoreAnnotationType)) {
        continue
      }
      for (const e of tr.effects) {
        if (e.is(createFile)) {
          const requestedFileNameWithExtension = e.value.path
            .split(window.electron?.sep || '/')
            .pop()
          const requestedProjectName = getProjectDirectoryFromKCLFilePath(
            e.value.path,
            applicationProjectDirectory
          )
          const requestedProjectNameWithSubDirectories = window.electron?.join(
            requestedProjectName,
            (e.value.path.split(requestedProjectName).pop() || '').replace(
              requestedFileNameWithExtension || '',
              ''
            )
          )
          if (
            requestedFileNameWithExtension &&
            requestedProjectNameWithSubDirectories
          ) {
            systemIOActor.send({
              type: SystemIOMachineEvents.createKCLFile,
              data: {
                requestedCode: e.value.contents,
                requestedProjectName: requestedProjectNameWithSubDirectories,
                requestedFileNameWithExtension,
              },
            })
          }
        } else if (e.is(deleteFile)) {
          console.log('got a delete!')
          systemIOActor.send({
            type: SystemIOMachineEvents.deleteFileOrFolder,
            data: { requestedPath: e.value.path },
          })
        }
      }
    }
  })

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
      if (e.is(createFile)) {
        found.push(deleteFile.of({ path: e.value.path, contents: '' }))
      } else if (e.is(deleteFile)) {
        found.push(createFile.of(e.value))
      }
    }
    return found
  })

  return [undoableFs, fsEffectCompartment.of([])]
}
