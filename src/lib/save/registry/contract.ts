import {
  appendValueSpec,
  defineContract,
  defineService,
} from '@kittycad/registry'
import type {
  EditorMatchContext,
  EditorMatcher,
} from '@src/lib/editors/matching'
import type { ReadonlySignal } from '@preact/signals-core'
import type { Editor } from '@src/lib/editors/registry/contract'

/** Save status relative to the last loaded or successfully saved document. */
export interface EditorSaveState {
  dirty: boolean
  saving: boolean
  error?: Error
}

/** The immutable document requested for a save, independent of later typing or renames. */
export interface EditorSaveSnapshot extends EditorMatchContext {
  readonly editor: Editor
}

/** A step in the save action, matched against its snapshot. Failure stops subsequent steps. */
export interface EditorOnSave {
  id: string
  matches: EditorMatcher
  /** Lower orders run first; equal orders retain registration order. */
  order?: number
  onSave: (
    document: EditorSaveSnapshot
  ) => undefined | Error | Promise<undefined | Error>
}

/** Save orchestration and document baselines, independent of storage, panes, and executors. */
export interface EditorSave {
  readonly lastFocusedEditor: ReadonlySignal<Editor | undefined>
  state: (editor: Editor) => ReadonlySignal<EditorSaveState>
  save: (editor: Editor) => Promise<undefined | Error>
}

export const { editorSaveService, editorOnSaveValueSpec } = defineContract({
  editorOnSaveValueSpec: appendValueSpec<EditorOnSave>('editors.onSave'),
  editorSaveService: defineService<EditorSave>('editors.save'),
})
