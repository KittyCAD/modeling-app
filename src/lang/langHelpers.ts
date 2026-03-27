import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { KCLError, toUtf16 } from '@src/lang/errors'
import type { ArtifactGraph } from '@src/lang/wasm'
import { executeAstMock as executeAstMockImpl } from '@src/lang/executeAstMock'
import { resolveRefactorLintActions } from '@src/lang/lintRefactorActions'
import type {
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  ExecState,
  Program,
} from '@src/lang/wasm'
import { emptyExecState, kclLint } from '@src/lang/wasm'
import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE } from '@src/network/utils'
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
  | 'tangentialArcTo'
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
  'tangentialArcTo',
  'circleThreePoint',
  'arc',
  'arcTo',
  'startProfile',
]

export function isToolTip(value: string): value is ToolTip {
  return toolTips.includes(value as ToolTip)
}

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
    const settings = jsAppSettings(rustContext.settingsActor)
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

export const executeAstMock = executeAstMockImpl

function handleExecuteError(e: any): ExecutionResult {
  let isInterrupted = false

  if (e instanceof KCLError) {
    // Detect if it is a force interrupt error which is not a KCL processing error.
    if (
      e.msg.includes(EXECUTE_AST_INTERRUPT_ERROR_STRING) ||
      e.msg.includes('Failed to wait for promise from send modeling command') ||
      e.msg.includes(
        'no connection to send on, connection manager called tearDown()'
      ) ||
      e.msg.includes(REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE)
    ) {
      isInterrupted = true
    }
    const execState = emptyExecState()
    // We're passing back those so the user can still fix issues in p&c
    execState.variables = e.variables
    execState.operations = e.operations
    execState.artifactGraph = e.artifactGraph
    return {
      errors: [e],
      logs: [],
      execState,
      isInterrupted,
    }
  } else {
    if (e && e.length > 0 && e[0].errors && e[0].errors.length > 0) {
      if (
        e[0].errors[0].message.includes(
          'no connection to send on, connection manager called tearDown()'
        ) ||
        e[0].errors[0].message.includes(
          'Failed to wait for promise from send modeling command'
        ) ||
        e[0].errors[0].message.includes(REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE)
      ) {
        isInterrupted = true
      }
    }

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
  sourceCode,
  instance,
  rustContext,
  edgeRefactorMetadata,
  directTagFilletMetadata,
  artifactGraph,
}: {
  ast: Program
  sourceCode: string
  instance: ModuleType
  rustContext?: RustContext
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  directTagFilletMetadata?: DirectTagFilletMeta[]
  artifactGraph?: ArtifactGraph
}): Promise<Array<Diagnostic>> {
  try {
    let discovered_findings = await kclLint(ast, instance)

    // Filter out Z0005 if sketch solve mode is not enabled
    // Only show Z0005 when useSketchSolveMode setting is enabled
    let shouldShowZ0005 = false
    if (rustContext) {
      try {
        const settings = jsAppSettings(rustContext.settingsActor)
        shouldShowZ0005 =
          settings?.settings?.modeling?.use_sketch_solve_mode === true
      } catch {
        // If we can't get settings, no-op since shouldShowZ0005 defaults false
      }
    }

    if (!shouldShowZ0005) {
      discovered_findings = discovered_findings.filter(
        (lint) => lint.finding.code !== 'Z0005'
      )
    }

    // Process findings - for Z0005 without suggestion, we'll create actions async
    const diagnosticsPromises = discovered_findings.map(async (lint) => {
      let actions
      let message = lint.finding.title
      const suggestion = lint.suggestion

      if (suggestion) {
        actions = [
          {
            name: suggestion.title,
            apply: (view: EditorView, from: number, to: number) => {
              view.dispatch({
                changes: {
                  from: toUtf16(suggestion.source_range[0], sourceCode),
                  to: toUtf16(suggestion.source_range[1], sourceCode),
                  insert: suggestion.insert,
                },
                annotations: [lspCodeActionEvent],
              })
            },
          },
        ]
      } else {
        const refactorResult = await resolveRefactorLintActions({
          lint,
          ast,
          sourceCode,
          instance,
          rustContext,
          shouldShowZ0005,
          edgeRefactorMetadata,
          directTagFilletMetadata,
          artifactGraph,
        })
        actions = refactorResult.actions
        if (refactorResult.messageOverride) {
          message = refactorResult.messageOverride
        }
      }

      const diagnostic = {
        from: toUtf16(lint.pos[0], sourceCode),
        to: toUtf16(lint.pos[1], sourceCode),
        message,
        severity: 'info',
        actions,
      } as const

      return diagnostic
    })

    return await Promise.all(diagnosticsPromises)
  } catch (e: any) {
    console.log(e)
    return []
  }
}
