import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { KCLError } from '@src/lang/errors'
import type { ExecState, Program } from '@src/lang/wasm'
import { emptyExecState, kclLint } from '@src/lang/wasm'
import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { EditorView } from 'codemirror'

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
  | 'tangentialArc'
  | 'circle'
  | 'circleThreePoint'
  | 'arcTo'
  | 'arc'
  | 'startProfile'

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
  'tangentialArc',
  'circleThreePoint',
  'arc',
  'arcTo',
  'startProfile',
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
    const settings = await jsAppSettings()
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
    const settings = await jsAppSettings()
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
    if (e.msg.includes(EXECUTE_AST_INTERRUPT_ERROR_STRING)) {
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
      let actions
      const suggestion = lint.suggestion
      if (suggestion) {
        actions = [
          {
            name: suggestion.title,
            apply: (view: EditorView, from: number, to: number) => {
              view.dispatch({
                changes: {
                  from: suggestion.source_range[0],
                  to: suggestion.source_range[1],
                  insert: suggestion.insert,
                },
                annotations: [lspCodeActionEvent],
              })
            },
          },
        ]
      }
      return {
        from: lint.pos[0],
        to: lint.pos[1],
        message: lint.finding.title,
        severity: 'info',
        actions,
      }
    })
  } catch (e: any) {
    console.log(e)
    return []
  }
}
