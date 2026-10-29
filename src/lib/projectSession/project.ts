import { getProjectInfo } from '@src/lib/desktop'
import { getAutomaticallyRenderEnabledFromSettings } from '@src/lib/automaticRendering'
import { getSettingsFromActorContext } from '@src/lib/settings/settingsUtils'
import {
  type Signal,
  type ReadonlySignal,
  signal,
  computed,
} from '@preact/signals-core'
import type { ApiFile } from '@rust/kcl-lib/bindings/FrontendApi'
import { KclManager } from '@src/lang/KclManager'
import { getStringAfterLastSeparator } from '@src/lib/paths'
import { markOnce } from '@src/lib/performance'
import type { FileEntry, Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { reportRejection } from '@src/lib/trap'
import { uuidv4 } from '@src/lib/utils'
import type { CommandBarActorType } from '@src/machines/commandBarMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import type { UserFeaturesSettleService } from '@src/machines/userFeaturesMachine'
import type { KeymapService } from '@src/registry/contracts/keymap'
import type { ConnectionManager } from '@src/lib/engineConnection'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { App } from '@src/lib/app'
import type { MachineManager } from '@src/lib/MachineManager'
import { File } from '@src/lib/projectSession/file'
import type { TextFileIO } from '@src/lib/projectSession/textFileIO'
import {
  projectSession,
  type ProjectSessionService,
} from '@src/registry/contracts/projectSession'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

// Each of our singletons has dependencies on _other_ singletons, so importing
// can easily become cyclic. Each will have its own Singletons type.
export interface ProjectSystemDeps {
  machineManager: MachineManager
  /** Live metadata for the editor's owning project; absent before a project opens. */
  project: ReadonlySignal<Project | undefined>
  /** Storage access for editor-owned export and thumbnail workflows. */
  fileOperations: FileOperationsRegistryService
  textFileIO: TextFileIO
  modelingReady?: () => Promise<void>
  projectSession?: Pick<
    ProjectSessionService,
    'editorChanged' | 'writeThumbnail'
  >
  wasmInstancePromise: Promise<ModuleType>
  settings: SettingsActorType
  commandBar: CommandBarActorType
  engineCommandManager: ConnectionManager
  rustContext: RustContext
  userFeatures: UserFeaturesSettleService
  keymap?: KeymapService
}

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

  private modelingPreparation: Promise<void> = Promise.resolve()
  get modelingReady() {
    return this.modelingPreparation
  }
  private fileWatcherId = uuidv4()

  constructor(
    public projectIORefSignal: Signal<Project>,
    private app: App,
    public readonly textFileIO: TextFileIO
  ) {
    this.files = this.collectProjectFiles(projectIORefSignal.value)
    this.textFileIO.watch(
      projectIORefSignal.value.path,
      this.fileWatcherId,
      this.onUpdateFromDisk
    )
  }

  /** Clean up resources and watchers for Project */
  public close() {
    this.closeAllEditors()
    this.textFileIO.unwatch(
      this.projectIORefSignal.value.path,
      this.fileWatcherId
    )
  }

  /** Open a project, with the option to open an initial editor too */
  static async open(projectRef: Signal<Project>, app: App) {
    return new ZDSProject(
      projectRef,
      app,
      app.registry.get(projectSession).textFileIO
    )
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
      this.executingEditor.peek()?.setSceneSettingsActive(false)
      this.#executingPath.value = null
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
    const previous = this.executingEditor.peek()
    const changedEditor = previous !== found
    if (changedEditor) previous?.setSceneSettingsActive(false)
    this.#executingPath.value = foundPathSignal[0]
    if (changedEditor) found.setSceneSettingsActive(true)
  }
  findEditor(path: string) {
    return Array.from(this.editors.entries()).find(([p]) => p.value === path)
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
    isExecuting = true,
    assertCurrent: () => void = () => {},
    options: { deferModeling?: boolean } = {}
  ) {
    const foundEditor = this.findEditor(path)
    const found = foundEditor?.[1]
    if (
      found &&
      (!providedEditor || found !== providedEditor || found.path === path)
    ) {
      console.warn(`Attempted to overwrite editor with path "${path}"`)
      if (isExecuting && !options.deferModeling) {
        await found.modelingActorPromise
        assertCurrent()
      }
      return found
    }

    const systemDeps: ProjectSystemDeps = {
      machineManager: this.app.machineManager,
      project: this.projectIORefSignal,
      fileOperations: this.app.fileOperations,
      textFileIO: this.textFileIO,
      modelingReady: () => this.modelingPreparation,
      projectSession: this.app.projectSession,
      wasmInstancePromise: this.app.wasmPromise,
      commandBar: this.app.commands.actor,
      settings: this.app.settings.actor,
      engineCommandManager: this.app.engineCommandManager,
      rustContext: this.app.rustContext,
      userFeatures: this.app.userFeatures,
    }

    if (providedEditor) {
      providedEditor.systemDeps.project = systemDeps.project
      providedEditor.systemDeps.modelingReady = systemDeps.modelingReady
    }

    const foundFileIndex = this.files.findIndex((f) => f.path === path)
    if (providedEditor && providedEditor.path !== path) {
      const previousEditorFileIndex = this.files.findIndex(
        (file) => file === providedEditor
      )
      if (previousEditorFileIndex > -1) {
        this.files[previousEditorFileIndex] = new File(
          providedEditor.path,
          this.textFileIO,
          providedEditor.id
        )
      }
    }
    const newEditor = await KclManager.fromFile(
      foundFileIndex > -1
        ? this.files[foundFileIndex]
        : new File(path, this.textFileIO, this.nextFileId++),
      systemDeps,
      providedEditor,
      providedCode,
      // Project-level file opens refresh Rust with the full project snapshot
      // below. Do not let the reused editor send update_file for a new file ID
      // before that snapshot has registered the file.
      {
        shouldSyncRustOnOpen: !providedEditor,
        backgroundSave: options.deferModeling,
        assertCurrent,
      }
    )
    assertCurrent()

    // Splice our new editor into our files array
    if (foundFileIndex > -1) {
      this.files[foundFileIndex] = newEditor
    } else {
      // We must be opening a new file as an editor
      this.files = [...this.files, newEditor]
    }

    if (newEditor.path !== path) {
      newEditor.path = path
    }

    // A reused editor owns only its current path; older buffers live in its history/save cache.
    for (const [key, editor] of this.editors) {
      if (editor === newEditor && key.peek() !== path) this.editors.delete(key)
    }
    this.set(this.findEditor(path)?.[0] ?? signal(path), newEditor)

    // Initialize a snapshot of the project for Rust
    // to have for executions and code mods
    if (isExecuting) {
      this.executingPath = path
    }

    const assertModelingCurrent = () => {
      assertCurrent()
      if (
        this.app.project !== this ||
        (isExecuting && this.executingPath !== path)
      ) {
        // eslint-disable-next-line suggest-no-throw/suggest-no-throw
        throw new DOMException('Superseded editor preparation', 'AbortError')
      }
    }
    const prepareModeling = async () => {
      assertModelingCurrent()
      markOnce('project/startCollectFiles')
      const apiFiles = await this.getAllKclFiles()
      markOnce('project/endCollectFiles')
      assertModelingCurrent()

      markOnce('project/startSendProjectToWasm')
      await newEditor.rustContext
        .sendOpenProject(path, apiFiles)
        .catch(reportRejection)
      markOnce('project/endSendProjectToWasm')
      assertModelingCurrent()
    }
    const renderModeling = async () => {
      assertModelingCurrent()
      if (
        isExecuting &&
        providedEditor &&
        newEditor.engineCommandManager.connection?.connected
      ) {
        await newEditor.executeCode(newEditor.code)
        assertModelingCurrent()
        await resetCameraPosition({
          sceneInfra: newEditor.sceneInfra,
          engineCommandManager: newEditor.engineCommandManager,
          settingsActor: this.app.settings.actor,
        })
      }
      if (isExecuting) {
        // Finish preparing modeling before the route commits its view. Rendering
        // an already loaded file must not introduce another Suspense loading screen.
        await newEditor.modelingActorPromise
        assertModelingCurrent()
      }
    }
    const reportPreparationFailure = (error: unknown) => {
      if (!(error instanceof DOMException && error.name === 'AbortError'))
        reportRejection(error)
    }
    if (options.deferModeling) {
      this.modelingPreparation = this.modelingPreparation
        .catch(() => undefined)
        .then(prepareModeling)
        .catch(reportPreparationFailure)
      void this.modelingPreparation
        .then(renderModeling)
        .catch(reportPreparationFailure)
    } else {
      await prepareModeling()
      await renderModeling()
    }
    return newEditor
  }

  closeEditor(path: string) {
    const foundPathSignal = this.findEditor(path)
    if (!foundPathSignal) {
      console.warn(`Attempted to close nonexistent editor with path "${path}"`)
      return
    }
    if (this.executingEditor.peek() === foundPathSignal[1]) {
      this.executingPath = null
    }
    foundPathSignal[1].close()
    this.editors.delete(foundPathSignal[0])
  }

  closeAllEditors() {
    this.executingPath = null
    for (const editor of this.editors.values()) {
      editor.close()
    }
    this.editors.clear()
  }

  /** Handle updates from the disk representation of the project */
  private onUpdateFromDisk = (eventType: string, path: string) => {
    const foundEditorKey = Array.from(this.editors.keys()).find(
      (pathSignal) => pathSignal.value === path
    )

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
          const newFile =
            foundFile ?? new File(path, this.textFileIO, this.nextFileId++)
          if (!foundFile) this.files.push(newFile)
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
          files.push(new File(path, this.textFileIO, id))
        } else {
          this.collectProjectFiles(entry, files)
        }
      }
    }

    return files
  }

  /** Get all the KCL files in this project as a flat array. */
  private async getAllKclFiles(): Promise<ApiFile[]> {
    const editor = this.executingEditor.peek()
    return Promise.all(
      this.files.map(async (file) => {
        if (editor?.path === file.path)
          return { id: file.id, path: file.path, text: editor.code }
        const pending = editor?.getPendingFileCode(file.path)
        return pending === undefined
          ? file.asRustApiFile()
          : { id: file.id, path: file.path, text: pending }
      })
    )
  }

  /** Rebuild the complete Rust snapshot after an authoritative storage refresh. */
  async reloadFilesFromStorage(isCurrent: () => boolean) {
    const editor = this.executingEditor.value
    if (!editor || !isCurrent()) return
    const project = await getProjectInfo(
      this.app.fileOperations,
      this.path,
      await this.app.wasmPromise
    )
    if (!isCurrent()) return
    const existing = new Map(this.files.map((file) => [file.path, file]))
    const files = this.collectProjectFiles(project).map(
      (file) => existing.get(file.path) ?? file
    )
    const apiFiles = await Promise.all(
      files.map((file) => file.asRustApiFile())
    )
    if (!isCurrent() || this.executingEditor.value !== editor) return
    this.files = files
    this.projectIORefSignal.value = {
      ...this.projectIORefSignal.value,
      ...project,
      cloudProjectId: this.projectIORefSignal.value.cloudProjectId,
    }
    for (const [, openEditor] of this.editors)
      if (
        openEditor !== editor &&
        !files.some((file) => file.path === openEditor.path)
      )
        this.closeEditor(openEditor.path)
    // The controller navigates to the default file when the executing file was
    // removed. Never execute the deleted editor's stale buffer.
    if (!files.some((file) => file.path === editor.path)) return
    await editor.rustContext.sendOpenProject(editor.path, apiFiles)
    if (!isCurrent() || this.executingEditor.value !== editor) return
    if (
      !editor.modelingState?.matches('Sketch') &&
      !editor.modelingState?.matches('sketchSolveMode') &&
      getAutomaticallyRenderEnabledFromSettings(
        getSettingsFromActorContext(this.app.settings.actor)
      )
    )
      await editor.executeCode(editor.code)
  }

  /**
   * Keep Rust's project file registry aligned while Zookeeper history replay
   * applies create/update/delete changes directly to the browser file system.
   * Normal editor writes only touch the active file, so replay needs this
   * explicit multi-file synchronization path.
   */
  async syncReplayedFilesToRust(
    replayFiles: readonly {
      absolutePath: string
      nextContent: string | null
    }[]
  ) {
    const editor = this.executingEditor.value
    if (!editor) return

    for (const replayFile of replayFiles) {
      const foundIndex = this.files.findIndex(
        (file) => file.path === replayFile.absolutePath
      )
      const foundFile = this.files[foundIndex]

      if (replayFile.nextContent === null) {
        if (!foundFile) continue
        this.files = this.files.filter((_, index) => index !== foundIndex)
        await editor.rustContext
          .sendRemoveFile(foundFile.id)
          .catch(reportRejection)
        continue
      }

      if (foundFile) {
        await editor.rustContext
          .sendUpdateFile(foundFile.id, replayFile.nextContent)
          .catch(reportRejection)
        continue
      }

      const newFile = new File(
        replayFile.absolutePath,
        this.textFileIO,
        this.nextFileId++
      )
      this.files.push(newFile)
      await editor.rustContext
        .sendAddFile({
          id: newFile.id,
          path: newFile.path,
          text: replayFile.nextContent,
        })
        .catch(reportRejection)
    }
  }
}
