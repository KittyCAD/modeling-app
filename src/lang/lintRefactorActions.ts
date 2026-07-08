import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Discovered } from '@rust/kcl-lib/bindings/Discovered'
import type { Node } from '@rust/kcl-lib/bindings/Node'

import { toUtf16 } from '@src/lang/errors'
import { refactorZ0006Unified } from '@src/lang/modifyAst/edges'
import type { EngineCommand } from '@src/lang/std/artifactGraph'
import type {
  ArtifactGraph,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Program,
} from '@src/lang/wasm'
import { isModelingResponse } from '@src/lib/kcSdkGuards'
import type RustContext from '@src/lib/rustContext'
import { jsAppSettings } from '@src/lib/settings/settingsUtils'
import { err } from '@src/lib/trap'
import { isArray } from '@src/lib/utils'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { ConnectionManager } from '@src/network/connectionManager'
import type { EditorView } from 'codemirror'
import { v4 as uuidv4 } from 'uuid'

type RefactorLintActionsParams = {
  lint: Discovered
  ast: Node<Program>
  sourceCode: string
  instance: ModuleType
  rustContext?: RustContext
  shouldShowZ0005: boolean
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  directTagFilletMetadata?: DirectTagFilletMeta[]
  artifactGraph?: ArtifactGraph
  engineCommandManager?: ConnectionManager
  z0006RefactorCache?: Z0006RefactorCache
}

type RefactorLintActionsResult = {
  actions?: Diagnostic['actions']
  messageOverride?: string
}

export type Z0006RefactorCache = {
  promise?: Promise<string | null>
}

type HydratableEdgeRefactorMeta = EdgeRefactorMeta & {
  objectId?: string
  faceIds?: [string, string]
}

async function getFaceIdsForEdge({
  engineCommandManager,
  objectId,
  edgeId,
}: {
  engineCommandManager: ConnectionManager
  objectId: string
  edgeId: string
}): Promise<[string, string] | null> {
  const command: EngineCommand = {
    type: 'modeling_cmd_req',
    cmd_id: uuidv4(),
    cmd: {
      type: 'solid3d_get_all_edge_faces',
      object_id: objectId,
      edge_id: edgeId,
    },
  }
  const response = await engineCommandManager.sendSceneCommand(command)
  if (!isModelingResponse(response)) {
    return null
  }
  const modelingResponse = response.resp.data.modeling_response as {
    type?: string
    data?: { faces?: string[] }
  }
  if (modelingResponse.type !== 'solid3d_get_all_edge_faces') {
    return null
  }
  const faces = modelingResponse.data?.faces ?? []
  return faces.length === 2 ? [faces[0], faces[1]] : null
}

export async function hydrateEdgeRefactorMetadata({
  edgeRefactorMetadata,
  engineCommandManager,
}: {
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  engineCommandManager?: ConnectionManager
}): Promise<EdgeRefactorMeta[]> {
  if (!edgeRefactorMetadata?.length) {
    return []
  }
  if (!engineCommandManager) {
    return edgeRefactorMetadata
  }

  const hydrated = await Promise.all(
    edgeRefactorMetadata.map(async (meta) => {
      const hydratable = meta as HydratableEdgeRefactorMeta
      if (isArray(hydratable.faceIds) && hydratable.faceIds.length === 2) {
        return meta
      }
      if (!hydratable.objectId) {
        return meta
      }
      const faceIds = await getFaceIdsForEdge({
        engineCommandManager,
        objectId: hydratable.objectId,
        edgeId: hydratable.edgeId,
      }).catch(() => null)
      return faceIds ? { ...meta, faceIds } : meta
    })
  )

  return hydrated
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

function computeZ0006RefactorSource({
  ast,
  sourceCode,
  instance,
  edgeRefactorMetadata,
  directTagFilletMetadata,
  artifactGraph,
  sourceRange,
}: Omit<
  RefactorLintActionsParams,
  'lint' | 'rustContext' | 'shouldShowZ0005' | 'z0006RefactorCache'
> & {
  sourceRange?: [number, number, number]
}): string | null {
  if (
    !artifactGraph ||
    (!edgeRefactorMetadata?.length && !directTagFilletMetadata?.length)
  ) {
    return null
  }

  const newSourceResult = refactorZ0006Unified(
    ast,
    edgeRefactorMetadata ?? [],
    directTagFilletMetadata ?? [],
    artifactGraph,
    instance,
    sourceRange
  )
  const newSource = err(newSourceResult) ? null : newSourceResult.trim() || null
  const codeActuallyChanged =
    newSource != null && newSource !== sourceCode.trim()
  return newSource && codeActuallyChanged ? newSource : null
}

async function getZ0006RefactorSource(
  params: Omit<
    RefactorLintActionsParams,
    'lint' | 'rustContext' | 'shouldShowZ0005'
  > & {
    sourceRange?: [number, number, number]
  }
): Promise<string | null> {
  if (params.sourceRange || !params.z0006RefactorCache) {
    return computeZ0006RefactorSource(params)
  }

  params.z0006RefactorCache.promise ??= Promise.resolve().then(() =>
    computeZ0006RefactorSource(params)
  )
  return params.z0006RefactorCache.promise
}

async function createZ0006Actions({
  lint,
  ast,
  sourceCode,
  instance,
  edgeRefactorMetadata,
  directTagFilletMetadata,
  artifactGraph,
  engineCommandManager,
  z0006RefactorCache,
}: Omit<
  RefactorLintActionsParams,
  'rustContext' | 'shouldShowZ0005'
>): Promise<RefactorLintActionsResult> {
  if (
    lint.finding.code !== 'Z0006' ||
    !artifactGraph ||
    (!edgeRefactorMetadata?.length && !directTagFilletMetadata?.length)
  ) {
    return {}
  }

  const hydratedEdgeRefactorMetadata = await hydrateEdgeRefactorMetadata({
    edgeRefactorMetadata,
    engineCommandManager,
  })

  const newSource = await getZ0006RefactorSource({
    ast,
    sourceCode,
    instance,
    edgeRefactorMetadata: hydratedEdgeRefactorMetadata,
    directTagFilletMetadata,
    artifactGraph,
    sourceRange: [lint.pos[0], lint.pos[1], lint.pos[2] ?? 0],
    z0006RefactorCache,
  })
  if (!newSource) return {}

  return {
    actions: [
      {
        name: 'Convert this edge reference to edge specifiers',
        apply: (view: EditorView, _from: number, _to: number) => {
          try {
            // Diagnostics can survive briefly during the execution debounce.
            // Avoid applying a stale full-document refactor over newer edits.
            if (view.state.doc.toString().trim() !== sourceCode.trim()) return

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

  const z0006 = await createZ0006Actions(params)
  if (z0006.actions || z0006.messageOverride) return z0006

  return {}
}
