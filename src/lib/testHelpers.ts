import { Program, ProgramMemory, _executor, SourceRange } from '../lang/wasm'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { EngineCommand } from 'lang/std/artifactGraph'
import { Models } from '@kittycad/lib'
import { v4 as uuidv4 } from 'uuid'
import { DefaultPlanes } from 'wasm-lib/kcl/bindings/DefaultPlanes'
import { err } from 'lib/trap'

type WebSocketResponse = Models['WebSocketResponse_type']

const defaultPlanes: DefaultPlanes = {
  xy: uuidv4(),
  xz: uuidv4(),
  yz: uuidv4(),
  negXy: uuidv4(),
  negXz: uuidv4(),
  negYz: uuidv4(),
}

class MockEngineCommandManager {
  // eslint-disable-next-line @typescript-eslint/no-useless-constructor
  constructor(mockParams: {
    setIsStreamReady: (isReady: boolean) => void
    setMediaStream: (stream: MediaStream) => void
  }) {}
  startNewSession() {}
  waitForAllCommands() {}
  waitForReady = new Promise<void>((resolve) => resolve())
  sendModelingCommand({
    id,
    range,
    command,
  }: {
    id: string
    range: SourceRange
    command: EngineCommand
  }): Promise<any> {
    const response: WebSocketResponse = {
      success: true,
      resp: {
        type: 'modeling',
        data: {
          modeling_response: { type: 'empty' },
        },
      },
    }
    return Promise.resolve(JSON.stringify(response))
  }
  async wasmGetDefaultPlanes(): Promise<string> {
    return JSON.stringify(defaultPlanes)
  }
  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string
  ): Promise<any> {
    if (id === undefined) {
      return Promise.reject(new Error('id is undefined'))
    }
    if (rangeStr === undefined) {
      return Promise.reject(new Error('rangeStr is undefined'))
    }
    if (commandStr === undefined) {
      return Promise.reject(new Error('commandStr is undefined'))
    }
    const command: EngineCommand = JSON.parse(commandStr)
    const range: SourceRange = JSON.parse(rangeStr)

    return this.sendModelingCommand({ id, range, command })
  }
  sendSceneCommand() {}
}

export async function enginelessExecutor(
  ast: Program | Error,
  pm: ProgramMemory | Error = ProgramMemory.empty()
): Promise<ProgramMemory> {
  if (err(ast)) return Promise.reject(ast)
  if (err(pm)) return Promise.reject(pm)

  const mockEngineCommandManager = new MockEngineCommandManager({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
  }) as any as EngineCommandManager
  await mockEngineCommandManager.waitForReady
  mockEngineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, mockEngineCommandManager, true)
  await mockEngineCommandManager.waitForAllCommands()
  return programMemory
}

export async function executor(
  ast: Program,
  pm: ProgramMemory = ProgramMemory.empty()
): Promise<ProgramMemory> {
  const engineCommandManager = new EngineCommandManager()
  engineCommandManager.start({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
    width: 0,
    height: 0,
    executeCode: () => {},
    makeDefaultPlanes: () => {
      return new Promise((resolve) => resolve(defaultPlanes))
    },
    modifyGrid: (hidden: boolean) => {
      return new Promise((resolve) => resolve())
    },
  })
  await engineCommandManager.waitForReady
  engineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, engineCommandManager, false)
  await engineCommandManager.waitForAllCommands()
  return programMemory
}
