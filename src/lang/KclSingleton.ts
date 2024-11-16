import { executeAst, lintAst } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { KCLError, kclErrorsToDiagnostics } from './errors'
import { uuidv4 } from 'lib/utils'
import { EngineCommandManager } from './std/engineConnection'
import { err } from 'lib/trap'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from 'lib/constants'

import {
  CallExpression,
  emptyExecState,
  ExecState,
  initPromise,
  parse,
  PathToNode,
  Program,
  ProgramMemory,
  recast,
  SourceRange,
} from 'lang/wasm'
import { getNodeFromPath } from './queryAst'
import { codeManager, editorManager, sceneInfra } from 'lib/singletons'
import { Diagnostic } from '@codemirror/lint'
import { markOnce } from 'lib/performance'
import { Node } from 'wasm-lib/kcl/bindings/Node'

interface ExecuteArgs {
  ast?: Node<Program>
  zoomToFit?: boolean
  executionId?: number
  zoomOnRangeAndType?: {
    range: SourceRange
    type: string
  }
}

export class KclManager {
  private _ast: Node<Program> = {
    body: [],
    start: 0,
    end: 0,
    moduleId: 0,
    nonCodeMeta: {
      nonCodeNodes: {},
      startNodes: [],
    },
  }
  private _execState: ExecState = emptyExecState()
  private _programMemory: ProgramMemory = ProgramMemory.empty()
  lastSuccessfulProgramMemory: ProgramMemory = ProgramMemory.empty()
  private _logs: string[] = []
  private _lints: Diagnostic[] = []
  private _kclErrors: KCLError[] = []
  private _isExecuting = false
  private _executeIsStale: ExecuteArgs | null = null
  private _wasmInitFailed = true

  engineCommandManager: EngineCommandManager

  private _isExecutingCallback: (arg: boolean) => void = () => {}
  private _astCallBack: (arg: Node<Program>) => void = () => {}
  private _programMemoryCallBack: (arg: ProgramMemory) => void = () => {}
  private _logsCallBack: (arg: string[]) => void = () => {}
  private _kclErrorsCallBack: (arg: KCLError[]) => void = () => {}
  private _wasmInitFailedCallback: (arg: boolean) => void = () => {}
  private _executeCallback: () => void = () => {}

  get ast() {
    return this._ast
  }
  set ast(ast) {
    this._ast = ast
    this._astCallBack(ast)
  }

  get programMemory() {
    return this._programMemory
  }
  // This is private because callers should be setting the entire execState.
  private set programMemory(programMemory) {
    this._programMemory = programMemory
    this._programMemoryCallBack(programMemory)
  }

  set execState(execState) {
    this._execState = execState
    this.programMemory = execState.memory
  }

  get execState() {
    return this._execState
  }

  get logs() {
    return this._logs
  }
  set logs(logs) {
    this._logs = logs
    this._logsCallBack(logs)
  }

  get lints() {
    return this._lints
  }

  set lints(lints) {
    if (lints === this._lints) return
    this._lints = lints
    // Run the lints through the diagnostics.
    this.kclErrors = this._kclErrors
  }

  get kclErrors() {
    return this._kclErrors
  }
  set kclErrors(kclErrors) {
    if (kclErrors === this._kclErrors && this.lints.length === 0) return
    this._kclErrors = kclErrors
    this.setDiagnosticsForCurrentErrors()
    this._kclErrorsCallBack(kclErrors)
  }

  setDiagnosticsForCurrentErrors() {
    let diagnostics = kclErrorsToDiagnostics(this.kclErrors)
    if (this.lints.length > 0) {
      diagnostics = diagnostics.concat(this.lints)
    }
    editorManager?.setDiagnostics(diagnostics)
  }

  addKclErrors(kclErrors: KCLError[]) {
    if (kclErrors.length === 0) return
    this.kclErrors = this.kclErrors.concat(kclErrors)
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
    this.ensureWasmInit().then(() => {
      this.ast = this.safeParse(codeManager.code) || this.ast
    })
  }

