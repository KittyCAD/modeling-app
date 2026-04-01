import fsZds from '@src/lib/fs-zds'
import type { EntityType } from '@kittycad/lib'
import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import type RustContext from '@src/lib/rustContext'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Operation } from '@rust/kcl-lib/bindings/Operation'
import type { KCLError } from '@src/lang/errors'
import {
  compilationErrorsToDiagnostics,
  kclErrorsToDiagnostics,
} from '@src/lang/errors'
import { executeAst, executeAstMock, lintAst } from '@src/lang/langHelpers'
import { getNodeFromPath, getSettingsAnnotation } from '@src/lang/queryAst'
import { CommandLogType } from '@src/lang/std/commandLog'
import { isTopLevelModule, topLevelRange } from '@src/lang/util'
import type {
  ArtifactGraph,
  ExecState,
  PathToNode,
  Program,
  VariableMap,
} from '@src/lang/wasm'
import { emptyExecState, getKclVersion, parse, recast } from '@src/lang/wasm'
import {
  setArtifactGraphEffect,
  artifactAnnotationsEvent,
} from '@src/editor/plugins/artifacts'
import type { ArtifactIndex } from '@src/lib/artifactIndex'
import { buildArtifactIndex } from '@src/lib/artifactIndex'
import {
  DEFAULT_DEFAULT_LENGTH_UNIT,
  EXECUTE_AST_INTERRUPT_ERROR_MESSAGE,
} from '@src/lib/constants'
import { markOnce } from '@src/lib/performance'
import type {
  BaseUnit,
  KclSettingsAnnotation,
} from '@src/lib/settings/settingsTypes'
import {
  getSettingsFromActorContext,
  jsAppSettings,
} from '@src/lib/settings/settingsUtils'

import { err, reportRejection } from '@src/lib/trap'
import { deferredCallback, uuidv4 } from '@src/lib/utils'
import type { ConnectionManager } from '@src/network/connectionManager'
import { EngineDebugger } from '@src/lib/debugger'
import type {
  PlaneVisibilityMap,
  Selection,
  Selections,
} from '@src/machines/modelingSharedTypes'
import {
  processCodeMirrorRanges,
  type handleSelectionBatch as handleSelectionBatchFn,
  type processCodeMirrorRanges as processCodeMirrorRangesFn,
} from '@src/lib/selections'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

