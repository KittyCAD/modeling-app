import { executeAst, executeAstMock, lintAst } from 'lang/langHelpers'
import { handleSelectionBatch, Selections } from 'lib/selections'
import {
  KCLError,
  compilationErrorsToDiagnostics,
  kclErrorsToDiagnostics,
} from './errors'
import { uuidv4, isOverlap, deferExecution } from 'lib/utils'
import { EngineCommandManager } from './std/engineConnection'
import { err, reportRejection } from 'lib/trap'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from 'lib/constants'
import { buildArtifactIndex } from 'lib/artifactIndex'
import { ArtifactIndex } from 'lib/artifactIndex'

import {
  emptyExecState,
  ExecState,
  getKclVersion,
  initPromise,
  jsAppSettings,
  KclValue,
  parse,
  PathToNode,
  Program,
  recast,
  SourceRange,
  topLevelRange,
  VariableMap,
  ArtifactGraph,
} from 'lang/wasm'
import { getNodeFromPath, getSettingsAnnotation } from './queryAst'
import {
  codeManager,
  editorManager,
  sceneInfra,
  rustContext,
} from 'lib/singletons'
import { Diagnostic } from '@codemirror/lint'
import { markOnce } from 'lib/performance'
import { Node } from '@rust/kcl-lib/bindings/Node'
import {
  EntityType_type,
  ModelingCmdReq_type,
} from '@kittycad/lib/dist/types/src/models'
import { Operation } from '@rust/kcl-lib/bindings/Operation'
import { KclSettingsAnnotation } from 'lib/settings/settingsTypes'

interface ExecuteArgs {
  ast?: Node<Program>
  executionId?: number
}

export class KclManager {
  /**
   * The artifactGraph is a client-side representation of the commands that have been sent
   * see: src/lang/std/artifactGraph-README.md for a full explanation.
   */
  artifactGraph: ArtifactGraph = new Map()
  artifactIndex: ArtifactIndex = []
  defaultPlanesShown: boolean = false

  private _ast: Node<Program> = {
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
  private _execState: ExecState = emptyExecState()
  private _variables: VariableMap = {}
  lastSuccessfulVariables: VariableMap = {}
  lastSuccessfulOperations: Operation[] = []
  private _logs: string[] = []
  private _errors: KCLError[] = []
  private _diagnostics: Diagnostic[] = []
  private _isExecuting = false
  private _executeIsStale: ExecuteArgs | null = null
  private _wasmInitFailed = true
  private _astParseFailed = false
  private _switchedFiles = false
  private _fileSettings: KclSettingsAnnotation = {}
  private _kclVersion: string | undefined = undefined

  engineCommandManager: EngineCommandManager

  private _isExecutingCallback: (arg: boolean) => void = () => {}
  private _astCallBack: (arg: Node<Program>) => void = () => {}
  private _variablesCallBack: (arg: {
    [key in string]?: KclValue | undefined
  }) => void = () => {}
  private _logsCallBack: (arg: string[]) => void = () => {}
  private _kclErrorsCallBack: (errors: KCLError[]) => void = () => {}
  private _diagnosticsCallback: (errors: Diagnostic[]) => void = () => {}
  private _wasmInitFailedCallback: (arg: boolean) => void = () => {}
  private _executeCallback: () => void = () => {}

  get ast() {
    return this._ast
  }
  set ast(ast) {
    this._ast = ast
    this._astCallBack(ast)
  }

  set switchedFiles(switchedFiles: boolean) {
    this._switchedFiles = switchedFiles
  }

  get variables() {
    return this._variables
  }
  // This is private because callers should be setting the entire execState.
  private set variables(variables) {
    this._variables = variables
    this._variablesCallBack(variables)
  }

  private set execState(execState) {
    this._execState = execState
    this.variables = execState.variables
  }

  get execState() {
    return this._execState
  }

  // Get the kcl version from the wasm module
  // and store it in the singleton
  // so we don't waste time getting it multiple times
  get kclVersion() {
    if (this._kclVersion === undefined) {
      this._kclVersion = getKclVersion()
    }
    return this._kclVersion
  }

  get errors() {
    return this._errors
  }
  set errors(errors) {
    this._errors = errors
    this._kclErrorsCallBack(errors)
  }
  get logs() {
    return this._logs
  }
  set logs(logs) {
    this._logs = logs
    this._logsCallBack(logs)
  }

  get diagnostics() {
    return this._diagnostics
  }

  set diagnostics(ds) {
    if (ds === this._diagnostics) return
    this._diagnostics = ds
    this.setDiagnosticsForCurrentErrors()
  }

  addDiagnostics(ds: Diagnostic[]) {
    if (ds.length === 0) return
    this.diagnostics = this.diagnostics.concat(ds)
  }

  hasErrors(): boolean {
    return this._astParseFailed || this._errors.length > 0
  }

  setDiagnosticsForCurrentErrors() {
    editorManager?.setDiagnostics(this.diagnostics)
    this._diagnosticsCallback(this.diagnostics)
  }

  get isExecuting() {
    return this._isExecuting
  }

  set isExecuting(isExecuting) {
    this._isExecuting = isExecuting
    // If we have finished executing, but the execute is stale, we should
    // execute again.
    if (!isExecuting && this.executeIsStale) {
      const args = this.executeIsStale
      this.executeIsStale = null
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      this.executeAst(args)
    }
    this._isExecutingCallback(isExecuting)
  }

  get executeIsStale() {
    return this._executeIsStale
  }

  set executeIsStale(executeIsStale) {
    this._executeIsStale = executeIsStale
  }

  get wasmInitFailed() {
    return this._wasmInitFailed
  }
  set wasmInitFailed(wasmInitFailed) {
    this._wasmInitFailed = wasmInitFailed
    this._wasmInitFailedCallback(wasmInitFailed)
  }

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager

    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    this.ensureWasmInit().then(async () => {
      await this.safeParse(codeManager.code).then((ast) => {
        if (ast) {
          this.ast = ast
        }
      })
    })
  }

