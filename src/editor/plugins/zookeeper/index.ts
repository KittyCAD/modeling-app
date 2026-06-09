import { invertedEffects } from '@codemirror/commands'
import type { Extension, Transaction } from '@codemirror/state'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import type { MlToolResult } from '@kittycad/lib'
import type { TransactionSpecNoChanges } from '@src/editor/HistoryView'
import type { KclManager } from '@src/lang/KclManager'
import { isCodeTheSame } from '@src/lib/codeEditor'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import fsZds from '@src/lib/fs-zds'
import { isErr } from '@src/lib/trap'
import { EditorView } from 'codemirror'
import {
  type StructuredPatch,
  applyPatch,
  parsePatch,
  reversePatch,
} from 'diff'
import toast from 'react-hot-toast'

type ZookeeperCreatedPatchFile = {
  path: string
  status: 'created'
  contents?: string | null
}

type ZookeeperModifiedPatchFile = {
  path: string
  status: 'modified'
  diff?: string | null
}

type ZookeeperDeletedPatchFile = {
  path: string
  status: 'deleted'
  previous_contents?: string | null
}

export type ZookeeperEditPatchFile =
  | ZookeeperCreatedPatchFile
  | ZookeeperModifiedPatchFile
  | ZookeeperDeletedPatchFile

export type ZookeeperEditPatch = {
  run_id: string
  changed_files?: ZookeeperEditPatchFile[]
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
    changedFilesByPath.set(normalizeZookeeperPatchPath(file.path), file)
  }

  return {
    ...nextPatch,
    run_id: previousPatch.run_id,
    changed_files: Array.from(changedFilesByPath.values()),
  }
}

type EditKclCodeToolResultWithPatch = Extract<
  MlToolResult,
  { type: 'edit_kcl_code' }
> & {
  zookeeper_edit_patch?: ZookeeperEditPatch | null
}

type ZookeeperPatchReplayDirection = 'undo' | 'redo'

type ZookeeperPatchEffectProps = {
  projectPath: string
  patch: ZookeeperEditPatch
  direction: ZookeeperPatchReplayDirection
  activeFilePath?: string
}

type ZookeeperPatchFileReplay = {
  kind: 'content'
  relativePath: string
  absolutePath: string
  expectedContent: string | null
  nextContent: string | null
}

type ZookeeperPatchFileDiffReplay = {
  kind: 'diff'
  relativePath: string
  absolutePath: string
  patch: StructuredPatch
}

type ZookeeperPatchReplay =
  | ZookeeperPatchFileReplay
  | ZookeeperPatchFileDiffReplay

type ZookeeperPatchReplayContents =
  | {
      kind: 'content'
      expectedContent: string | null
      nextContent: string | null
    }
  | {
      kind: 'diff'
      patch: StructuredPatch
    }

export type PreparedZookeeperPatchFileReplay = {
  relativePath: string
  absolutePath: string
  previousContent: string | null
  nextContent: string | null
}

type ZookeeperPatchReplayOptions = {
  fileContentOverrides?: Map<string, string>
}

type ZookeeperHistoryExtensionDependencies = {
  kclManager: KclManager
  onCurrentFileDelete: (deletedPaths: Set<string>) => void | Promise<void>
  onActiveFileRestore: (restoredPath: string) => void | Promise<void>
  onProjectFilesReplay?: (
    replayFiles: readonly PreparedZookeeperPatchFileReplay[]
  ) => void | Promise<void>
}

const zookeeperEffectCompartment = new Compartment()
export const zookeeperPatchIgnoreAnnotationType = Annotation.define<true>()

const zookeeperEditPatchEffect = StateEffect.define<ZookeeperPatchEffectProps>()

const textEncoder = new TextEncoder()

export function getZookeeperEditPatchFromToolOutput(
  toolOutput: MlToolResult
): ZookeeperEditPatch | undefined {
  if (toolOutput.type !== 'edit_kcl_code') {
    return
  }

  return (
    (toolOutput as EditKclCodeToolResultWithPatch).zookeeper_edit_patch ??
    undefined
  )
}

export function zookeeperEditPatchHistoryEvent({
  projectPath,
  patch,
  activeFilePath,
}: {
  projectPath: string
  patch: ZookeeperEditPatch
  activeFilePath?: string
}): TransactionSpecNoChanges {
  return {
    effects: zookeeperEditPatchEffect.of({
      projectPath,
      patch,
      direction: 'redo',
      activeFilePath,
    }),
    annotations: [zookeeperPatchIgnoreAnnotationType.of(true)],
  }
}

