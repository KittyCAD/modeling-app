import {
  Program,
  _executor,
  ProgramMemory,
  programMemoryInit,
  kclLint,
} from 'lang/wasm'
import { enginelessExecutor } from 'lib/testHelpers'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { KCLError } from 'lang/errors'
import { Diagnostic } from '@codemirror/lint'

export type ToolTip =
  | 'lineTo'
  | 'line'
  | 'angledLine'
  | 'angledLineOfXLength'
  | 'angledLineOfYLength'
  | 'angledLineToX'
  | 'angledLineToY'
  | 'xLine'
  | 'yLine'
  | 'xLineTo'
  | 'yLineTo'
  | 'angledLineThatIntersects'
  | 'tangentialArcTo'
  | 'circle'

export const toolTips: Array<ToolTip> = [
  'line',
  'lineTo',
  'angledLine',
  'angledLineOfXLength',
  'angledLineOfYLength',
  'angledLineToX',
  'angledLineToY',
  'xLine',
  'yLine',
  'xLineTo',
  'yLineTo',
  'angledLineThatIntersects',
  'tangentialArcTo',
]

export async function executeAst({
  ast,
  engineCommandManager,
  useFakeExecutor = false,
  programMemoryOverride,
}: {
  ast: Program
  engineCommandManager: EngineCommandManager
  useFakeExecutor?: boolean
  programMemoryOverride?: ProgramMemory
  isInterrupted?: boolean
}): Promise<{
  logs: string[]
  errors: KCLError[]
  programMemory: ProgramMemory
  isInterrupted: boolean
}> {
  try {
    if (!useFakeExecutor) {
      engineCommandManager.endSession()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      engineCommandManager.startNewSession()
    }
    const programMemory = await (useFakeExecutor
      ? enginelessExecutor(ast, programMemoryOverride || programMemoryInit())
      : _executor(ast, programMemoryInit(), engineCommandManager, false))

    await engineCommandManager.waitForAllCommands()
    return {
      logs: [],
      errors: [],
      programMemory,
      isInterrupted: false,
    }
  } catch (e: any) {
    let isInterrupted = false
    if (e instanceof KCLError) {
      // Detect if it is a force interrupt error which is not a KCL processing error.
      if (
        e.msg ===
        'Failed to wait for promise from engine: JsValue("Force interrupt, executionIsStale, new AST requested")'
      ) {
        isInterrupted = true
      }
      return {
        errors: [e],
        logs: [],
        programMemory: ProgramMemory.empty(),
        isInterrupted,
      }
    } else {
      console.log(e)
      return {
        logs: [e],
        errors: [],
        programMemory: ProgramMemory.empty(),
        isInterrupted,
      }
    }
  }
}

export async function lintAst({
  ast,
}: {
  ast: Program
}): Promise<Array<Diagnostic>> {
  try {
    const discovered_findings = await kclLint(ast)
    return discovered_findings.map((lint) => {
      return {
        message: lint.finding.title,
        severity: 'info',
        from: lint.pos[0],
        to: lint.pos[1],
      }
    })
  } catch (e: any) {
    console.log(e)
    return []
  }
}
