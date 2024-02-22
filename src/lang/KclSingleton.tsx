import { executeAst, executeCode } from 'useStore'
import { Selections } from 'lib/selections'
import { KCLError } from './errors'
import {
  EngineCommandManager,
  engineCommandManager,
} from './std/engineConnection'
import { deferExecution } from 'lib/utils'
import {
  CallExpression,
  initPromise,
  parse,
  PathToNode,
  Program,
  ProgramMemory,
  recast,
} from 'lang/wasm'
import { bracket } from 'lib/exampleKcl'
import { createContext, useContext, useEffect, useState } from 'react'
import { getNodeFromPath } from './queryAst'
import { type IndexLoaderData } from 'lib/types'
import { Params, useLoaderData } from 'react-router-dom'
import { isTauri } from 'lib/isTauri'
import { writeTextFile } from '@tauri-apps/api/fs'
import { toast } from 'react-hot-toast'
import { useParams } from 'react-router-dom'

const PERSIST_CODE_TOKEN = 'persistCode'

class KclManager {
  private _code = bracket
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
  private _params: Params<string> = {}

  engineCommandManager: EngineCommandManager
  private _defferer = deferExecution((code: string) => {
    const ast = this.safeParse(code)
    if (!ast) return
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
  private _codeCallBack: (arg: string) => void = () => {}
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

  get code() {
    return this._code
  }
  set code(code) {
    this._code = code
    this._codeCallBack(code)
    if (isTauri()) {
      setTimeout(() => {
        // Wait one event loop to give a chance for params to be set
        // Save the file to disk
        // Note that PROJECT_ENTRYPOINT is hardcoded until we support multiple files
        this._params.id &&
          writeTextFile(this._params.id, code).catch((err) => {
            // TODO: add Sentry per GH issue #254 (https://github.com/KittyCAD/modeling-app/issues/254)
            console.error('error saving file', err)
            toast.error('Error saving file, please check file permissions')
          })
      })
    } else {
      safteLSSetItem(PERSIST_CODE_TOKEN, code)
    }
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

  setParams(params: Params<string>) {
    this._params = params
  }

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager

    if (isTauri()) {
      this.code = ''
      return
    }
    const storedCode = safeLSGetItem(PERSIST_CODE_TOKEN) || ''
    // TODO #819 remove zustand persistence logic in a few months
    // short term migration, shouldn't make a difference for tauri app users
    // anyway since that's filesystem based.
    const zustandStore = JSON.parse(safeLSGetItem('store') || '{}')
    if (storedCode === null && zustandStore?.state?.code) {
      this.code = zustandStore.state.code
      safteLSSetItem(PERSIST_CODE_TOKEN, this._code)
      zustandStore.state.code = ''
      safteLSSetItem('store', JSON.stringify(zustandStore))
    } else if (storedCode === null) {
      this.code = bracket
    } else {
      this.code = storedCode
    }
    this.ensureWasmInit().then(() => {
      this.ast = this.safeParse(this.code) || this.ast
    })
  }
  registerCallBacks({
    setCode,
    setProgramMemory,
    setAst,
    setLogs,
    setKclErrors,
    setIsExecuting,
    setWasmInitFailed,
  }: {
    setCode: (arg: string) => void
    setProgramMemory: (arg: ProgramMemory) => void
    setAst: (arg: Program) => void
    setLogs: (arg: string[]) => void
    setKclErrors: (arg: KCLError[]) => void
    setIsExecuting: (arg: boolean) => void
    setWasmInitFailed: (arg: boolean) => void
  }) {
    this._codeCallBack = setCode
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

  safeParse(code: string): Program | null {
    try {
      const ast = parse(code)
      this.kclErrors = []
      return ast
    } catch (e) {
      console.error('error parsing code', e)
      if (e instanceof KCLError) {
        this.kclErrors = [e]
        if (e.msg === 'file is empty') engineCommandManager?.endSession()
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

  async executeAst(
    ast: Program = this._ast,
    updateCode = false,
    executionId?: number
  ) {
    console.trace('executeAst')
    const currentExecutionId = executionId || Date.now()
    this._cancelTokens.set(currentExecutionId, false)

    this.isExecuting = true
    await this.ensureWasmInit()
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager: this.engineCommandManager,
    })
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
    if (updateCode) {
      this.code = recast(ast)
    }
    this._executeCallback()
    engineCommandManager.addCommandLog({
      type: 'execution-done',
      data: null,
    })
    this._cancelTokens.delete(currentExecutionId)
  }
  async executeAstMock(
    ast: Program = this._ast,
    {
      updates,
    }: {
      updates: 'none' | 'code' | 'codeAndArtifactRanges'
    } = { updates: 'none' }
  ) {
    await this.ensureWasmInit()
    const newCode = recast(ast)
    const newAst = this.safeParse(newCode)
    if (!newAst) return
    await this?.engineCommandManager?.waitForReady
    if (updates !== 'none') {
      this.setCode(recast(ast))
    }
    this._ast = { ...newAst }

    const { logs, errors, programMemory } = await executeAst({
      ast: newAst,
      engineCommandManager: this.engineCommandManager,
      useFakeExecutor: true,
    })
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
    if (updates !== 'codeAndArtifactRanges') return
    Object.entries(engineCommandManager.artifactMap).forEach(
      ([commandId, artifact]) => {
        if (!artifact.pathToNode) return
        const node = getNodeFromPath<CallExpression>(
          kclManager.ast,
          artifact.pathToNode,
          'CallExpression'
        ).node
        if (node.type !== 'CallExpression') return
        const [oldStart, oldEnd] = artifact.range
        if (oldStart === 0 && oldEnd === 0) return
        if (oldStart === node.start && oldEnd === node.end) return
        engineCommandManager.artifactMap[commandId].range = [
          node.start,
          node.end,
        ]
      }
    )
  }
  async executeCode(code?: string, executionId?: number) {
    const currentExecutionId = executionId || Date.now()
    this._cancelTokens.set(currentExecutionId, false)
    if (this._cancelTokens.get(currentExecutionId)) {
      this._cancelTokens.delete(currentExecutionId)
      return
    }
    await this.ensureWasmInit()
    await this?.engineCommandManager?.waitForReady
    const result = await executeCode({
      engineCommandManager,
      code: code || this._code,
      lastAst: this._ast,
      force: false,
    })
    // Check the cancellation token for this execution before applying side effects
    if (this._cancelTokens.get(currentExecutionId)) {
      this._cancelTokens.delete(currentExecutionId)
      return
    }
    if (!result.isChange) return
    const { logs, errors, programMemory, ast } = result
    this.logs = logs
    this.kclErrors = errors
    this.programMemory = programMemory
    this.ast = ast
    if (code) this.code = code
    this._cancelTokens.delete(currentExecutionId)
  }
  cancelAllExecutions() {
    this._cancelTokens.forEach((_, key) => {
      this._cancelTokens.set(key, true)
    })
  }
  setCode(code: string, shouldWriteFile = true) {
    if (shouldWriteFile) {
      // use the normal code setter
      this.code = code
      return
    }
    this._code = code
    this._codeCallBack(code)
  }
  setCodeAndExecute(code: string, shouldWriteFile = true) {
    this.setCode(code, shouldWriteFile)
    if (code.trim()) {
      this._defferer(code)
      return
    }
    this._ast = {
      body: [],
      start: 0,
      end: 0,
      nonCodeMeta: {
        nonCodeNodes: {},
        start: [],
      },
    }
    this._programMemory = {
      root: {},
      return: null,
    }
    this.engineCommandManager.endSession()
  }
  format() {
    const ast = this.safeParse(this.code)
    if (!ast) return
    this.code = recast(ast)
  }
  // There's overlapping responsibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
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
      await this.executeAst(astWithUpdatedSource, true)
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead.
      await this.executeAstMock(astWithUpdatedSource, { updates: 'code' })
    }
    return returnVal
  }

  get defaultPlanes() {
    return this?.engineCommandManager?.defaultPlanes
  }

  getPlaneId(axis: 'xy' | 'xz' | 'yz'): string {
    return this.defaultPlanes[axis]
  }

  showPlanes() {
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, false)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, false)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, false)
  }

  hidePlanes() {
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, true)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, true)
    void this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, true)
  }
}

