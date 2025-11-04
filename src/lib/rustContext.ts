import toast from 'react-hot-toast'

import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type {
  ApiConstraint,
  ApiFile,
  ApiFileId,
  ApiObjectId,
  ApiProjectId,
  ApiVersion,
  ExistingSegmentCtor,
  SceneGraphDelta,
  SegmentCtor,
  SketchArgs,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { type Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { BSON } from 'bson'

import type { WebSocketResponse } from '@kittycad/lib'

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { ExecState } from '@src/lang/wasm'
import { errFromErrWithOutputs, execStateFromRust } from '@src/lang/wasm'
import { initPromise } from '@src/lang/wasmUtils'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { defaultPlaneStrToKey } from '@src/lib/planes'
import type { FileEntry, Project } from '@src/lib/project'
import { err, reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { getModule } from '@src/lib/wasm_lib_wrapper'

import type { ConnectionManager } from '@src/network/connectionManager'
import { Signal } from '@src/lib/signal'

export default class RustContext {
  private wasmInitFailed: boolean = true
  private rustInstance: ModuleType | null = null
  private ctxInstance: Context | null = null
  private _defaultPlanes: DefaultPlanes | null = null
  private engineCommandManager: ConnectionManager
  private projectId = 0
  public readonly planesCreated = new Signal()

  /** Initialize the WASM module */
  private async ensureWasmInit() {
    try {
      await initPromise
      if (this.wasmInitFailed) {
        this.wasmInitFailed = false
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      this.wasmInitFailed = true
    }
  }

  constructor(engineCommandManager: ConnectionManager, instance?: ModuleType) {
    this.engineCommandManager = engineCommandManager

    if (instance) {
      this.createFromInstance(instance)
    } else {
      this.ensureWasmInit()
        .then(() => {
          this.ctxInstance = this.create()
        })
        .catch(reportRejection)
    }
  }

  /** Create a new context instance */
  private create(): Context {
    this.rustInstance = getModule()

    const ctxInstance = new this.rustInstance.Context(
      this.engineCommandManager,
      projectFsManager
    )

    return ctxInstance
  }

  getRustInstance() {
    return this.rustInstance || undefined
  }

  private createFromInstance(instance: ModuleType) {
    this.rustInstance = instance

    const ctxInstance = new this.rustInstance.Context(
      this.engineCommandManager,
      projectFsManager
    )

    this.ctxInstance = ctxInstance
  }

  async sendOpenProject(
    project: Project,
    currentFilePath: string | null
  ): Promise<void> {
    this.projectId += 1
    let files: ApiFile[] = []
    collectFiles(project, files)
    let openFile = 0
    for (let f of files) {
      if (f.path === currentFilePath) {
        openFile = f.id
      }
    }
    // TODO need to find text of files and add it to this call (which might mean we want to call this function later when we're not on the
    // critical path for opening a project).
    await this.ctxInstance?.open_project(
      this.projectId,
      JSON.stringify(files),
      openFile
    )
  }

  /** Execute a program. */
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = this._checkInstance()

    try {
      const result = await instance.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
      // Set the default planes, safe to call after execute.
      const outcome = execStateFromRust(result)

      this.setDefaultPlanes(outcome.defaultPlanes)

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(err.defaultPlanes)
      return Promise.reject(err)
    }
  }

  /** Execute a program with in mock mode. */
  async executeMock(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    usePrevMemory?: boolean
  ): Promise<ExecState> {
    const instance = this._checkInstance()

    if (usePrevMemory === undefined) {
      usePrevMemory = true
    }

    try {
      const result = await instance.executeMock(
        JSON.stringify(node),
        path,
        JSON.stringify(settings),
        usePrevMemory
      )
      return execStateFromRust(result)
    } catch (e: any) {
      return Promise.reject(errFromErrWithOutputs(e))
    }
  }

  /** Export a scene to a file. */
  async export(
    format: DeepPartial<OutputFormat3d>,
    settings: DeepPartial<Configuration>,
    toastId: string
  ): Promise<ModelingAppFile[] | undefined> {
    const instance = this._checkInstance()

    try {
      return await instance.export(
        JSON.stringify(format),
        JSON.stringify(settings)
      )
    } catch (e: any) {
      const parsed: RustKclError = JSON.parse(e.toString())
      toast.error(parsed.details.msg, { id: toastId })
      return
    }
  }

  async waitForAllEngineCommands() {
    await this.engineCommandManager.waitForAllCommands()
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  /** Internal setter for default planes that emits a planesCreated signal when planes are available */
  private setDefaultPlanes(planes: DefaultPlanes | null) {
    this._defaultPlanes = planes
    if (planes) {
      this.planesCreated.dispatch()
    }
  }

  /**
   * Clear/reset the scene and bust the cache.
   * Do not use this function unless you absolutely need to. In most cases,
   * we should just fix the  cache for whatever bug you are seeing.
   * The only time it makes sense to run this is if the engine disconnects and
   * reconnects. The rust side has no idea that happened and will think the
   * cache is still valid.
   * Caching on the rust side accounts for changes to files outside of the
   * scope of the current file the user is on. It collects all the dependencies
   * and checks if any of them have changed. If they have, it will bust the
   * cache and recompile the scene.
   * The typescript side should never raw dog clear the scene since that would
   * fuck with the cache as well. So if you _really_ want to just clear the scene
   * AND NOT re-execute, you can use this for that. But in 99.999999% of cases just
   * re-execute.
   */
  async clearSceneAndBustCache(
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = this._checkInstance()

    try {
      const result = await instance.bustCacheAndResetScene(
        JSON.stringify(settings),
        path
      )

      /* Set the default planes, safe to call after execute. */
      const outcome = execStateFromRust(result)

      this.setDefaultPlanes(outcome.defaultPlanes)

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(err.defaultPlanes)
      return Promise.reject(err)
    }
  }

  getDefaultPlaneId(name: DefaultPlaneStr): string | Error {
    const key = defaultPlaneStrToKey(name)
    if (!this.defaultPlanes) {
      return new Error('Default planes not initialized')
    } else if (err(key)) {
      return key
    }
    return this.defaultPlanes[key]
  }

  /** Send a response back to the rust side, that we got back from the engine. */
  async sendResponse(response: WebSocketResponse): Promise<void> {
    const instance = this._checkInstance()

    try {
      const serialized = BSON.serialize(response)
      await instance.sendResponse(serialized)
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Temporary hack. Set the program AST used by the frontend layer of the API
   * and execute it so that state is updated and ready for the next API call. */
  async hackSetProgram(
    program_ast: Node<Program>,
    settings: DeepPartial<Configuration>
  ): Promise<void> {
    const instance = this._checkInstance()

    try {
      await instance.hack_set_program(
        JSON.stringify(program_ast),
        JSON.stringify(settings)
      )
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Add a new sketch and enter sketch mode. */
  async newSketch(
    project: ApiProjectId,
    file: ApiFileId,
    version: ApiVersion,
    sketchArgs: SketchArgs,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    sketchId: ApiObjectId
  }> {
    const instance = this._checkInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta, ApiObjectId] =
        await instance.new_sketch(
          JSON.stringify(project),
          JSON.stringify(file),
          JSON.stringify(version),
          JSON.stringify(sketchArgs),
          JSON.stringify(settings)
        )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
        sketchId: result[2],
      }
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Exit sketch mode. */
  async exitSketch(
    version: ApiVersion,
    sketch: ApiObjectId,
    settings: DeepPartial<Configuration>
  ): Promise<SceneGraphDelta> {
    const instance = this._checkInstance()

    try {
      const result: SceneGraphDelta = await instance.exit_sketch(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(settings)
      )
      return result
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Add a segment to a sketch. */
  async addSegment(
    version: ApiVersion,
    sketch: ApiObjectId,
    segment: SegmentCtor,
    label: string | undefined,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = this._checkInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta] = await instance.add_segment(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(segment),
        label,
        JSON.stringify(settings)
      )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
      }
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Add a segment to a sketch using the stub implementation. */
  async addSegmentStub(
    version: number,
    sketch: number,
    segment: SegmentCtor,
    label: string,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = this._checkInstance()

    try {
      const result: string = await instance.add_segment_stub(
        version,
        sketch,
        JSON.stringify(segment),
        label,
        JSON.stringify(settings)
      )
      const tuple: [SourceDelta, SceneGraphDelta] = JSON.parse(result)
      return {
        kclSource: tuple[0],
        sceneGraphDelta: tuple[1],
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Edit a segment in a sketch. */
  async editSegments(
    version: ApiVersion,
    sketch: ApiObjectId,
    segments: ExistingSegmentCtor[],
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = this._checkInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta] =
        await instance.edit_segments(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(segments),
          JSON.stringify(settings)
        )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
      }
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Add a constraint to a sketch. */
  async addConstraint(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraint: ApiConstraint,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = this._checkInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta] =
        await instance.add_constraint(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(constraint),
          JSON.stringify(settings)
        )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
      }
    } catch (e: any) {
      // TODO: sketch-api: const err = errFromErrWithOutputs(e)
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Helper to check if context instance exists */
  private _checkInstance(): Context {
    if (!this.ctxInstance) {
      // Create the context instance.
      this.ctxInstance = this.create()
    }

    return this.ctxInstance
  }

  /** Clean up resources */
  destroy() {
    if (this.ctxInstance) {
      // In a real implementation, you might need to manually free resources
      this.ctxInstance = null
    }
  }
}

const collectFiles = (file: FileEntry, files: ApiFile[]) => {
  if (file.children) {
    for (let entry of file.children) {
      if (entry.name.endsWith('.kcl')) {
        files.push({
          id: files.length,
          path: entry.path,
          text: '',
        })
      } else {
        collectFiles(entry, files)
      }
    }
  }
}
