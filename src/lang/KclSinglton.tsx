import { executeAst, executeCode } from 'useStore'
import { Selections } from 'lib/selections'
import { KCLError } from './errors'
import {
  EngineCommandManager,
  engineCommandManager,
} from './std/engineConnection'
import { deferExecution } from 'lib/utils'
import {
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
import { IndexLoaderData } from 'Router'
import { useLoaderData } from 'react-router-dom'

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

  engineCommandManager: EngineCommandManager
  private _defferer = deferExecution((code: string) => {
    const ast = parse(code)
    this.executeAst(ast)
  }, 600)

  private _isExecutingCallback: (a: boolean) => void = () => {}
  private _codeCallBack: (arg: string) => void = () => {}
  private _astCallBack: (arg: Program) => void = () => {}
  private _programMemoryCallBack: (arg: ProgramMemory) => void = () => {}
  private _logsCallBack: (arg: string[]) => void = () => {}
  private _kclErrorsCallBack: (arg: KCLError[]) => void = () => {}

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
  }

  get programMemory() {
    return this._programMemory
  }
  set programMemory(programMemory) {
    this._programMemory = programMemory
    this._programMemoryCallBack(programMemory)
  }

  get defaultPlanes() {
    return this?.engineCommandManager?.defaultPlanes
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

  constructor(engineCommandManager: EngineCommandManager) {
    this.engineCommandManager = engineCommandManager
    const storedCode = localStorage.getItem(PERSIST_CODE_TOKEN)
    // TODO #819 remove zustand persistance logic in a few months
    // short term migration, shouldn't make a difference for tauri app users
    // anyway since that's filesystem based.
    const zustandStore = JSON.parse(localStorage.getItem('store') || '{}')
    if (storedCode === null && zustandStore?.state?.code) {
      this.code = zustandStore.state.code
      localStorage.setItem(PERSIST_CODE_TOKEN, this._code)
      zustandStore.state.code = ''
      localStorage.setItem('store', JSON.stringify(zustandStore))
    } else if (storedCode === null) {
      this.code = bracket
    } else {
      this.code = storedCode
    }
  }
  registerCallBacks({
    setCode,
    setProgramMemory,
    setAst,
    setLogs,
    setKclErrors,
    setIsExecuting,
  }: {
    setCode: (arg: string) => void
    setProgramMemory: (arg: ProgramMemory) => void
    setAst: (arg: Program) => void
    setLogs: (arg: string[]) => void
    setKclErrors: (arg: KCLError[]) => void
    setIsExecuting: (arg: boolean) => void
  }) {
    this._codeCallBack = setCode
    this._programMemoryCallBack = setProgramMemory
    this._astCallBack = setAst
    this._logsCallBack = setLogs
    this._kclErrorsCallBack = setKclErrors
    this._isExecutingCallback = setIsExecuting
  }

  async executeAst(ast: Program = this._ast, updateCode = false) {
    this.isExecuting = true
    await initPromise
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager: this.engineCommandManager,
      defaultPlanes: this.defaultPlanes,
    })
    this.isExecuting = false
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
    this._ast = { ...ast }
    if (updateCode) {
      this._code = recast(ast)
      this._codeCallBack(this._code)
    }
  }
  async executeAstMock(ast: Program = this._ast, updateCode = false) {
    await initPromise
    const newCode = recast(ast)
    const newAst = parse(newCode)
    await this?.engineCommandManager?.waitForReady
    if (updateCode) {
      this.setCode(recast(ast))
    }
    this._ast = { ...newAst }

    const { logs, errors, programMemory } = await executeAst({
      ast: newAst,
      engineCommandManager: this.engineCommandManager,
      defaultPlanes: this.defaultPlanes,
      useFakeExecutor: true,
    })
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
  }
  async executeCode(code?: string) {
    await initPromise
    await this?.engineCommandManager?.waitForReady
    if (!this?.engineCommandManager?.planesInitialized()) return
    const result = await executeCode({
      engineCommandManager,
      code: code || this._code,
      lastAst: this._ast,
      defaultPlanes: this.defaultPlanes,
      force: false,
    })
    if (!result.isChange) return
    const { logs, errors, programMemory, ast } = result
    this.logs = logs
    this.kclErrors = errors
    this.programMemory = programMemory
    this.ast = ast
    if (code) this.code = code
  }
  setCode(code: string) {
    this._code = code
    this._codeCallBack(code)
    localStorage.setItem(PERSIST_CODE_TOKEN, code)
  }
  setCodeAndExecute(code: string) {
    this.setCode(code)
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
    this.code = recast(parse(kclManager.code))
  }
  // There's overlapping resposibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
  async updateAst(
    ast: Program,
    execute: boolean,
    optionalParams?: {
      focusPath?: PathToNode
      callBack?: (ast: Program) => void
    }
  ): Promise<Selections | null> {
    const newCode = recast(ast)
    const astWithUpdatedSource = parse(newCode)
    optionalParams?.callBack?.(astWithUpdatedSource)
    let returnVal: Selections | null = null

    this.code = newCode
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
      await this.executeAst(astWithUpdatedSource)
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead.
      await this.executeAstMock(astWithUpdatedSource)
    }
    return returnVal
  }

  getPlaneId(axis: 'xy' | 'xz' | 'yz'): string {
    return this.defaultPlanes[axis]
  }

  showPlanes() {
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, false)
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, false)
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, false)
  }

  hidePlanes() {
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xy, true)
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.yz, true)
    this.engineCommandManager.setPlaneHidden(this.defaultPlanes.xz, true)
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

  useEffect(() => {
    kclManager.registerCallBacks({
      setCode,
      setProgramMemory,
      setAst,
      setLogs,
      setKclErrors: setErrors,
      setIsExecuting,
    })
  }, [])
  return (
    <KclContext.Provider
      value={{
        code,
        programMemory,
        ast,
        isExecuting,
        errors,
        logs,
      }}
    >
      {children}
    </KclContext.Provider>
  )
}
