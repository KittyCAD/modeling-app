import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  defineContract,
  defineService,
  appendValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'

/** One owned CodeMirror view, identified separately from the source it edits. */
export interface Editor {
  readonly id: symbol
  /** A local path, or a cloud ID plus relative path; multiple editors may share it. */
  readonly src: ReadonlySignal<string>
  /** Lowercase file extension, derived from src; empty when the source has no extension. */
  readonly type: ReadonlySignal<string>
  readonly view: EditorView
}

/** Editing behavior contributed for all files or a particular file extension. */
export interface EditorCapability {
  id: string
  editorType: '*' | `.${string}`
  capabilities: Extension
}

/** Owns open editors independently of executors and mounted editor panes. */
export interface EditorsService {
  editors: ReadonlySignal<readonly Editor[]>
  /** Synchronously create a distinct view from contents already loaded by the caller. */
  openEditor: (src: string, contents: string) => Editor
  /** Update an editor's source after a rename or reassociation; performs no file IO. */
  setSource: (id: symbol, src: string) => void
  closeEditor: (id: symbol) => void
}

export const editorsContract = defineContract({
  editorsService: defineService<EditorsService>('editors.service'),
  editorCapabilityValueSpec: appendValueSpec<EditorCapability>(
    'editors.capabilities'
  ),
})

export const { editorsService, editorCapabilityValueSpec } = editorsContract