  registerCallBacks({
    setVariables,
    setAst,
    setLogs,
    setErrors,
    setDiagnostics,
    setIsExecuting,
    setWasmInitFailed,
  }: {
    setVariables: (arg: VariableMap) => void
    setAst: (arg: Node<Program>) => void
    setLogs: (arg: string[]) => void
    setErrors: (errors: KCLError[]) => void
    setDiagnostics: (errors: Diagnostic[]) => void
    setIsExecuting: (arg: boolean) => void
    setWasmInitFailed: (arg: boolean) => void
  }) {
    this._variablesCallBack = setVariables
    this._astCallBack = setAst
    this._logsCallBack = setLogs
    this._kclErrorsCallBack = setErrors
    this._diagnosticsCallback = setDiagnostics
    this._isExecutingCallback = setIsExecuting
    this._wasmInitFailedCallback = setWasmInitFailed
  }
  registerExecuteCallback(callback: () => void) {
    this._executeCallback = callback
  }

  clearAst() {
    this._ast = {
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
      await rustContext.clearSceneAndBustCache(
        { settings: await jsAppSettings() },
        codeManager.currentFilePath || undefined
      )
    } else if (this._switchedFiles) {
      // Reset the switched files boolean.
      this._switchedFiles = false
    }
  }

  private async updateArtifactGraph(
    execStateArtifactGraph: ExecState['artifactGraph']
  ) {
    this.artifactGraph = execStateArtifactGraph
    this.artifactIndex = buildArtifactIndex(execStateArtifactGraph)
    if (this.artifactGraph.size) {
      // TODO: we wanna remove this logic from xstate, it is racey
      // This defer is bullshit but playwright wants it
      // It was like this in engineConnection.ts already
      deferExecution((a?: null) => {
        this.engineCommandManager.modelingSend({
          type: 'Artifact graph emptied',
        })
      }, 200)(null)
    } else {
      deferExecution((a?: null) => {
        this.engineCommandManager.modelingSend({
          type: 'Artifact graph populated',
        })
      }, 200)(null)
    }
  }

  // Some "objects" have the same source range, such as sketch_mode_start and start_path.
  // So when passing a range, we need to also specify the command type
  private mapRangeToObjectId(
    range: SourceRange,
    commandTypeToTarget: string
  ): string | undefined {
    for (const [artifactId, artifact] of this.artifactGraph) {
      if (
        'codeRef' in artifact &&
        artifact.codeRef &&
        isOverlap(range, artifact.codeRef.range)
      ) {
        if (commandTypeToTarget === artifact.type) return artifactId
      }
    }
    return undefined
  }