export function buildZookeeperHistoryExtension({
  kclManager,
  onCurrentFileDelete,
  onActiveFileRestore,
  onProjectFilesReplay,
}: ZookeeperHistoryExtensionDependencies) {
  let restoringHistoryAfterFailure = false
  const zookeeperPatchListener = EditorView.updateListener.of((vu) => {
    for (const tr of vu.transactions) {
      if (tr.annotation(zookeeperPatchIgnoreAnnotationType)) {
        continue
      }

      for (const e of tr.effects) {
        if (e.is(zookeeperEditPatchEffect)) {
          if (restoringHistoryAfterFailure) {
            restoringHistoryAfterFailure = false
            continue
          }

          kclManager.globalHistoryView.setOperationInProgress(true)
          void replayZookeeperEditPatch({
            ...e.value,
            kclManager,
            onCurrentFileDelete,
            onActiveFileRestore,
            onProjectFilesReplay,
          })
            .catch((error: unknown) => {
              console.error(error)
              toast.error(getReplayErrorMessage(error))
              restoringHistoryAfterFailure = true
              const restored =
                e.value.direction === 'undo'
                  ? kclManager.globalHistoryView.restoreAfterFailedUndo()
                  : kclManager.globalHistoryView.restoreAfterFailedRedo()
              if (!restored) {
                restoringHistoryAfterFailure = false
              }
            })
            .finally(() => {
              kclManager.globalHistoryView.setOperationInProgress(false)
            })
        }
      }
    }
  })

  kclManager.globalHistoryView.dispatch(
    {
      effects: [zookeeperEffectCompartment.reconfigure(zookeeperPatchListener)],
    },
    { shouldForwardToLocalHistory: false }
  )

  return () => {
    kclManager.globalHistoryView.dispatch(
      {
        effects: [zookeeperEffectCompartment.reconfigure([])],
      },
      { shouldForwardToLocalHistory: false }
    )
  }
}

export function zookeeperHistoryExtension(): Extension {
  const undoableZookeeperEditPatch = invertedEffects.of((tr: Transaction) => {
    const found: StateEffect<unknown>[] = []

    for (const e of tr.effects) {
      if (e.is(zookeeperEditPatchEffect)) {
        found.push(
          zookeeperEditPatchEffect.of({
            ...e.value,
            direction: invertZookeeperPatchReplayDirection(e.value.direction),
          })
        )
      }
    }

    return found
  })

  return [undoableZookeeperEditPatch, zookeeperEffectCompartment.of([])]
}

export async function applyZookeeperEditPatch({
  projectPath,
  patch,
  direction,
  fileContentOverrides,
}: ZookeeperPatchEffectProps & ZookeeperPatchReplayOptions) {
  const replayFiles = getZookeeperPatchFileReplays({
    projectPath,
    patch,
    direction,
  })
  if (isErr(replayFiles)) {
    return Promise.reject(replayFiles)
  }

  await writeZookeeperPatchReplay(
    await prepareZookeeperPatchReplay(replayFiles, { fileContentOverrides })
  )
}

async function replayZookeeperEditPatch({
  kclManager,
  ...effectProps
}: ZookeeperPatchEffectProps & {
  kclManager: KclManager
  onCurrentFileDelete: (deletedPaths: Set<string>) => void | Promise<void>
  onActiveFileRestore: (restoredPath: string) => void | Promise<void>
  onProjectFilesReplay?: (
    replayFiles: readonly PreparedZookeeperPatchFileReplay[]
  ) => void | Promise<void>
}) {
  const replayFiles = getZookeeperPatchFileReplays(effectProps)
  if (isErr(replayFiles)) {
    return Promise.reject(replayFiles)
  }
  const preparedReplayFiles = await prepareZookeeperPatchReplay(replayFiles, {
    fileContentOverrides: new Map([[kclManager.path, kclManager.code]]),
  })
  const currentFileReplay = preparedReplayFiles.find(
    (replayFile) => replayFile.absolutePath === kclManager.path
  )

  const deletesCurrentFile = currentFileReplay?.nextContent === null
  await writeZookeeperPatchReplay(preparedReplayFiles)
  await effectProps.onProjectFilesReplay?.(preparedReplayFiles)

  if (deletesCurrentFile) {
    await effectProps.onCurrentFileDelete(
      new Set(
        preparedReplayFiles
          .filter((replayFile) => replayFile.nextContent === null)
          .map((replayFile) => replayFile.absolutePath)
      )
    )
    return
  }

  const restoresActiveFile = preparedReplayFiles.some(
    (replayFile) =>
      replayFile.absolutePath === effectProps.activeFilePath &&
      replayFile.previousContent === null &&
      replayFile.nextContent !== null
  )
  if (
    restoresActiveFile &&
    effectProps.activeFilePath &&
    kclManager.path !== effectProps.activeFilePath
  ) {
    await effectProps.onActiveFileRestore(effectProps.activeFilePath)
    if (effectProps.direction === 'undo') {
      kclManager.synchronizeLocalHistoryAfterExternalGlobalUndo()
    } else {
      kclManager.synchronizeLocalHistoryAfterExternalGlobalRedo()
    }
    return
  }

  if (currentFileReplay && currentFileReplay.nextContent !== null) {
    kclManager.updateCodeEditor(currentFileReplay.nextContent, {
      shouldAddToHistory: false,
      shouldClearHistory: false,
      shouldExecute: true,
      shouldResetCamera: false,
      shouldWriteToDisk: true,
    })
    return
  }

  await kclManager.executeCode()
}

