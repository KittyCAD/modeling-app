import { executeAst, lintAst } from 'lang/langHelpers'
import { Selections } from 'lib/selections'
import { KCLError, kclErrorsToDiagnostics } from './errors'
import { uuidv4 } from 'lib/utils'
import { EngineCommandManager } from './std/engineConnection'
import { err } from 'lib/trap'

import { deferExecution } from 'lib/utils'
import {
  CallExpression,
  initPromise,
  parse,
  PathToNode,
  Program,
  ProgramMemory,
  recast,
  SketchGroup,
  SourceRange,
  ExtrudeGroup,
} from 'lang/wasm'
import { getNodeFromPath } from './queryAst'
import { codeManager, editorManager, sceneInfra } from 'lib/singletons'

export class KclManager {
  private _ast: Program = {
    body: [],
    start: 0,
    end: 0,
    nonCodeMeta: {
      nonCodeNodes: {},
      start: [],
    },
  }
  private _programMemory: ProgramMemory = {
    root: {},
    return: null,
  }
  private _logs: string[] = []
  private _kclErrors: KCLError[] = []
  private _isExecuting = false
  private _wasmInitFailed = true

  engineCommandManager: EngineCommandManager
  private _defferer = deferExecution((code: string) => {
    const ast = this.safeParse(code)
    if (!ast) {
      this.clearAst()
      return
    }
    try {
      const fmtAndStringify = (ast: Program) =>
        JSON.stringify(parse(recast(ast)))
      const isAstTheSame = fmtAndStringify(ast) === fmtAndStringify(this._ast)
      if (isAstTheSame) return
    } catch (e) {
      console.error(e)
    }
    this.executeAst(ast)
  }, 600)

  private _isExecutingCallback: (arg: boolean) => void = () => {}
  private _astCallBack: (arg: Program) => void = () => {}
  private _programMemoryCallBack: (arg: ProgramMemory) => void = () => {}
  private _logsCallBack: (arg: string[]) => void = () => {}
  private _kclErrorsCallBack: (arg: KCLError[]) => void = () => {}
  private _wasmInitFailedCallback: (arg: boolean) => void = () => {}
  private _executeCallback: () => void = () => {}

  isFirstRender = true

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
  set programMemory(programMemory) {
    this._programMemory = programMemory
    this._programMemoryCallBack(programMemory)
  }

  get logs() {
    return this._logs
  }
  set logs(logs) {
    this._logs = logs
    this._logsCallBack(logs)
  }

  get kclErrors() {
    return this._kclErrors
  }
  set kclErrors(kclErrors) {
    this._kclErrors = kclErrors
    let diagnostics = kclErrorsToDiagnostics(kclErrors)
    editorManager.addDiagnostics(diagnostics)
    this._kclErrorsCallBack(kclErrors)
  }