  async safeParse(code: string): Promise<Node<Program> | null> {
    const result = parse(code)
    this.diagnostics = []
    this._astParseFailed = false

    if (err(result)) {
      const kclError: KCLError = result as KCLError
      this.diagnostics = kclErrorsToDiagnostics([kclError])
      this._astParseFailed = true

      await this.checkIfSwitchedFilesShouldClear()
      return null
    }

    // GOTCHA:
    // When we safeParse this is tied to execution because they clicked a new file to load
    // Clear all previous errors and logs because they are old since they executed a new file
    // If we decouple safeParse from execution we need to move this application logic.
    this._kclErrorsCallBack([])
    this._logsCallBack([])

    this.addDiagnostics(compilationErrorsToDiagnostics(result.errors))
    this.addDiagnostics(compilationErrorsToDiagnostics(result.warnings))
    if (result.errors.length > 0) {
      this._astParseFailed = true

      await this.checkIfSwitchedFilesShouldClear()
      return null
    }

    return result.program
  }

  async ensureWasmInit() {
    try {
      await initPromise
      if (this.wasmInitFailed) {
        this.wasmInitFailed = false
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
    } catch (e) {
      console.error(e)
      this.wasmInitFailed = true
    }
  }

  private _cancelTokens: Map<number, boolean> = new Map()

  // This NEVER updates the code, if you want to update the code DO NOT add to
  // this function, too many other things that don't want it exist. For that,
  // use updateModelingState().
  async executeAst(args: ExecuteArgs = {}): Promise<void> {
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
    await this.ensureWasmInit()
    const { logs, errors, execState, isInterrupted } = await executeAst({
      ast,
      path: codeManager.currentFilePath || undefined,
      rustContext,
    })

    // Program was not interrupted, setup the scene
    // Do not send send scene commands if the program was interrupted, go to clean up
    if (!isInterrupted) {
      this.addDiagnostics(await lintAst({ ast: ast }))
      await setSelectionFilterToDefault(this.engineCommandManager)
    }

    this.isExecuting = false

    // Check the cancellation token for this execution before applying side effects
    if (this._cancelTokens.get(currentExecutionId)) {
      this._cancelTokens.delete(currentExecutionId)
      return
    }

    // Exit sketch mode if the AST is empty
    if (this._isAstEmpty(ast)) {
      await this.disableSketchMode()
    }

    let fileSettings = getSettingsAnnotation(ast)
    if (err(fileSettings)) {
      console.error(fileSettings)
      fileSettings = {}
    }
    this.fileSettings = fileSettings

    this.logs = logs
    this.errors = errors
    // Do not add the errors since the program was interrupted and the error is not a real KCL error
    this.addDiagnostics(isInterrupted ? [] : kclErrorsToDiagnostics(errors))
    // Add warnings and non-fatal errors
    this.addDiagnostics(
      isInterrupted ? [] : compilationErrorsToDiagnostics(execState.errors)
    )
    this.execState = execState
    if (!errors.length) {
      this.lastSuccessfulVariables = execState.variables
      this.lastSuccessfulOperations = execState.operations
    }
    this.ast = { ...ast }
    // updateArtifactGraph relies on updated executeState/variables
    await this.updateArtifactGraph(execState.artifactGraph)
    this._executeCallback()
    if (!isInterrupted) {
      sceneInfra.modelingSend({ type: 'code edit during sketch' })
    }
    this.engineCommandManager.addCommandLog({
      type: 'execution-done',
      data: null,
    })

    this._cancelTokens.delete(currentExecutionId)
    markOnce('code/endExecuteAst')
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
      type: 'execution-done',
      data: null,
    })
    markOnce('code/endExecuteAst')
  }

  // DO NOT CALL THIS from codemirror ever.
  async executeAstMock(ast: Program) {
    await this.ensureWasmInit()

    const newCode = recast(ast)
    if (err(newCode)) {
      console.error(newCode)
      return
    }
    const newAst = await this.safeParse(newCode)
    if (!newAst) {
      // By clearing the AST we indicate to our callers that there was an issue with execution and
      // the pre-execution state should be restored.
      this.clearAst()
      return
    }
    this._ast = { ...newAst }

    const { logs, errors, execState } = await executeAstMock({
      ast: newAst,
      rustContext,
    })

    this._logs = logs
    this._execState = execState
    this._variables = execState.variables
    if (!errors.length) {
      this.lastSuccessfulVariables = execState.variables
      this.lastSuccessfulOperations = execState.operations
    }
  }
  cancelAllExecutions() {
    this._cancelTokens.forEach((_, key) => {
      this._cancelTokens.set(key, true)
    })
  }
  async executeCode(): Promise<void> {
    const ast = await this.safeParse(codeManager.code)

    if (!ast) {
      // By clearing the AST we indicate to our callers that there was an issue with execution and
      // the pre-execution state should be restored.
      this.clearAst()
      return
    }

    this.ast = { ...ast }
    return this.executeAst()
  }

  async format() {
    const originalCode = codeManager.code
    const ast = await this.safeParse(originalCode)
    if (!ast) {
      this.clearAst()
      return
    }
    const code = recast(ast)
    if (err(code)) {
      console.error(code)
      return
    }
    if (originalCode === code) return

    // Update the code state and the editor.
    codeManager.updateCodeStateEditor(code)

    // Write back to the file system.
    void codeManager
      .writeToFile()
      .then(() => this.executeCode())
      .catch(reportRejection)
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
    const newCode = recast(ast)
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
          path
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
      await this.executeAstMock(astWithUpdatedSource)
    }

    return { selections: returnVal, newAst: astWithUpdatedSource }
  }

  get defaultPlanes() {
    return rustContext.defaultPlanes
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
  /** TODO: this function is hiding unawaited asynchronous work */
  defaultSelectionFilter(selectionsToRestore?: Selections) {
    setSelectionFilterToDefault(this.engineCommandManager, selectionsToRestore)
  }
  /** TODO: this function is hiding unawaited asynchronous work */
  setSelectionFilter(filter: EntityType_type[]) {
    setSelectionFilter(filter, this.engineCommandManager)
  }

  /**
   * We can send a single command of 'enable_sketch_mode' or send this in a batched request.
   * When there is no code in the KCL editor we should be sending 'sketch_mode_disable' since any previous half finished
   * code could leave the state of the application in sketch mode on the engine side.
   */
  async disableSketchMode() {
    await this.engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: { type: 'sketch_mode_disable' },
    })
  }

  // Determines if there is no KCL code which means it is executing a blank KCL file
  _isAstEmpty(ast: Node<Program>) {
    return ast.start === 0 && ast.end === 0 && ast.body.length === 0
  }

  get fileSettings() {
    return this._fileSettings
  }

  set fileSettings(settings: KclSettingsAnnotation) {
    this._fileSettings = settings
  }
}

