import { executeAst } from 'useStore'
import { Selections } from 'lib/selections'
import { KCLError } from './errors'
import { uuidv4 } from 'lib/utils'
import { EngineCommandManager } from './std/engineConnection'

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
  ExtrudeGroup,
} from 'lang/wasm'
import { getNodeFromPath } from './queryAst'
import { codeManager } from 'lib/singletons'

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
    if (!ast) return
    try {
        parse(recast(ast)).then((newAst) => {
      const fmtAndStringify = (ast: Program) =>
        JSON.stringify(newAst)
      const isAstTheSame = fmtAndStringify(ast) === fmtAndStringify(this._ast)
      if (isAstTheSame) return
      this.executeAst(ast)
        })
    } catch (e) {
      console.error(e)
    }
  }, 600)

  private _isExecutingCallback: (arg: boolean) => void = () => {}
  private _astCallBack: (arg: Program) => void = () => {}
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

  async safeParse(code: string): Promise<Program | null> {
    try {
      const ast = await parse(code)
      this.kclErrors = []
      return ast
    } catch (e) {
      console.error('error parsing code', e)
      if (e instanceof KCLError) {
        this.kclErrors = [e]
        if (e.msg === 'file is empty') this.engineCommandManager?.endSession()
      }
      return null
    }
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
  async executeAst(ast: Program = this._ast, executionId?: number) {
    await this?.engineCommandManager?.waitForReady
    const currentExecutionId = executionId || Date.now()
    this._cancelTokens.set(currentExecutionId, false)

    this.isExecuting = true
    await this.ensureWasmInit()
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager: this.engineCommandManager,
    })
    enterEditMode(programMemory, this.engineCommandManager)
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
    const newAst = this.safeParse(newCode)
    if (!newAst) return
    codeManager.updateCodeStateEditor(newCode)
    // Write the file to disk.
    await codeManager.writeToFile()
    await this?.engineCommandManager?.waitForReady
    this._ast = { ...newAst }

    const { logs, errors, programMemory } = await executeAst({
      ast: newAst,
      engineCommandManager: this.engineCommandManager,
      useFakeExecutor: true,
    })
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
    if (updates !== 'artifactRanges') return
    Object.entries(this.engineCommandManager.artifactMap).forEach(
      ([commandId, artifact]) => {
        if (!artifact.pathToNode) return
        const node = getNodeFromPath<CallExpression>(
          this.ast,
          artifact.pathToNode,
          'CallExpression'
        ).node
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
  executeCode(force?: boolean) {
    // If we want to force it we don't want to defer it.
    if (!force) return this._defferer(codeManager.code)

    const ast = this.safeParse(codeManager.code)
    if (!ast) return
    this.ast = { ...ast }
    return this.executeAst(ast)
  }
  format() {
    const originalCode = codeManager.code
    const ast = this.safeParse(originalCode)
    if (!ast) return
    const code = recast(ast)
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
    }
  ): Promise<Selections | null> {
    const newCode = recast(ast)
    const astWithUpdatedSource = this.safeParse(newCode)
    if (!astWithUpdatedSource) return null
    let returnVal: Selections | null = null

    if (optionalParams?.focusPath) {
      const { node } = getNodeFromPath<any>(
        astWithUpdatedSource,
        optionalParams?.focusPath
      )
      const { start, end } = node
      if (!start || !end) return null
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
      codeManager.updateCodeStateEditor(newCode)
      // Write the file to disk.
      await codeManager.writeToFile()
      await this.executeAst(astWithUpdatedSource)
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead..
      // Execute ast mock will update the code state and editor.
      await this.executeAstMock(astWithUpdatedSource)
    }
    return returnVal
  }

  get defaultPlanes() {
    return this?.engineCommandManager?.defaultPlanes
  }

  showPlanes() {
    if (!this.defaultPlanes) return
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, false)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, false)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, false)
  }

  hidePlanes() {
    if (!this.defaultPlanes) return
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, true)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, true)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, true)
  }
}

function enterEditMode(
  programMemory: ProgramMemory,
  engineCommandManager: EngineCommandManager
) {
  const firstSketchOrExtrudeGroup = Object.values(programMemory.root).find(
    (node) => node.type === 'ExtrudeGroup' || node.type === 'SketchGroup'
  ) as SketchGroup | ExtrudeGroup
  firstSketchOrExtrudeGroup &&
    engineCommandManager.sendSceneCommand({
      type: 'modeling_cmd_batch_req',
      batch_id: uuidv4(),
      responses: false,
      requests: [
        {
          cmd_id: uuidv4(),
          cmd: {
            type: 'edit_mode_enter',
            target: firstSketchOrExtrudeGroup.id,
          },
        },
        {
          cmd_id: uuidv4(),
          cmd: {
            type: 'set_selection_filter',
            filter: ['face', 'edge', 'solid2d'],
          },
        },
      ],
    })
}
