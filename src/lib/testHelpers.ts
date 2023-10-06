import { Program, ProgramMemory, _executor, SourceRange } from '../lang/wasm'
import {
  EngineCommandManager,
  EngineCommand,
} from '../lang/std/engineConnection'
import { Models } from '@kittycad/lib'

type WebSocketResponse = Models['OkWebSocketResponseData_type']

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
      type: 'modeling',
      data: {
        modeling_response: { type: 'empty' },
      },
    }
    return Promise.resolve(JSON.stringify(response))
  }
  sendModelingCommandFromWasm(
    id: string,
    rangeStr: string,
    commandStr: string
  ): Promise<any> {
    if (id === undefined) {
      throw new Error('id is undefined')
    }
    if (rangeStr === undefined) {
      throw new Error('rangeStr is undefined')
    }
    if (commandStr === undefined) {
      throw new Error('commandStr is undefined')
    }
    const command: EngineCommand = JSON.parse(commandStr)
    const range: SourceRange = JSON.parse(rangeStr)

    return this.sendModelingCommand({ id, range, command })
  }
  sendSceneCommand() {}
}

export async function enginelessExecutor(
  ast: Program,
  pm: ProgramMemory = { root: {}, return: null }
): Promise<ProgramMemory> {
  const mockEngineCommandManager = new MockEngineCommandManager({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
  }) as any as EngineCommandManager
  await mockEngineCommandManager.waitForReady
  mockEngineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, mockEngineCommandManager)
  await mockEngineCommandManager.waitForAllCommands()
  return programMemory
}

export async function executor(
  ast: Program,
  pm: ProgramMemory = { root: {}, return: null }
): Promise<ProgramMemory> {
  const engineCommandManager = new EngineCommandManager()
  engineCommandManager.start({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
    width: 0,
    height: 0,
    executeCode: () => {},
  })
  await engineCommandManager.waitForReady
  engineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, engineCommandManager)
  await engineCommandManager.waitForAllCommands(ast, programMemory)
  return programMemory
}
