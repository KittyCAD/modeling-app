import type {
  EditorMatcher,
  EditorSourceContext,
} from '@src/lib/editors/matching'
import type {
  EditorState,
  Transaction,
  TransactionSpec,
  Extension,
} from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import {
  defineContract,
  defineService,
  appendValueSpec,
} from '@kittycad/registry'
import type { ReadonlySignal } from '@preact/signals-core'
import type { ComponentType } from 'react'

/** One live working document, independent of the views displaying it. */
export interface Editor {
  readonly id: symbol
  /** Undefined for a new buffer; otherwise a local path or cloud ID plus relative path. */
  readonly src: ReadonlySignal<string | undefined>
  /** Independent language/format metadata; undefined means the buffer is unclassified. */
  readonly classification: ReadonlySignal<EditorClassification | undefined>
  /** Current buffer text, independent of mounted panes and execution results. */
  readonly contents: ReadonlySignal<string>
  /** Canonical document and history. Its selection is history bookkeeping; live Code selections belong to view instances. */
  readonly state: EditorState
  readonly signal: AbortSignal
  dispatch: (...specs: TransactionSpec[]) => void
  subscribe: (listener: (transaction: Transaction) => void) => () => void
  undo: () => boolean
  redo: () => boolean
}

/** One presentation of a backing editor, with an independent mode and Code surface. */
export interface EditorViewInstance {
  readonly id: symbol
  readonly editor: Editor
  readonly codeView: ReadonlySignal<EditorView | undefined>
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
export interface EditorResourceHost {
  editor: Editor
  /**
   * Runs once in reverse registration order when this resource owner closes or initialization fails.
   * Synchronous setup and cleanup cannot change editor/view ownership, sources, or mode choices.
   * Cleanup owns resources, not other buffers; one failure does not skip later callbacks.
   * Register synchronous ownership here, including cleanup for asynchronous work.
   */
  onDispose: (dispose: () => void) => void
}
/** Mode contexts are owned by this presentation rather than every view of the document. */
export interface EditorViewHost extends EditorResourceHost {
  instance: EditorViewInstance
}
/** Only Code-surface contributions receive a native CodeMirror view. */
export interface CodeEditorHost extends EditorViewHost {
  view: EditorView
}
/** Props the pane supplies; contributed context is bound separately. */
export interface EditorSurfaceProps {
  editor: Editor
  instance: EditorViewInstance
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

/** Document behavior is acquired once per matching editor and released on withdrawal or close. */
export interface EditorCapability {
  id: string
  matches: EditorMatcher
  setup: (host: EditorResourceHost) => void
}

/** Native CodeMirror behavior is installed separately in every matching Code surface. */
export interface CodeEditorExtension {
  id: string
  matches: EditorMatcher
  extensions: Extension | ((host: CodeEditorHost) => Extension)
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
  views: ReadonlySignal<readonly EditorViewInstance[]>
  createView: (editor: Editor, modeId?: string) => EditorViewInstance
  closeView: (id: symbol) => void
  /** Create an unsaved buffer, without reading or creating a file. */
  createEditor: (contents?: string) => Editor
  /** Synchronously create an independent document from contents already loaded by the caller. */
  openEditor: (src: string | undefined, contents: string) => Editor
  /** Update an editor's source after a rename or reassociation; performs no file IO. */
  setSource: (id: symbol, src: string) => void
  /** Explicitly choose a registered language, or clear the choice to resume source classification. */
  setLanguage: (id: symbol, languageId: string | undefined) => Error | undefined
  /** Observe the modes and choice of one presentation, independently of React mounts. */
  viewState: (instance: EditorViewInstance) => ReadonlySignal<EditorViewState>
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
  codeEditorExtensionValueSpec: appendValueSpec<CodeEditorExtension>(
    'editors.codeExtensions'
  ),
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
  codeEditorExtensionValueSpec,
} = editorsContract
