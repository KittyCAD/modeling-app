import type {
  EditorMatcher,
  EditorSourceContext,
} from '@src/lib/editors/matching'
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
  /** Undefined for a new buffer; otherwise a local path or cloud ID plus relative path. */
  readonly src: ReadonlySignal<string | undefined>
  /** Independent language/format metadata; undefined means the buffer is unclassified. */
  readonly classification: ReadonlySignal<EditorClassification | undefined>
  /** Current buffer text, independent of mounted panes and execution results. */
  readonly contents: ReadonlySignal<string>
  readonly view: EditorView
}

/** Language identity is distinct from a filename extension; not every language has a media type. */
export interface EditorClassification {
  readonly languageId: string
  readonly mediaType?: string
}

/** Independent language descriptors classify source snapshots, before any editing behavior is installed. */
export interface EditorLanguage {
  id: string
  mediaType?: string
  matches: '*' | `.${string}` | ((source: EditorSourceContext) => boolean)
  /** Higher priorities win; ties retain registration order. */
  priority?: number
}

/** Context resources belong to a mode instance, independently of its React mount. */
export interface EditorViewHost {
  editor: Editor
  /**
   * Runs once in reverse registration order when the mode closes or initialization fails.
   * Synchronous setup and cleanup cannot change the editor collection, sources, or mode choices.
   * Cleanup owns resources, not other buffers; one failure does not skip later callbacks.
   * Register synchronous ownership here, including cleanup for asynchronous work.
   */
  onDispose: (dispose: () => void) => void
}
/** Props the pane supplies; contributed context is bound separately. */
export interface EditorSurfaceProps {
  editor: Editor
  active: boolean
}
export interface EditorViewProps<C> extends EditorSurfaceProps {
  context: C
}
export interface EditorViewMetadata {
  id: string
  label: string
  matches: EditorMatcher
  /** Higher priorities are preferred by default; ties retain registration order. */
  priority?: number
}
/** A mode binds its typed context once; the registry stores its uniform rendering interface. */
export interface EditorViewContribution extends EditorViewMetadata {
  bind: (host: EditorViewHost) => ComponentType<EditorSurfaceProps>
}

/** Binding is deferred during CodeMirror updates; failed providers carry no renderable component. */
export type EditorViewBinding =
  | { type: 'unbound' }
  | { type: 'ready'; Component: ComponentType<EditorSurfaceProps> }
  | { type: 'error'; error: Error }

/** An explicit choice wins while it matches; otherwise the highest-priority view is used. */
export interface EditorViewState {
  available: readonly EditorViewContribution[]
  selected: EditorViewContribution | undefined
  binding: EditorViewBinding
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
  /** Create an unsaved buffer, without reading or creating a file. */
  createEditor: (contents?: string) => Editor
  /** Synchronously create a distinct view from contents already loaded by the caller. */
  openEditor: (src: string | undefined, contents: string) => Editor
  /** Update an editor's source after a rename or reassociation; performs no file IO. */
  setSource: (id: symbol, src: string) => void
  /** Explicitly choose a registered language, or clear the choice to resume source classification. */
  setLanguage: (id: symbol, languageId: string | undefined) => Error | undefined
  /** Observe contributed surfaces and the retained choice independently of mounted panes. */
  viewState: (editor: Editor) => ReadonlySignal<EditorViewState>
  /** Choose a matching surface without replacing the buffer or its capabilities. */
  setView: (id: symbol, viewId: string) => void
  closeEditor: (id: symbol) => void
}

export const editorsContract = defineContract({
  editorLanguageValueSpec: appendValueSpec<EditorLanguage>('editors.languages'),
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
  editorLanguageValueSpec,
  editorCapabilityValueSpec,
  editorTabIndicatorValueSpec,
  editorViewValueSpec,
} = editorsContract
