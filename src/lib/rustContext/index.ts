import type { WebSocketResponse } from '@kittycad/lib'

import { encode as msgpackEncode } from '@msgpack/msgpack'
import type { Configuration } from '@rust/kcl-lib/bindings/Configuration'
import type { DefaultPlanes } from '@rust/kcl-lib/bindings/DefaultPlanes'
import type {
  ApiConstraint,
  ApiFile,
  ApiFileId,
  ApiObjectId,
  ApiPoint2d,
  ApiProjectId,
  ApiVersion,
  ConstraintLabelPositionEdit,
  ExistingSegmentCtor,
  Number,
  SetProgramOutcome as RustSetProgramOutcome,
  SceneGraphDelta,
  SegmentCtor,
  SegmentDragAnchor,
  SketchCtor,
  SourceDelta,
} from '@rust/kcl-lib/bindings/FrontendApi'
import type { KclError as RustKclError } from '@rust/kcl-lib/bindings/KclError'
import type { OutputFormat3d } from '@rust/kcl-lib/bindings/ModelingCmd'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@rust/kcl-lib/bindings/Program'
import type { ParsedExecutionSource } from '@rust/kcl-lib/bindings/ParsedExecutionSource'
import { type Context } from '@rust/kcl-wasm-lib/pkg/kcl_wasm_lib'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { ExecCallbacks, ExecState } from '@src/lang/wasm'
import {
  errFromErrWithOutputs,
  execStateFromRust,
  ParseResult,
} from '@src/lang/wasm'
import type { ConnectionManager } from '@src/lib/engineConnection/connectionManager'
import type ModelingAppFile from '@src/lib/modelingAppFile'
import type { DefaultPlaneStr } from '@src/lib/planes'
import { defaultPlaneStrToKey } from '@src/lib/planes'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { Signal as LegacySignal } from '@src/lib/signal'
import { err, reportRejection } from '@src/lib/trap'
import type { DeepPartial } from '@src/lib/types'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import toast from 'react-hot-toast'

interface PlanePublicationOwner {
  context: Context
  sessionId: string | undefined
  projectRevision: number
}

interface PlanePublicationReceipt {
  owner: PlanePublicationOwner
  generation: number
  planes: DefaultPlanes
}

export default class RustContext {
  private projectRevision = 0
  private planePublicationReceipt: PlanePublicationReceipt | undefined
  private initialization: Promise<Context> | undefined
  private contextChanged = new AbortController()
  private destroyed = false
  private ctxInstance: Context | null = null
  private _defaultPlanes: DefaultPlanes | null = null
  public readonly planesCreated = new LegacySignal()

  constructor(
    public readonly wasmInstancePromise: Promise<ModuleType>,
    private readonly engineCommandManager: ConnectionManager,
    public readonly settingsActor: SettingsActorType,
    private projectId = 0,
    private readonly geometryOnly = false
  ) {
    this.initialization = this.createContextFromWasm()
    void this.initialization.catch((error: unknown) => {
      if (!this.destroyed) reportRejection(error)
    })
  }

  private async createContextFromWasm(): Promise<Context> {
    const instance = await this.wasmInstancePromise
    if (this.destroyed) return this._checkContextInstance()
    const context = new instance.Context(
      this.engineCommandManager,
      projectFsManager,
      undefined,
      this.geometryOnly
    )
    this.ctxInstance = context
    return context
  }

  public hasOpenedProject = false

  /** Project lifecycle method for WASM, setting up initial snapshot of project */
  async sendOpenProject(currentFilePath: string | null, kclFiles: ApiFile[]) {
    this.projectRevision += 1
    const context = await this._checkContextInstance()
    await context.open_project(
      this.projectId,
      JSON.stringify(kclFiles),
      kclFiles.find((file) => file.path === currentFilePath)?.id ?? -1
    )
    this.hasOpenedProject = true
  }

  /** Helper to verify the state on the WASM side, useful for testing */
  async getProjectState() {
    const context = await this._checkContextInstance()
    return context.get_project(this.projectId)
  }

