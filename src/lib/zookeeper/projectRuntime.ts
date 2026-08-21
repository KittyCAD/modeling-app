import type { EditorState } from '@codemirror/state'
import { effect, type ReadonlySignal } from '@preact/signals-core'
import type { KclManager } from '@src/lang/KclManager'
import { isCodeTheSame } from '@src/lib/codeEditor'
import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  type MlEphantNewFileRequestProps,
  watchForNewFileRequestsFromMlEphant,
} from '@src/lib/zookeeper/components/MlEphantConversationPaneHooks'
import {
  type ZookeeperSnapshotFileReplay,
  zookeeperEditPatchHistoryEvent,
} from '@src/lib/zookeeper/editorPlugin'
import type { ZookeeperService } from '@src/lib/zookeeper/registry/contract'
import {
  mergeZookeeperEditPatches,
  normalizeZookeeperPatchPath,
  type ZookeeperEditPatch,
  type ZookeeperEditPatchFile,
} from '@src/lib/zookeeper/zookeeperEditPatch'
import {
  normalizeKCLFileDeletePath,
  prepareMlEphantNewFileRequest,
  SystemIOMachineEvents,
  waitForIdleState,
} from '@src/machines/systemIO/utils'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import type { SettingsRegistryService } from '@src/registry/contracts/settings'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import { applyPatch, parsePatch, reversePatch } from 'diff'

type MutableValue<T> = { current: T }

type AttachZookeeperProjectRuntimeArgs = {
  service: ZookeeperService
  projectSession: ReadonlySignal<ProjectSessionService | undefined>
  settings: ReadonlySignal<SettingsRegistryService | undefined>
  systemIO: ReadonlySignal<SystemIORegistryService | undefined>
}

type ZookeeperProjectRuntime = {
  project: NonNullable<
    ProjectSessionService['openedProject']['value']
  >['projectIORefSignal']['value']
  projectId: string | undefined
  loaderFile: NonNullable<
    ProjectSessionService['openedProject']['value']
  >['executingFileEntry']['value']
  kclManager: KclManager
}

type ZookeeperEditPatchHistory = ReturnType<
  typeof createZookeeperEditPatchHistory
>

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

function listenToWindowOnlineOffline(service: ZookeeperService) {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const handleOffline = () => {
    service.handleNetworkOffline()
  }
  const handleOnline = () => {
    service.handleNetworkOnline()
  }

  window.addEventListener('offline', handleOffline)
  window.addEventListener('online', handleOnline)

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    service.handleNetworkOffline()
  }

  return () => {
    window.removeEventListener('offline', handleOffline)
    window.removeEventListener('online', handleOnline)
  }
}

function projectRuntimeKey(runtime: ZookeeperProjectRuntime | undefined) {
  if (!runtime) {
    return undefined
  }

  return `${runtime.project.path}\n${runtime.projectId ?? ''}`
}

/**
 * Connects Zookeeper's actor to app-owned project runtime signals.
 *
 * This is intentionally not a React component: the actor, file-output watcher,
 * and project conversation binding live for the plugin runtime rather than for
 * whichever Zookeeper UI surface happens to be mounted.
 */
