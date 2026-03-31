import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Discovered } from '@rust/kcl-lib/bindings/Discovered'

import { refactorZ0006Unified } from '@src/lang/modifyAst/edges'
import type {
  ArtifactGraph,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Program,
} from '@src/lang/wasm'
import { toUtf16 } from '@src/lang/errors'
import type RustContext from '@src/lib/rustContext'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import type { EditorView } from 'codemirror'

type RefactorLintActionsParams = {
  lint: Discovered
  ast: Program
  sourceCode: string
  instance: ModuleType
  rustContext?: RustContext
  shouldShowZ0005: boolean
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  directTagFilletMetadata?: DirectTagFilletMeta[]
  artifactGraph?: ArtifactGraph
}

type RefactorLintActionsResult = {
  actions?: Diagnostic['actions']
  messageOverride?: string
}

function findLintVariableName(
  ast: Program,
  lintStart: number,
  lintEnd: number
) {
  for (const item of ast.body) {
    if (item.type !== 'VariableDeclaration') continue
    const varDecl = item.declaration
    if (lintStart >= varDecl.init.start && lintEnd <= varDecl.init.end) {
      return varDecl.id.name
    }
  }
  return null
}

async function createZ0005Actions({
  lint,
  ast,
  sourceCode,
  rustContext,
  shouldShowZ0005,
}: Omit<
  RefactorLintActionsParams,
  | 'instance'
  | 'edgeRefactorMetadata'
  | 'directTagFilletMetadata'
  | 'artifactGraph'
>): Promise<RefactorLintActionsResult> {
  if (lint.finding.code !== 'Z0005' || !rustContext || !shouldShowZ0005) {
    return {}
  }

  const transpilationFailMessage =
    'Deprecated sketch syntax. This sketch cannot be converted to new sketch block syntax at this time.'

  try {
    const lintStart = lint.pos[0]
    const lintEnd = lint.pos[1]
    const variableName = findLintVariableName(ast, lintStart, lintEnd)
    if (!variableName) return {}

    let ctx: Awaited<ReturnType<typeof rustContext.createNewContext>> | null =
      null
    try {
      const settings = jsAppSettings(rustContext.settingsActor)
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

      if (!transpiledCode?.trim()) {
        console.warn('[lintAst] Z0005 transpilation returned empty result')
        return { messageOverride: transpilationFailMessage }
      }

      return {
        actions: [
          {
            name: `convert '${variableName}' to new sketch block syntax`,
            apply: (view: EditorView, _from: number, _to: number) => {
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
        ],
      }
    } catch (transpileError) {
      console.warn('[lintAst] Z0005 transpilation failed:', transpileError)
      return { messageOverride: transpilationFailMessage }
    } finally {
      // The ExecutorContext inside transpile_old_sketch is closed by Rust code.
      ctx = null
    }
  } catch (e) {
    console.warn('[lintAst] Error processing Z0005:', e)
    return {}
  }
}

function createZ0006Actions({
  lint,
  ast,
  sourceCode,
  instance,
  edgeRefactorMetadata,
  directTagFilletMetadata,
  artifactGraph,
}: Omit<
  RefactorLintActionsParams,
  'rustContext' | 'shouldShowZ0005'
>): RefactorLintActionsResult {
  if (
    lint.finding.code !== 'Z0006' ||
    !artifactGraph ||
    (!edgeRefactorMetadata?.length && !directTagFilletMetadata?.length)
  ) {
    return {}
  }

  const newSourceResult = refactorZ0006Unified(
    ast,
    edgeRefactorMetadata ?? [],
    directTagFilletMetadata ?? [],
    artifactGraph,
    instance
  )
  const newSource = err(newSourceResult) ? null : newSourceResult.trim() || null
  const codeActuallyChanged =
    newSource != null && newSource !== sourceCode.trim()
  if (!newSource || !codeActuallyChanged) return {}

  return {
    actions: [
      {
        name: 'Convert to edges/axis',
        apply: (view: EditorView, _from: number, _to: number) => {
          try {
            view.dispatch({
              changes: {
                from: 0,
                to: view.state.doc.length,
                insert: newSource,
              },
              annotations: [lspCodeActionEvent],
            })
          } catch (e) {
            console.warn('[lintAst] Z0006 apply dispatch failed:', e)
          }
        },
      },
    ],
  }
}

export async function resolveRefactorLintActions(
  params: RefactorLintActionsParams
): Promise<RefactorLintActionsResult> {
  const z0005 = await createZ0005Actions(params)
  if (z0005.actions || z0005.messageOverride) return z0005

  const z0006 = createZ0006Actions(params)
  if (z0006.actions || z0006.messageOverride) return z0006

  return {}
}
