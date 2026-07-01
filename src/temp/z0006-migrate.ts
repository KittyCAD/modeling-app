/*
 * Temporary PR3.2 migration helper.
 *
 * This is intentionally local tooling for applying the Z0006 codemod to
 * samples/examples. Do not commit this script unless we decide it should become
 * supported repo tooling.
 */

import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Node } from '@rust/kcl-lib/bindings/Node'
import { hydrateEdgeRefactorMetadata } from '@src/lang/lintRefactorActions'
import { refactorZ0006Unified } from '@src/lang/modifyAst/edges'
import { defaultArtifactGraph } from '@src/lang/std/artifactGraph'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import { assertParse } from '@src/lang/wasm'
import type { Program } from '@src/lang/wasm'
import { buildTheWorldAndConnectToEngine } from '@src/unitTestUtils'

export type MigrationResult =
  | {
      status: 'changed' | 'unchanged'
      file: string
      before: string
      after: string
    }
  | {
      status: 'failed'
      file: string
      error: string
    }

export async function migrateRawKclFile({
  file,
  kclManager,
  engineCommandManager,
  wasmInstance,
}: {
  file: string
  kclManager: Awaited<
    ReturnType<typeof buildTheWorldAndConnectToEngine>
  >['kclManager']
  engineCommandManager: Awaited<
    ReturnType<typeof buildTheWorldAndConnectToEngine>
  >['engineCommandManager']
  wasmInstance: Awaited<
    ReturnType<typeof buildTheWorldAndConnectToEngine>
  >['instance']
}): Promise<MigrationResult> {
  const source = await readFile(file, 'utf8')
  projectFsManager.dir = dirname(file)
  kclManager.path = file

  let ast: Node<Program>
  try {
    ast = assertParse(source, wasmInstance)
  } catch (error) {
    return {
      status: 'failed',
      file,
      error: `parse failed: ${formatError(error)}`,
    }
  }

  try {
    await kclManager.executeAst({ ast })
  } catch (error) {
    const fallback = refactorWithoutExecutionMetadata({
      ast,
      file,
      source,
      wasmInstance,
    })
    if (fallback.status !== 'failed') return fallback

    return {
      status: 'failed',
      file,
      error: `execute failed: ${formatError(error)}; fallback refactor failed: ${fallback.error}`,
    }
  }

  if (kclManager.errors.length > 0) {
    const fallback = refactorWithoutExecutionMetadata({
      ast,
      file,
      source,
      wasmInstance,
    })
    if (fallback.status !== 'failed') return fallback

    return {
      status: 'failed',
      file,
      error: `execute produced ${kclManager.errors.length} error(s): ${kclManager.errors
        .map((error) => error.message)
        .join('; ')}; fallback refactor failed: ${fallback.error}`,
    }
  }

  const execState = kclManager.execState
  const hydratedEdgeRefactorMetadata = await hydrateEdgeRefactorMetadata({
    edgeRefactorMetadata: execState.edgeRefactorMetadata ?? [],
    engineCommandManager,
  })
  const refactored = refactorZ0006Unified(
    ast,
    hydratedEdgeRefactorMetadata,
    execState.directTagFilletMetadata ?? [],
    execState.artifactGraph,
    wasmInstance
  )

  if (refactored instanceof Error) {
    if (
      refactored.message === 'No Z0006 fixes to apply' &&
      !hasDeprecatedEdgeHelperUsage(source)
    ) {
      return { status: 'unchanged', file, before: source, after: source }
    }

    return {
      status: 'failed',
      file,
      error: `refactor failed: ${refactored.message}`,
    }
  }

  if (refactored.trim() === source.trim()) {
    return { status: 'unchanged', file, before: source, after: refactored }
  }

  return { status: 'changed', file, before: source, after: refactored }
}

function refactorWithoutExecutionMetadata({
  ast,
  file,
  source,
  wasmInstance,
}: {
  ast: Node<Program>
  file: string
  source: string
  wasmInstance: Awaited<
    ReturnType<typeof buildTheWorldAndConnectToEngine>
  >['instance']
}): MigrationResult {
  const refactored = refactorZ0006Unified(
    ast,
    [],
    [],
    defaultArtifactGraph(),
    wasmInstance
  )

  if (refactored instanceof Error) {
    if (
      refactored.message === 'No Z0006 fixes to apply' &&
      !hasDeprecatedEdgeHelperUsage(source)
    ) {
      return { status: 'unchanged', file, before: source, after: source }
    }

    return {
      status: 'failed',
      file,
      error: refactored.message,
    }
  }

  if (refactored.trim() === source.trim()) {
    return { status: 'unchanged', file, before: source, after: refactored }
  }

  return { status: 'changed', file, before: source, after: refactored }
}

export function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function hasDeprecatedEdgeHelperUsage(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  return /\b(getOppositeEdge|getNextAdjacentEdge|getPreviousAdjacentEdge|getCommonEdge|edgeId|getOffsetEdge)\s*\(/.test(
    withoutComments
  )
}