function getZookeeperPatchFileReplays({
  projectPath,
  patch,
  direction,
}: ZookeeperPatchEffectProps): ZookeeperPatchReplay[] | Error {
  const replays: ZookeeperPatchReplay[] = []

  for (const file of patch.changed_files ?? []) {
    if (
      file.status === 'deleted' &&
      isZookeeperProjectEntrypointPath(file.path)
    ) {
      return new Error(
        `Cannot replay Zookeeper edit patch because ${PROJECT_ENTRYPOINT} is the project entrypoint and cannot be deleted.`
      )
    }
    const absolutePath = getZookeeperPatchAbsolutePath(projectPath, file.path)
    if (isErr(absolutePath)) {
      return absolutePath
    }
    const replayContents = getZookeeperPatchReplayContents(file, direction)
    if (isErr(replayContents)) {
      return replayContents
    }
    const pathProps = {
      relativePath: file.path,
      absolutePath,
    }

    replays.push({
      ...pathProps,
      ...replayContents,
    })
  }

  return replays
}

function getZookeeperPatchReplayContents(
  file: ZookeeperEditPatchFile,
  direction: ZookeeperPatchReplayDirection
): ZookeeperPatchReplayContents | Error {
  switch (file.status) {
    case 'created': {
      const contents = requiredContent(file.contents, file)
      if (isErr(contents)) {
        return contents
      }
      return direction === 'undo'
        ? {
            kind: 'content',
            expectedContent: contents,
            nextContent: null,
          }
        : {
            kind: 'content',
            expectedContent: null,
            nextContent: contents,
          }
    }
    case 'modified': {
      const structuredPatch = getZookeeperPatchStructuredPatch(file, direction)
      if (isErr(structuredPatch)) {
        return structuredPatch
      }
      return {
        kind: 'diff',
        patch: structuredPatch,
      }
    }
    case 'deleted': {
      const contents = requiredContent(file.previous_contents, file)
      if (isErr(contents)) {
        return contents
      }
      return direction === 'undo'
        ? {
            kind: 'content',
            expectedContent: null,
            nextContent: contents,
          }
        : {
            kind: 'content',
            expectedContent: contents,
            nextContent: null,
          }
    }
  }
}

async function prepareZookeeperPatchReplay(
  replayFiles: ZookeeperPatchReplay[],
  { fileContentOverrides }: ZookeeperPatchReplayOptions = {}
): Promise<PreparedZookeeperPatchFileReplay[]> {
  const preparedReplayFiles: PreparedZookeeperPatchFileReplay[] = []

  for (const replayFile of replayFiles) {
    const diskContent = await readTextFileIfExists(replayFile.absolutePath)
    const currentContent =
      diskContent === null
        ? null
        : (fileContentOverrides?.get(replayFile.absolutePath) ?? diskContent)

    if (replayFile.kind === 'diff') {
      if (currentContent === null) {
        return Promise.reject(
          zookeeperPatchConflictError(replayFile.relativePath)
        )
      }

      const nextContent = applyPatch(currentContent, replayFile.patch, {
        fuzzFactor: 0,
      })
      if (nextContent === false) {
        return Promise.reject(
          zookeeperPatchConflictError(replayFile.relativePath)
        )
      }
      preparedReplayFiles.push({
        relativePath: replayFile.relativePath,
        absolutePath: replayFile.absolutePath,
        previousContent: currentContent,
        nextContent,
      })
      continue
    }

    const expectedContentError = validateExpectedContent(
      replayFile,
      currentContent
    )
    if (expectedContentError) {
      return Promise.reject(expectedContentError)
    }
    preparedReplayFiles.push({
      relativePath: replayFile.relativePath,
      absolutePath: replayFile.absolutePath,
      previousContent: currentContent,
      nextContent: replayFile.nextContent,
    })
  }

  return preparedReplayFiles
}

