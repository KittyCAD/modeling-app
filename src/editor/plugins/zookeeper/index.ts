import { invertedEffects } from '@codemirror/commands'
import type { Extension, Transaction } from '@codemirror/state'
import { Annotation, Compartment, StateEffect } from '@codemirror/state'
import type { TransactionSpecNoChanges } from '@src/editor/HistoryView'
import type { KclManager } from '@src/lang/KclManager'
import { isCodeTheSame } from '@src/lib/codeEditor'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { runWithProjectFilesystemMutationLock } from '@src/lib/projectDirectoryNamespaceLock'
import { isErr } from '@src/lib/trap'
import {
  type ZookeeperEditPatch,
  type ZookeeperEditPatchFile,
  type ZookeeperModifiedPatchFile,
  isZookeeperProjectEntrypointPath,
  normalizeZookeeperPatchPath,
} from '@src/lib/zookeeperEditPatch'
import { EditorView } from 'codemirror'
import {
  type StructuredPatch,
  applyPatch,
  parsePatch,
  reversePatch,
} from 'diff'
import toast from 'react-hot-toast'

export {
  getZookeeperEditPatchFromToolOutput,
  isZookeeperProjectEntrypointPath,
  mergeZookeeperEditPatches,
  normalizeZookeeperPatchPath,
} from '@src/lib/zookeeperEditPatch'
export type {
  ZookeeperEditPatch,
  ZookeeperEditPatchFile,
} from '@src/lib/zookeeperEditPatch'

type ZookeeperPatchReplayDirection = 'undo' | 'redo'

