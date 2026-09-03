import type { Diagnostic } from '@codemirror/lint'
import { lspCodeActionEvent } from '@kittycad/codemirror-lsp-client'
import type { Discovered } from '@rust/kcl-lib/bindings/Discovered'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { LegacyAngleRefactorMeta } from '@rust/kcl-lib/bindings/LegacyAngleRefactorMeta'

import { convertLegacyAngleToAngleDimension } from '@src/lang/modifyAst/angle'
import { refactorZ0006Unified } from '@src/lang/modifyAst/edges'
import type {
  ArtifactGraph,
  DirectTagFilletMeta,
  EdgeRefactorMeta,
  Program,
} from '@src/lang/wasm'
import { recast } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import type { ModuleType } from '@src/lib/wasm_lib_wrapper'
import type { EditorView } from 'codemirror'

type RefactorLintActionsParams = {
  lint: Discovered
  ast: Node<Program>
  sourceCode: string
  instance: ModuleType
  edgeRefactorMetadata?: EdgeRefactorMeta[]
  directTagFilletMetadata?: DirectTagFilletMeta[]
  legacyAngleRefactorMetadata: LegacyAngleRefactorMeta[]
  artifactGraph?: ArtifactGraph
  z0006RefactorCache?: Z0006RefactorCache
}

type RefactorLintActionsResult = {
  actions?: Diagnostic['actions']
}

export type Z0006RefactorCache = {
  promise?: Promise<string | null>
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
  'lint' | 'legacyAngleRefactorMetadata' | 'z0006RefactorCache'
> & {
  sourceRange?: [number, number, number]
}): string | null {
  if (!artifactGraph) return null

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
    'lint' | 'legacyAngleRefactorMetadata'
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
  z0006RefactorCache,
}: RefactorLintActionsParams): Promise<RefactorLintActionsResult> {
  if (lint.finding.code !== 'Z0006' || !artifactGraph) {
    return {}
  }

  const newSource = await getZ0006RefactorSource({
    ast,
    sourceCode,
    instance,
    edgeRefactorMetadata,
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

function createZ0007Actions({
  lint,
  ast,
  sourceCode,
  instance,
  legacyAngleRefactorMetadata,
}: RefactorLintActionsParams): RefactorLintActionsResult {
  if (lint.finding.code !== 'Z0007') return {}

  const metadata = legacyAngleRefactorMetadata.find(
    ({ sourceRange }) =>
      sourceRange[0] === lint.pos[0] &&
      sourceRange[1] === lint.pos[1] &&
      sourceRange[2] === lint.pos[2]
  )
  if (!metadata) return {}

  const modifiedAst = convertLegacyAngleToAngleDimension(
    ast,
    metadata.sourceRange,
    metadata.sector,
    metadata.inverse,
    instance
  )
  if (err(modifiedAst)) return {}

  const convertedSource = recast(modifiedAst, instance)
  if (err(convertedSource)) return {}

  return {
    actions: [
      {
        name: 'Convert to angleDimension',
        apply: (view: EditorView, _from: number, _to: number) => {
          if (view.state.doc.toString() !== sourceCode) return

          view.dispatch({
            changes: {
              from: 0,
              to: view.state.doc.length,
              insert: convertedSource,
            },
            annotations: [lspCodeActionEvent],
          })
        },
      },
    ],
  }
}

export async function resolveRefactorLintActions(
  params: RefactorLintActionsParams
): Promise<RefactorLintActionsResult> {
  const z0006 = await createZ0006Actions(params)
  if (z0006.actions) return z0006

  const z0007 = createZ0007Actions(params)
  if (z0007.actions) return z0007

  return {}
}