export function attachZookeeperProjectRuntime({
  service,
  projectSession,
  settings,
  systemIO,
}: AttachZookeeperProjectRuntimeArgs) {
  const mlEphantManagerActor = service.actor
  let disposed = false
  let zookeeperFileRequestQueue: Promise<void> = Promise.resolve()
  let history: ZookeeperEditPatchHistory | undefined
  let historyKclManager: KclManager | undefined

  const getRuntime = (): ZookeeperProjectRuntime | undefined => {
    if (disposed) {
      return undefined
    }

    const openedProject = projectSession.value?.openedProject.value
    const kclManager = openedProject?.executingEditor.value
    if (!openedProject || !kclManager) {
      return undefined
    }

    return {
      project: openedProject.projectIORefSignal.value,
      projectId: settings.value?.current.value.meta.id.current,
      loaderFile: openedProject.executingFileEntry.value,
      kclManager,
    }
  }
  const getSystemIOActor = () => systemIO.value?.actor
  const getEngineCommandManager = () =>
    getRuntime()?.kclManager.engineCommandManager

  const ensureHistory = (kclManager: KclManager) => {
    if (history && historyKclManager === kclManager) {
      return history
    }

    history?.dispose()
    historyKclManager = kclManager
    history = createZookeeperEditPatchHistory({
      kclManager,
      mlEphantManagerActor,
    })
    return history
  }

  const disposeProjectBinding = effect(() => {
    const runtime = getRuntime()
    if (!runtime) {
      service.clearProject()
      return
    }

    service.bindProject({
      project: runtime.project,
      projectId: runtime.projectId,
      loaderFile: runtime.loaderFile,
      kclManager: runtime.kclManager,
    })
  })

  const disposeNetworkListener = listenToWindowOnlineOffline(service)
  const disposeFileRequestWatcher = watchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor,
    getEngineCommandManager,
    (requestProps) => {
      const runtime = getRuntime()
      const systemIOActor = getSystemIOActor()
      if (!runtime || !systemIOActor) {
        return
      }

      const runtimeKey = projectRuntimeKey(runtime)
      const historyForRuntime = ensureHistory(runtime.kclManager)
      zookeeperFileRequestQueue = zookeeperFileRequestQueue.then(() =>
        processZookeeperFileRequest({
          history: historyForRuntime,
          isCurrentRuntime: () =>
            projectRuntimeKey(getRuntime()) === runtimeKey,
          requestProps,
          runtime,
          systemIOActor,
        })
      )
    }
  )

  return () => {
    disposed = true
    disposeFileRequestWatcher()
    disposeNetworkListener()
    disposeProjectBinding()
    history?.dispose()
    history = undefined
    historyKclManager = undefined
    service.clearProject()
  }
}