  registerCallBacks({
    setProgramMemory,
    setAst,
    setLogs,
    setKclErrors,
    setIsExecuting,
    setWasmInitFailed,
  }: {
    setProgramMemory: (arg: ProgramMemory) => void
    setAst: (arg: Node<Program>) => void
    setLogs: (arg: string[]) => void
    setKclErrors: (arg: KCLError[]) => void
    setIsExecuting: (arg: boolean) => void
    setWasmInitFailed: (arg: boolean) => void
  }) {
    this._programMemoryCallBack = setProgramMemory
    this._astCallBack = setAst
    this._logsCallBack = setLogs
    this._kclErrorsCallBack = setKclErrors
    this._isExecutingCallback = setIsExecuting
    this._wasmInitFailedCallback = setWasmInitFailed
  }
  registerExecuteCallback(callback: () => void) {
    this._executeCallback = callback
  }

  clearAst() {
    this._ast = {
      body: [],
      start: 0,
      end: 0,
      moduleId: 0,
      nonCodeMeta: {
        nonCodeNodes: {},
        startNodes: [],
      },
    }
  }

  safeParse(code: string): Node<Program> | null {
    const ast = parse(code)
    this.lints = []
    this.kclErrors = []
    if (!err(ast)) return ast
    const kclerror: KCLError = ast as KCLError

    this.addKclErrors([kclerror])
    // TODO: re-eval if session should end?
    if (kclerror.msg === 'file is empty')
      this.engineCommandManager?.endSession()
    return null
  }

  async ensureWasmInit() {
    try {
      await initPromise
      if (this.wasmInitFailed) {
        this.wasmInitFailed = false
      }
    } catch (e) {
      this.wasmInitFailed = true
    }
  }

  private _cancelTokens: Map<number, boolean> = new Map()

