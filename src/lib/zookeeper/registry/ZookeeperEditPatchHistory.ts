import type { EditorState } from '@codemirror/state'
import type { KclManager } from '@src/lang/KclManager'
import { isCodeTheSame } from '@src/lib/codeEditor'
import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  type ZookeeperSnapshotFileReplay,
  zookeeperEditPatchHistoryEvent,
} from '@src/lib/zookeeper/editorPlugin'
import {
  mergeZookeeperEditPatches,
  normalizeZookeeperPatchPath,
  type ZookeeperEditPatch,
  type ZookeeperEditPatchFile,
} from '@src/lib/zookeeper/zookeeperEditPatch'
import {
  isResponseComplete,
  type ZookeeperManagerActor,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { normalizeKCLFileDeletePath } from '@src/machines/systemIO/utils'
import { applyPatch, parsePatch, reversePatch } from 'diff'

export type BeginZookeeperHistoryWriteProps = {
  activeFilePath?: string
  exchangeId: number
  patch: ZookeeperEditPatch
  projectPath: string
  reserved?: boolean
}

export type ReserveZookeeperHistoryWriteProps = {
  activeFilePath?: string
  exchangeId: number
  projectPath: string
}

export type CancelZookeeperHistoryWriteProps = {
  exchangeId: number
}

export type CompleteZookeeperHistoryWriteProps = {
  activeFileDeleted: boolean
  activeFilePath?: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  exchangeId: number
  requestIsCurrent: () => boolean
  patch: ZookeeperEditPatch
  projectPath: string
}

type ZookeeperManagerSnapshot = ReturnType<ZookeeperManagerActor['getSnapshot']>

export class ZookeeperEditPatchHistory {
  private readonly pendingByExchange = new Map<
    number,
    PendingZookeeperHistory
  >()
  private lastMessageId: number | undefined
  private disposed = false

  constructor(private readonly kclManager: KclManager) {}

  reserve({
    activeFilePath,
    exchangeId,
    projectPath,
  }: ReserveZookeeperHistoryWriteProps) {
    if (this.disposed) {
      return
    }

    const pending =
      this.pendingByExchange.get(exchangeId) ?? createPendingZookeeperHistory()
    pending.outstandingWrites += 1
    pending.projectPath ??= projectPath
    this.captureActiveEditorState(pending, activeFilePath)
    this.pendingByExchange.set(exchangeId, pending)
    this.kclManager.zookeeperHistoryRecordingInProgress = true
  }

  async begin({
    activeFilePath,
    exchangeId,
    patch,
    projectPath,
    reserved,
  }: BeginZookeeperHistoryWriteProps) {
    if (this.disposed) {
      return
    }

    const pending =
      this.pendingByExchange.get(exchangeId) ?? createPendingZookeeperHistory()
    if (reserved && !this.pendingByExchange.has(exchangeId)) {
      return
    }
    if (!reserved) {
      pending.outstandingWrites += 1
    }
    pending.projectPath ??= projectPath
    this.captureActiveEditorState(pending, activeFilePath)
    this.pendingByExchange.set(exchangeId, pending)
    this.kclManager.zookeeperHistoryRecordingInProgress = true

    try {
      await captureZookeeperSnapshotPreviousContents({
        kclManager: this.kclManager,
        patch,
        pending,
        projectPath,
      })
    } catch (error: unknown) {
      console.error('Failed to capture Zookeeper history snapshots.', error)
      pending.snapshotFilesByRelativePath.clear()
    }
  }

  cancel({ exchangeId }: CancelZookeeperHistoryWriteProps) {
    if (this.disposed) {
      return
    }

    const pending = this.pendingByExchange.get(exchangeId)
    if (!pending) {
      this.clearRecordingFlagIfIdle()
      return
    }

    pending.snapshotFilesByRelativePath.clear()
    pending.outstandingWrites = Math.max(0, pending.outstandingWrites - 1)
    if (
      pending.outstandingWrites === 0 &&
      !pending.patch?.changed_files?.length
    ) {
      this.pendingByExchange.delete(exchangeId)
    } else {
      this.pendingByExchange.set(exchangeId, pending)
      this.tryFlush(exchangeId)
    }

    this.clearRecordingFlagIfIdle()
  }

  async complete({
    activeFileDeleted,
    activeFilePath,
    activeFileRequestedCode,
    currentFilePath,
    currentFileRequestedCode,
    exchangeId,
    requestIsCurrent,
    patch,
    projectPath,
  }: CompleteZookeeperHistoryWriteProps) {
    if (this.disposed) {
      return
    }

    const pending = this.pendingByExchange.get(exchangeId)
    if (!pending) {
      return
    }
    if (!requestIsCurrent()) {
      this.cancel({ exchangeId })
      return
    }

    try {
      await captureZookeeperSnapshotNextContents({
        patch,
        pending,
        projectPath,
      })
    } catch (error: unknown) {
      console.error('Failed to capture Zookeeper history snapshots.', error)
      pending.snapshotFilesByRelativePath.clear()
    }

    if (this.disposed) {
      return
    }
    if (!requestIsCurrent()) {
      this.cancel({ exchangeId })
      return
    }

    pending.projectPath = projectPath
    pending.activeFilePath ??= activeFilePath
    pending.activeFileDeleted = pending.activeFileDeleted || activeFileDeleted
    pending.activeFileRequestedCode =
      activeFileRequestedCode ?? pending.activeFileRequestedCode
    pending.currentFilePath = currentFilePath ?? pending.currentFilePath
    pending.currentFileRequestedCode =
      currentFileRequestedCode ?? pending.currentFileRequestedCode
    pending.patch = pending.patch
      ? mergeZookeeperEditPatches(pending.patch, patch)
      : patch

    pending.outstandingWrites = Math.max(0, pending.outstandingWrites - 1)
    this.pendingByExchange.set(exchangeId, pending)
    this.tryFlush(exchangeId)
  }

  handleActorSnapshot(snapshot: ZookeeperManagerSnapshot) {
    if (this.disposed) {
      return
    }
    const isNewMessage = snapshot.context.lastMessageId !== this.lastMessageId
    this.lastMessageId = snapshot.context.lastMessageId

    const exchanges = snapshot.context.conversation?.exchanges ?? []
    const latestResponses = exchanges[exchanges.length - 1]?.responses ?? []
    const latestResponse = latestResponses[latestResponses.length - 1]
    if (latestResponse !== undefined && 'error' in latestResponse) {
      this.finishPending()
      return
    }
    const liveTerminalExchange =
      isNewMessage &&
      (snapshot.context.lastMessageType === 'end_of_stream' ||
        snapshot.context.lastMessageType === 'error')
        ? exchanges.length - 1
        : -1

    for (const [exchangeId, pending] of this.pendingByExchange) {
      const responses = exchanges[exchangeId]?.responses ?? []
      const lastResponse = responses[responses.length - 1]
      if (
        exchangeId !== liveTerminalExchange &&
        (lastResponse === undefined || !isResponseComplete(lastResponse))
      ) {
        continue
      }

      pending.streamEnded = true
      this.pendingByExchange.set(exchangeId, pending)
      this.tryFlush(exchangeId)
    }
  }

  finishPending() {
    if (this.disposed) {
      return
    }

    for (const [exchangeId, pending] of this.pendingByExchange) {
      pending.streamEnded = true
      this.pendingByExchange.set(exchangeId, pending)
      try {
        this.tryFlush(exchangeId)
      } catch (error: unknown) {
        console.error('Failed to finish Zookeeper history.', error)
      }
    }
  }

  reset() {
    if (this.disposed) {
      return
    }

    this.pendingByExchange.clear()
    this.lastMessageId = undefined
    this.kclManager.zookeeperHistoryRecordingInProgress = false
  }

  dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.pendingByExchange.clear()
    this.kclManager.zookeeperHistoryRecordingInProgress = false
  }

  private captureActiveEditorState(
    pending: PendingZookeeperHistory,
    activeFilePath: string | undefined
  ) {
    if (
      !pending.activeEditorState &&
      activeFilePath &&
      activeFilePath === this.kclManager.path
    ) {
      pending.activeEditorState = this.kclManager.captureEditorHistoryState()
    }
  }

  private clearRecordingFlagIfIdle() {
    if (this.pendingByExchange.size === 0) {
      this.kclManager.zookeeperHistoryRecordingInProgress = false
    }
  }

  private tryFlush(exchangeId: number) {
    if (this.disposed) {
      return
    }

    const pending = this.pendingByExchange.get(exchangeId)
    if (!pending?.streamEnded || pending.outstandingWrites > 0) {
      return
    }

    if (
      !pending.projectPath ||
      !pending.patch?.changed_files?.length ||
      !pending.activeFilePath
    ) {
      this.pendingByExchange.delete(exchangeId)
      this.clearRecordingFlagIfIdle()
      return
    }

    this.pendingByExchange.delete(exchangeId)
    try {
      this.record({
        activeFileDeleted: pending.activeFileDeleted,
        activeFilePath: pending.activeFilePath,
        activeEditorState: pending.activeEditorState,
        activeFileRequestedCode: pending.activeFileRequestedCode,
        currentFilePath: pending.currentFilePath,
        currentFileRequestedCode: pending.currentFileRequestedCode,
        patch: pending.patch,
        projectPath: pending.projectPath,
        snapshotFiles: getReadyZookeeperSnapshotFiles(pending),
      })
    } finally {
      this.clearRecordingFlagIfIdle()
    }
  }

  private record(pending: ReadyPendingZookeeperHistory) {
    const {
      codeChangeFilePath,
      codeChangeRelativePath,
      codeChangeRequestedCode,
      patchChangesCodeChangeFile,
    } = getZookeeperCodeChangeTarget(pending)

    if (
      codeChangeFilePath &&
      patchChangesCodeChangeFile &&
      codeChangeRequestedCode !== undefined &&
      this.kclManager.path === codeChangeFilePath
    ) {
      const codeChangePreviousCode =
        getZookeeperSnapshotPreviousCode(
          pending.snapshotFiles,
          codeChangeRelativePath
        ) ??
        getZookeeperPatchPreviousCode(
          pending.patch,
          codeChangeRelativePath,
          codeChangeRequestedCode
        )
      // A project refresh can reload the active editor before history is
      // recorded. Restore the captured state so this edit joins its undo stack.
      if (
        pending.activeEditorState &&
        codeChangePreviousCode !== undefined &&
        isCodeTheSame(
          pending.activeEditorState.doc.toString(),
          codeChangePreviousCode
        ) &&
        (isCodeTheSame(this.kclManager.code, codeChangePreviousCode) ||
          isCodeTheSame(this.kclManager.code, codeChangeRequestedCode))
      ) {
        this.kclManager.restoreEditorHistoryState(pending.activeEditorState)
      }
      this.kclManager.addGlobalHistoryEventWithCodeChange(
        zookeeperEditPatchHistoryEvent({
          projectPath: pending.projectPath,
          patch: pending.patch,
          activeFilePath: pending.activeFilePath,
          snapshotFiles: pending.snapshotFiles,
        }),
        codeChangeRequestedCode,
        codeChangePreviousCode
      )
      return
    }

    this.kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: pending.projectPath,
        patch: pending.patch,
        activeFilePath: pending.activeFilePath,
        snapshotFiles: pending.snapshotFiles,
      })
    )
  }
}