  /** Helper to verify the state on the WASM side, useful for testing */
  async getFileState(fileId: number) {
    const context = await this._checkContextInstance()
    return context.get_file(this.projectId, fileId)
  }

  async sendAddFile(file: ApiFile) {
    this.projectRevision += 1
    const context = await this._checkContextInstance()
    return context.add_file(this.projectId, JSON.stringify(file))
  }

  async sendUpdateFile(fileId: number, code: string) {
    this.projectRevision += 1
    if (!this.hasOpenedProject) return
    const context = await this._checkContextInstance()
    return context.update_file(this.projectId, fileId, code)
  }

  async sendRemoveFile(fileId: number) {
    this.projectRevision += 1
    const context = await this._checkContextInstance()
    return context.remove_file(this.projectId, fileId)
  }

  /** Execute a program. */
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    callbacks?: ExecCallbacks
  ): Promise<ExecState> {
    const instance = await this._checkContextInstance()
    const planeOwner = this.capturePlaneOwner(instance)
    const executionContext = callbacks
      ? instance.cloneWithExecuteCallbacks(callbacks)
      : instance

    try {
      const result: SceneGraphDelta = await executionContext.execute(
        JSON.stringify(node),
        path,
        JSON.stringify(settings)
      )
      const outcome = execStateFromRust(result.exec_outcome)

      // Set the default planes, safe to call after execute.
      this.setDefaultPlanes(
        outcome.defaultPlanes,
        outcome.engineSceneGeneration,
        planeOwner
      )

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(
        err.defaultPlanes,
        err.engineSceneGeneration,
        planeOwner
      )
      return Promise.reject(err)
    }
  }

  /** Execute a program with in mock mode. */
  async executeMock(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    usePrevMemory?: boolean,
    callbacks?: ExecCallbacks
  ): Promise<ExecState> {
    const instance = await this._checkContextInstance()
    const planeOwner = this.capturePlaneOwner(instance)
    const executionContext = callbacks
      ? instance.cloneWithExecuteCallbacks(callbacks)
      : instance

    if (usePrevMemory === undefined) {
      usePrevMemory = true
    }

    try {
      const result = await executionContext.executeMock(
        JSON.stringify(node),
        path,
        JSON.stringify(settings),
        usePrevMemory
      )
      const outcome = execStateFromRust(result)
      this.setDefaultPlanes(
        outcome.defaultPlanes,
        outcome.engineSceneGeneration,
        planeOwner
      )
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(
        err.defaultPlanes,
        err.engineSceneGeneration,
        planeOwner
      )
      return Promise.reject(err)
    }
  }

  /** Parse the active entry point. Rust owns scene/cache behavior for invalid files. */
  async parseForExecution(
    code: string,
    settings: DeepPartial<Configuration>,
    path?: string
  ): Promise<ParseResult | Error> {
    const instance = await this._checkContextInstance()
    const planeOwner = this.capturePlaneOwner(instance)
    try {
      const parsed: ParsedExecutionSource = await instance.parseForExecution(
        code,
        JSON.stringify(settings),
        path
      )
      this.setDefaultPlanes(
        parsed.default_planes,
        parsed.engine_scene_generation,
        planeOwner
      )
      return new ParseResult(
        parsed.program,
        parsed.kcl_version,
        parsed.issues.filter((issue) => issue.severity !== 'Warning'),
        parsed.issues.filter((issue) => issue.severity === 'Warning')
      )
    } catch (error) {
      const failure = errFromErrWithOutputs(error)
      this.setDefaultPlanes(
        failure.defaultPlanes,
        failure.engineSceneGeneration,
        planeOwner
      )
      return failure
    }
  }

  /** Evaluate an input expression with the current Rust model's settings. */
  async evaluateExpression(node: Node<Program>): Promise<ExecState> {
    const instance = await this._checkContextInstance()
    try {
      const result = await instance.evaluateExpression(
        JSON.stringify(node),
        JSON.stringify(jsAppSettings(this.settingsActor))
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

  /**
   * Wait for all modeling commands sent to the engine
   */
  async waitForAllEngineModelingCommands() {
    await this.engineCommandManager.waitForAllModelingCommands()
  }

  get defaultPlanes() {
    return this._defaultPlanes
  }

  private capturePlaneOwner(context: Context): PlanePublicationOwner {
    return {
      context,
      sessionId: this.engineCommandManager.engineSessionId,
      projectRevision: this.projectRevision,
    }
  }

  /** Notify visibility consumers only for a new Rust-owned scene receipt. */
  private setDefaultPlanes(
    planes: DefaultPlanes | null,
    generation: number | null | undefined,
    owner: PlanePublicationOwner
  ) {
    if (
      this.destroyed ||
      owner.context !== this.ctxInstance ||
      owner.sessionId !== this.engineCommandManager.engineSessionId ||
      owner.projectRevision !== this.projectRevision
    )
      return

    const previous = this.planePublicationReceipt
    const sameOwner =
      previous &&
      previous.owner.context === owner.context &&
      previous.owner.sessionId === owner.sessionId &&
      previous.owner.projectRevision === owner.projectRevision
    if (sameOwner && generation != null && generation < previous.generation)
      return

    this._defaultPlanes = planes
    if (!planes || generation == null) {
      // Unknown provenance cannot justify suppressing a required replay.
      this.planePublicationReceipt = undefined
      if (planes) this.planesCreated.dispatch()
      return
    }
    if (
      sameOwner &&
      generation === previous.generation &&
      planes.xy === previous.planes.xy &&
      planes.xz === previous.planes.xz &&
      planes.yz === previous.planes.yz &&
      planes.negXy === previous.planes.negXy &&
      planes.negXz === previous.planes.negXz &&
      planes.negYz === previous.planes.negYz
    )
      return

    this.planePublicationReceipt = { owner, generation, planes: { ...planes } }
    this.planesCreated.dispatch()
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
    const planeOwner = this.capturePlaneOwner(instance)

    try {
      const result = await instance.bustCacheAndResetScene(
        JSON.stringify(settings),
        path
      )

      /* Set the default planes, safe to call after execute. */
      const outcome = execStateFromRust(result)

      this.setDefaultPlanes(
        outcome.defaultPlanes,
        outcome.engineSceneGeneration,
        planeOwner
      )

      // Return the result.
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(
        err.defaultPlanes,
        err.engineSceneGeneration,
        planeOwner
      )
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
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.sketch_execute_mock(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(jsAppSettings(this.settingsActor))
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

  /** Add a new sketch and enter sketch mode. */
  async newSketch(
    project: ApiProjectId,
    file: ApiFileId,
    version: ApiVersion,
    sketchArgs: SketchCtor
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
        JSON.stringify(jsAppSettings(this.settingsActor))
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
    sketch: ApiObjectId
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
        JSON.stringify(jsAppSettings(this.settingsActor))
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
        JSON.stringify(jsAppSettings(this.settingsActor))
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

  /** Edit segments and optional constraint label positions in one sketch execution. */
  async editSegments(
    version: ApiVersion,
    sketch: ApiObjectId,
    segments: ExistingSegmentCtor[],
    settings: DeepPartial<Configuration>,
    createCheckpoint = false,
    anchorSegmentIds?: ApiObjectId[],
    commitSolverResults = true,
    dragAnchors: SegmentDragAnchor[] = [],
    constraintLabelEdits: ConstraintLabelPositionEdit[] = []
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      if (!commitSolverResults && createCheckpoint) {
        return Promise.reject(
          new Error('Preview segment edits cannot create sketch checkpoints')
        )
      }

      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.edit_segments(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(segments),
        JSON.stringify(settings),
        createCheckpoint,
        JSON.stringify(anchorSegmentIds ?? null),
        JSON.stringify(dragAnchors),
        commitSolverResults,
        JSON.stringify(constraintLabelEdits)
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
  async editConstraintValue(
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
      } = await instance.edit_constraint_value(
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

  async editAngleConstraint(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraintId: ApiObjectId,
    constraint: Extract<ApiConstraint, { type: 'Angle' }>,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false,
    commitSolverResults = true
  ): Promise<SketchMutationResult> {
    const instance =
      (await this._checkContextInstance()) as ContextWithAngleConstraintEdit

    try {
      if (!commitSolverResults && createCheckpoint) {
        return Promise.reject(
          new Error('Preview angle edits cannot create sketch checkpoints')
        )
      }

      const result = await instance.edit_angle_constraint(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraintId),
        JSON.stringify(constraint),
        JSON.stringify(settings),
        createCheckpoint,
        commitSolverResults
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

  async editDistanceConstraint(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraintId: ApiObjectId,
    constraint: Extract<
      ApiConstraint,
      { type: 'Distance' | 'HorizontalDistance' | 'VerticalDistance' }
    >,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false,
    commitSolverResults = true
  ): Promise<SketchMutationResult> {
    const instance =
      (await this._checkContextInstance()) as ContextWithDistanceConstraintEdit

    try {
      if (!commitSolverResults && createCheckpoint) {
        return Promise.reject(
          new Error('Preview distance edits cannot create sketch checkpoints')
        )
      }

      const result = await instance.edit_distance_constraint(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraintId),
        JSON.stringify(constraint),
        JSON.stringify(settings),
        createCheckpoint,
        commitSolverResults
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

  async editDistanceConstraintLabelPosition(
    version: ApiVersion,
    sketch: ApiObjectId,
    constraintId: ApiObjectId,
    labelPosition: ApiPoint2d<Number>,
    settings: DeepPartial<Configuration>,
    createCheckpoint = false,
    anchorSegmentIds: ApiObjectId[] = [],
    commitSolverResults = true
  ): Promise<SketchMutationResult> {
    const instance = await this._checkContextInstance()

    try {
      if (!commitSolverResults && createCheckpoint) {
        return Promise.reject(
          new Error('Preview label edits cannot create sketch checkpoints')
        )
      }

      const result: {
        sourceDelta: SourceDelta
        sceneGraphDelta: SceneGraphDelta
        checkpointId?: number | null
      } = await instance.edit_distance_constraint_label_position(
        JSON.stringify(version),
        JSON.stringify(sketch),
        JSON.stringify(constraintId),
        JSON.stringify(labelPosition),
        JSON.stringify(settings),
        createCheckpoint,
        JSON.stringify(anchorSegmentIds),
        commitSolverResults
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
    while (!this.destroyed) {
      if (this.ctxInstance) return this.ctxInstance
      const initialization = this.initialization
      if (!initialization) break
      const signal = this.contextChanged.signal
      const changed = Promise.withResolvers<null>()
      const onChanged = () => changed.resolve(null)
      signal.addEventListener('abort', onChanged, { once: true })
      try {
        const context = await Promise.race([initialization, changed.promise])
        if (context && initialization === this.initialization) return context
      } catch (error) {
        if (initialization === this.initialization && !this.destroyed)
          return Promise.reject(error)
      } finally {
        signal.removeEventListener('abort', onChanged)
      }
    }
    return Promise.reject(new Error('Rust context has been destroyed.'))
  }

  /** Clean up resources */
  destroy() {
    this.destroyed = true
    this.planePublicationReceipt = undefined
    this.ctxInstance = null
    this.initialization = undefined
    this._defaultPlanes = null
    this.hasOpenedProject = false
    this.contextChanged.abort()
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

type ContextWithAngleConstraintEdit = Context & {
  edit_angle_constraint(
    versionJson: string,
    sketchJson: string,
    constraintIdJson: string,
    constraintJson: string,
    settings: string,
    createCheckpoint: boolean,
    commitSolverResults: boolean
  ): Promise<{
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  }>
}

type ContextWithDistanceConstraintEdit = Context & {
  edit_distance_constraint(
    versionJson: string,
    sketchJson: string,
    constraintIdJson: string,
    constraintJson: string,
    settings: string,
    createCheckpoint: boolean,
    commitSolverResults: boolean
  ): Promise<{
    sourceDelta: SourceDelta
    sceneGraphDelta: SceneGraphDelta
    checkpointId?: number | null
  }>
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