  // This NEVER updates the code, if you want to update the code DO NOT add to
  // this function, too many other things that don't want it exist.
  // just call to codeManager from wherever you want in other files.
  async executeAst(args: ExecuteArgs = {}): Promise<void> {
    if (this.isExecuting) {
      this.executeIsStale = args

      // The previous execteAst will be rejected and cleaned up. The execution will be marked as stale.
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
    // Make sure we clear before starting again. End session will do this.
    this.engineCommandManager?.endSession()
    await this.ensureWasmInit()
    const { logs, errors, execState, isInterrupted } = await executeAst({
      ast,
      idGenerator: this.execState.idGenerator,
      engineCommandManager: this.engineCommandManager,
    })

    // Program was not interrupted, setup the scene
    // Do not send send scene commands if the program was interrupted, go to clean up
    if (!isInterrupted) {
      this.lints = await lintAst({ ast: ast })

      sceneInfra.modelingSend({ type: 'code edit during sketch' })
      defaultSelectionFilter(execState.memory, this.engineCommandManager)

      if (args.zoomToFit) {
        let zoomObjectId: string | undefined = ''
        if (args.zoomOnRangeAndType) {
          zoomObjectId = this.engineCommandManager?.mapRangeToObjectId(
            args.zoomOnRangeAndType.range,
            args.zoomOnRangeAndType.type
          )
        }

        await this.engineCommandManager.sendSceneCommand({
          type: 'modeling_cmd_req',
          cmd_id: uuidv4(),
          cmd: {
            type: 'zoom_to_fit',
            object_ids: zoomObjectId ? [zoomObjectId] : [], // leave empty to zoom to all objects
            padding: 0.1, // padding around the objects
            animated: false, // don't animate the zoom for now
          },
        })
      }
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

    this.logs = logs
    // Do not add the errors since the program was interrupted and the error is not a real KCL error
    this.addKclErrors(isInterrupted ? [] : errors)
    // Reset the next ID index so that we reuse the previous IDs next time.
    execState.idGenerator.nextId = 0
    this.execState = execState
    if (!errors.length) {
      this.lastSuccessfulProgramMemory = execState.memory
    }
    this.ast = { ...ast }
    this._executeCallback()
    this.engineCommandManager.addCommandLog({
      type: 'execution-done',
      data: null,
    })

    this._cancelTokens.delete(currentExecutionId)
    markOnce('code/endExecuteAst')
  }
  // NOTE: this always updates the code state and editor.
  // DO NOT CALL THIS from codemirror ever.
  async executeAstMock(
    ast: Program = this._ast,
    {
      updates,
    }: {
      updates: 'none' | 'artifactRanges'
    } = { updates: 'none' }
  ) {
    await this.ensureWasmInit()

    const newCode = recast(ast)
    if (err(newCode)) {
      console.error(newCode)
      return
    }
    const newAst = this.safeParse(newCode)
    if (!newAst) {
      this.clearAst()
      return
    }
    this._ast = { ...newAst }

    const { logs, errors, execState } = await executeAst({
      ast: newAst,
      idGenerator: this.execState.idGenerator,
      engineCommandManager: this.engineCommandManager,
      useFakeExecutor: true,
    })

    this._logs = logs
    this._kclErrors = errors
    this._execState = execState
    this._programMemory = execState.memory
    if (!errors.length) {
      this.lastSuccessfulProgramMemory = execState.memory
    }
    if (updates !== 'artifactRanges') return

    // TODO the below seems like a work around, I wish there's a comment explaining exactly what
    // problem this solves, but either way we should strive to remove it.
    Array.from(this.engineCommandManager.artifactGraph).forEach(
      ([commandId, artifact]) => {
        if (!('codeRef' in artifact)) return
        const _node1 = getNodeFromPath<Node<CallExpression>>(
          this.ast,
          artifact.codeRef.pathToNode,
          'CallExpression'
        )
        if (err(_node1)) return
        const { node } = _node1
        if (node.type !== 'CallExpression') return
        const [oldStart, oldEnd] = artifact.codeRef.range
        if (oldStart === 0 && oldEnd === 0) return
        if (oldStart === node.start && oldEnd === node.end) return
        this.engineCommandManager.artifactGraph.set(commandId, {
          ...artifact,
          codeRef: {
            ...artifact.codeRef,
            range: [node.start, node.end],
          },
        })
      }
    )
  }
  cancelAllExecutions() {
    this._cancelTokens.forEach((_, key) => {
      this._cancelTokens.set(key, true)
    })
  }
  async executeCode(zoomToFit?: boolean): Promise<void> {
    const ast = this.safeParse(codeManager.code)
    if (!ast) {
      this.clearAst()
      return
    }
    this.ast = { ...ast }
    return this.executeAst({ zoomToFit })
  }
  format() {
    const originalCode = codeManager.code
    const ast = this.safeParse(originalCode)
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
    void codeManager.writeToFile().then(() => this.executeCode())
  }
  // There's overlapping responsibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
  // This always updates the code state and editor and writes to the file system.
  async updateAst(
    ast: Node<Program>,
    execute: boolean,
    optionalParams?: {
      focusPath?: Array<PathToNode>
      zoomToFit?: boolean
      zoomOnRangeAndType?: {
        range: SourceRange
        type: string
      }
    }
  ): Promise<{
    newAst: Node<Program>
    selections?: Selections
  }> {
    const newCode = recast(ast)
    if (err(newCode)) return Promise.reject(newCode)

    const astWithUpdatedSource = this.safeParse(newCode)
    if (!astWithUpdatedSource) return Promise.reject(new Error('bad ast'))
    let returnVal: Selections | undefined = undefined

    if (optionalParams?.focusPath) {
      returnVal = {
        codeBasedSelections: [],
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
          returnVal.codeBasedSelections.push({
            type: 'default',
            range: [start, end],
          })
        }
      }
    }

    if (execute) {
      await this.executeAst({
        ast: astWithUpdatedSource,
        zoomToFit: optionalParams?.zoomToFit,
        zoomOnRangeAndType: optionalParams?.zoomOnRangeAndType,
      })
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead..
      // Execute ast mock will update the code state and editor.
      await this.executeAstMock(astWithUpdatedSource)
    }

    return { selections: returnVal, newAst: astWithUpdatedSource }
  }

  get defaultPlanes() {
    return this?.engineCommandManager?.defaultPlanes
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
  defaultSelectionFilter() {
    defaultSelectionFilter(this.programMemory, this.engineCommandManager)
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
}

function defaultSelectionFilter(
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager
) {
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  programMemory.hasSketchOrSolid() &&
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_selection_filter',
        filter: ['face', 'edge', 'solid2d', 'curve'],
      },
    })
}
