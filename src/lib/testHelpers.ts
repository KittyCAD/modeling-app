import { Program } from '../lang/abstractSyntaxTree'
import { ProgramMemory, _executor } from '../lang/executor'
import { EngineCommandManager } from '../lang/std/engineConnection'

export async function executor(
  ast: Program,
  pm: ProgramMemory = { root: {}, pendingMemory: {} }
): Promise<ProgramMemory> {
  const engineCommandManager = new EngineCommandManager({
    setIsStreamReady: () => {},
    setMediaStream: () => {},
  })
  engineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, engineCommandManager)
  await engineCommandManager.waitForAllCommands()
  return programMemory
}