import {
  setSelectionFilter,
  setSelectionFilterToDefault,
} from '@src/lib/selectionFilterUtils'
import { history, redoDepth, undoDepth } from '@codemirror/commands'
import { syntaxTree } from '@codemirror/language'
import type { Diagnostic } from '@codemirror/lint'
import { forEachDiagnostic, setDiagnosticsEffect } from '@codemirror/lint'
import {
  Annotation,
  Compartment,
  EditorSelection,
  EditorState,
  Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import type { KeyBinding, ViewUpdate } from '@codemirror/view'
import { drawSelection, EditorView, keymap } from '@codemirror/view'
import type { StateFrom } from 'xstate'

import {
  addLineHighlight,
  addLineHighlightEvent,
} from '@src/editor/highlightextension'

import type {
  ModelingMachineEvent,
  modelingMachine,
} from '@src/machines/modelingMachine'
import { historyCompartment } from '@src/editor/compartments'
import { bracket } from '@src/lib/exampleKcl'
import toast from 'react-hot-toast'
import { computed, type Signal, signal } from '@preact/signals-core'
import {
  editorTheme,
  themeCompartment,
  appSettingsThemeEffect,
  settingsUpdateAnnotation,
} from '@src/editor/plugins/theme'
import { SceneEntities } from '@src/clientSideScene/sceneEntities'
import {
  createEmptyAst,
  setAstEffect,
  updateAstAnnotation,
} from '@src/editor/plugins/ast'
import {
  operationsAnnotation,
  operationsStateField,
  setOperationsEffect,
} from '@src/editor/plugins/operations'
import { setKclVersion } from '@src/lib/kclVersion'
import {
  baseEditorExtensions,
  cursorBlinkingCompartment,
  lineWrappingCompartment,
} from '@src/editor'
import type {
  ApiFile,
  SceneGraphDelta,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import {
  HistoryView,
  type TransactionSpecNoChanges,
} from '@src/editor/HistoryView'
import { fsHistoryExtension } from '@src/editor/plugins/fs'
import { createThumbnailPNGOnDesktop } from '@src/lib/screenshot'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import type { FileEntry, Project } from '@src/lib/project'
import { getStringAfterLastSeparator } from '@src/lib/paths'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import { isCodeTheSame, normalizeLineEndings } from '@src/lib/codeEditor'
import { getOppositeTheme, getResolvedTheme, type Themes } from '@src/lib/theme'
import {
  requestCameraReset,
  requestSkipExecution,
} from '@src/editor/plugins/execution'
import { requestWriteToFile } from '@src/editor/plugins/write'

interface ExecuteArgs {
  ast?: Node<Program>
  executionId?: number
}

type UpdateCodeEditorOptions = {
  shouldExecute: boolean
  shouldClearHistory: boolean
  /** Only has an effect if `shouldClearHistory` is `false`.
  if it is `true` then this will act as `false`. */
  shouldAddToHistory: boolean
  shouldWriteToDisk: boolean
  /** Only has an effect if `shouldExecute` is also `true`. */
  shouldResetCamera: boolean
}

// Each of our singletons has dependencies on _other_ singletons, so importing
// can easily become cyclic. Each will have its own Singletons type.
interface SystemDeps {
  wasmInstancePromise: Promise<ModuleType>
  settings: SettingsActorType
  commandBar: CommandBarActorType
  projectPath: Signal<string>
  engineCommandManager: ConnectionManager
  rustContext: RustContext
}

export enum KclManagerEvents {
  LongExecution = 'long-execution',
}

declare global {
  interface Window {
    EditorSelection: typeof EditorSelection
    EditorView: typeof EditorView
  }
}

// We need to be able to create these during tests dynamically (via
// page.evaluate) So that's why this exists.
window.EditorSelection = EditorSelection
window.EditorView = EditorView

/**
 * A project contains 0 or more editors, one of which is the "executing" one
 * that connects to the geometry engine.
 */
export class ZDSProject {
  private nextFileId = 0
  files: File[] = []
  get path() {
    return this.projectIORefSignal.value.path
  }
  get name() {
    return this.projectIORefSignal.value.name
  }
  /** Editors are referenced via Signal in case the file name itself is changed. */
  public editors = new Map<Signal<string>, KclManager>()
  #executingPath = signal<Signal<string> | null>(null)
  public executingEditor = computed(() =>
    this.#executingPath.value
      ? this.editors.get(this.#executingPath.value)
      : null
  )
  /** The currently-executing file's info as a FileEntry */
  executingFileEntry = computed<FileEntry>(() => ({
    name: getStringAfterLastSeparator(this.#executingPath.value?.value ?? ''),
    path: this.#executingPath.value?.value ?? '',
    children: [],
  }))

  private fileWatcherId = uuidv4()

  constructor(
    public projectIORefSignal: Signal<Project>,
    private app: App
  ) {
    this.files = this.collectProjectFiles(projectIORefSignal.value)
    window.electron?.watchFileOn(
      projectIORefSignal.value.path,
      this.fileWatcherId,
      this.onUpdateFromDisk
    )
  }

  /** Clean up resources and watchers for Project */
  public close() {
    this.closeAllEditors()
    window.electron?.watchFileOff(
      this.projectIORefSignal.value.path,
      this.fileWatcherId
    )
  }

  /** Open a project, with the option to open an initial editor too */
  static async open(projectRef: Signal<Project>, app: App) {
    return new ZDSProject(projectRef, app)
  }

  get executingPath() {
    return this.#executingPath.value?.value ?? null
  }
  get executingPathSignal() {
    return this.#executingPath
  }
  set executingPath(newPath: string | null) {
    // TODO: Clear current executing editor's execution status

    if (newPath === null) {
      return
    }
    const foundPathSignal = this.findEditor(newPath)
    if (!foundPathSignal) {
      return
    }
    const found = foundPathSignal[1]
    if (found) {
      // TODO: Reconfigure the editor to be an executing one
    }
    this.#executingPath.value = foundPathSignal[0]
  }
  findEditor(path: string) {
    return this.editors
      .entries()
      .toArray()
      .find(([p]) => p.value === path)
  }

  // Saving some keystrokes
  private set = this.editors.set.bind(this.editors)

  async openEditor(
    path: string,
    /** TODO: Remove providedEditor, replace with options about if the editor is the executing one
     * once the app can handle not having a KclManager.
     */
    providedEditor?: KclManager,
    /** TODO: Remove `providedCode` once no tests rely on initializing
     * editor state through localstorage.
     */
    providedCode?: string,
    isExecuting = true
  ) {
    const foundEditor = this.findEditor(path)
    const found = foundEditor?.[1]
    if (found) {
      console.warn(`Attempted to overwrite editor with path "${path}"`)
      return found
    }

    const systemDeps: SystemDeps = {
      wasmInstancePromise: this.app.wasmPromise,
      commandBar: this.app.commands.actor,
      settings: this.app.settings.actor,
      engineCommandManager: this.app.engineCommandManager,
      rustContext: this.app.rustContext,
      projectPath: computed(() => this.projectIORefSignal.value.path),
    }

    if (providedEditor) {
      providedEditor.systemDeps.projectPath = systemDeps.projectPath
    }

    const foundFileIndex = this.files.findIndex((f) => f.path === path)
    const newEditor = await KclManager.fromFile(
      foundFileIndex > -1
        ? this.files[foundFileIndex]
        : new File(path, this.nextFileId++),
      systemDeps,
      providedEditor,
      providedCode
    )

    // Splice our new editor into our files array
    if (foundFileIndex > -1) {
      this.files[foundFileIndex] = newEditor
    } else {
      // We must be opening a new file as an editor
      this.files = [...this.files, newEditor]
    }

    newEditor.path = path

    // Initialize the editor theme
    // Subsequent changes are listened for within app.onSettingsUpdate()
    // TODO: Disassemble onSettingsUpdate, subscribe to changes from subsystems
    newEditor
      .updateTheme(
        getSettingsFromActorContext(this.app.settings.actor).app.theme.current
      )
      .catch(reportRejection)

    this.set(signal(path), newEditor)

    // Initialize a snapshot of the project for Rust
    // to have for executions and code mods
    markOnce('project/startCollectFiles')
    const apiFiles = await this.getAllKclFiles()
    if (err(apiFiles)) {
      reportRejection(apiFiles)
      return newEditor
    }
    markOnce('project/endCollectFiles')

    markOnce('project/startSendProjectToWasm')
    await newEditor.rustContext
      .sendOpenProject(path, apiFiles)
      .catch(reportRejection)
    markOnce('project/endSendProjectToWasm')

    if (isExecuting) {
      this.executingPath = path
    }
    return newEditor
  }

  closeEditor(path: string) {
    const foundPathSignal = this.findEditor(path)
    if (!foundPathSignal) {
      console.warn(`Attempted to close nonexistent editor with path "${path}"`)
      return
    }
    foundPathSignal[1].close()
    this.editors.delete(foundPathSignal[0])
  }

  closeAllEditors() {
    for (const editor of this.editors.values()) {
      editor.close()
    }
    this.editors.clear()
  }

  /** Handle updates from the disk representation of the project */
  private onUpdateFromDisk = (eventType: string, path: string) => {
    const foundEditorKey = this.editors
      .keys()
      .toArray()
      .find((pathSignal) => pathSignal.value === path)

    // We ignore all currently-opened editors. The project watcher is meant
    // only to notify about the rest of the project's updates, and pass them
    // into the currently-executing editor.
    if (foundEditorKey) {
      return
    }

    const editor = this.executingEditor.value
    const foundFile = this.files.find((f) => f.path === path)

    if (path.endsWith('.kcl')) {
      switch (eventType) {
        case 'add':
          const newFile = new File(path, this.nextFileId++)
          this.files.push(newFile)
          newFile
            .asRustApiFile()
            .then((file) => editor?.rustContext.sendAddFile(file))
            .catch(reportRejection)
          break
        case 'change':
          if (foundFile && path !== this.executingPath) {
            foundFile
              .read()
              .then((text) =>
                editor?.rustContext.sendUpdateFile(foundFile.id, text)
              )
              .catch(reportRejection)
          }
          break
        case 'unlink':
          const foundIndex = this.files.findIndex((f) => f.path === path)
          if (foundIndex >= 0 && path !== this.executingPath && foundFile) {
            this.files = this.files.filter((_, i) => i !== foundIndex)
            editor?.rustContext
              .sendRemoveFile(foundFile.id)
              .catch(reportRejection)
          }
      }
    }
  }

  /** Recursively gather KCL files in this project, without reading in their content */
  private collectProjectFiles = (
    fileOrDir: FileEntry,
    files: File[] = []
  ): File[] => {
    if (fileOrDir.children) {
      for (let entry of fileOrDir.children) {
        if (entry.name.endsWith('.kcl')) {
          const id = this.nextFileId++
          const path = entry.path
          files.push(new File(path, id))
        } else {
          this.collectProjectFiles(entry, files)
        }
      }
    }

    return files
  }

  /** Get all the KCL files in this project as a flat array. */
  private getAllKclFiles(): Promise<ApiFile[]> {
    return Promise.all(this.files.map((f) => f.asRustApiFile()))
  }
}

const PERSIST_CODE_KEY = 'persistCode'

const keymapCompartment = new Compartment()

const updateOutsideEditorAnnotation = Annotation.define<boolean>()
export const updateOutsideEditorEvent = updateOutsideEditorAnnotation.of(true)

const modelingMachineAnnotation = Annotation.define<boolean>()
export const modelingMachineEvent = modelingMachineAnnotation.of(true)

const setDiagnosticsAnnotation = Annotation.define<boolean>()
export const setDiagnosticsEvent = setDiagnosticsAnnotation.of(true)

export const hotkeyRegisteredAnnotation = Annotation.define<string>()

export class File extends EventTarget {
  /** Path to file this editor is operating on */
  private pathSignal: Signal<string>
  private fileWatcherKey = uuidv4()
  public watching: boolean = false
  /** Array of listeners. TODO: Make this a CodeMirror-like Facet */
  public onWatchEvent: ((eventType: string, path: string) => void)[] = [
    () => ({}),
  ]
  get path() {
    return this.pathSignal.value
  }
  set path(newPath: string) {
    const wasWatching = this.watching
    if (wasWatching) {
      this.unwatch()
    }

    // Set pathSignal before calling this.watch() as it uses the path!
    this.pathSignal.value = newPath

    // Don't watch empty file paths, that's the whole file system!
    if (wasWatching && newPath.length > 0) {
      this.watch()
    }
  }

  read() {
    return File.ioImplementations.read(this.pathSignal.value)
  }

  write(newContent: string) {
    return File.ioImplementations.write(this.pathSignal.value, newContent)
  }

  watch() {
    if (this.watching || this.path.length < 1) {
      return
    }
    File.ioImplementations.watch(this.path, this.fileWatcherKey, (e, p) => {
      this.onWatchEvent.map((f) => f(e, p))
    })
    this.watching = true
  }

  unwatch() {
    if (!this.watching) {
      return
    }
    File.ioImplementations.unwatch(this.path, this.fileWatcherKey)
    this.watching = false
  }

  constructor(
    path: string,
    public id = 0
  ) {
    super()
    this.pathSignal = signal(path)
  }

  /** Present file data in format that RUST-WASM side needs it */
  async asRustApiFile(): Promise<ApiFile> {
    return this.read().then((text) => ({
      id: this.id,
      path: this.pathSignal.value,
      text,
    }))
  }

  /** Allows environments to swap their implementation of these IO-interfacing functions */
  static ioImplementations = {
    read: (path: string) => fsZds.readFile(path, 'utf8'),
    write: (path: string, content: string) =>
      fsZds.writeFile(path, File.encoder.encode(content)),
    watch: window.electron?.watchFileOn || (() => {}),
    unwatch: window.electron?.watchFileOff || (() => {}),
  }
  static encoder = new TextEncoder()
}

export class KclManager extends File {
  // SYSTEM DEPENDENCIES

  private _wasmInstance: ModuleType | null = null
  /** in the case of WASM crash, we should ensure the new refreshed WASM module is held here. */
  get wasmInstancePromise() {
    return this.systemDeps.wasmInstancePromise
  }
  set wasmInstancePromise(newInstancePromise: Promise<ModuleType>) {
    this.systemDeps.wasmInstancePromise = newInstancePromise
    void this.systemDeps.wasmInstancePromise.then((instance) => {
      this._wasmInstance = instance
    })
  }
  /**
   * You probably should use `wasmInstancePromise` instead.
   *
   * This is for when you need the wasm instance in synchronous time,
   * you can't make it asynchronous,
   * and for some reason you can absolutely guarantee WASM will be done initializing.
   */
  get wasmInstance(): ModuleType {
    if (this._wasmInstance === null) {
      // eslint-disable-next-line  suggest-no-throw/suggest-no-throw
      throw new Error('Attempted to get wasmInstance before initialization')
    }
    return this._wasmInstance
  }
  readonly systemDeps: SystemDeps
  private _modelingSend: (eventInfo: ModelingMachineEvent) => void = () => {}
  private _modelingState: StateFrom<typeof modelingMachine> | null = null

  // CORE STATE

  private readonly _editorView: EditorView
  private readonly _globalHistoryView: HistoryView

  /**
   * The core state in KclManager are the code and the selection.
   * all other state should be derived from the code or selection in some way.
   */
  private _code = signal(bracket)
  lastSuccessfulCode: string = ''
  get code(): string {
    return this.editorView.state.doc.toString()
  }
  get codeSignal() {
    return this._code
  }

  // Derived state
  sceneEntitiesManager: SceneEntities
  sceneInfra: SceneInfra
  rustContext: RustContext
  engineCommandManager: ConnectionManager

  /** The Abstract Syntax Tree generated from parsing the KCL code */
  private _ast = signal<Node<Program>>(createEmptyAst())
  _lastAst: Node<Program> = createEmptyAst()
  get ast() {
    return this._ast.value
  }
  get astSignal() {
    return this._ast
  }
  set ast(ast) {
    if (this._ast.value.body.length !== 0) {
      // last intact ast, if the user makes a typo with a syntax error, we want to keep the one before they made that mistake
      this._lastAst = structuredClone(this._ast.value)
    }
    this._ast.value = ast
    this.dispatchUpdateAst(ast)
  }
  livePathsToWatch = signal<string[]>([])

  private _execState = signal<ExecState>(emptyExecState())

  private _variables = signal<VariableMap>({})
  lastSuccessfulVariables: VariableMap = {}
  lastSuccessfulOperations: Operation[] = []
  private _logs = signal<string[]>([])
  private _errors = signal<KCLError[]>([])
  private _diagnostics = signal<Diagnostic[]>([])
  private _lastEvent: { event: string; time: number } | null = null
  private _highlightRange: Array<[number, number]> = [[0, 0]]
  /** a representation of selections used by modelingMachine */
  private _selectionRanges: Selections = {
    otherSelections: [],
    graphSelections: [],
  }
  undoDepth = signal(0)
  redoDepth = signal(0)
  undoListenerEffect = EditorView.updateListener.of((vu) => {
    this.undoDepth.value =
      undoDepth(vu.state) + undoDepth(this._globalHistoryView.state)
    this.redoDepth.value =
      redoDepth(vu.state) + redoDepth(this._globalHistoryView.state)
  })
  get operations() {
    return this._editorView.state.field(operationsStateField)
  }
  /**
   * A client-side representation of the commands that have been sent,
   * the geometry they represent, and the connections between them.
   *
   * see: src/lang/std/artifactGraph-README.md for a full explanation.
   */
  artifactGraph: ArtifactGraph = new Map()
  artifactIndex: ArtifactIndex = []

  // INTERNAL BOOKKEEPING STATE

  /**
   * Watching the file system for updates and reacting to them.
   * TODO: might need to watch for deletions here or in the project eventually.
   * It's currently handled elsewhere in SystemIOMachine I believe.
   *
   * NOTE: This listener is in *addition* to the base File class one, so it must have a distinct name and
   * In future, event listeners like `onWatchEvent` should be Facets in the CodeMirror sense.
   */
  #onWatchEvent = (_eventType: string, path: string) => {
    // TODO: We can remove this once we make it impossible to have
    // a KclManager without a ZDSProject.
    if (
      path !== this.path ||
      !this.systemDeps.projectPath.value ||
      this.path.length < 1
    ) {
      return
    }
    // Your current file is changed, read it from disk and write it into the code manager and execute the AST,
    // unless the change was initiated by us (the currently running instance).
    File.ioImplementations
      .read(path)
      .then((code) => {
        const isInSketchMode =
          this.modelingState?.matches('Sketch') ||
          this.modelingState?.matches('sketchSolveMode')

        if (!isCodeTheSame(code, this.code)) {
          // Nothing written out yet by ourselves, or it's not the same as the current file content
          // -> this must be an external change -> re-execute.
          this.updateCodeEditor(code, {
            shouldExecute: !isInSketchMode,
            shouldResetCamera: !isInSketchMode,
            // We explicitly do not write to the file here since we are loading from
            // the file system and not the editor.
            shouldWriteToDisk: false,
          })

          toast('Reloading file from disk', { icon: '📁' })
        }
      })
      .catch(reportRejection)
  }
  private _wasmInitFailed = signal<boolean | undefined>(undefined)
  private _astParseFailed = false
  private _switchedFiles = false
  private _fileSettings: KclSettingsAnnotation = {}
  private _cancelTokens: Map<number, boolean> = new Map()
  private _executeIsStale: ExecuteArgs | null = null
  private _isExecuting = signal(false)
  get isExecuting() {
    return this._isExecuting.value
  }
  get isExecutingSignal() {
    return this._isExecuting
  }
  private _copilotEnabled: boolean = true
  private _isAllTextSelected: boolean = false
  private _isShiftDown: boolean = false
  private _kclVersion: string = ''
  private timeoutWriter: ReturnType<typeof setTimeout> | undefined = undefined
  private timeoutRewatch: ReturnType<typeof setTimeout> | undefined = undefined
  private executionTimeoutId: ReturnType<typeof setTimeout> | undefined =
    undefined
  public writeCausedByAppCheckedInFileTreeFileSystemWatcher = false
  public mlEphantManagerMachineBulkManipulatingFileSystem = false
  /**
    Indicator Promise that is pending while a live write is happening.
    If this value isn't `null`, don't watch for file system writes it was probably us!
   */
  public writingPromise = signal<Promise<unknown> | null>(null)
  sceneInfraBaseUnitMultiplierSetter: (unit: BaseUnit) => void = () => {}
  /** Values merged in from former EditorManager and CodeManager classes */
  private _convertToVariableEnabled: boolean = false
  private _convertToVariableCallback: () => void = () => {}

  // CONFIGURATION

  /** In the future this could be a setting. */
  public longExecutionTimeMs = 1000 * 60 * 5
  private _hotkeys: { [key: string]: () => void } = {
    ['Ctrl-Shift-c']: () => this.convertToVariable(),
    ['Alt-Shift-f']: () => {
      void this.format().catch(reportRejection)
    },
  }

  set switchedFiles(switchedFiles: boolean) {
    this._switchedFiles = switchedFiles

    // These belonged to the previous file
    this.lastSuccessfulOperations = []
    this.lastSuccessfulCode = ''
    this.lastSuccessfulVariables = {}

    // Without this, when leaving a project which has errors and opening another project which doesn't,
    // you'd see the errors from the previous project for a short time until the new code is executed.
    this.errors = []
  }

  get variables() {
    return this._variables.value
  }
  /** get entire signal for use in React. A plugin transforms its use there */
  get variablesSignal() {
    return this._variables
  }
  // This is private because callers should be setting the entire execState.
  private set variables(variables) {
    this._variables.value = variables
  }

  private set execState(execState) {
    this._execState.value = execState
    this.variables = execState.variables
  }

  get execState() {
    return this._execState.value
  }
  get execStateSignal() {
    return this._execState
  }

  // Get the kcl version from the wasm module
  // and store it in the singleton
  // so we don't waste time getting it multiple times
  get kclVersion() {
    if (this._kclVersion === undefined) {
      this._kclVersion = getKclVersion(this.wasmInstance)
      setKclVersion(this.kclVersion)
    }
    return this._kclVersion
  }

  get errors() {
    return this._errors.value
  }
  /** get entire signal for use in React. A plugin transforms its use there */
  get errorsSignal() {
    return this._errors
  }
  set errors(errors) {
    this._errors.value = errors
  }
  get logs() {
    return this._logs.value
  }
  /** get entire signal for use in React. A plugin transforms its use there */
  get logsSignal() {
    return this._logs
  }
  set logs(logs) {
    this._logs.value = logs
  }

  get diagnostics() {
    return this._diagnostics.value
  }
  /** get entire signal for use in React. A plugin transforms its use there */
  get diagnosticsSignal() {
    return this._diagnostics
  }

  set diagnostics(ds) {
    if (ds === this._diagnostics.value) return
    this._diagnostics.value = ds
    this.setDiagnosticsForCurrentErrors()
  }

  addDiagnostics(ds: Diagnostic[]) {
    if (ds.length === 0) return
    this.diagnostics = this.diagnostics.concat(ds)
  }

  hasErrors(): boolean {
    return this._astParseFailed || this.errors.length > 0
  }

  setDiagnosticsForCurrentErrors() {
    this.setDiagnostics(this.diagnostics)
  }

  set isExecuting(isExecuting) {
    this._isExecuting.value = isExecuting
    // If we have finished executing, but the execute is stale, we should
    // execute again.
    if (!isExecuting && this.executeIsStale && this.sceneEntitiesManager) {
      const args = this.executeIsStale
      this.executeIsStale = null
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.executeAst(args)
    }
  }

  get executeIsStale() {
    return this._executeIsStale
  }

  set executeIsStale(executeIsStale) {
    this._executeIsStale = executeIsStale
    // Next execution will be flagged as stale or not depending on this value.
    this.systemDeps.engineCommandManager.executionIsStale =
      executeIsStale !== null
  }

  get wasmInitFailed() {
    return this._wasmInitFailed.value
  }
  /** get entire signal for use in React. A plugin transforms its use there */
  get wasmInitFailedSignal() {
    return this._wasmInitFailed
  }
  set wasmInitFailed(wasmInitFailed) {
    this._wasmInitFailed.value = wasmInitFailed
  }

  /**
   * This is a CodeMirror extension that listens for selection events
   * and fires off engine commands to highlight the corresponding engine entities.
   * It is not debounced.
   */
  private highlightEngineEntitiesEffect = EditorView.updateListener.of(
    (update: ViewUpdate) => {
      if (update.transactions.some((tr) => tr.isUserEvent('select'))) {
        this.wasmInstancePromise
          .then((wasmInstance) =>
            this.handleOnViewUpdate(
              update,
              processCodeMirrorRanges,
              wasmInstance
            )
          )
          .catch(reportRejection)
      }
    }
  )

  private syncCodeSignalToDoc = EditorView.updateListener.of((update) => {
    if (update.docChanged) {
      const newCode = update.view.state.doc.toString()
      this._code.value = newCode
      this.rustContext.sendUpdateFile(this.id, newCode).catch(reportRejection)
    }
  })

  /**
   * code mirror extension that clears modeling selection state when the document is empty
   */
  private clearSelectionsOnEmptyDoc = EditorView.updateListener.of((update) => {
    // The doc changed and the new code is the empty string
    if (update.docChanged) {
      const newCode = update.view.state.doc.toString()
      if (newCode === '') {
        this.sendModelingEvent({
          type: 'Set selection',
          data: { selection: undefined, selectionType: 'singleCodeCursor' },
        })
      }
    }
  })

  /**
   * This is a CodeMirror extension that watches for updates to the document,
   * discerns if the change is a kind that we want to re-execute on,
   * then fires (and forgets) an execution with a debounce.
   */
  private executeKclEffect = EditorView.updateListener.of((update) => {
    const notIgnoredUpdate =
      this.engineCommandManager.connection?.connected && update.docChanged

    const shouldResetCamera = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(requestCameraReset) && e.value)
    )

    if (notIgnoredUpdate) {
      const newCode = update.state.doc.toString()

      const hasSkipExecutionAnnotation = update.transactions.some((tr) =>
        tr.effects.some((e) => e.is(requestSkipExecution) && e.value)
      )
      if (!hasSkipExecutionAnnotation) {
        this.deferredExecution({ newCode, shouldResetCamera })
      }
    }
  })

  private deferredExecution = deferredCallback(
    async ({
      newCode,
      shouldResetCamera,
    }: { newCode: string; shouldResetCamera: boolean }) => {
      // If we're in sketchSolveMode, update Rust state with the latest AST
      // This handles the case where the user directly edits in the CodeMirror editor
      // these are short term hacks while in rapid development for sketch revamp
      // should be clean up.
      try {
        if (this.modelingState?.matches('sketchSolveMode')) {
          await this.executeCode(newCode)
          const setProgramOutcome = await this.rustContext.hackSetProgram(
            this.ast,
            jsAppSettings(this.systemDeps.settings)
          )

          if (setProgramOutcome.type === 'Success') {
            // Convert SceneGraph to SceneGraphDelta and send to sketch solve machine
            // Always invalidate IDs for direct edits since we don't know what the user changed
            const sceneGraphDelta: SceneGraphDelta = {
              new_graph: setProgramOutcome.sceneGraph,
              new_objects: [],
              invalidates_ids: true,
              exec_outcome: setProgramOutcome.execOutcome,
            }

            const kclSource: SourceDelta = {
              text: newCode,
            }

            // Send event to sketch solve machine via modeling machine
            this.sendModelingEvent({
              type: 'update sketch outcome',
              data: {
                sourceDelta: kclSource,
                sceneGraphDelta,
              },
            })
          } else {
            console.debug(
              'Error when executing after user edit:',
              setProgramOutcome
            )
          }
        } else {
          await this.executeCode(newCode)
          if (shouldResetCamera) {
            await resetCameraPosition({
              sceneInfra: this.sceneInfra,
              engineCommandManager: this.engineCommandManager,
              settingsActor: this.systemDeps.settings,
            })
          }
        }
      } catch (error) {
        console.error('Error when updating Rust state after user edit:', error)
      }
    },
    1000
  )

  private writeToFileListener = EditorView.updateListener.of((update) => {
    const hasWriteToFileEffect = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(requestWriteToFile) && e.value)
    )
    const notIgnoredUpdate =
      this.engineCommandManager.started &&
      update.docChanged &&
      update.transactions.some((tr) => {
        const ignoredEvents = [
          tr.annotation(updateOutsideEditorEvent.type),
          tr.annotation(hotkeyRegisteredAnnotation),
        ]

        return !ignoredEvents.some((v) => Boolean(v))
      })

    const shouldWriteToFile = hasWriteToFileEffect || notIgnoredUpdate

    if (shouldWriteToFile) {
      // We don't want to block on writing to file
      void this.writeToFile(update.state.doc.toString())
    }
  })

  private createEditorExtensions() {
    return [
      baseEditorExtensions(),
      keymapCompartment.of(keymap.of(this.getCodemirrorHotkeys())),
      this.highlightEngineEntitiesEffect,
      this.undoListenerEffect,
      this.syncCodeSignalToDoc,
      this.executeKclEffect,
      this.writeToFileListener,
      this.clearSelectionsOnEmptyDoc,
    ]
  }
  private createEditorView(initialCode = '') {
    return new EditorView({
      state: EditorState.create({
        doc: initialCode,
        extensions: this.createEditorExtensions(),
      }),
    })
  }

  /**
   * Upgrade a File to an Editor, reading its contents for the initial editor state.
   * TODO: Remove providedEditor once the app can handle an undefined currently-executing editor.
   */
  static async fromFile(
    file: File,
    systemDeps: SystemDeps,
    providedEditor?: KclManager,
    providedCode?: string
  ) {
    const initialCode = normalizeLineEndings(
      providedCode || (await file.read())
    )

    if (!providedEditor) {
      return new KclManager(file.path, initialCode, systemDeps, file.id)
    }

    // TODO: remove all this once the app can handle an undefined currently-executing editor
    providedEditor.path = file.path
    providedEditor.id = file.id
    providedEditor.codeSignal.value = initialCode
    providedEditor.updateCodeEditor(initialCode, {
      shouldExecute: providedEditor.engineCommandManager.connection?.connected,
      // This way undo and redo are not super weird when opening new files.
      shouldClearHistory: true,
      shouldResetCamera: true,
      // We explicitly do not write to the file here since we are loading from
      // the file system and not the editor.
      shouldWriteToDisk: false,
    })
    return providedEditor
  }

  constructor(
    path: string,
    initialCode: string,
    systemDeps: SystemDeps,
    fileId = 0
  ) {
    super(path, fileId)
    // Register our additional, KclManager-specific watch event handler
    this.onWatchEvent.push(this.#onWatchEvent)
    this.systemDeps = systemDeps
    const getSettings = () =>
      getSettingsFromActorContext(this.systemDeps.settings)
    this.engineCommandManager = this.systemDeps.engineCommandManager
    this.rustContext = this.systemDeps.rustContext
    this.sceneInfra = new SceneInfra(
      this.engineCommandManager,
      systemDeps.wasmInstancePromise,
      getSettings
    )
    this.sceneEntitiesManager = new SceneEntities(
      this.engineCommandManager,
      this.sceneInfra,
      this,
      this.rustContext,
      this.systemDeps.commandBar,
      getSettings
    )

    this._globalHistoryView = new HistoryView([fsHistoryExtension()])
    this._editorView = this.createEditorView(initialCode)
    // TODO: Delete this._code, only derive from the editorView's doc
    this._code.value = initialCode
    this._globalHistoryView.registerLocalHistoryTarget(this._editorView)

    this.systemDeps.wasmInstancePromise
      .then(async (wasmInstance) => {
        this._kclVersion = getKclVersion(wasmInstance)
        if (typeof wasmInstance === 'string') {
          this.wasmInitFailed = true
        } else {
          await this.safeParse(this.code, wasmInstance).then((ast) => {
            if (ast) {
              this.ast = ast
              // on setup, set _lastAst so it's populated.
              this._lastAst = ast
            }
          })
        }
      })
      .catch((e) => {
        this._wasmInitFailed.value = true
        reportRejection(e)
      })
  }

  /** Clean up listeners, watchers, etc */
  public close() {
    clearTimeout(this.timeoutWriter)
    clearTimeout(this.timeoutRewatch)
    this.unwatch()
  }

  clearAst() {
    this.ast = {
      body: [],
      shebang: null,
      start: 0,
      end: 0,
      moduleId: 0,
      nonCodeMeta: {
        nonCodeNodes: {},
        startNodes: [],
      },
      innerAttrs: [],
      outerAttrs: [],
      preComments: [],
      commentStart: 0,
    }
  }

  // (jess) I'm not in love with this, but it ensures we clear the scene and
  // bust the cache on
  // errors from parsing when opening new files.
  // Why not just clear the cache on all parse errors, you ask? well its actually
  // really nice to keep the cache on parse errors within the same file, and
  // only bust on engine errors esp if they take a long time to execute and
  // you hit the wrong key!
  private async checkIfSwitchedFilesShouldClear() {
    // If we were switching files and we hit an error on parse we need to bust
    // the cache and clear the scene.
    if (this._astParseFailed && this._switchedFiles) {
      await this.rustContext.clearSceneAndBustCache(
        jsAppSettings(this.systemDeps.settings),
        this.path
      )
    } else if (this._switchedFiles) {
      // Reset the switched files boolean.
      this._switchedFiles = false
    }
  }

  /**
   */
  private dispatchUpdateOperations(newOperations: Operation[]) {
    this.editorView.dispatch({
      effects: [setOperationsEffect.of(newOperations)],
      annotations: [
        operationsAnnotation.of(true),
        Transaction.addToHistory.of(false),
      ],
    })
  }

  /**
   * Dispatches a CodeMirror state effect to update the AST
   * stored on the current EditorView.
   *
   * TODO: not used yet. Wire up the system to look to this version of the AST
   * when we consolidate all editor state within CodeMirror.
   */
  private dispatchUpdateAst(newAst: Node<Program>) {
    // Push the artifact graph into the editor state so annotations/decorations update
    this.editorView.dispatch({
      effects: [setAstEffect.of(newAst)],
      annotations: [
        updateAstAnnotation.of(true),
        Transaction.addToHistory.of(false),
      ],
    })
  }

  private async updateArtifactGraph(
    execStateArtifactGraph: ExecState['artifactGraph']
  ) {
    this.artifactGraph = execStateArtifactGraph
    this.artifactIndex = buildArtifactIndex(execStateArtifactGraph)

    // Push the artifact graph into the editor state so annotations/decorations update
    const editorView = this.editorView
    if (editorView) {
      editorView.dispatch({
        effects: [setArtifactGraphEffect.of(this.artifactGraph)],
        annotations: [
          artifactAnnotationsEvent,
          Transaction.addToHistory.of(false),
        ],
      })
    }
    if (this.artifactGraph.size) {
      // TODO: we wanna remove this logic from xstate, it is racey
      // This defer is bullshit but playwright wants it
      // It was like this in engineConnection.ts already
      deferredCallback((_a?: null) => {
        this.engineCommandManager.modelingSend({
          type: 'Artifact graph populated',
        })
      }, 200)(null)
    } else {
      deferredCallback((_a?: null) => {
        this.engineCommandManager.modelingSend({
          type: 'Artifact graph emptied',
        })
      }, 200)(null)
    }

    // Send the 'artifact graph initialized' event for modelingMachine, only once, when default planes are also initialized.
    deferredCallback((_a?: null) => {
      if (this.defaultPlanes) {
        this.engineCommandManager.modelingSend({
          type: 'Artifact graph initialized',
        })
      }
    }, 200)(null)
  }

  async safeParse(
    code: string,
    wasmInstance: Promise<ModuleType> | ModuleType = this.wasmInstancePromise
  ): Promise<Node<Program> | null> {
    const result = parse(code, await wasmInstance)
    this.diagnostics = []
    this._astParseFailed = false

    if (err(result)) {
      const kclError: KCLError = result as KCLError
      this.diagnostics = kclErrorsToDiagnostics([kclError], code)
      this._astParseFailed = true

      await this.checkIfSwitchedFilesShouldClear()
      return null
    }

    // GOTCHA:
    // When we safeParse this is tied to execution because they clicked a new file to load
    // Clear all previous errors and logs because they are old since they executed a new file
    // If we decouple safeParse from execution we need to move this application logic.
    this.errors = []
    this.logs = []

    this.addDiagnostics(compilationErrorsToDiagnostics(result.errors, code))
    this.addDiagnostics(compilationErrorsToDiagnostics(result.warnings, code))
    if (result.errors.length > 0) {
      this._astParseFailed = true

      await this.checkIfSwitchedFilesShouldClear()
      return null
    }

    return result.program
  }

  // This NEVER updates the code, if you want to update the code DO NOT add to
  // this function, too many other things that don't want it exist. For that,
  // use updateModelingState().
  async executeAst(args: ExecuteArgs = {}): Promise<void> {
    if (!this.engineCommandManager.started) {
      console.warn('`executeAst` called before engine connection started')
      return
    }
    if (this.isExecuting) {
      this.executeIsStale = args

      // The previous executeAst will be rejected and cleaned up. The execution will be marked as stale.
      // A new executeAst will start.
      this.engineCommandManager.rejectAllModelingCommands(
        EXECUTE_AST_INTERRUPT_ERROR_MESSAGE
      )
      // Exit early if we are already executing.
      return
    }

    const ast = args.ast || this.ast
    markOnce('code/startExecuteAst')

    const currentExecutionId = args.executionId || Date.now()
    this._cancelTokens.set(currentExecutionId, false)

    this.isExecuting = true

    const codeThatExecuted = this.code
    const { logs, errors, execState, isInterrupted } = await executeAst({
      ast,
      path: this.path,
      rustContext: this.rustContext,
    })

    const livePathsToWatch = Object.values(execState.filenames)
      .filter((file) => {
        return file?.type === 'Local'
      })
      .map((file) => {
        return file.value
      })
    this.livePathsToWatch.value = livePathsToWatch

    // Program was not interrupted, setup the scene
    // Do not send send scene commands if the program was interrupted, go to clean up
    if (!isInterrupted) {
      this.addDiagnostics(
        await lintAst({
          ast,
          sourceCode: this.code,
          instance: await this.systemDeps.wasmInstancePromise,
          rustContext: this.rustContext,
        })
      )
      if (this.sceneEntitiesManager) {
        setSelectionFilterToDefault({
          engineCommandManager: this.engineCommandManager,
          kclManager: this,
          sceneEntitiesManager: this.sceneEntitiesManager,
          wasmInstance: await this.systemDeps.wasmInstancePromise,
        })
      }
    }

    this.isExecuting = false

    // Check the cancellation token for this execution before applying side effects
    if (this._cancelTokens.get(currentExecutionId)) {
      this._cancelTokens.delete(currentExecutionId)
      return
    }

    let fileSettings = getSettingsAnnotation(
      ast,
      await this.wasmInstancePromise
    )
    if (err(fileSettings)) {
      fileSettings = {}
    }
    this.fileSettings = fileSettings

    this.logs = logs
    this.errors = errors
    const code = this.code
    // Do not add the errors since the program was interrupted and the error is not a real KCL error
    this.addDiagnostics(
      isInterrupted ? [] : kclErrorsToDiagnostics(errors, code)
    )
    // Add warnings and non-fatal errors
    this.addDiagnostics(
      isInterrupted
        ? []
        : compilationErrorsToDiagnostics(execState.errors, code)
    )
    this.execState = execState
    if (!errors.length) {
      this.lastSuccessfulVariables = execState.variables
      this.lastSuccessfulOperations = execState.operations
      this.lastSuccessfulCode = codeThatExecuted
    }
    this.ast = structuredClone(ast)
    // updateArtifactGraph relies on updated executeState/variables
    await this.updateArtifactGraph(execState.artifactGraph)
    this.dispatchUpdateOperations(execState.operations)

    if (!isInterrupted) {
      this.sceneInfra.modelingSend({
        type: 'code edit during sketch',
      })
    }
    EngineDebugger.addLog({
      label: 'executeAst',
      message: 'execution done',
    })
    this.engineCommandManager.addCommandLog({
      type: CommandLogType.ExecutionDone,
      data: null,
    })

    this._cancelTokens.delete(currentExecutionId)
    markOnce('code/endExecuteAst')

    // Update project thumbnail after successful execution
    if (!isInterrupted && errors.length === 0 && projectFsManager.dir) {
      createThumbnailPNGOnDesktop({
        projectDirectoryWithoutEndingSlash: projectFsManager.dir,
      })
    }
  }

  /**
   * This cleanup function is external and internal to the KclSingleton class.
   * Since the WASM runtime can panic and the error cannot be caught in executeAst
   * we need a global exception handler in exceptions.ts
   * This file will interface with this cleanup as if it caught the original error
   * to properly restore the TS application state.
   */
  executeAstCleanUp() {
    this.isExecuting = false
    this.executeIsStale = null
    this.engineCommandManager.addCommandLog({
      type: CommandLogType.ExecutionDone,
      data: null,
    })
    markOnce('code/endExecuteAst')
  }

  // DO NOT CALL THIS from codemirror ever.
  async executeAstMock(ast: Program): Promise<null | Error> {
    const newCode = recast(ast, await this.wasmInstancePromise)
    if (err(newCode)) {
      console.error(newCode)
      return newCode
    }
    const newAst = await this.safeParse(newCode)

    if (!newAst) {
      // By clearing the AST we indicate to our callers that there was an issue with execution and
      // the pre-execution state should be restored.
      this.clearAst()
      return new Error('failed to re-parse')
    }
    this.ast = { ...newAst }

    const codeThatExecuted = this.code
    const { logs, errors, execState } = await executeAstMock({
      ast: newAst,
      rustContext: this.rustContext,
    })

    this.logs = logs
    this._execState.value = execState
    this._variables.value = execState.variables
    if (!errors.length) {
      this.lastSuccessfulVariables = execState.variables
      this.lastSuccessfulOperations = execState.operations
      this.lastSuccessfulCode = codeThatExecuted
    }
    await this.updateArtifactGraph(execState.artifactGraph)
    return null
  }
  cancelAllExecutions() {
    this._cancelTokens.forEach((_, key) => {
      this._cancelTokens.set(key, true)
    })
  }
  async executeCode(newCode = this.codeSignal.value): Promise<void> {
    if (!this.engineCommandManager.started) {
      console.warn('`executeCode` called before engine connection started')
      return
    }
    const ast = await this.safeParse(newCode, await this.wasmInstancePromise)

    if (!ast) {
      // By clearing the AST we indicate to our callers that there was an issue with execution and
      // the pre-execution state should be restored.
      this.clearAst()
      return
    }
    clearTimeout(this.executionTimeoutId)

    // We consider anything taking longer than 5 minutes a long execution.
    this.executionTimeoutId = setTimeout(() => {
      if (!this.isExecuting) {
        clearTimeout(this.executionTimeoutId)
        return
      }

      this.dispatchEvent(new CustomEvent(KclManagerEvents.LongExecution, {}))
    }, this.longExecutionTimeMs)

    return this.executeAst({ ast })
  }

  async format() {
    const originalCode = this.code
    const ast = await this.safeParse(originalCode)
    if (!ast) {
      this.clearAst()
      return
    }
    const code = recast(ast, await this.wasmInstancePromise)
    if (err(code)) {
      console.error(code)
      return
    }
    if (originalCode === code) return

    // Update the code state and the editor.
    this.updateCodeEditor(code, { shouldExecute: true })
  }

  // There's overlapping responsibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
  // This never updates the code state or editor and doesn't write to the file system.
  async updateAst(
    ast: Node<Program>,
    execute: boolean,
    optionalParams?: {
      focusPath?: Array<PathToNode>
    }
  ): Promise<{
    newAst: Node<Program>
    selections?: Selections
  }> {
    const newCode = recast(ast, await this.systemDeps.wasmInstancePromise)
    if (err(newCode)) return Promise.reject(newCode)

    const astWithUpdatedSource = await this.safeParse(newCode)
    if (!astWithUpdatedSource) return Promise.reject(new Error('bad ast'))
    let returnVal: Selections | undefined = undefined

    if (optionalParams?.focusPath) {
      returnVal = {
        graphSelections: [],
        otherSelections: [],
      }

      for (const path of optionalParams.focusPath) {
        const getNodeFromPathResult = getNodeFromPath<any>(
          astWithUpdatedSource,
          path,
          await this.wasmInstancePromise
        )
        if (err(getNodeFromPathResult))
          return Promise.reject(getNodeFromPathResult)
        const { node } = getNodeFromPathResult

        const { start, end } = node

        if (!start || !end)
          return {
            selections: undefined,
            newAst: astWithUpdatedSource,
          }

        if (start && end) {
          returnVal.graphSelections.push({
            codeRef: {
              range: topLevelRange(start, end),
              pathToNode: path,
            },
          })
        }
      }
    }

    if (execute) {
      await this.executeAst({
        ast: astWithUpdatedSource,
      })
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead..
      const didReParse = await this.executeAstMock(astWithUpdatedSource)
      if (err(didReParse)) return Promise.reject(didReParse)
    }

    return { selections: returnVal, newAst: astWithUpdatedSource }
  }

  get defaultPlanes() {
    return this.rustContext.defaultPlanes
  }

  showPlanes(all = false) {
    if (!this.defaultPlanes) return Promise.all([])
    const thePromises = [
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, false),
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, false),
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, false),
    ]
    if (all) {
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(
          this.defaultPlanes.negXy,
          false
        )
      )
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(
          this.defaultPlanes.negYz,
          false
        )
      )
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(
          this.defaultPlanes.negXz,
          false
        )
      )
    }
    return Promise.all(thePromises)
  }

  hidePlanes(all = false) {
    if (!this.defaultPlanes) return Promise.all([])
    const thePromises = [
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, true),
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, true),
      this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, true),
    ]
    if (all) {
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(this.defaultPlanes.negXy, true)
      )
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(this.defaultPlanes.negYz, true)
      )
      thePromises.push(
        this.engineCommandManager.setPlaneHidden(this.defaultPlanes.negXz, true)
      )
    }
    return Promise.all(thePromises)
  }

  setPlaneVisibilityByKey(
    planeKey: keyof PlaneVisibilityMap,
    visible: boolean
  ) {
    const planeId = this.defaultPlanes?.[planeKey]
    if (!planeId) {
      console.warn(`Plane ${planeKey} not found`)
      return
    }
    return this.engineCommandManager.setPlaneHidden(planeId, !visible)
  }

  /** TODO: this function is hiding unawaited asynchronous work */
  setSelectionFilterToDefault(
    wasmInstance: ModuleType,
    selectionsToRestore?: Selections,
    handleSelectionBatch?: typeof handleSelectionBatchFn
  ) {
    setSelectionFilterToDefault({
      engineCommandManager: this.engineCommandManager,
      kclManager: this,
      sceneEntitiesManager: this.sceneEntitiesManager,
      selectionsToRestore,
      handleSelectionBatchFn: handleSelectionBatch,
      wasmInstance,
    })
  }
  /** TODO: this function is hiding unawaited asynchronous work */
  setSelectionFilter(
    filter: EntityType[],
    wasmInstance: ModuleType,
    selectionsToRestore?: Selections,
    handleSelectionBatch?: typeof handleSelectionBatchFn
  ) {
    setSelectionFilter({
      filter,
      engineCommandManager: this.engineCommandManager,
      kclManager: this,
      sceneEntitiesManager: this.sceneEntitiesManager,
      selectionsToRestore,
      handleSelectionBatchFn: handleSelectionBatch,
      wasmInstance,
    })
  }

  // Determines if there is no KCL code which means it is executing a blank KCL file
  _isAstEmpty(ast: Node<Program>) {
    return ast.start === 0 && ast.end === 0 && ast.body.length === 0
  }

  /**
   * Determines if there is no code to execute. If there is a @settings annotation
   * that adds to the overall ast.start and ast.end but not the body which is the program
   *
   *
   * If you need to know if there is any program code or not, use this function otherwise
   * use _isAstEmpty
   */
  isAstBodyEmpty(ast: Node<Program>) {
    return ast.body.length === 0
  }

  get fileSettings() {
    return this._fileSettings
  }

  set fileSettings(settings: KclSettingsAnnotation) {
    this._fileSettings = settings
    this.sceneInfra.baseUnit =
      settings?.defaultLengthUnit || DEFAULT_DEFAULT_LENGTH_UNIT
  }

  get editorView() {
    return this._editorView
  }
  get editorState(): EditorState {
    return this._editorView.state
  }
  get state() {
    return this.editorState
  }
  get globalHistoryView() {
    return this._globalHistoryView
  }
  setCopilotEnabled(enabled: boolean) {
    this._copilotEnabled = enabled
  }
  get copilotEnabled(): boolean {
    return this._copilotEnabled
  }
  // Invoked when editorView is created and each time when it is updated (eg. user is sketching)..
  // setEditorView(editorView: EditorView) {
  //   this.overrideTreeHighlighterUpdateForPerformanceTracking()
  // }

  /** TODO: Investigate if this is still needed in the new world */
  overrideTreeHighlighterUpdateForPerformanceTracking() {
    // @ts-ignore
    this._editorView?.plugins.forEach((e) => {
      let sawATreeDiff = false
      // we cannot use <>.constructor.name since it will get destroyed
      // when packaging the application.
      const isTreeHighlightPlugin =
        e?.value &&
        e.value?.hasOwnProperty('tree') &&
        e.value?.hasOwnProperty('decoratedTo') &&
        e.value?.hasOwnProperty('decorations')
      if (isTreeHighlightPlugin) {
        let originalUpdate = e.value.update
        // @ts-ignore
        function performanceTrackingUpdate(args) {
          /**
           * TreeHighlighter.update will be called multiple times on start up.
           * We do not want to track the highlight performance of an empty update.
           * mark the syntax highlight one time when the new tree comes in with the
           * initial code
           */
          const treeIsDifferent =
            // @ts-ignore
            !sawATreeDiff && this.tree !== syntaxTree(args.state)
          if (treeIsDifferent && !sawATreeDiff) {
            markOnce('code/willSyntaxHighlight')
          }
          // Call the original function
          // @ts-ignore
          originalUpdate.apply(this, [args])
          if (treeIsDifferent && !sawATreeDiff) {
            markOnce('code/didSyntaxHighlight')
            sawATreeDiff = true
          }
        }
        e.value.update = performanceTrackingUpdate
      }
    })
  }
  get isAllTextSelected() {
    return this._isAllTextSelected
  }
  get isShiftDown(): boolean {
    return this._isShiftDown
  }
  setIsShiftDown(isShiftDown: boolean) {
    this._isShiftDown = isShiftDown
  }
  private selectionsWithSafeEnds(
    selection: Array<Selection['codeRef']['range']>
  ): Array<[number, number]> {
    if (!this._editorView) {
      return selection.filter(isTopLevelModule).map((s): [number, number] => {
        return [s[0], s[1]]
      })
    }
    return selection.filter(isTopLevelModule).map((s): [number, number] => {
      const safeEnd = Math.min(s[1], this._editorView?.state.doc.length || s[1])
      return [Math.min(s[0], safeEnd), safeEnd]
    })
  }
  set selectionRanges(selectionRanges: Selections) {
    this._selectionRanges = selectionRanges
  }
  set modelingSend(send: (eventInfo: ModelingMachineEvent) => void) {
    this._modelingSend = send
  }
  /**
   * Send an event to the modeling machine.
   * Returns false if the modeling machine is not available.
   */
  sendModelingEvent(event: ModelingMachineEvent): boolean {
    if (this._modelingSend) {
      this._modelingSend(event)
      return true
    }
    return false
  }
  get modelingState(): StateFrom<typeof modelingMachine> | null {
    return this._modelingState
  }
  set modelingState(state: StateFrom<typeof modelingMachine>) {
    this._modelingState = state
  }
  get highlightRange(): Array<[number, number]> {
    return this._highlightRange
  }
  setHighlightRange(range: Array<Selection['codeRef']['range']>): void {
    const selectionsWithSafeEnds = this.selectionsWithSafeEnds(range).filter(
      (selection) => {
        // Only keep valid selections.
        // Note: the selection might still be outdated for the new AST which is not calculated yet after a code mod /undo
        return selection[0] < selection[1]
      }
    )
    this._highlightRange = selectionsWithSafeEnds
    if (this._editorView) {
      this._editorView.dispatch({
        effects: addLineHighlight.of(selectionsWithSafeEnds),
        annotations: [
          updateOutsideEditorEvent,
          addLineHighlightEvent,
          Transaction.addToHistory.of(false),
        ],
      })
    }
  }
  async updateTheme(newTheme: Themes) {
    const resolvedTheme = getResolvedTheme(newTheme)
    const opposingTheme = getOppositeTheme(newTheme)
    this.sceneInfra.theme = opposingTheme
    this.sceneEntitiesManager.updateSegmentBaseColor(opposingTheme)
    this.setEditorTheme(resolvedTheme)
    if (this.engineCommandManager.connection) {
      return this.engineCommandManager.setTheme(newTheme).catch(reportRejection)
    }
  }
  setEditorTheme(theme: 'light' | 'dark') {
    this._editorView.dispatch({
      effects: [
        appSettingsThemeEffect.of(theme),
        themeCompartment.reconfigure(editorTheme[theme]),
      ],
      annotations: [
        settingsUpdateAnnotation.of(null),
        Transaction.addToHistory.of(false),
      ],
    })
  }
  setEditorLineWrapping(shouldWrap: boolean) {
    this._editorView.dispatch({
      effects: [
        lineWrappingCompartment.reconfigure(
          shouldWrap ? EditorView.lineWrapping : []
        ),
      ],
      annotations: [
        settingsUpdateAnnotation.of(null),
        Transaction.addToHistory.of(false),
      ],
    })
  }
  setCursorBlinking(shouldBlink: boolean) {
    this._editorView.dispatch({
      effects: [
        cursorBlinkingCompartment.reconfigure(
          drawSelection({ cursorBlinkRate: shouldBlink ? 1200 : 0 })
        ),
      ],
      annotations: [
        settingsUpdateAnnotation.of(null),
        Transaction.addToHistory.of(false),
      ],
    })
  }

  /**
   * Given an array of Diagnostics remove any duplicates by hashing a key
   * in the format of from + ' ' + to + ' ' + message.
   */
  makeUniqueDiagnostics(duplicatedDiagnostics: Diagnostic[]): Diagnostic[] {
    const uniqueDiagnostics: Diagnostic[] = []
    const seenDiagnostic: { [key: string]: boolean } = {}
    duplicatedDiagnostics.forEach((diagnostic: Diagnostic) => {
      const hash = `${diagnostic.from} ${diagnostic.to} ${diagnostic.message}`
      if (!seenDiagnostic[hash]) {
        uniqueDiagnostics.push(diagnostic)
        seenDiagnostic[hash] = true
      }
    })
    return uniqueDiagnostics
  }
  setDiagnostics(diagnostics: Diagnostic[]): void {
    if (!this._editorView) return
    // Clear out any existing diagnostics that are the same.
    diagnostics = this.makeUniqueDiagnostics(diagnostics)

    this._editorView.dispatch({
      effects: [setDiagnosticsEffect.of(diagnostics)],
      annotations: [
        setDiagnosticsEvent,
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }
  /**
   * Scroll to the first selection in the editor.
   */
  scrollToSelection() {
    if (!this._editorView || !this._selectionRanges.graphSelections[0]) return
    const firstSelection = this._selectionRanges.graphSelections[0]
    this._editorView.focus()
    this._editorView.dispatch({
      effects: [
        EditorView.scrollIntoView(
          EditorSelection.range(
            firstSelection.codeRef.range[0],
            firstSelection.codeRef.range[1]
          ),
          { y: 'center' }
        ),
      ],
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }
  scrollToFirstErrorDiagnosticIfExists() {
    if (!this._editorView) return
    let firstDiagnosticPos: [number, number] | null = null
    forEachDiagnostic(
      this._editorView.state,
      (d: Diagnostic, from: number, to: number) => {
        if (!firstDiagnosticPos && d.severity === 'error') {
          firstDiagnosticPos = [from, to]
        }
      }
    )
    if (!firstDiagnosticPos) return
    this._editorView.focus()
    this._editorView.dispatch({
      selection: EditorSelection.create([
        EditorSelection.cursor(firstDiagnosticPos[0]),
      ]),
      effects: [
        EditorView.scrollIntoView(
          EditorSelection.range(firstDiagnosticPos[0], firstDiagnosticPos[1])
        ),
      ],
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }
  addGlobalHistoryEvent(spec: TransactionSpecNoChanges) {
    this._globalHistoryView.dispatch(spec)
  }
  undo() {
    this._globalHistoryView.undo(this._editorView)
  }
  redo() {
    this._globalHistoryView.redo(this._editorView)
  }
  clearLocalHistory() {
    // Clear history
    this.editorView.dispatch({
      effects: [historyCompartment.reconfigure([])],
    })

    // Add history back
    this.editorView.dispatch({
      effects: [historyCompartment.reconfigure([history()])],
    })
  }
  clearGlobalHistory() {
    this._globalHistoryView.dispatch(
      {
        effects: [this._globalHistoryView.historyCompartment.reconfigure([])],
      },
      { shouldForwardToLocalHistory: false }
    )

    // Add history back
    this._globalHistoryView.dispatch(
      {
        effects: [
          this._globalHistoryView.historyCompartment.reconfigure([history()]),
        ],
      },
      { shouldForwardToLocalHistory: false }
    )
  }

  // Invoked by codeMirror during undo/redo.
  // Call with incorrect "this" so it needs to be an arrow function.
  dispatch = (spec: TransactionSpec) => {
    this._editorView.dispatch(spec)
  }
  set convertToVariableEnabled(enabled: boolean) {
    this._convertToVariableEnabled = enabled
  }
  set convertToVariableCallback(callback: () => void) {
    this._convertToVariableCallback = callback
  }
  convertToVariable() {
    if (this._convertToVariableEnabled) {
      this._convertToVariableCallback()
      return true
    }
    return false
  }
  selectRange(selections: Selections) {
    if (selections?.graphSelections?.length === 0) {
      return
    }
    if (!this._editorView) {
      return
    }
    const codeBaseSelections = this.createEditorSelection(selections)
    this._editorView.dispatch({
      selection: codeBaseSelections,
      annotations: [
        updateOutsideEditorEvent,
        Transaction.addToHistory.of(false),
      ],
    })
  }
  createEditorSelection(selections: Selections) {
    let codeBasedSelections = []
    // Handle empty graphSelections array to avoid runtime errors
    if (selections.graphSelections.length === 0) {
      const defaultCursor = EditorSelection.cursor(
        this._editorView?.state.doc.length || 0
      )
      return EditorSelection.create([defaultCursor], 0)
    }
    for (const selection of selections.graphSelections) {
      const safeEnd = Math.min(
        selection.codeRef.range[1],
        this._editorView?.state.doc.length || selection.codeRef.range[1]
      )
      codeBasedSelections.push(
        EditorSelection.range(selection.codeRef.range[0], safeEnd)
      )
    }
    const end =
      selections.graphSelections[selections.graphSelections.length - 1].codeRef
        .range[1]
    const safeEnd = Math.min(end, this._editorView?.state.doc.length || end)
    codeBasedSelections.push(EditorSelection.cursor(safeEnd))
    return EditorSelection.create(codeBasedSelections, 1)
  }
  // We will ONLY get here if the user called a select event.
  // This is handled by the code mirror kcl plugin.
  // If you call this function from somewhere else, you best know wtf you are
  // doing. (jess)
  handleOnViewUpdate(
    viewUpdate: ViewUpdate,
    processCodeMirrorRanges: typeof processCodeMirrorRangesFn,
    wasmInstance: ModuleType
  ): void {
    const sceneEntitiesManager = this.sceneEntitiesManager
    const ranges = viewUpdate?.state?.selection?.ranges || []
    if (ranges.length === 0) {
      return
    }
    if (!this._modelingState || !sceneEntitiesManager) {
      return
    }
    if (this._modelingState.matches({ Sketch: 'Change Tool' })) {
      return
    }
    this._isAllTextSelected = viewUpdate.state.selection.ranges.some(
      (selection) => {
        return (
          // The user will need to select the empty new lines as well to be considered all of the text.
          // CTRL+A is the best way to select all the text
          selection.from === 0 && selection.to === viewUpdate.state.doc.length
        )
      }
    )
    const eventInfo = processCodeMirrorRanges({
      codeMirrorRanges: viewUpdate.state.selection.ranges,
      selectionRanges: this._selectionRanges,
      isShiftDown: this._isShiftDown,
      ast: this.ast,
      artifactGraph: this.artifactGraph,
      artifactIndex: this.artifactIndex,
      systemDeps: {
        engineCommandManager: this.engineCommandManager,
        sceneEntitiesManager,
        wasmInstance,
      },
    })
    if (!eventInfo) {
      return
    }
    const deterministicEventInfo = {
      ...eventInfo,
      engineEvents: eventInfo.engineEvents.map((e) => ({
        ...e,
        cmd_id: 'static',
      })),
    }
    const stringEvent = JSON.stringify(deterministicEventInfo)
    if (
      this._lastEvent &&
      stringEvent === this._lastEvent.event &&
      Date.now() - this._lastEvent.time < 500
    ) {
      return // don't repeat events
    }
    this._lastEvent = { event: stringEvent, time: Date.now() }
    this._modelingSend(eventInfo.modelingEvent)
    eventInfo.engineEvents.forEach((event) => {
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.engineCommandManager.sendSceneCommand(event)
    })
  }
  localStoragePersistCode(): string {
    return safeLSGetItem(PERSIST_CODE_KEY) || ''
  }
  registerHotkey(hotkey: string, callback: () => void) {
    this._hotkeys[hotkey] = callback
    this.editorView.dispatch({
      effects: keymapCompartment.reconfigure(
        keymap.of(this.getCodemirrorHotkeys())
      ),
      annotations: hotkeyRegisteredAnnotation.of(hotkey),
    })
  }
  getCodemirrorHotkeys(): KeyBinding[] {
    return Object.keys(this._hotkeys).map((key) => ({
      key,
      run: () => {
        this._hotkeys[key]()
        return false
      },
      preventDefault: true,
    }))
  }
  get currentFileName() {
    return this.path.split(window.electron?.path.sep || '/').pop() || null
  }

  static defaultUpdateCodeEditorOptions: UpdateCodeEditorOptions = {
    shouldExecute: false,
    shouldWriteToDisk: true,
    shouldResetCamera: false,
    shouldClearHistory: false,
    shouldAddToHistory: true,
  }
  /**
   * Update the code in the editor.
   * This is invoked when a segment is being dragged on the canvas, among other things.
   */
  updateCodeEditor(
    code: string,
    options: Partial<UpdateCodeEditorOptions> = KclManager.defaultUpdateCodeEditorOptions
  ): void {
    const resolvedOptions: UpdateCodeEditorOptions = Object.assign(
      structuredClone(KclManager.defaultUpdateCodeEditorOptions),
      options
    )
    // If the code hasn't changed, skip the full update to preserve cursor position
    const currentCode = this.editorState.doc.toString()
    if (currentCode === code) {
      // However, if clearHistory is true, we still need to clear the history
      if (resolvedOptions.shouldClearHistory) {
        // Code is the same but we need to clear history (e.g., opening a new file with same content)
        this.clearLocalHistory()
      }
      // And we still want to honor the caller's request to write to disk.
      this.editorView.dispatch({
        annotations: [Transaction.addToHistory.of(false)],
        effects: [requestWriteToFile.of(resolvedOptions.shouldWriteToDisk)],
      })
      return
    }

    // Preserve the current selection/cursor position
    const currentSelection = this.editorState.selection
    const newDocLength = code.length

    // Map each selection range through the document change
    // Since we're replacing the entire document, we need to clamp positions
    // to the new document length if they exceed it
    const preservedRanges = currentSelection.ranges.map((range) => {
      const from = Math.min(range.from, newDocLength)
      const to = Math.min(range.to, newDocLength)
      // Ensure from <= to
      if (from === to) {
        return EditorSelection.cursor(from)
      }
      return EditorSelection.range(from, to)
    })

    if (resolvedOptions.shouldClearHistory) {
      this.clearLocalHistory()
    }

    this.editorView.dispatch({
      changes: {
        from: 0,
        to: this.editorState.doc.length || 0,
        insert: code,
      },
      selection: EditorSelection.create(
        preservedRanges,
        currentSelection.mainIndex
      ),
      annotations: [
        Transaction.addToHistory.of(
          resolvedOptions.shouldAddToHistory &&
            !resolvedOptions.shouldClearHistory
        ),
      ],
      effects: [
        requestSkipExecution.of(!resolvedOptions.shouldExecute),
        requestCameraReset.of(resolvedOptions.shouldResetCamera),
        requestWriteToFile.of(resolvedOptions.shouldWriteToDisk),
      ],
    })
  }
  async writeToFile(newCode = this.codeSignal.value) {
    if (this.path !== '') {
      // Only write our buffer contents to file once per second. Any faster
      // and file-system watchers which read, will receive empty data during
      // writes.
      clearTimeout(this.timeoutWriter)
      clearTimeout(this.timeoutRewatch)
      return new Promise((resolve, reject) => {
        this.timeoutWriter = setTimeout(() => {
          if (!this.path) {
            return reject(new Error('currentFilePath not set'))
          }
          // Wait one event loop to give a chance for params to be set
          // Save the file to disk
          this.writeCausedByAppCheckedInFileTreeFileSystemWatcher = true
          this.unwatch()
          this.write(newCode)
            .then(resolve)
            .then(() => {
              // After a cooldown, start watching this file again on disk.
              this.timeoutRewatch = setTimeout(() => {
                this.watch()
                this.timeoutRewatch = undefined
              }, 1_000)
            })
            .catch((err: Error) => {
              // TODO: add tracing per GH issue #254 (https://github.com/KittyCAD/modeling-app/issues/254)
              console.warn('error saving file', err)
              toast.error('Error saving file, please check file permissions')
              reject(err)
            })
        }, 1000)
      }).catch((err: Error) => {
        if (err.cause === 'ENOENT') {
          return
        }
        return err
      })
    }
  }
  async updateEditorWithAstAndWriteToFile(
    ast: Program,
    options?: Partial<{ isDeleting: boolean } & UpdateCodeEditorOptions>
  ) {
    const resolvedOptions: NonNullable<typeof options> = Object.assign(
      { shouldExecute: false },
      options ?? {},
      { shouldWriteToDisk: true }
    )
    const wasmInstance = await this.wasmInstancePromise

    // We clear the AST when it cannot be parsed. If we are trying to write an
    // empty AST, it's probably because of an earlier error. That's a bad state
    // to be in, and it's not going to be pretty, but at the least, let's not
    // permanently delete the user's code accidentally.
    // if you want to clear the scene, pass in the `isDeleting` option.
    if (ast.body.length === 0 && !resolvedOptions.isDeleting) return
    const newCode = recast(ast, wasmInstance)
    if (err(newCode)) return
    // Test to see if we can parse the recast code, and never update the editor with bad code.
    // This should never happen ideally and should mean there is a bug in recast.
    const result = parse(newCode, wasmInstance)
    if (err(result)) {
      console.log('Recast code could not be parsed:', result, ast)
      return
    }
    this.updateCodeEditor(newCode, resolvedOptions)
  }
}

function safeLSGetItem(key: string) {
  if (typeof window === 'undefined') return
  return localStorage?.getItem(key)
}
