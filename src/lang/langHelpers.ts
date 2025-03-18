import {
  Program,
  kclLint,
  emptyExecState,
  ExecState,
  jsAppSettings,
} from 'lang/wasm'
import { KCLError } from 'lang/errors'
import { Diagnostic } from '@codemirror/lint'
import { Node } from '@rust/kcl-lib/bindings/Node'
import RustContext from 'lib/rustContext'

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
  | 'circleThreePoint'
  | 'arcTo'
  | 'arc'

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
  'circleThreePoint',
  'arc',
  'arcTo',
]

interface ExecutionResult {
  logs: string[]
  errors: KCLError[]
  execState: ExecState
  isInterrupted: boolean
}

export async function executeAst({
  ast,
  rustContext,
  path,
}: {
  ast: Node<Program>
  rustContext: RustContext
  path?: string
}): Promise<ExecutionResult> {
  try {
    const settings = { settings: await jsAppSettings() }
    const execState = await rustContext.execute(ast, settings, path)

    await rustContext.waitForAllEngineCommands()
    return {
      logs: [],
      errors: [],
      execState,
      isInterrupted: false,
    }
  } catch (e: any) {
    return handleExecuteError(e)
  }
}

export async function executeAstMock({
  ast,
  rustContext,
  path,
  usePrevMemory,
}: {
  ast: Node<Program>
  rustContext: RustContext
  path?: string
  usePrevMemory?: boolean
}): Promise<ExecutionResult> {
  try {
    const settings = { settings: await jsAppSettings() }
    const execState = await rustContext.executeMock(
      ast,
      settings,
      path,
      usePrevMemory
    )

    await rustContext.waitForAllEngineCommands()
    return {
      logs: [],
      errors: [],
      execState,
      isInterrupted: false,
    }
  } catch (e: any) {
    return handleExecuteError(e)
  }
}

function handleExecuteError(e: any): ExecutionResult {
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
