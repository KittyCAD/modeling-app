import { Program } from '../lang/abstractSyntaxTree'
import { ProgramMemory, _executor } from '../lang/executor'
import { EngineCommandManager } from '../lang/std/engineConnection'

export async function executor(
  ast: Program,
  pm: ProgramMemory = { root: {}, _sketch: [], pendingMemory: {} }
): Promise<ProgramMemory> {
  const engineCommandManager = new EngineCommandManager()
  engineCommandManager.startNewSession()
  const programMemory = await _executor(ast, pm, engineCommandManager)
  await engineCommandManager.waitForAllCommands()
  return programMemory
}