const defaultSelectionFilter: EntityType_type[] = [
  'face',
  'edge',
  'solid2d',
  'curve',
  'object',
]

/** TODO: This function is not synchronous but is currently treated as such */
function setSelectionFilterToDefault(
  engineCommandManager: EngineCommandManager,
  selectionsToRestore?: Selections
) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  setSelectionFilter(
    defaultSelectionFilter,
    engineCommandManager,
    selectionsToRestore
  )
}

/** TODO: This function is not synchronous but is currently treated as such */
function setSelectionFilter(
  filter: EntityType_type[],
  engineCommandManager: EngineCommandManager,
  selectionsToRestore?: Selections
) {
  const { engineEvents } = selectionsToRestore
    ? handleSelectionBatch({
        selections: selectionsToRestore,
      })
    : { engineEvents: undefined }
  if (!selectionsToRestore || !engineEvents) {
    // eslint-disable-next-line @typescript-eslint/no-floating-promises
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_selection_filter',
        filter,
      },
    })
    return
  }
  const modelingCmd: ModelingCmdReq_type[] = []
  engineEvents.forEach((event) => {
    if (event.type === 'modeling_cmd_req') {
      modelingCmd.push({
        cmd_id: uuidv4(),
        cmd: event.cmd,
      })
    }
  })
  // batch is needed other wise the selection flickers.
  engineCommandManager
    .sendSceneCommand({
      type: 'modeling_cmd_batch_req',
      batch_id: uuidv4(),
      requests: [
        {
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter,
          },
        },
        ...modelingCmd,
      ],
      responses: false,
    })
    .catch(reportError)
}