export const kclManager = new KclManager(engineCommandManager)

const KclContext = createContext({
  code: kclManager.code,
  programMemory: kclManager.programMemory,
  ast: kclManager.ast,
  isExecuting: kclManager.isExecuting,
  errors: kclManager.kclErrors,
  logs: kclManager.logs,
  wasmInitFailed: kclManager.wasmInitFailed,
})

export function useKclContext() {
  return useContext(KclContext)
}

export function KclContextProvider({
  children,
}: {
  children: React.ReactNode
}) {
  // If we try to use this component anywhere but under the paths.FILE route it will fail
  // Because useLoaderData assumes we are on within it's context.
  const { code: loadedCode } = useLoaderData() as IndexLoaderData
  const [code, setCode] = useState(loadedCode || kclManager.code)
  const [programMemory, setProgramMemory] = useState(kclManager.programMemory)
  const [ast, setAst] = useState(kclManager.ast)
  const [isExecuting, setIsExecuting] = useState(false)
  const [errors, setErrors] = useState<KCLError[]>([])
  const [logs, setLogs] = useState<string[]>([])
  const [wasmInitFailed, setWasmInitFailed] = useState(false)

  useEffect(() => {
    kclManager.registerCallBacks({
      setCode,
      setProgramMemory,
      setAst,
      setLogs,
      setKclErrors: setErrors,
      setIsExecuting,
      setWasmInitFailed,
    })
  }, [])

  const params = useParams()
  useEffect(() => {
    kclManager.setParams(params)
  }, [params])
  return (
    <KclContext.Provider
      value={{
        code,
        programMemory,
        ast,
        isExecuting,
        errors,
        logs,
        wasmInitFailed,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}

function safeLSGetItem(key: string) {
  if (typeof window === 'undefined') return null
  return localStorage?.getItem(key)
}

function safteLSSetItem(key: string, value: string) {
  if (typeof window === 'undefined') return
  localStorage?.setItem(key, value)
}
