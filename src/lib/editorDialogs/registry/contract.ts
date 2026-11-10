import { defineContract, defineService } from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type {
  Editor,
  EditorsService,
  EditorViewInstance,
} from '@src/lib/editors/registry/contract'
import type {
  Executor,
  ExecutorCapability,
  CapabilityData,
} from '@src/lib/executors/registry/contract'

/** Preparation may await validation; only the synchronous commit may mutate the target document. */
export interface EditorDialogCommit {
  commit: () => Error | undefined
}
export interface EditorDialogOptions<C extends ExecutorCapability> {
  title: string
  contents: string
  documentType: string
  capability: C
  /** Attach domain context before contributed modes or executors can inspect this editor. */
  bind?: (editor: Editor) => () => void
  prepareSubmit: (
    data: CapabilityData<C>
  ) => Promise<EditorDialogCommit | Error>
}
/** The host owns one temporary editor and its independent executor scope, never a project tab. */
export interface ActiveEditorDialog {
  id: string
  title: string
  editor: Editor
  instance: EditorViewInstance
  editors: EditorsService
  executor: Executor
  error: ReadonlySignal<Error | undefined>
  submitting: ReadonlySignal<boolean>
  canSubmit: ReadonlySignal<boolean>
  submit: () => Promise<void>
  cancel: () => void
}
export interface EditorDialogsService {
  active: ReadonlySignal<ActiveEditorDialog | undefined>
  open: <C extends ExecutorCapability>(
    options: EditorDialogOptions<C>
  ) => ActiveEditorDialog
  executorFor: (editor: Editor) => Executor | undefined
  close: () => void
}
export const { editorDialogsService } = defineContract({
  editorDialogsService: defineService<EditorDialogsService>('editor-dialogs'),
})
