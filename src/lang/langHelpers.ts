import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { UserFeature } from '@kittycad/lib'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { KCLError, toUtf16 } from '@src/lang/errors'
import { executeAstMock as executeAstMockImpl } from '@src/lang/executeAstMock'
import {
  type Z0006RefactorCache,
  resolveRefactorLintActions,
} from '@src/lang/lintRefactorActions'
import type { ArtifactGraph } from '@src/lang/wasm'
import type {
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  ExecCallbacks,
  ExecState,
  Program,
} from '@src/lang/wasm'
import { emptyExecState, kclLint } from '@src/lang/wasm'
import { EXECUTE_AST_INTERRUPT_ERROR_STRING } from '@src/lib/constants'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import { REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE } from '@src/network/utils'
import type { EditorView } from 'codemirror'
export type { ToolTip } from '@src/lang/toolTips'
export { isToolTip, toolTips } from '@src/lang/toolTips'

const ENABLE_Z0006_LINT_FLAG = 'enable_z0006_lint'

function userHasFeature(featureFlagId: string, defaultValue: boolean): boolean {
  return (
    window.app?.userFeatures.has(featureFlagId as UserFeature, defaultValue) ??
    defaultValue
  )
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
  callbacks,
}: {
  ast: Node<Program>
  rustContext: RustContext
  path?: string
  callbacks?: ExecCallbacks
}): Promise<ExecutionResult> {
  try {
    const settings = jsAppSettings(rustContext.settingsActor)
    const execState = await rustContext.execute(ast, settings, path, callbacks)
    await rustContext.waitForAllEngineModelingCommands()
    return {
      logs: [],
      errors: [],
      execState,
      isInterrupted: false,
    }
  } catch (e) {
    return handleExecuteError(e)
  }
}

export const executeAstMock = executeAstMockImpl

function getFirstExecutionErrorMessage(e: unknown): string | undefined {
  if (!isArray(e)) return undefined
  const firstErrorResult = e[0]
  if (
    !firstErrorResult ||
    typeof firstErrorResult !== 'object' ||
    !('errors' in firstErrorResult) ||
    !isArray(firstErrorResult.errors)
  ) {
    return undefined
  }
  const firstError = firstErrorResult.errors[0]
  if (
    !firstError ||
    typeof firstError !== 'object' ||
    !('message' in firstError) ||
    typeof firstError.message !== 'string'
  ) {
    return undefined
  }
  return firstError.message
}

function handleExecuteError(e: unknown): ExecutionResult {
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
    const executionErrorMessage = getFirstExecutionErrorMessage(e)
    if (executionErrorMessage) {
      isInterrupted =
        executionErrorMessage.includes(
          'no connection to send on, connection manager called tearDown()'
        ) ||
        executionErrorMessage.includes(
          'Failed to wait for promise from send modeling command'
        ) ||
        executionErrorMessage.includes(REJECTED_TOO_EARLY_WEBSOCKET_MESSAGE)
    }

    console.log(e)
    return {
      logs: [String(e)],
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
  engineCommandManager,
}: {
  ast: Node<Program>
  sourceCode: string
  instance: ModuleType
  rustContext?: RustContext
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  directTagFilletMetadata?: DirectTagFilletMeta[]
  artifactGraph?: ArtifactGraph
  engineCommandManager?: ConnectionManager
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

    const shouldShowZ0006 = userHasFeature(ENABLE_Z0006_LINT_FLAG, false)
    if (!shouldShowZ0006) {
      discovered_findings = discovered_findings.filter(
        (lint) => lint.finding.code !== 'Z0006'
      )
    }

    // Process findings - for Z0005 without suggestion, we'll create actions async
    const z0006RefactorCache: Z0006RefactorCache = {}
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
          engineCommandManager,
          z0006RefactorCache,
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
  } catch (e) {
    console.log(e)
    return []
  }
}
