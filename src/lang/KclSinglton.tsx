import { Selection, Selections, executeAst } from 'useStore'
import { KCLError } from './errors'
import {
  EngineCommandManager,
  engineCommandManager,
} from './std/engineConnection'
import { deferExecution } from 'lib/utils'
import { parse, PathToNode, Program, ProgramMemory, recast } from 'lang/wasm'
import { bracket } from 'lib/exampleKcl'
import { createContext, useContext, useEffect, useState } from 'react'
import { getNodeFromPath } from './queryAst'
import { CursorPos } from 'readline'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'

const PERSIST_CODE_TOKEN = 'persistCode'

class KclManager {
  private _code = bracket
  private _ast: Program = {
    body: [],
    start: 0,
    end: 0,
    nonCodeMeta: {
      nonCodeNodes: {},
      start: null,
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
  private _defferer = deferExecution(
    (defaultPlanes: DefaultPlanes, code: string) => {
      const ast = parse(code)
      this.executeAst(defaultPlanes, ast)
    },
    600
  )

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
    // TODO remove zustand persistance logic in a few months
    // short term migration, shouldn't make a difference for tauri app users
    // anyway since that's filesystem based.
    const zustandStore = JSON.parse(localStorage.getItem('store') || '{}')
    if (!storedCode && zustandStore?.state?.code) {
      this._code = zustandStore.state.code
      localStorage.setItem(PERSIST_CODE_TOKEN, this._code)
      zustandStore.state.code = ''
      localStorage.setItem('store', JSON.stringify(zustandStore))
    } else {
      this._code = storedCode || bracket
    }
    this._codeCallBack(this._code)
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

  async executeAst(
    defaultPlanes: DefaultPlanes,
    ast: Program = this._ast,
    updateCode = false
  ) {
    // if (!this.isStreamReady) return
    this._isExecutingCallback(true)
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager,
      defaultPlanes,
    })
    this._isExecutingCallback(false)
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
    this._ast = { ...ast }
    if (updateCode) {
      this._code = recast(ast)
      this._codeCallBack(this._code)
    }
  }
  async executeAstMock(
    defaultPlanes: DefaultPlanes,
    ast: Program = this._ast,
    updateCode = false
  ) {
    const newCode = recast(ast)
    const newAst = parse(newCode)
    await engineCommandManager.waitForReady
    if (updateCode) {
      this.setCode(recast(ast))
    }
    this._ast = { ...newAst }

    const { logs, errors, programMemory } = await executeAst({
      ast: newAst,
      engineCommandManager,
      defaultPlanes,
      useFakeExecutor: true,
    })
    this._logs = logs
    this._kclErrors = errors
    this._programMemory = programMemory
  }
  setCode(code: string) {
    this._code = code
    this._codeCallBack(code)
    localStorage.setItem(PERSIST_CODE_TOKEN, code)
  }
  setCodeAndExecute(defaultPlanes: DefaultPlanes, code: string) {
    this.setCode(code)
    if (code.trim()) {
      this._defferer(defaultPlanes, code)
      return
    }
    this._ast = {
      body: [],
      start: 0,
      end: 0,
      nonCodeMeta: {
        nonCodeNodes: {},
        start: null,
      },
    }
    this._programMemory = {
      root: {},
      return: null,
    }
    engineCommandManager.endSession()
  }
  format() {
    this.code = recast(parse(kclManager.code))
  }
  // There's overlapping resposibility between updateAst and executeAst.
  // updateAst was added as it was used a lot before xState migration so makes the port easier.
  // but should probably have think about which of the function to keep
  updateAst(
    defaultPlanes: DefaultPlanes,
    ast: Program,
    execute: boolean,
    optionalParams?: {
      focusPath?: PathToNode
      callBack?: (ast: Program) => void
    }
  ): Selections | null {
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
      this.executeAst(defaultPlanes, astWithUpdatedSource)
    } else {
      // When we don't re-execute, we still want to update the program
      // memory with the new ast. So we will hit the mock executor
      // instead.
      this.executeAstMock(defaultPlanes, astWithUpdatedSource)
    }
    return returnVal
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
  const [code, setCode] = useState(kclManager.code)
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