function getZookeeperPatchPreviousCode(
  patch: ZookeeperEditPatch,
  relativePath: string | undefined,
  currentCode: string
): string | undefined {
  if (relativePath === undefined) {
    return
  }

  const changedFile = patch.changed_files?.find(
    (file) => normalizeKCLFileDeletePath(file.path) === relativePath
  )
  if (changedFile === undefined) {
    return
  }

  return getZookeeperChangedFilePreviousCode(changedFile, currentCode)
}

function getZookeeperChangedFilePreviousCode(
  changedFile: ZookeeperEditPatchFile,
  currentCode: string
): string | undefined {
  if (changedFile.status === 'deleted') {
    return changedFile.previous_contents ?? undefined
  }
  if (changedFile.status === 'created') {
    return ''
  }
  if (!changedFile.diff) {
    return
  }

  const parsedPatch = parsePatch(changedFile.diff)[0]
  if (!parsedPatch) {
    return
  }

  const previousCode = applyPatch(currentCode, reversePatch(parsedPatch), {
    fuzzFactor: 0,
  })
  return previousCode === false ? undefined : previousCode
}

function getZookeeperCodeChangeTarget({
  activeFileDeleted,
  activeFilePath,
  activeFileRequestedCode,
  currentFilePath,
  currentFileRequestedCode,
  patch,
  projectPath,
}: ReadyPendingZookeeperHistory) {
  const fallbackFilePath = activeFileDeleted ? undefined : activeFilePath
  const fallbackRequestedCode = activeFileDeleted
    ? undefined
    : activeFileRequestedCode
  const codeChangeFilePath = currentFilePath ?? fallbackFilePath
  const codeChangeRequestedCode =
    currentFileRequestedCode ?? fallbackRequestedCode
  const codeChangeRelativePath = codeChangeFilePath
    ? normalizeKCLFileDeletePath(
        fsZds.relative(projectPath, codeChangeFilePath)
      )
    : undefined
  const patchChangesCodeChangeFile = Boolean(
    codeChangeRelativePath &&
      patch.changed_files?.some(
        (file) =>
          normalizeKCLFileDeletePath(file.path) === codeChangeRelativePath
      )
  )

  return {
    codeChangeFilePath,
    codeChangeRelativePath,
    codeChangeRequestedCode,
    patchChangesCodeChangeFile,
  }
}