  get isExecuting() {
    return this._isExecuting
  }
  set isExecuting(isExecuting) {
    this._isExecuting = isExecuting
    this._isExecutingCallback(isExecuting)
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
    setAst: (arg: Program) => void
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
      nonCodeMeta: {
        nonCodeNodes: {},
        start: [],
      },
    }
  }

  safeParse(code: string): Program | null {
    const ast = parse(code)
    this.kclErrors = []
    if (!err(ast)) return ast
    const kclerror: KCLError = ast as KCLError

    console.error('error parsing code', kclerror)
    this.kclErrors = [kclerror]
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
  async executeAst(
    ast: Program = this._ast,
    zoomToFit?: boolean,
    executionId?: number,
    zoomOnRangeAndType?: {
      range: SourceRange
      type: string
    }
  ): Promise<void> {
    await this?.engineCommandManager?.waitForReady
    const currentExecutionId = executionId || Date.now()
    this._cancelTokens.set(currentExecutionId, false)

    // here we're going to clear diagnostics since we're the first
    // one in. We're the only location where diagnostics are cleared;
    // everything from here on out should be *appending*.
    editorManager.clearDiagnostics()

    this.isExecuting = true
    await this.ensureWasmInit()
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager: this.engineCommandManager,
    })

    editorManager.addDiagnostics(await lintAst({ ast: ast }))

    sceneInfra.modelingSend({ type: 'code edit during sketch' })
    defaultSelectionFilter(programMemory, this.engineCommandManager)

    if (zoomToFit) {
      let zoomObjectId: string | undefined = ''
      if (zoomOnRangeAndType) {
        zoomObjectId = this.engineCommandManager?.mapRangeToObjectId(
          zoomOnRangeAndType.range,
          zoomOnRangeAndType.type
        )
      }

      await this.engineCommandManager.sendSceneCommand({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'zoom_to_fit',
          object_ids: zoomObjectId ? [zoomObjectId] : [], // leave empty to zoom to all objects
          padding: 0.1, // padding around the objects
        },
      })
    }

    this.isExecuting = false
    // Check the cancellation token for this execution before applying side effects
    if (this._cancelTokens.get(currentExecutionId)) {
      this._cancelTokens.delete(currentExecutionId)
      return
    }
    this.logs = logs
    this.kclErrors = errors
    this.programMemory = programMemory
    this.ast = { ...ast }
    this._executeCallback()
    this.engineCommandManager.addCommandLog({
      type: 'execution-done',
      data: null,
    })
    this._cancelTokens.delete(currentExecutionId)
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
    codeManager.updateCodeEditor(newCode)
    // Write the file to disk.
    await codeManager.writeToFile()
    await this?.engineCommandManager?.waitForReady
    this._ast = { ...newAst }

    // here we're going to clear diagnostics since we're the first
    // one in. We're the only location where diagnostics are cleared;
    // everything from here on out should be *appending*.
    editorManager.clearDiagnostics()

    const { logs, errors, programMemory } = await executeAst({
      ast: newAst,
      engineCommandManager: this.engineCommandManager,
      useFakeExecutor: true,
    })

    editorManager.addDiagnostics(await lintAst({ ast: ast }))

    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
    if (updates !== 'artifactRanges') return
    Object.entries(this.engineCommandManager.artifactMap).forEach(
      ([commandId, artifact]) => {
        if (!artifact.pathToNode) return
        const _node1 = getNodeFromPath<CallExpression>(
          this.ast,
          artifact.pathToNode,
          'CallExpression'
        )
        if (err(_node1)) return
        const { node } = _node1
        if (node.type !== 'CallExpression') return
        const [oldStart, oldEnd] = artifact.range
        if (oldStart === 0 && oldEnd === 0) return
        if (oldStart === node.start && oldEnd === node.end) return
        this.engineCommandManager.artifactMap[commandId].range = [
          node.start,
          node.end,
        ]
      }
    )
  }
  cancelAllExecutions() {
    this._cancelTokens.forEach((_, key) => {
      this._cancelTokens.set(key, true)
    })
  }
  async executeCode(force?: boolean, zoomToFit?: boolean): Promise<void> {
    // If we want to force it we don't want to defer it.
    if (!force) return this._defferer(codeManager.code)

    const ast = this.safeParse(codeManager.code)
    if (!ast) {
      this.clearAst()
      return
    }
    this.ast = { ...ast }
    return this.executeAst(ast, zoomToFit)
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
    codeManager.writeToFile()
  }
  // There's overlapping responsibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
  // This always updates the code state and editor and writes to the file system.
  async updateAst(
    ast: Program,
    execute: boolean,
    optionalParams?: {
      focusPath?: PathToNode
      zoomToFit?: boolean
      zoomOnRangeAndType?: {
        range: SourceRange
        type: string
      }
    }
  ): Promise<{
    newAst: Program
    selections?: Selections
  }> {
    const newCode = recast(ast)
    if (err(newCode)) return Promise.reject(newCode)

    const astWithUpdatedSource = this.safeParse(newCode)
    if (!astWithUpdatedSource) return Promise.reject(new Error('bad ast'))
    let returnVal: Selections | undefined = undefined

    if (optionalParams?.focusPath) {
      const _node1 = getNodeFromPath<any>(
        astWithUpdatedSource,
        optionalParams?.focusPath
      )
      if (err(_node1)) return Promise.reject(_node1)
      const { node } = _node1

      const { start, end } = node
      if (!start || !end)
        return {
          selections: undefined,
          newAst: astWithUpdatedSource,
        }
      returnVal = {
        codeBasedSelections: [
          {
            type: 'default',
            range: [start, end],
          },
        ],
        otherSelections: [],
      }
    }

    if (execute) {
      // Call execute on the set ast.
      // Update the code state and editor.
      codeManager.updateCodeEditor(newCode)
      // Write the file to disk.
      await codeManager.writeToFile()
      await this.executeAst(
        astWithUpdatedSource,
        optionalParams?.zoomToFit,
        undefined,
        optionalParams?.zoomOnRangeAndType
      )
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
}

function defaultSelectionFilter(
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager
) {
  const firstSketchOrExtrudeGroup = Object.values(programMemory.root).find(
    (node) => node.type === 'ExtrudeGroup' || node.type === 'SketchGroup'
  ) as SketchGroup | ExtrudeGroup
  firstSketchOrExtrudeGroup &&
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'set_selection_filter',
        filter: ['face', 'edge', 'solid2d', 'curve'],
      },
    })
}