function processZookeeperFileRequest({
  history,
  isCurrentRuntime,
  requestProps,
  runtime,
  systemIOActor,
}: {
  history: ZookeeperEditPatchHistory
  isCurrentRuntime: () => boolean
  requestProps: MlEphantNewFileRequestProps
  runtime: ZookeeperProjectRuntime
  systemIOActor: SystemIORegistryService['actor']
}) {
  if (!isCurrentRuntime()) {
    return Promise.resolve()
  }

  const { kclManager, project } = runtime
  const activeFilePath =
    requestProps.fileFocusedOnInEditor?.path ?? kclManager.path
  const payload = prepareMlEphantNewFileRequest({
    ...requestProps,
    fallbackFilePath: activeFilePath,
  })

  if (!payload) {
    return Promise.resolve()
  }

  const exchangeId = requestProps.exchangeId ?? 0
  const activeRelativePath = activeFilePath
    ? normalizeKCLFileDeletePath(fsZds.relative(project.path, activeFilePath))
    : ''
  const activeFileDeleted =
    activeRelativePath.length > 0 &&
    payload.filesToDelete.some(
      (file) =>
        normalizeKCLFileDeletePath(file.requestedFileName) ===
        activeRelativePath
    )
  const shouldRecordZookeeperHistory = Boolean(
    project.path && payload.zookeeperEditPatch?.changed_files?.length
  )
  const activeFileOutput = payload.files.find(
    (file) =>
      normalizeKCLFileDeletePath(file.requestedFileName) === activeRelativePath
  )
  const shouldRefreshActiveEditor = Boolean(
    !activeFileDeleted &&
      activeFileOutput &&
      project.name === payload.requestedProjectName &&
      activeFilePath === kclManager.path
  )
  const pendingHistoryReserved = Boolean(
    shouldRecordZookeeperHistory && project.path && payload.zookeeperEditPatch
  )

  if (pendingHistoryReserved && project.path && payload.zookeeperEditPatch) {
    history.reservePendingZookeeperHistoryWrite({
      activeFilePath,
      exchangeId,
      projectPath: project.path,
    })
  }

  return new Promise<void>((resolve) => {
    let pendingHistoryStarted = false
    let requestSettled = false
    let historyWriteCompleted = !shouldRecordZookeeperHistory
    let postWriteCompleted = !shouldRecordZookeeperHistory
    const settleRequest = () => {
      if (requestSettled) {
        return
      }
      if (!historyWriteCompleted || !postWriteCompleted) {
        return
      }
      requestSettled = true
      resolve()
    }

    void (async () => {
      let historyRecorded = false
      if (!isCurrentRuntime()) {
        if (pendingHistoryReserved) {
          history.cancelPendingZookeeperHistoryWrite({ exchangeId })
        }
        historyWriteCompleted = true
        postWriteCompleted = true
        settleRequest()
        return
      }

      if (
        shouldRecordZookeeperHistory &&
        project.path &&
        payload.zookeeperEditPatch
      ) {
        pendingHistoryStarted = true
        await history.beginPendingZookeeperHistoryWrite({
          activeFilePath,
          exchangeId,
          patch: payload.zookeeperEditPatch,
          projectPath: project.path,
          reserved: pendingHistoryReserved,
        })
      }
      await waitForIdleState({ systemIOActor })
      if (!isCurrentRuntime()) {
        if (pendingHistoryReserved || pendingHistoryStarted) {
          history.cancelPendingZookeeperHistoryWrite({ exchangeId })
        }
        historyWriteCompleted = true
        postWriteCompleted = true
        settleRequest()
        return
      }

      kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = true
      systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
        data: {
          files: payload.files,
          filesToDelete: payload.filesToDelete,
          override: true,
          requestedProjectName: payload.requestedProjectName,
          requestedFileNameWithExtension:
            payload.requestedFileNameWithExtension ?? '',
          onFileSystemError: () => {
            if (pendingHistoryReserved || pendingHistoryStarted) {
              history.cancelPendingZookeeperHistoryWrite({ exchangeId })
            }
            historyWriteCompleted = true
            postWriteCompleted = true
            settleRequest()
          },
          onFileSystemSuccess: () => {
            if (historyRecorded) {
              historyWriteCompleted = true
              settleRequest()
              return
            }
            historyRecorded = true
            if (
              shouldRecordZookeeperHistory &&
              project.path &&
              payload.zookeeperEditPatch &&
              isCurrentRuntime()
            ) {
              const currentFile = payload.files.find(
                (file) =>
                  normalizeKCLFileDeletePath(file.requestedFileName) ===
                  activeRelativePath
              )
              const currentEditorRelativePath = kclManager.path
                ? normalizeKCLFileDeletePath(
                    fsZds.relative(project.path, kclManager.path)
                  )
                : ''
              const currentEditorFile = payload.files.find(
                (file) =>
                  normalizeKCLFileDeletePath(file.requestedFileName) ===
                  currentEditorRelativePath
              )
              void history
                .completePendingZookeeperHistoryWrite({
                  activeFileDeleted,
                  activeFilePath,
                  activeFileRequestedCode: currentFile?.requestedCode,
                  currentFilePath: currentEditorFile
                    ? kclManager.path
                    : undefined,
                  currentFileRequestedCode: currentEditorFile?.requestedCode,
                  exchangeId,
                  patch: payload.zookeeperEditPatch,
                  projectPath: project.path,
                })
                .catch((error: unknown) => {
                  console.error(
                    'Failed to complete Zookeeper history write.',
                    error
                  )
                })
                .finally(() => {
                  historyWriteCompleted = true
                  settleRequest()
                })
              return
            }
            historyWriteCompleted = true
            postWriteCompleted = true
            settleRequest()
          },
          ...(shouldRecordZookeeperHistory || shouldRefreshActiveEditor
            ? {
                onSuccess: () => {
                  if (
                    shouldRefreshActiveEditor &&
                    activeFileOutput &&
                    isCurrentRuntime() &&
                    kclManager.path === activeFilePath &&
                    kclManager.code !== activeFileOutput.requestedCode
                  ) {
                    kclManager.updateCodeEditor(
                      activeFileOutput.requestedCode,
                      {
                        shouldAddToHistory: false,
                        shouldClearHistory: !shouldRecordZookeeperHistory,
                        shouldExecute: true,
                        shouldResetCamera: true,
                        shouldWriteToDisk: !shouldRecordZookeeperHistory,
                      }
                    )
                  }
                  postWriteCompleted = true
                  settleRequest()
                },
              }
            : {}),
        },
      })
    })().catch((error: unknown) => {
      if (pendingHistoryReserved || pendingHistoryStarted) {
        history.cancelPendingZookeeperHistoryWrite({ exchangeId })
      }
      console.error('Failed to process Zookeeper file request.', error)
      historyWriteCompleted = true
      postWriteCompleted = true
      settleRequest()
    })
  })
}