function getZookeeperSnapshotPreviousCode(
  snapshotFiles: readonly ZookeeperSnapshotFileReplay[],
  relativePath: string | undefined
) {
  if (relativePath === undefined) {
    return
  }

  const snapshotFile = snapshotFiles.find(
    (file) => normalizeKCLFileDeletePath(file.relativePath) === relativePath
  )
  if (snapshotFile === undefined) {
    return
  }

  return snapshotFile.previousContent ?? ''
}

async function captureZookeeperSnapshotPreviousContents({
  kclManager,
  patch,
  pending,
  projectPath,
}: {
  kclManager: KclManager
  patch: ZookeeperEditPatch
  pending: PendingZookeeperHistory
  projectPath: string
}) {
  for (const changedFile of patch.changed_files ?? []) {
    const snapshotPath = getZookeeperSnapshotPath(projectPath, changedFile.path)
    if (snapshotPath instanceof Error) {
      return Promise.reject(snapshotPath)
    }
    if (pending.snapshotFilesByRelativePath.has(snapshotPath.relativePath)) {
      continue
    }

    const previousContent =
      snapshotPath.absolutePath === kclManager.path
        ? kclManager.code
        : await readZookeeperSnapshotFileIfExists(snapshotPath.absolutePath)
    pending.snapshotFilesByRelativePath.set(snapshotPath.relativePath, {
      ...snapshotPath,
      previousContent,
    })
  }
}

