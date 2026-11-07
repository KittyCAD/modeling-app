import type { EditorMatcher } from '@src/lib/editors/matching'
import type { Extension } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  defineContract,
  defineService,
  appendValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'

/** One live buffer with owned CodeMirror state and interchangeable contributed surfaces. */
export interface Editor {
  readonly id: symbol
  /** A local path, or a cloud ID plus relative path; multiple editors may share it. */
  readonly src: ReadonlySignal<string>
  /** Lowercase file extension, derived from src; empty when the source has no extension. */
  readonly type: ReadonlySignal<string>
  /** Current buffer text, independent of mounted panes and execution results. */
  readonly contents: ReadonlySignal<string>
  readonly view: EditorView
}

/** A contributed surface over the same live buffer; it never owns the editor's lifetime. */
export interface EditorViewContribution {
  id: string
  label: string
  matches: EditorMatcher
  /** Higher priorities are preferred by default; ties retain registration order. */
  priority?: number
  Component: ComponentType<{ editor: Editor; active: boolean }>
}

/** An explicit choice wins while it matches; otherwise the highest-priority view is used. */
export interface EditorViewState {
  available: readonly EditorViewContribution[]
  selected: EditorViewContribution | undefined
}

/** Editing behavior contributed for a matching source snapshot. */
export interface EditorCapability {
  id: string
  matches: EditorMatcher
  /** Factories run once per editor/contribution; read observable source data when needed. */
  capabilities: Extension | ((editor: Editor) => Extension)
}

/** Informational decorations contributed alongside a buffer's tab label. */
export interface EditorTabIndicator {
  id: string
  order?: number
  component: ComponentType<{ editor: Editor }>
}

/** Owns open editors independently of executors and mounted editor panes. */
export interface EditorsService {
  editors: ReadonlySignal<readonly Editor[]>
  /** Synchronously create a distinct view from contents already loaded by the caller. */
  openEditor: (src: string, contents: string) => Editor
  /** Update an editor's source after a rename or reassociation; performs no file IO. */
  setSource: (id: symbol, src: string) => void
  /** Observe contributed surfaces and the retained choice independently of mounted panes. */
  viewState: (editor: Editor) => ReadonlySignal<EditorViewState>
  /** Choose a matching surface without replacing the buffer or its capabilities. */
  setView: (id: symbol, viewId: string) => void
  closeEditor: (id: symbol) => void
}

export const editorsContract = defineContract({
  editorViewValueSpec: appendValueSpec<EditorViewContribution>('editors.views'),
  editorTabIndicatorValueSpec: appendValueSpec<EditorTabIndicator>(
    'editors.tabIndicators'
  ),
  editorsService: defineService<EditorsService>('editors.service'),
  editorCapabilityValueSpec: appendValueSpec<EditorCapability>(
    'editors.capabilities'
  ),
})

export const {
  editorsService,
  editorCapabilityValueSpec,
  editorTabIndicatorValueSpec,
  editorViewValueSpec,
} = editorsContract