function createZookeeperEditPatchHistory({
  kclManager,
  mlEphantManagerActor,
}: {
  kclManager: KclManager
  mlEphantManagerActor: ZookeeperService['actor']
}) {
  const pendingZookeeperHistoryByExchange: MutableValue<
    Map<number, PendingZookeeperHistory>
  > = {
    current: new Map<number, PendingZookeeperHistory>(),
  }

  const recordZookeeperHistory = (pending: ReadyPendingZookeeperHistory) => {
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
      kclManager.path === codeChangeFilePath
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
      // Project refreshes may reload the active editor before Zookeeper
      // history is recorded. Put the captured pre-write state back first so
      // the Zookeeper change lands on top of the user's local undo stack.
      if (
        pending.activeEditorState &&
        codeChangePreviousCode !== undefined &&
        isCodeTheSame(
          pending.activeEditorState.doc.toString(),
          codeChangePreviousCode
        ) &&
        (isCodeTheSame(kclManager.code, codeChangePreviousCode) ||
          isCodeTheSame(kclManager.code, codeChangeRequestedCode))
      ) {
        kclManager.restoreEditorHistoryState(pending.activeEditorState)
      }
      kclManager.addGlobalHistoryEventWithCodeChange(
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

    kclManager.addGlobalHistoryEvent(
      zookeeperEditPatchHistoryEvent({
        projectPath: pending.projectPath,
        patch: pending.patch,
        activeFilePath: pending.activeFilePath,
        snapshotFiles: pending.snapshotFiles,
      })
    )
  }

  const tryFlushPendingZookeeperHistory = (exchangeId: number) => {
    const pending = pendingZookeeperHistoryByExchange.current.get(exchangeId)
    if (
      !pending?.streamEnded ||
      pending.outstandingWrites > 0 ||
      !pending.projectPath ||
      !pending.patch?.changed_files?.length ||
      !pending.activeFilePath
    ) {
      return
    }

    pendingZookeeperHistoryByExchange.current.delete(exchangeId)
    try {
      recordZookeeperHistory({
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
      if (pendingZookeeperHistoryByExchange.current.size === 0) {
        kclManager.zookeeperHistoryRecordingInProgress = false
      }
    }
  }

  const reservePendingZookeeperHistoryWrite = ({
    activeFilePath,
    exchangeId,
    projectPath,
  }: ReservePendingZookeeperHistoryWriteProps) => {
    const pending =
      pendingZookeeperHistoryByExchange.current.get(exchangeId) ??
      createPendingZookeeperHistory()
    pending.outstandingWrites += 1
    pending.projectPath ??= projectPath
    if (
      !pending.activeEditorState &&
      activeFilePath &&
      activeFilePath === kclManager.path
    ) {
      pending.activeEditorState = kclManager.captureEditorHistoryState()
    }
    pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
    kclManager.zookeeperHistoryRecordingInProgress = true
  }

  const beginPendingZookeeperHistoryWrite = async ({
    activeFilePath,
    exchangeId,
    patch,
    projectPath,
    reserved,
  }: BeginPendingZookeeperHistoryWriteProps) => {
    const pending =
      pendingZookeeperHistoryByExchange.current.get(exchangeId) ??
      createPendingZookeeperHistory()
    if (!reserved) {
      pending.outstandingWrites += 1
    }
    pending.projectPath ??= projectPath
    if (
      !pending.activeEditorState &&
      activeFilePath &&
      activeFilePath === kclManager.path
    ) {
      pending.activeEditorState = kclManager.captureEditorHistoryState()
    }
    pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
    kclManager.zookeeperHistoryRecordingInProgress = true
    try {
      await captureZookeeperSnapshotPreviousContents({
        kclManager,
        patch,
        pending,
        projectPath,
      })
    } catch (error: unknown) {
      console.error('Failed to capture Zookeeper history snapshots.', error)
      pending.snapshotFilesByRelativePath.clear()
    }
  }

  const cancelPendingZookeeperHistoryWrite = ({
    exchangeId,
  }: CancelPendingZookeeperHistoryWriteProps) => {
    const pending = pendingZookeeperHistoryByExchange.current.get(exchangeId)
    if (!pending) {
      if (pendingZookeeperHistoryByExchange.current.size === 0) {
        kclManager.zookeeperHistoryRecordingInProgress = false
      }
      return
    }

    pending.snapshotFilesByRelativePath.clear()
    pending.outstandingWrites = Math.max(0, pending.outstandingWrites - 1)
    if (
      pending.outstandingWrites === 0 &&
      !pending.patch?.changed_files?.length
    ) {
      pendingZookeeperHistoryByExchange.current.delete(exchangeId)
    } else {
      pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
      tryFlushPendingZookeeperHistory(exchangeId)
    }

    if (pendingZookeeperHistoryByExchange.current.size === 0) {
      kclManager.zookeeperHistoryRecordingInProgress = false
    }
  }

  const completePendingZookeeperHistoryWrite = async ({
    activeFileDeleted,
    activeFilePath,
    activeFileRequestedCode,
    currentFilePath,
    currentFileRequestedCode,
    exchangeId,
    patch,
    projectPath,
  }: CompletePendingZookeeperHistoryWriteProps) => {
    const pending =
      pendingZookeeperHistoryByExchange.current.get(exchangeId) ??
      createPendingZookeeperHistory()
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
    pending.outstandingWrites = Math.max(0, pending.outstandingWrites - 1)
    pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
    tryFlushPendingZookeeperHistory(exchangeId)
  }

  const disposeFlush = subscribeFlushZookeeperHistoryOnResponseEnd(
    mlEphantManagerActor,
    pendingZookeeperHistoryByExchange,
    tryFlushPendingZookeeperHistory
  )

  return {
    beginPendingZookeeperHistoryWrite,
    cancelPendingZookeeperHistoryWrite,
    completePendingZookeeperHistoryWrite,
    dispose: () => {
      disposeFlush()
      pendingZookeeperHistoryByExchange.current.clear()
      kclManager.zookeeperHistoryRecordingInProgress = false
    },
    reservePendingZookeeperHistoryWrite,
  }
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

type BeginPendingZookeeperHistoryWriteProps = {
  activeFilePath?: string
  exchangeId: number
  patch: ZookeeperEditPatch
  projectPath: string
  reserved?: boolean
}

type ReservePendingZookeeperHistoryWriteProps = {
  activeFilePath?: string
  exchangeId: number
  projectPath: string
}

type CancelPendingZookeeperHistoryWriteProps = {
  exchangeId: number
}

type CompletePendingZookeeperHistoryWriteProps = {
  activeFileDeleted: boolean
  activeFilePath?: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  exchangeId: number
  patch: ZookeeperEditPatch
  projectPath: string
}

function createPendingZookeeperHistory(): PendingZookeeperHistory {
  return {
    activeFileDeleted: false,
    outstandingWrites: 0,
    snapshotFilesByRelativePath: new Map(),
    streamEnded: false,
  }
}

function subscribeFlushZookeeperHistoryOnResponseEnd(
  mlEphantManagerActor: ZookeeperService['actor'],
  pendingZookeeperHistoryByExchange: MutableValue<
    Map<number, PendingZookeeperHistory>
  >,
  tryFlushPendingZookeeperHistory: (exchangeId: number) => void
) {
  let lastId: number | undefined
  const subscription = mlEphantManagerActor.subscribe((next) => {
    if (next.context.lastMessageId === lastId) {
      return
    }
    lastId = next.context.lastMessageId

    if (next.context.lastMessageType !== 'end_of_stream') {
      return
    }
    const exchangeId = (next.context.conversation?.exchanges.length ?? 0) - 1
    if (exchangeId < 0) {
      return
    }

    const pending = pendingZookeeperHistoryByExchange.current.get(exchangeId)
    if (!pending) {
      return
    }

    pending.streamEnded = true
    pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
    tryFlushPendingZookeeperHistory(exchangeId)
  })

  return () => {
    subscription.unsubscribe()
  }
}
