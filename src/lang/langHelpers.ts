import {
  Program,
  _executor,
  ProgramMemory,
  programMemoryInit,
  kclLint,
  emptyExecState,
  ExecState,
} from 'lang/wasm'
import { enginelessExecutor } from 'lib/testHelpers'
import { EngineCommandManager } from 'lang/std/engineConnection'
import { KCLError } from 'lang/errors'
import { Diagnostic } from '@codemirror/lint'
import { IdGenerator } from 'wasm-lib/kcl/bindings/IdGenerator'
import { UnboxedNode } from 'wasm-lib/kcl/bindings/UnboxedNode'

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
  idGenerator,
}: {
  ast: UnboxedNode<Program>
  engineCommandManager: EngineCommandManager
  useFakeExecutor?: boolean
  programMemoryOverride?: ProgramMemory
  idGenerator?: IdGenerator
  isInterrupted?: boolean
}): Promise<{
  logs: string[]
  errors: KCLError[]
  execState: ExecState
  isInterrupted: boolean
}> {
  try {
    if (!useFakeExecutor) {
      engineCommandManager.endSession()
      // eslint-disable-next-line @typescript-eslint/no-floating-promises
      engineCommandManager.startNewSession()
    }
    const execState = await (useFakeExecutor
      ? enginelessExecutor(ast, programMemoryOverride || programMemoryInit())
      : _executor(
          ast,
          programMemoryInit(),
          idGenerator,
          engineCommandManager,
          false
        ))

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
