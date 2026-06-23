import type { MlToolResult } from '@kittycad/lib'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import {
  type StructuredPatch,
  applyPatch,
  createTwoFilesPatch,
  parsePatch,
} from 'diff'

export type ZookeeperCreatedPatchFile = {
  path: string
  status: 'created'
  contents?: string
}

export type ZookeeperModifiedPatchFile = {
  path: string
  status: 'modified'
  diff?: string
}

export type ZookeeperDeletedPatchFile = {
  path: string
  status: 'deleted'
  previous_contents?: string
}

export type ZookeeperEditPatchFile =
  | ZookeeperCreatedPatchFile
  | ZookeeperModifiedPatchFile
  | ZookeeperDeletedPatchFile

export type ZookeeperEditPatch = {
  run_id: string
  changed_files?: ZookeeperEditPatchFile[]
}

type EditKclCodeToolResultWithPatch = Extract<
  MlToolResult,
  { type: 'edit_kcl_code' }
>

type EditKclCodeToolResultWithLocalPatch = Omit<
  EditKclCodeToolResultWithPatch,
  'zookeeper_edit_patch'
> & {
  zookeeper_edit_patch?: ZookeeperEditPatch | null
}

export function getZookeeperEditPatchFromToolOutput(
  toolOutput: MlToolResult
): ZookeeperEditPatch | undefined {
  if (toolOutput.type !== 'edit_kcl_code') {
    return
  }

  return (
    (toolOutput as EditKclCodeToolResultWithLocalPatch).zookeeper_edit_patch ??
    undefined
  )
}

export function isZookeeperProjectEntrypointPath(path: string) {
  return normalizeZookeeperPatchPath(path) === PROJECT_ENTRYPOINT
}

export function mergeZookeeperEditPatches(
  previousPatch: ZookeeperEditPatch,
  nextPatch: ZookeeperEditPatch
): ZookeeperEditPatch {
  const changedFilesByPath = new Map<string, ZookeeperEditPatchFile>()

  for (const file of previousPatch.changed_files ?? []) {
    changedFilesByPath.set(normalizeZookeeperPatchPath(file.path), file)
  }

  for (const file of nextPatch.changed_files ?? []) {
    const normalizedPath = normalizeZookeeperPatchPath(file.path)
    const previousFile = changedFilesByPath.get(normalizedPath)
    const mergedFile = previousFile
      ? mergeZookeeperEditPatchFile(previousFile, file)
      : file

    if (mergedFile) {
      changedFilesByPath.set(normalizedPath, mergedFile)
    } else {
      changedFilesByPath.delete(normalizedPath)
    }
  }

  return {
    ...nextPatch,
    run_id: previousPatch.run_id,
    changed_files: Array.from(changedFilesByPath.values()),
  }
}

/**
 * Normalize streamed Zookeeper patch paths to project-relative POSIX-style
 * paths. This only strips leading "./" path segments, so dotfile names such
 * as ".gitignore" are preserved.
 */
export function normalizeZookeeperPatchPath(path: string) {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
}

/**
 * Merge streamed patch entries for one path into the aggregate patch for a run.
 * Zookeeper currently streams modified-file diffs cumulatively from the file's
 * original contents, so the latest modified diff replaces the earlier one. If
 * the API starts sending incremental diffs, this branch must compose patches
 * instead.
 */
function mergeZookeeperEditPatchFile(
  previousFile: ZookeeperEditPatchFile,
  nextFile: ZookeeperEditPatchFile
): ZookeeperEditPatchFile | undefined {
  if (previousFile.status === 'created') {
    if (nextFile.status === 'modified') {
      const nextContents = applyModifiedPatch(
        previousFile.contents,
        nextFile.diff
      )
      return {
        ...previousFile,
        contents: nextContents ?? previousFile.contents,
      }
    }
    if (nextFile.status === 'deleted') {
      return undefined
    }
  }

  if (
    previousFile.status === 'deleted' &&
    nextFile.status === 'created' &&
    previousFile.previous_contents != null &&
    nextFile.contents != null
  ) {
    return {
      path: nextFile.path,
      status: 'modified',
      diff: createTwoFilesPatch(
        `a/${nextFile.path}`,
        `b/${nextFile.path}`,
        previousFile.previous_contents,
        nextFile.contents
      ),
    }
  }

  if (
    previousFile.status === 'created' &&
    nextFile.status === 'created' &&
    nextFile.contents == null
  ) {
    return {
      ...nextFile,
      contents: previousFile.contents,
    }
  }

  if (
    previousFile.status === 'deleted' &&
    nextFile.status === 'deleted' &&
    nextFile.previous_contents == null
  ) {
    return {
      ...nextFile,
      previous_contents: previousFile.previous_contents,
    }
  }

  if (previousFile.status === 'modified' && nextFile.status === 'modified') {
    return nextFile
  }

  return nextFile
}

function applyModifiedPatch(
  contents: string | null | undefined,
  diff: string | null | undefined
) {
  if (contents == null || diff == null) {
    return
  }

  let patch: StructuredPatch | undefined
  try {
    patch = parsePatch(diff)[0]
  } catch {
    return
  }
  if (!patch) {
    return
  }

  const nextContents = applyPatch(contents, patch, { fuzzFactor: 0 })
  return nextContents === false ? undefined : nextContents
}
