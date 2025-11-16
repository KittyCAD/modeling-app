import { SceneInfra } from '@src/clientSideScene/sceneInfra'
import EditorManager from '@src/editor/manager'
import CodeManager from '@src/lang/codeManager'
import { KclManager } from '@src/lang/KclSingleton'
import { loadAndInitialiseWasmInstance } from '@src/lang/wasmUtilsNode'
import { ConnectionManager } from '@src/network/connectionManager'
import { join } from 'path'
import RustContext from '../rustContext'
import { Project } from '../project'
import { isDesktop } from '../isDesktop'

type WasmInstanceType = Awaited<
  ReturnType<typeof loadAndInitialiseWasmInstance>
>

interface EditorConstructor {
  new (wasmInstance: WasmInstanceType): EditorInterface
  create(): Promise<EditorInterface>
}

interface EditorInterface {
  engineCommandManager: ConnectionManager
  wasmInstance: WasmInstanceType
  rustContext: RustContext
  editorManager: EditorManager
  codeManager: CodeManager
  kclManager: KclManager
  sceneInfra: SceneInfra
  /** An editor can be created without a project, but cannot do much */
  project?: Project
}

/** The Zoo Design Studio Editor
 *
 * Our editor, which must have an initialized instance of our WASM bundle
 * that includes the KCL interpreter and other Rust-written subsystems
 * in order to run.
 *
 * It is possible to have an editor running without an open project. To open a project, use {@link openProject}
 * It is possible to have an editor running without an engine connection. To manage the connection, use {@Editor.engineCommandManager}
 */
export const Editor: EditorConstructor = class Editor
  implements EditorInterface
{
  // Our WASM bundle is core to the editor's functionality
  static WASM_PATH_STEM = 'public/kcl_wasm_lib_bg.wasm'
  static WASM_PATH = isDesktop()
    ? join(process.cwd(), this.WASM_PATH_STEM)
    : `/${this.WASM_PATH_STEM}`
  wasmInstance: WasmInstanceType

  // All the single ladies, all the single ladies
  engineCommandManager: ConnectionManager
  rustContext: RustContext
  editorManager: EditorManager
  codeManager: CodeManager
  kclManager: KclManager
  sceneInfra: SceneInfra
  project?: Project

  constructor(wasmInstance: WasmInstanceType) {
    this.wasmInstance = wasmInstance
    this.engineCommandManager = new ConnectionManager()
    this.rustContext = new RustContext(
      this.engineCommandManager,
      this.wasmInstance
    )
    this.sceneInfra = new SceneInfra(this.engineCommandManager)
    this.editorManager = new EditorManager(this.engineCommandManager)
    this.codeManager = new CodeManager({ editorManager: this.editorManager })
    this.kclManager = new KclManager(this.engineCommandManager, {
      rustContext: this.rustContext,
      codeManager: this.codeManager,
      editorManager: this.editorManager,
      sceneInfra: this.sceneInfra,
    })
    this.editorManager.kclManager = this.kclManager
    this.editorManager.codeManager = this.codeManager
    this.engineCommandManager.kclManager = this.kclManager
    this.engineCommandManager.codeManager = this.codeManager
    this.engineCommandManager.sceneInfra = this.sceneInfra
    this.engineCommandManager.rustContext = this.rustContext
  }

  // Initialize all the singletons and the WASM blob but do not connect to the engine
  static async create() {
    const instance = await loadAndInitialiseWasmInstance(this.WASM_PATH)
    return new Editor(instance)
  }

  openProject(project: Project) {
    this.project = project
  }

  closeProject() {
    this.project = undefined
  }
}