type ZookeeperPatchEffectProps = {
  projectPath: string
  patch: ZookeeperEditPatch
  direction: ZookeeperPatchReplayDirection
  activeFilePath?: string
  snapshotFiles?: readonly ZookeeperSnapshotFileReplay[]
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

export type ZookeeperSnapshotFileReplay = PreparedZookeeperPatchFileReplay

type ZookeeperPatchReplayOptions = {
  fileContentOverrides?: Map<string, string>
  alreadyReplayedFilePaths?: Set<string>
}

type ZookeeperHistoryExtensionDependencies = {
  kclManager: KclManager
  onCurrentFileDelete: (deletedPaths: Set<string>) => void | Promise<void>
  onActiveFileRestore: (
    restoredPath: string,
    restoredContents: string
  ) => void | Promise<void>
  onProjectFilesReplay?: (
    replayFiles: readonly PreparedZookeeperPatchFileReplay[]
  ) => void | Promise<void>
}

const zookeeperEffectCompartment = new Compartment()
export const zookeeperPatchIgnoreAnnotationType = Annotation.define<true>()

const zookeeperEditPatchEffect = StateEffect.define<ZookeeperPatchEffectProps>()

const textEncoder = new TextEncoder()

export function zookeeperEditPatchHistoryEvent({
  projectPath,
  patch,
  activeFilePath,
  snapshotFiles,
}: {
  projectPath: string
  patch: ZookeeperEditPatch
  activeFilePath?: string
  snapshotFiles?: readonly ZookeeperSnapshotFileReplay[]
}): TransactionSpecNoChanges {
  return {
    effects: zookeeperEditPatchEffect.of({
      projectPath,
      patch,
      direction: 'redo',
      activeFilePath,
      snapshotFiles,
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
              try {
                if (e.value.direction === 'undo') {
                  kclManager.globalHistoryView.restoreAfterFailedUndo()
                } else {
                  kclManager.globalHistoryView.restoreAfterFailedRedo()
                }
              } finally {
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
  alreadyReplayedFilePaths,
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
    await prepareZookeeperPatchReplay(replayFiles, {
      alreadyReplayedFilePaths,
      fileContentOverrides,
    })
  )
}

async function replayZookeeperEditPatch({
  kclManager,
  ...effectProps
}: ZookeeperPatchEffectProps & {
  kclManager: KclManager
  onCurrentFileDelete: (deletedPaths: Set<string>) => void | Promise<void>
  onActiveFileRestore: (
    restoredPath: string,
    restoredContents: string
  ) => void | Promise<void>
  onProjectFilesReplay?: (
    replayFiles: readonly PreparedZookeeperPatchFileReplay[]
  ) => void | Promise<void>
}) {
  const alreadyReplayedFilePaths = new Set<string>()
  if (effectProps.activeFilePath === kclManager.path) {
    alreadyReplayedFilePaths.add(kclManager.path)
  }
  const replayOptions = {
    alreadyReplayedFilePaths,
    fileContentOverrides: new Map([[kclManager.path, kclManager.code]]),
  }
  let preparedReplayFiles: PreparedZookeeperPatchFileReplay[]
  if (effectProps.snapshotFiles?.length) {
    preparedReplayFiles = await prepareZookeeperSnapshotReplay(
      effectProps.snapshotFiles,
      effectProps.direction,
      replayOptions
    )
  } else {
    const replayFiles = getZookeeperPatchFileReplays(effectProps)
    if (isErr(replayFiles)) {
      return Promise.reject(replayFiles)
    }
    preparedReplayFiles = await prepareZookeeperPatchReplay(
      replayFiles,
      replayOptions
    )
  }
  const currentFileReplay = preparedReplayFiles.find(
    (replayFile) => replayFile.absolutePath === kclManager.path
  )
  const activeFileReplay = preparedReplayFiles.find(
    (replayFile) => replayFile.absolutePath === effectProps.activeFilePath
  )

  const deletesCurrentFile = currentFileReplay?.nextContent === null
  await writeZookeeperPatchReplay(preparedReplayFiles)
  await effectProps.onProjectFilesReplay?.(preparedReplayFiles)
  if (effectProps.activeFilePath && activeFileReplay) {
    kclManager.synchronizeCachedEditorHistoryAfterDirectGlobalReplay({
      filePath: effectProps.activeFilePath,
      direction: effectProps.direction,
      previousContent: activeFileReplay.previousContent,
      nextContent: activeFileReplay.nextContent,
    })
  }

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

  const restoredActiveFileReplay = preparedReplayFiles.find(
    (replayFile) =>
      replayFile.absolutePath === effectProps.activeFilePath &&
      replayFile.previousContent === null &&
      replayFile.nextContent !== null
  )
  if (
    restoredActiveFileReplay &&
    effectProps.activeFilePath &&
    kclManager.path !== effectProps.activeFilePath
  ) {
    if (currentFileReplay) {
      kclManager.synchronizeCurrentEditorAfterDirectGlobalReplay({
        filePath: currentFileReplay.absolutePath,
        nextContent: currentFileReplay.nextContent,
      })
    }
    await effectProps.onActiveFileRestore(
      effectProps.activeFilePath,
      restoredActiveFileReplay.nextContent ?? ''
    )
    if (effectProps.direction === 'undo') {
      kclManager.synchronizeLocalHistoryAfterDirectGlobalUndo()
    } else {
      kclManager.synchronizeLocalHistoryAfterDirectGlobalRedo()
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

  await kclManager.executeCode().catch((error: unknown) => {
    console.error(
      'Failed to execute after replaying Zookeeper edit patch.',
      error
    )
  })
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

async function prepareZookeeperSnapshotReplay(
  snapshotFiles: readonly ZookeeperSnapshotFileReplay[],
  direction: ZookeeperPatchReplayDirection,
  {
    alreadyReplayedFilePaths,
    fileContentOverrides,
  }: ZookeeperPatchReplayOptions = {}
): Promise<PreparedZookeeperPatchFileReplay[]> {
  const preparedReplayFiles: PreparedZookeeperPatchFileReplay[] = []

  for (const snapshotFile of snapshotFiles) {
    const previousContent =
      direction === 'undo'
        ? snapshotFile.nextContent
        : snapshotFile.previousContent
    const nextContent =
      direction === 'undo'
        ? snapshotFile.previousContent
        : snapshotFile.nextContent
    const diskContent = await readTextFileIfExists(snapshotFile.absolutePath)
    const currentContent =
      fileContentOverrides?.get(snapshotFile.absolutePath) ?? diskContent

    if (isZookeeperReplayContentSame(currentContent, previousContent)) {
      preparedReplayFiles.push({
        relativePath: snapshotFile.relativePath,
        absolutePath: snapshotFile.absolutePath,
        previousContent,
        nextContent,
      })
      continue
    }

    if (
      alreadyReplayedFilePaths?.has(snapshotFile.absolutePath) &&
      isZookeeperReplayContentSame(currentContent, nextContent)
    ) {
      preparedReplayFiles.push({
        relativePath: snapshotFile.relativePath,
        absolutePath: snapshotFile.absolutePath,
        previousContent: currentContent,
        nextContent: currentContent,
      })
      continue
    }

    return Promise.reject(
      zookeeperPatchConflictError(snapshotFile.relativePath)
    )
  }

  return preparedReplayFiles
}

function isZookeeperReplayContentSame(
  currentContent: string | null,
  expectedContent: string | null
) {
  if (currentContent === null || expectedContent === null) {
    return currentContent === expectedContent
  }

  return isCodeTheSame(currentContent, expectedContent)
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
  {
    alreadyReplayedFilePaths,
    fileContentOverrides,
  }: ZookeeperPatchReplayOptions = {}
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

      let replayPreviousContent = currentContent
      let nextContent = applyPatch(replayPreviousContent, replayFile.patch, {
        fuzzFactor: 0,
      })
      if (nextContent === false) {
        // Active-file Zookeeper edits may already be applied by local editor
        // history before the project-level patch replays.
        const alreadyAppliedPreviousContent = applyPatch(
          replayPreviousContent,
          reversePatch(replayFile.patch),
          {
            fuzzFactor: 0,
          }
        )
        if (alreadyAppliedPreviousContent !== false) {
          preparedReplayFiles.push({
            relativePath: replayFile.relativePath,
            absolutePath: replayFile.absolutePath,
            previousContent: replayPreviousContent,
            nextContent: replayPreviousContent,
          })
          continue
        }
        if (
          patchTargetLinesAlreadyPresent(
            replayPreviousContent,
            replayFile.patch
          )
        ) {
          preparedReplayFiles.push({
            relativePath: replayFile.relativePath,
            absolutePath: replayFile.absolutePath,
            previousContent: replayPreviousContent,
            nextContent: replayPreviousContent,
          })
          continue
        }
      }
      if (
        nextContent === false &&
        diskContent !== null &&
        !isCodeTheSame(replayPreviousContent, diskContent)
      ) {
        const diskNextContent = applyPatch(diskContent, replayFile.patch, {
          fuzzFactor: 0,
        })
        if (diskNextContent !== false) {
          replayPreviousContent = diskContent
          nextContent = diskNextContent
        }
      }
      if (
        nextContent === false &&
        alreadyReplayedFilePaths?.has(replayFile.absolutePath)
      ) {
        // The active editor's local history already moved this file; keep
        // sibling-file replay strict while treating this file as a no-op.
        preparedReplayFiles.push({
          relativePath: replayFile.relativePath,
          absolutePath: replayFile.absolutePath,
          previousContent: replayPreviousContent,
          nextContent: replayPreviousContent,
        })
        continue
      }
      if (nextContent === false) {
        return Promise.reject(
          zookeeperPatchConflictError(replayFile.relativePath)
        )
      }
      preparedReplayFiles.push({
        relativePath: replayFile.relativePath,
        absolutePath: replayFile.absolutePath,
        previousContent: replayPreviousContent,
        nextContent,
      })
      continue
    }

    const expectedContentError = validateExpectedContent(
      replayFile,
      currentContent
    )
    if (expectedContentError) {
      if (
        alreadyReplayedFilePaths?.has(replayFile.absolutePath) &&
        ((replayFile.nextContent === null &&
          currentContent !== null &&
          isCodeTheSame(currentContent, '')) ||
          (replayFile.expectedContent === null &&
            replayFile.nextContent !== null &&
            currentContent !== null &&
            isCodeTheSame(currentContent, replayFile.nextContent)))
      ) {
        preparedReplayFiles.push({
          relativePath: replayFile.relativePath,
          absolutePath: replayFile.absolutePath,
          previousContent: diskContent,
          nextContent: replayFile.nextContent,
        })
        continue
      }
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

function patchTargetLinesAlreadyPresent(
  currentContent: string,
  patch: StructuredPatch
) {
  const currentLineCounts = countLines(currentContent.split(/\r?\n/))
  const removedLineCounts = new Map<string, number>()
  const addedLineCounts = new Map<string, number>()

  for (const hunk of patch.hunks) {
    for (const line of hunk.lines) {
      if (line.startsWith('\\')) {
        continue
      }
      const prefix = line[0]
      const content = line.slice(1)
      if (prefix === '-') {
        removedLineCounts.set(
          content,
          (removedLineCounts.get(content) ?? 0) + 1
        )
      } else if (prefix === '+') {
        addedLineCounts.set(content, (addedLineCounts.get(content) ?? 0) + 1)
      }
    }
  }

  for (const [line, count] of addedLineCounts) {
    if ((currentLineCounts.get(line) ?? 0) < count) {
      return false
    }
  }
  for (const [line, count] of removedLineCounts) {
    if ((currentLineCounts.get(line) ?? 0) >= count) {
      return false
    }
  }

  return addedLineCounts.size > 0
}

function countLines(lines: string[]) {
  const counts = new Map<string, number>()
  for (const line of lines) {
    counts.set(line, (counts.get(line) ?? 0) + 1)
  }
  return counts
}

async function writeZookeeperPatchReplay(
  replayFiles: PreparedZookeeperPatchFileReplay[]
) {
  return runWithProjectFilesystemMutationLock(
    () => writeZookeeperPatchReplayUnlocked(replayFiles),
    { ifAvailable: true, mode: 'shared' }
  )
}

async function writeZookeeperPatchReplayUnlocked(
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
    if (isPathNotFoundError(error)) {
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
  if (typeof error === 'string') {
    return error
  }
  if (error instanceof Error) {
    return error.message
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string'
  ) {
    return error.message
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'msg' in error &&
    typeof error.msg === 'string'
  ) {
    return error.msg
  }

  return 'Failed to replay Zookeeper edit patch.'
}
