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
  SetProgramOutcome as RustSetProgramOutcome,
  SketchCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import { type Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { encode as msgpackEncode } from '@msgpack/msgpack'

import type { WebSocketResponse } from '@kittycad/lib'

import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { ExecState } from '@src/lang/wasm'
import { errFromErrWithOutputs, execStateFromRust } from '@src/lang/wasm'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { defaultPlaneStrToKey } from '@src/lib/planes'
import { err, reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'

import type { ConnectionManager } from '@src/network/connectionManager'
import { Signal } from '@src/lib/signal'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import {
  getSettingsFromActorContext,
  jsAppSettings,
} from '@src/lib/settings/settingsUtils'

export default class RustContext {
  private rustInstance: ModuleType | null = null
  private ctxInstance: Context | null = null
  private _defaultPlanes: DefaultPlanes | null = null
  public readonly planesCreated = new Signal()

  constructor(
    public readonly wasmInstancePromise: Promise<ModuleType>,
    private readonly engineCommandManager: ConnectionManager,
    public readonly settingsActor: SettingsActorType,
    private projectId = 0
  ) {
    wasmInstancePromise
      .then((instance) => this.createFromInstance(instance))
      .catch(reportRejection)
  }

  /** Create a new context instance */
  private async createContextFromWasm(): Promise<Context> {
    this.rustInstance = await this.wasmInstancePromise

    const ctxInstance = new this.rustInstance.Context(
      this.engineCommandManager,
      projectFsManager
    )

    return ctxInstance
  }

  /** Create a new Context instance for operations that need a separate context (e.g., transpilation) */
  async createNewContext(): Promise<Context> {
    const instance = await this.wasmInstancePromise
    return new instance.Context(this.engineCommandManager, projectFsManager)
  }

  private createFromInstance(instance: ModuleType) {
    this.rustInstance = instance

    const ctxInstance = new this.rustInstance.Context(
      this.engineCommandManager,
      projectFsManager
    )

    this.ctxInstance = ctxInstance
  }

  public hasOpenedProject = false

  /** Project lifecycle method for WASM, setting up initial snapshot of project */
  async sendOpenProject(currentFilePath: string | null, kclFiles: ApiFile[]) {
    // TODO: The rust side should really honor having no current file ID
    const currentFileId =
      kclFiles.find((f) => f.path === currentFilePath)?.id || -1
    await this.ctxInstance?.open_project(
      this.projectId,
      JSON.stringify(kclFiles),
      currentFileId
    )
    this.hasOpenedProject = true
  }

  /** Helper to verify the state on the WASM side, useful for testing */
  async getProjectState() {
    return this.ctxInstance?.get_project(this.projectId)
  }

  /** Helper to verify the state on the WASM side, useful for testing */
  async getFileState(fileId: number) {
    return this.ctxInstance?.get_file(this.projectId, fileId)
  }

  async sendAddFile(file: ApiFile) {
    return this.ctxInstance?.add_file(this.projectId, JSON.stringify(file))
  }

  async sendUpdateFile(fileId: number, code: string) {
    if (!this.hasOpenedProject) {
      return
    }
    return this.ctxInstance?.update_file(this.projectId, fileId, code)
  }

  async sendRemoveFile(fileId: number) {
    return this.ctxInstance?.remove_file(this.projectId, fileId)
  }

  /** Execute a program. */
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ExecState> {
    const instance = await this._checkContextInstance()

    try {
      const result: SceneGraphDelta = await instance.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
      const outcome = execStateFromRust(result.exec_outcome)

      // Set the default planes, safe to call after execute.
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
    const instance = await this._checkContextInstance()

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
    const instance = await this._checkContextInstance()

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
    const instance = await this._checkContextInstance()

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
    const instance = await this._checkContextInstance()

    try {
      const serialized = msgpackEncode(response)
      await instance.sendResponse(serialized)
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /**
   * Temporary hack. Set the program AST used by the frontend layer of the API
   * and execute it with a real engine so that state is updated and ready for
   * the next API call.
   */
  async hackSetProgram(
    program_ast: Node<Program>,
    settings: DeepPartial<Configuration>
  ): Promise<SetProgramOutcome> {
    const instance = await this._checkContextInstance()

    try {
      const result: RustSetProgramOutcome & {
        checkpointId?: bigint | number | null
      } = await instance.hack_set_program(
        JSON.stringify(program_ast),
        JSON.stringify(settings)
      )
      if (result.type !== 'Success') {
        return result
      }

      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }

      return {
        ...result,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /**
   * Execute the sketch in mock mode, without changing anything. This is
   * useful after editing segments, and the user releases the mouse button.
   */
  async sketchExecuteMock(
    version: ApiVersion,
    sketch: ApiObjectId
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = await this._checkContextInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta] =
        await instance.sketch_execute_mock(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(jsAppSettings(this.settingsActor))
        )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Add a new sketch and enter sketch mode. */
  async newSketch(
    project: ApiProjectId,
    file: ApiFileId,
    version: ApiVersion,
    sketchArgs: SketchCtor,
    settings: DeepPartial<Configuration>
  ): Promise<NewSketchResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        sketchId: ApiObjectId
        checkpointId?: number | null
      } = await instance.new_sketch(
        JSON.stringify(project),
        JSON.stringify(file),
        JSON.stringify(version),
        JSON.stringify(sketchArgs),
        JSON.stringify(settings)
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        sketchId: result.sketchId,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Enter sketch mode for an existing sketch. */
  async editSketch(
    project: ApiProjectId,
    file: ApiFileId,
    version: ApiVersion,
    sketch: ApiObjectId,
    settings: DeepPartial<Configuration>
  ): Promise<EditSketchResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.edit_sketch(
        JSON.stringify(project),
        JSON.stringify(file),
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(settings)
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Exit sketch mode. */
  async exitSketch(
    version: ApiVersion,
    sketch: ApiObjectId
  ): Promise<SceneGraphDelta> {
    const instance = await this._checkContextInstance()

    try {
      const result: SceneGraphDelta = await instance.exit_sketch(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(getSettingsFromActorContext(this.settingsActor))
      )
      return result
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Delete a sketch. */
  async deleteSketch(
    version: ApiVersion,
    sketch: ApiObjectId,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
  }> {
    const instance = await this._checkContextInstance()

    try {
      const result: [SourceDelta, SceneGraphDelta] =
        await instance.delete_sketch(
          JSON.stringify(version),
          JSON.stringify(sketch),
          JSON.stringify(settings)
        )
      return {
        kclSource: result[0],
        sceneGraphDelta: result[1],
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Add a segment to a sketch. */
  async addSegment(
    version: ApiVersion,
    sketch: ApiObjectId,
    segment: SegmentCtor,
    label: string | undefined,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.add_segment(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(segment),
        label,
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
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
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.edit_segments(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(segments),
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Delete objects in a sketch. */
  async deleteObjects(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraintIds: ApiObjectId[],
    segmentIds: ApiObjectId[],
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.delete_objects(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraintIds),
        JSON.stringify(segmentIds),
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Add a constraint to a sketch. */
  async addConstraint(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraint: ApiConstraint,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.add_constraint(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraint),
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Edit a constraint value in a sketch. */
  async editConstraint(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraintId: ApiObjectId,
    valueExpression: string,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.edit_constraint(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraintId),
        valueExpression,
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Chain a segment to a previous segment by adding it and creating a coincident constraint. */
  async chainSegment(
    version: ApiVersion,
    sketch: ApiObjectId,
    previousSegmentEndPointId: ApiObjectId,
    segment: SegmentCtor,
    label: string | undefined,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.chain_segment(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(previousSegmentEndPointId),
        JSON.stringify(segment),
        label,
        JSON.stringify(settings),
        createCheckpoint
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpointId)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  async restoreSketchCheckpoint(
    checkpointId: number
  ): Promise<RestoreSketchCheckpointResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
      } = await instance.restore_sketch_checkpoint(JSON.stringify(checkpointId))
      return {
        kclSource: result.sourceDelta,
        sceneGraphDelta: result.sceneGraphDelta,
      }
    } catch (e: any) {
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  async clearSketchCheckpoints(): Promise<void> {
    const instance = await this._checkContextInstance()

    try {
      await instance.clear_sketch_checkpoints()
    } catch (e: any) {
      const err = { message: e }
      return Promise.reject(err)
    }
  }

  /** Execute trim operations on a sketch. Runs the full trim loop in Rust. */
  async executeTrim(
    version: ApiVersion,
    sketch: ApiObjectId,
    points: Array<[number, number]>,
    settings: DeepPartial<Configuration>
  ): Promise<{
    kclSource: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    operationsPerformed: boolean
    checkpointId?: number | null
  }> {
    const instance = await this._checkContextInstance()

    try {
      // Flatten array of [x, y] tuples into a Float64Array [x1, y1, x2, y2, ...]
      // wasm-bindgen expects a typed array for Vec<f64>
      const flattenedPoints = new Float64Array(points.flat())

      const result: {
        source_delta: SourceDelta
        scene_graph_delta: SceneGraphDelta
        operations_performed: boolean
        checkpoint_id?: number | null
      } = await instance.execute_trim(
        JSON.stringify(version),
        JSON.stringify(sketch),
        flattenedPoints,
        JSON.stringify(settings)
      )
      const checkpointId = normalizeSketchCheckpointId(result.checkpoint_id)
      if (checkpointId instanceof Error) {
        return Promise.reject(checkpointId)
      }
      return {
        kclSource: result.source_delta,
        sceneGraphDelta: result.scene_graph_delta,
        operationsPerformed: result.operations_performed,
        checkpointId,
      }
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      return Promise.reject(err)
    }
  }

  /** Helper to check if context instance exists */
  private async _checkContextInstance(): Promise<Context> {
    if (!this.ctxInstance) {
      // Create the context instance.
      this.ctxInstance = await this.createContextFromWasm()
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

function normalizeSketchCheckpointId(
  checkpointId: bigint | number | null | undefined
): number | null | undefined | Error {
  if (checkpointId == null) return checkpointId
  if (typeof checkpointId === 'number') return checkpointId

  const normalized = Number(checkpointId)
  if (!Number.isSafeInteger(normalized)) {
    return new Error(
      `Sketch checkpoint id is outside the safe integer range: ${checkpointId.toString()}`
    )
  }

  return normalized
}

type SketchMutationResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
}

type SetProgramOutcome =
  | (Omit<
      Extract<RustSetProgramOutcome, { type: 'Success' }>,
      'checkpointId'
    > & {
      checkpointId?: number | null
    })
  | Exclude<RustSetProgramOutcome, { type: 'Success' }>

type NewSketchResult = SketchMutationResult & {
  sketchId: ApiObjectId
}

type EditSketchResult = {
  sceneGraphDelta: SceneGraphDelta
  checkpointId?: number | null
}

type RestoreSketchCheckpointResult = {
  kclSource: SourceDelta
  sceneGraphDelta: SceneGraphDelta
}
