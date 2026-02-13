import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { KCLError, toUtf16 } from '@src/lang/errors'
import type { ExecState, Program } from '@src/lang/wasm'
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
    const settings = await jsAppSettings(rustContext.settingsActor)
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
    const settings = await jsAppSettings(rustContext.settingsActor)
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
}: {
  ast: Program
  sourceCode: string
  instance: ModuleType
  rustContext?: RustContext
}): Promise<Array<Diagnostic>> {
  try {
    let discovered_findings = await kclLint(ast, instance)

    // Filter out Z0005 if new sketch mode is not enabled
    // Only show Z0005 when useNewSketchMode setting is enabled
    let shouldShowZ0005 = false
    if (rustContext) {
      try {
        const settings = await jsAppSettings(rustContext.settingsActor)
        shouldShowZ0005 =
          settings?.settings?.modeling?.use_new_sketch_mode === true
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
      const transpilationFailMessage =
        'Deprecated sketch syntax. This sketch cannot be converted to new sketch block syntax at this time.'
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
      } else if (
        lint.finding.code === 'Z0005' &&
        rustContext &&
        shouldShowZ0005
      ) {
        // For Z0005 without suggestion, try to transpile using WASM
        // Extract variable name from the AST at the lint position
        try {
          const lintStart = lint.pos[0]
          const lintEnd = lint.pos[1]

          // Find the variable declaration that contains this range
          let variableName: string | null = null
          for (const item of ast.body) {
            if (item.type === 'VariableDeclaration') {
              const varDecl = item.declaration

              // Check if lint range is within this variable's init expression
              if (
                lintStart >= varDecl.init.start &&
                lintEnd <= varDecl.init.end
              ) {
                variableName = varDecl.id.name
                break
              }
            }
          }

          if (variableName) {
            // Create a temporary context for transpilation
            // Note: This creates a new context each time, but transpile_old_sketch
            // uses the execution cache, so it should be fast
            // The ExecutorContext inside transpile_old_sketch is closed automatically,
            // but we still need to ensure the WASM Context reference is released
            let ctx: Awaited<
              ReturnType<typeof rustContext.createNewContext>
            > | null = null
            try {
              const settings = await jsAppSettings(rustContext.settingsActor)

              ctx = await rustContext.createNewContext()

              const transpiledCodeResult = await ctx.transpile_old_sketch(
                JSON.stringify(ast),
                variableName,
                null, // path
                JSON.stringify(settings)
              )

              const transpiledCode =
                typeof transpiledCodeResult === 'string'
                  ? transpiledCodeResult
                  : String(transpiledCodeResult)

              if (transpiledCode?.trim()) {
                actions = [
                  {
                    name: `convert '${variableName}' to new sketch block syntax`,
                    apply: (view: EditorView, from: number, to: number) => {
                      view.dispatch({
                        changes: {
                          from: toUtf16(lint.pos[0], sourceCode),
                          to: toUtf16(lint.pos[1], sourceCode),
                          insert: transpiledCode.trim(),
                        },
                        annotations: [lspCodeActionEvent],
                      })
                    },
                  },
                ]
              } else {
                // Transpilation returned empty result - update message
                message = transpilationFailMessage
                console.warn(
                  '[lintAst] Z0005 transpilation returned empty result'
                )
              }
            } catch (transpileError) {
              // Transpilation failed - update message
              message = transpilationFailMessage
              console.warn(
                '[lintAst] Z0005 transpilation failed:',
                transpileError
              )
            } finally {
              // Explicitly clear the context reference to help GC
              // The ExecutorContext inside transpile_old_sketch is already closed by Rust code
              ctx = null
            }
          }
        } catch (e) {
          console.warn('[lintAst] Error processing Z0005:', e)
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