async function captureZookeeperSnapshotNextContents({
  patch,
  pending,
  projectPath,
}: {
  patch: ZookeeperEditPatch
  pending: PendingZookeeperHistory
  projectPath: string
}) {
  for (const changedFile of patch.changed_files ?? []) {
    const snapshotPath = getZookeeperSnapshotPath(projectPath, changedFile.path)
    if (snapshotPath instanceof Error) {
      return Promise.reject(snapshotPath)
    }
    const snapshotFile = pending.snapshotFilesByRelativePath.get(
      snapshotPath.relativePath
    ) ?? {
      ...snapshotPath,
      previousContent: null,
    }

    snapshotFile.nextContent = await readZookeeperSnapshotFileIfExists(
      snapshotPath.absolutePath
    )
    pending.snapshotFilesByRelativePath.set(
      snapshotPath.relativePath,
      snapshotFile
    )
  }
}

function getReadyZookeeperSnapshotFiles(
  pending: PendingZookeeperHistory
): ZookeeperSnapshotFileReplay[] {
  const snapshotFiles: ZookeeperSnapshotFileReplay[] = []

  for (const snapshotFile of pending.snapshotFilesByRelativePath.values()) {
    if (snapshotFile.nextContent === undefined) {
      return []
    }

    snapshotFiles.push({
      relativePath: snapshotFile.relativePath,
      absolutePath: snapshotFile.absolutePath,
      previousContent: snapshotFile.previousContent,
      nextContent: snapshotFile.nextContent,
    })
  }

  return snapshotFiles
}

function getZookeeperSnapshotPath(projectPath: string, relativePath: string) {
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
      `Cannot record Zookeeper history for unsafe path "${relativePath}".`
    )
  }

  return {
    relativePath: normalizedPath,
    absolutePath: fsZds.join(projectPath, ...safePathParts),
  }
}

async function readZookeeperSnapshotFileIfExists(path: string) {
  try {
    return await fsZds.readFile(path, 'utf8')
  } catch (error: unknown) {
    if (isPathNotFoundError(error)) {
      return null
    }
    return Promise.reject(error)
  }
}

type PendingZookeeperSnapshotFile = {
  relativePath: string
  absolutePath: string
  previousContent: string | null
  nextContent?: string | null
}

type PendingZookeeperHistory = {
  activeFileDeleted: boolean
  activeEditorState?: EditorState
  activeFilePath?: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  outstandingWrites: number
  patch?: ZookeeperEditPatch
  projectPath?: string
  snapshotFilesByRelativePath: Map<string, PendingZookeeperSnapshotFile>
  streamEnded: boolean
}

type ReadyPendingZookeeperHistory = {
  activeFileDeleted: boolean
  activeEditorState?: EditorState
  activeFilePath: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  patch: ZookeeperEditPatch
  projectPath: string
  snapshotFiles: readonly ZookeeperSnapshotFileReplay[]
}

function createPendingZookeeperHistory(): PendingZookeeperHistory {
  return {
    activeFileDeleted: false,
    outstandingWrites: 0,
    snapshotFilesByRelativePath: new Map(),
    streamEnded: false,
  }
}
