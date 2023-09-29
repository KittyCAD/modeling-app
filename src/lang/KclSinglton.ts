import { executeAst } from 'useStore'
import { KCLError } from './errors'
import {
  EngineCommandManager,
  engineCommandManager,
} from './std/engineConnection'
import { deferExecution } from 'lib/utils'
import { parse, Program, ProgramMemory, recast } from 'lang/wasm'
import { bracket } from 'lib/exampleKcl'

const PERSIST_CODE_TOKEN = 'persistCode'

class KclManager {
  _code = bracket
  private _defferer = deferExecution((code: string) => {
    const ast = parse(code)
    this.executeAst(ast)
  }, 600)
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
  logs: string[] = []
  kclErrors: KCLError[] = []
  engineCommandManager: EngineCommandManager
  private _isExecutingCallback: (a: boolean) => void = () => {}

  get ast() {
    return this._ast
  }
  get code() {
    return this._code
  }
  get programMemory() {
    return this._programMemory
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
  }
  onSetExecute(callBack: (a: boolean) => void) {
    this._isExecutingCallback = callBack
  }

  async executeAst(ast: Program = this._ast, updateCode = false) {
    // if (!this.isStreamReady) return
    this._isExecutingCallback(true)
    const { logs, errors, programMemory } = await executeAst({
      ast,
      engineCommandManager,
    })
    this._isExecutingCallback(false)
    this.logs = logs
    this.kclErrors = errors
    this._programMemory = programMemory
    this._ast = { ...ast }
    if (updateCode) {
      this._code = recast(ast)
    }
  }
  async executeAstMock(ast: Program = this._ast, updateCode = false) {
    // this._isExecutingCallback(true)
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
      useFakeExecutor: true,
    })
    // this._isExecutingCallback(false)
    this.logs = logs
    this.kclErrors = errors
    this._programMemory = programMemory
  }
  setCode(code: string, execute = false) {
    this._code = code
    localStorage.setItem(PERSIST_CODE_TOKEN, code)
    if (execute) {
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
          start: null,
        },
      }
      this._programMemory = {
        root: {},
        return: null,
      }
      engineCommandManager.endSession()
    }
  }
}

export const kclManager = new KclManager(engineCommandManager)
