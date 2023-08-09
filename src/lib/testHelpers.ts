import { Program } from '../lang/abstractSyntaxTreeTypes'
import { ProgramMemory, _executor } from '../lang/executor'
import { EngineCommandManager } from '../lang/std/engineConnection'

class MockEngineCommandManager {
  constructor(mockParams: {
    setIsStreamReady: (isReady: boolean) => void
    setMediaStream: (stream: MediaStream) => void
  }) {}
  startNewSession() {}
  waitForAllCommands() {}
  waitForReady = new Promise<void>((resolve) => resolve())
  sendModellingCommand() {}
  sendSceneCommand() {}
}

export async function enginelessExecutor(
  ast: Program,
  pm: ProgramMemory = { root: {}, pendingMemory: {} }
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
  pm: ProgramMemory = { root: {}, pendingMemory: {} }
): Promise<ProgramMemory> {
  const engineCommandManager = new EngineCommandManager({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
    width: 100,
    height: 100,
  })
  await engineCommandManager.waitForReady
  engineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, engineCommandManager)
  await engineCommandManager.waitForAllCommands()
  return programMemory
}