function validateExpectedContent(
  replayFile: ZookeeperPatchFileReplay,
  currentContent: string | null
): Error | undefined {
  if (replayFile.expectedContent === null) {
    if (currentContent !== null) {
      return zookeeperPatchConflictError(replayFile.relativePath)
    }
    return
  }

  if (
    currentContent === null ||
    !isCodeTheSame(currentContent, replayFile.expectedContent)
  ) {
    return zookeeperPatchConflictError(replayFile.relativePath)
  }
}

async function writeZookeeperPatchReplay(
  replayFiles: PreparedZookeeperPatchFileReplay[]
) {
  const writtenFiles: PreparedZookeeperPatchFileReplay[] = []

  try {
    for (const replayFile of replayFiles) {
      await writeZookeeperReplayFile(
        replayFile.absolutePath,
        replayFile.nextContent
      )
      writtenFiles.push(replayFile)
    }
  } catch (error: unknown) {
    const rollbackErrors: unknown[] = []
    for (const replayFile of writtenFiles.reverse()) {
      try {
        await writeZookeeperReplayFile(
          replayFile.absolutePath,
          replayFile.previousContent
        )
      } catch (rollbackError: unknown) {
        rollbackErrors.push(rollbackError)
      }
    }

    if (rollbackErrors.length > 0) {
      return Promise.reject(
        new AggregateError(
          [error, ...rollbackErrors],
          'Zookeeper edit replay failed and could not be fully rolled back.'
        )
      )
    }
    return Promise.reject(error)
  }
}

async function writeZookeeperReplayFile(
  absolutePath: string,
  content: string | null
) {
  if (content === null) {
    await fsZds.rm(absolutePath)
    return
  }

  await fsZds.mkdir(fsZds.dirname(absolutePath), { recursive: true })
  await fsZds.writeFile(absolutePath, textEncoder.encode(content))
}

async function readTextFileIfExists(path: string): Promise<string | null> {
  try {
    return await fsZds.readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isEnoentError(error)) {
      return null
    }

    return Promise.reject(error)
  }
}

function getZookeeperPatchAbsolutePath(
  projectPath: string,
  relativePath: string
): string | Error {
  const normalizedPath = normalizeZookeeperPatchPath(relativePath)
  const pathSeparator = '/'
  const pathParts = normalizedPath.split(pathSeparator)
  const safePathParts = pathParts.filter(
    (part) => part.length > 0 && part !== '.'
  )

  if (
    pathParts.some((part) => part === '..') ||
    safePathParts.length === 0 ||
    normalizedPath.startsWith('/') ||
    /^[A-Za-z]:/.test(normalizedPath)
  ) {
    return new Error(
      `Cannot replay Zookeeper edit patch for unsafe path "${relativePath}".`
    )
  }

  return fsZds.join(projectPath, ...safePathParts)
}

function normalizeZookeeperPatchPath(path: string) {
  return path.replaceAll('\\', '/').replace(/^(?:\.\/)+/, '')
}

function requiredContent(
  content: string | null | undefined,
  file: ZookeeperEditPatchFile
): string | Error {
  if (content == null) {
    return new Error(
      `Cannot replay Zookeeper edit patch for "${file.path}" because the ${file.status} file content is missing.`
    )
  }

  return content
}

function getZookeeperPatchStructuredPatch(
  file: ZookeeperModifiedPatchFile,
  direction: ZookeeperPatchReplayDirection
): StructuredPatch | Error {
  const diff = requiredDiff(file.diff, file)
  if (isErr(diff)) {
    return diff
  }
  let patches: StructuredPatch[]

  try {
    patches = parsePatch(diff)
  } catch {
    return new Error(
      `Cannot replay Zookeeper edit patch for "${file.path}" because the diff is invalid.`
    )
  }

  const patch = patches[0]
  if (!patch || patches.length !== 1) {
    return new Error(
      `Cannot replay Zookeeper edit patch for "${file.path}" because the diff must contain exactly one file patch.`
    )
  }

  return direction === 'undo' ? reversePatch(patch) : patch
}

function requiredDiff(
  diff: string | null | undefined,
  file: ZookeeperEditPatchFile
): string | Error {
  if (diff == null) {
    return new Error(
      `Cannot replay Zookeeper edit patch for "${file.path}" because the ${file.status} file diff is missing.`
    )
  }

  return diff
}

function invertZookeeperPatchReplayDirection(
  direction: ZookeeperPatchReplayDirection
): ZookeeperPatchReplayDirection {
  return direction === 'undo' ? 'redo' : 'undo'
}

function zookeeperPatchConflictError(path: string) {
  return new Error(
    `Cannot replay Zookeeper edit patch because "${path}" changed since the edit was recorded.`
  )
}

function getReplayErrorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Failed to replay Zookeeper edit patch.'
}

function isEnoentError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (('cause' in error && error.cause === 'ENOENT') ||
      ('code' in error && error.code === 'ENOENT'))
  )
}
