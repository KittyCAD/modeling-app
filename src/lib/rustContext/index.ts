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

interface ProjectSnapshot {
  currentFilePath: string | null
  files: ApiFile[]
}

export default class RustContext {
  private ctxInstance: Context | null = null
  private initialization: Promise<Context> | undefined
  private contextChanged = new AbortController()
  private moduleGeneration = 0
  private destroyed = false
  private projectSnapshot: ProjectSnapshot | null = null
  private projectRevision = 0
  private restoredProjectRevision = -1
  private _defaultPlanes: DefaultPlanes | null = null
  public readonly planesCreated = new LegacySignal()

  constructor(
    private modulePromise: Promise<ModuleType>,
    private readonly engineCommandManager: ConnectionManager,
    public readonly settingsActor: SettingsActorType,
    private projectId = 0,
    private readonly geometryOnly = false
  ) {
    this.initialization = this.createContextFromWasm(modulePromise, 0)
    void this.initialization.catch((error: unknown) => {
      if (!this.destroyed && this.moduleGeneration === 0) reportRejection(error)
    })
  }

  get wasmInstancePromise() {
    return this.modulePromise
  }

  /** Replace a crashed runtime, never the execution cache of a live runtime. */
  async replaceWasmInstance(modulePromise: Promise<ModuleType>): Promise<void> {
    if (this.destroyed)
      return Promise.reject(new Error('Rust context has been destroyed.'))
    const changed = this.contextChanged
    this.contextChanged = new AbortController()
    this.modulePromise = modulePromise
    this.moduleGeneration += 1
    // Published wrappers may still be held by in-flight AST calls. Their
    // wasm-bindgen finalizer frees them after those references are released.
    this.ctxInstance = null
    this._defaultPlanes = null
    this.hasOpenedProject = false
    this.restoredProjectRevision = -1
    this.initialization = this.createContextFromWasm(
      modulePromise,
      this.moduleGeneration
    )
    changed.abort()
    await this._checkContextInstance()
  }

  private async createContextFromWasm(
    modulePromise: Promise<ModuleType>,
    generation: number
  ): Promise<Context> {
    const instance = await modulePromise
    if (this.destroyed || generation !== this.moduleGeneration)
      return this._checkContextInstance()
    const context = new instance.Context(
      this.engineCommandManager,
      projectFsManager,
      undefined,
      this.geometryOnly
    )
    try {
      let revision: number
      do {
        revision = this.projectRevision
        const snapshot = this.projectSnapshot
        if (snapshot) {
          await context.open_project(
            this.projectId,
            JSON.stringify(snapshot.files),
            snapshot.files.find(
              (file) => file.path === snapshot.currentFilePath
            )?.id ?? -1
          )
        }
        if (this.destroyed || generation !== this.moduleGeneration) {
          this.releaseUnpublishedContext(context)
          return this._checkContextInstance()
        }
        // Edits received while replay was pending belong in the replacement
        // too. Reopen only this unpublished context, never an existing model.
      } while (revision !== this.projectRevision)
      this.ctxInstance = context
      this.restoredProjectRevision = revision
      this.hasOpenedProject = this.projectSnapshot !== null
      return context
    } catch (error) {
      this.releaseUnpublishedContext(context)
      if (this.destroyed || generation !== this.moduleGeneration)
        return this._checkContextInstance()
      return Promise.reject(error)
    }
  }

  private releaseUnpublishedContext(context: Context) {
    try {
      context.free()
    } catch (error) {
      reportRejection(error)
    }
  }

  private async applyProjectChange(
    snapshot: ProjectSnapshot | null,
    revision: number,
    apply: (context: Context) => Promise<void>
  ): Promise<boolean> {
    const context = await this._checkContextInstance()
    if (snapshot !== this.projectSnapshot) return false
    if (snapshot && revision <= this.restoredProjectRevision)
      return this.hasOpenedProject
    await apply(context)
    return context === this.ctxInstance && snapshot === this.projectSnapshot
  }

  public hasOpenedProject = false

  /** Project lifecycle method for WASM, setting up initial snapshot of project */
  async sendOpenProject(currentFilePath: string | null, kclFiles: ApiFile[]) {
    const snapshot = {
      currentFilePath,
      files: kclFiles.map((file) => ({ ...file })),
    }
    this.projectSnapshot = snapshot
    this.hasOpenedProject = false
    const applied = await this.applyProjectChange(
      snapshot,
      ++this.projectRevision,
      (context) =>
        context.open_project(
          this.projectId,
          JSON.stringify(snapshot.files),
          snapshot.files.find((file) => file.path === currentFilePath)?.id ?? -1
        )
    )
    if (applied) this.hasOpenedProject = true
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
    const snapshot = this.projectSnapshot
    const ownedFile = { ...file }
    if (snapshot)
      snapshot.files = [
        ...snapshot.files.filter((current) => current.id !== file.id),
        ownedFile,
      ]
    await this.applyProjectChange(snapshot, ++this.projectRevision, (context) =>
      context.add_file(this.projectId, JSON.stringify(ownedFile))
    )
  }

  async sendUpdateFile(fileId: number, code: string) {
    const snapshot = this.projectSnapshot
    if (!snapshot) {
      return
    }
    snapshot.files = snapshot.files.map((file) =>
      file.id === fileId ? { ...file, text: code } : file
    )
    await this.applyProjectChange(snapshot, ++this.projectRevision, (context) =>
      context.update_file(this.projectId, fileId, code)
    )
  }

  async sendRemoveFile(fileId: number) {
    const snapshot = this.projectSnapshot
    if (snapshot)
      snapshot.files = snapshot.files.filter((file) => file.id !== fileId)
    await this.applyProjectChange(snapshot, ++this.projectRevision, (context) =>
      context.remove_file(this.projectId, fileId)
    )
  }

  /** Execute a program. */
  async execute(
    node: Node<Program>,
    settings: DeepPartial<Configuration>,
    path?: string,
    callbacks?: ExecCallbacks
  ): Promise<ExecState> {
    const instance = await this._checkContextInstance()
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
    usePrevMemory?: boolean,
    callbacks?: ExecCallbacks
  ): Promise<ExecState> {
    const instance = await this._checkContextInstance()
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
      this.setDefaultPlanes(outcome.defaultPlanes)
      return outcome
    } catch (e: any) {
      const err = errFromErrWithOutputs(e)
      this.setDefaultPlanes(err.defaultPlanes)
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
    try {
      const parsed: ParsedExecutionSource = await instance.parseForExecution(
        code,
        JSON.stringify(settings),
        path
      )
      this.setDefaultPlanes(parsed.default_planes)
      return new ParseResult(
        parsed.program,
        parsed.kcl_version,
        parsed.issues.filter((issue) => issue.severity !== 'Warning'),
        parsed.issues.filter((issue) => issue.severity === 'Warning')
      )
    } catch (error) {
      const failure = errFromErrWithOutputs(error)
      this.setDefaultPlanes(failure.defaultPlanes)
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

  /** Internal setter for default planes that emits a planesCreated signal when planes are available */
  private setDefaultPlanes(planes: DefaultPlanes | null) {
    this._defaultPlanes = planes
    if (planes) {
      this.planesCreated.dispatch()
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
    this.moduleGeneration += 1
    this.ctxInstance = null
    this.initialization = undefined
    this.projectSnapshot = null
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
