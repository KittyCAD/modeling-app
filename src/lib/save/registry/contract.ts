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
  /** Advance the baseline after an authoritative remote snapshot is adopted. */
  adopt: (editor: Editor, contents: string) => Error | undefined
  save: (editor: Editor) => Promise<undefined | Error>
}

/** Policies may force autosave for a backing independently of the user preference. */
export interface EditorAutosavePolicy {
  id: string
  matches: EditorMatcher
  required: ReadonlySignal<boolean>
}

export const {
  editorSaveService,
  editorOnSaveValueSpec,
  editorAutosavePoliciesValueSpec,
} = defineContract({
  editorOnSaveValueSpec: appendValueSpec<EditorOnSave>('editors.onSave'),
  editorAutosavePoliciesValueSpec: appendValueSpec<EditorAutosavePolicy>(
    'editors.autosavePolicies'
  ),
  editorSaveService: defineService<EditorSave>('editors.save'),
})
