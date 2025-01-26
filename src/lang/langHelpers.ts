import {
  Program,
  executor,
  ProgramMemory,
  kclLint,
  emptyExecState,
  ExecState,
} from 'lang/wasm'
import { enginelessExecutor } from 'lib/testHelpers'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { KCLError } from 'lang/errors'
import { Diagnostic } from '@codemirror/lint'
import { Node } from 'wasm-lib/kcl/bindings/Node'

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

export type ToolTipKw = 'line'

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
  // If you set programMemoryOverride we assume you mean mock mode. Since that
  // is the only way to go about it.
  programMemoryOverride,
}: {
  ast: Node<Program>
  engineCommandManager: EngineCommandManager
  programMemoryOverride?: ProgramMemory
  isInterrupted?: boolean
}): Promise<{
  logs: string[]
  errors: KCLError[]
  execState: ExecState
  isInterrupted: boolean
}> {
  try {
    const execState = await (programMemoryOverride
      ? enginelessExecutor(ast, programMemoryOverride)
      : executor(ast, engineCommandManager))

    await engineCommandManager.waitForAllCommands()

    return {
      logs: [],
      errors: [],
      execState,
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
        execState: emptyExecState(),
        isInterrupted,
      }
    } else {
      console.log(e)
      return {
        logs: [e],
        errors: [],
        execState: emptyExecState(),
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
