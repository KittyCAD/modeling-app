import type { EditorState } from '@codemirror/state'
import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import {
  useProjectIdToConversationId,
  useWatchForNewFileRequestsFromMlEphant,
} from '@src/components/layout/areas/MlEphantConversationPaneHooks'
import {
  type ZookeeperSnapshotFileReplay,
  zookeeperEditPatchHistoryEvent,
} from '@src/editor/plugins/zookeeper'
import { useModelingContext } from '@src/hooks/useModelingContext'
import type { KclManager } from '@src/lang/KclManager'
import { useApp, useSingletons } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import { isCodeTheSame } from '@src/lib/codeEditor'
import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { zookeeperConversationStore } from '@src/lib/zookeeperConversationStore'
import {
  type ZookeeperEditPatch,
  type ZookeeperEditPatchFile,
  mergeZookeeperEditPatches,
  normalizeZookeeperPatchPath,
} from '@src/lib/zookeeperEditPatch'
import { BillingTransition } from '@src/machines/billingMachine'
import {
  MlEphantConversationToMarkdown,
  type MlEphantManagerActor,
  MlEphantManagerReactContext,
} from '@src/machines/mlEphantManagerMachine'
import {
  SystemIOMachineEvents,
  normalizeKCLFileDeletePath,
  prepareMlEphantNewFileRequest,
  waitForIdleState,
} from '@src/machines/systemIO/utils'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { applyPatch, parsePatch, reversePatch } from 'diff'
import { type MutableRefObject, useCallback, useEffect, useRef } from 'react'
// Yea, feels bad, but literally every other pane is doing this.
// TODO: Don't use CSS module for this? More generic module?
import styles from './KclEditorMenu.module.css'

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

export function MlEphantConversationPaneWrapper(props: AreaTypeComponentProps) {
  const { auth } = useApp()
  const token = auth.useToken()

  return (
    <MlEphantManagerReactContext.Provider
      options={{
        input: {
          apiToken: token,
        },
      }}
    >
      <MlEphantConversationPaneInner {...props} />
    </MlEphantManagerReactContext.Provider>
  )
}

function MlEphantConversationPaneInner(props: AreaTypeComponentProps) {
  useSignals()
  const app = useApp()
  const { auth, billing, settings, project, systemIOActor } = app
  const { kclManager } = useSingletons()
  const settingsValues = settings.useSettings()
  const user = auth.useUser()
  const token = auth.useToken()
  const {
    context: contextModeling,
    send: sendModeling,
    theProject,
  } = useModelingContext()
  const loaderFile = project?.executingFileEntry.value
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  useEffect(() => {
    if (!IS_STAGING_OR_DEBUG) return

    app.debug.mlEphantManagerActor = mlEphantManagerActor

    return () => {
      if (app.debug.mlEphantManagerActor === mlEphantManagerActor) {
        delete app.debug.mlEphantManagerActor
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- Only run on mount
  }, [])

  const {
    beginPendingZookeeperHistoryWrite,
    cancelPendingZookeeperHistoryWrite,
    completePendingZookeeperHistoryWrite,
    reservePendingZookeeperHistoryWrite,
  } = useZookeeperEditPatchHistory({
    kclManager,
    mlEphantManagerActor,
  })
  const zookeeperFileRequestQueue = useRef<Promise<void>>(Promise.resolve())

  useWatchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor,
    kclManager.engineCommandManager,
    (requestProps) => {
      const activeFilePath =
        requestProps.fileFocusedOnInEditor?.path ?? kclManager.path
      const payload = prepareMlEphantNewFileRequest({
        ...requestProps,
        fallbackFilePath: activeFilePath,
      })

      if (!payload) {
        return
      }

      const exchangeId = requestProps.exchangeId ?? 0
      const activeRelativePath =
        project?.path && activeFilePath
          ? normalizeKCLFileDeletePath(
              fsZds.relative(project.path, activeFilePath)
            )
          : ''
      const activeFileDeleted =
        activeRelativePath.length > 0 &&
        payload.filesToDelete.some(
          (file) =>
            normalizeKCLFileDeletePath(file.requestedFileName) ===
            activeRelativePath
        )
      const shouldRecordZookeeperHistory = Boolean(
        project?.path && payload.zookeeperEditPatch?.changed_files?.length
      )
      const activeFileOutput = payload.files.find(
        (file) =>
          normalizeKCLFileDeletePath(file.requestedFileName) ===
          activeRelativePath
      )
      const shouldRefreshActiveEditorAfterPlainOutput = Boolean(
        !shouldRecordZookeeperHistory &&
          !activeFileDeleted &&
          activeFileOutput &&
          project?.name === payload.requestedProjectName &&
          activeFilePath === kclManager.path
      )
      const pendingHistoryReserved = Boolean(
        shouldRecordZookeeperHistory &&
          project?.path &&
          payload.zookeeperEditPatch
      )
      if (
        pendingHistoryReserved &&
        project?.path &&
        payload.zookeeperEditPatch
      ) {
        reservePendingZookeeperHistoryWrite({
          activeFilePath,
          exchangeId,
          projectPath: project.path,
        })
      }

      zookeeperFileRequestQueue.current =
        zookeeperFileRequestQueue.current.then(
          () =>
            new Promise<void>((resolve) => {
              let pendingHistoryStarted = false
              let requestSettled = false
              const settleRequest = () => {
                if (requestSettled) return
                requestSettled = true
                resolve()
              }

              void (async () => {
                let historyRecorded = false
                if (
                  shouldRecordZookeeperHistory &&
                  project?.path &&
                  payload.zookeeperEditPatch
                ) {
                  pendingHistoryStarted = true
                  await beginPendingZookeeperHistoryWrite({
                    activeFilePath,
                    exchangeId,
                    patch: payload.zookeeperEditPatch,
                    projectPath: project.path,
                    reserved: pendingHistoryReserved,
                  })
                }
                await waitForIdleState({ systemIOActor })
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
                        cancelPendingZookeeperHistoryWrite({ exchangeId })
                      }
                      settleRequest()
                    },
                    onFileSystemSuccess: () => {
                      if (historyRecorded) {
                        settleRequest()
                        return
                      }
                      historyRecorded = true
                      if (
                        shouldRecordZookeeperHistory &&
                        project?.path &&
                        payload.zookeeperEditPatch
                      ) {
                        const currentFile = payload.files.find(
                          (file) =>
                            normalizeKCLFileDeletePath(
                              file.requestedFileName
                            ) === activeRelativePath
                        )
                        const currentEditorRelativePath =
                          project.path && kclManager.path
                            ? normalizeKCLFileDeletePath(
                                fsZds.relative(project.path, kclManager.path)
                              )
                            : ''
                        const currentEditorFile = payload.files.find(
                          (file) =>
                            normalizeKCLFileDeletePath(
                              file.requestedFileName
                            ) === currentEditorRelativePath
                        )
                        void completePendingZookeeperHistoryWrite({
                          activeFileDeleted,
                          activeFilePath,
                          activeFileRequestedCode: currentFile?.requestedCode,
                          currentFilePath: currentEditorFile
                            ? kclManager.path
                            : undefined,
                          currentFileRequestedCode:
                            currentEditorFile?.requestedCode,
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
                          .finally(settleRequest)
                        return
                      }
                      settleRequest()
                    },
                    ...(shouldRefreshActiveEditorAfterPlainOutput &&
                    activeFileOutput
                      ? {
                          onSuccess: () => {
                            if (kclManager.path !== activeFilePath) return
                            if (
                              kclManager.code === activeFileOutput.requestedCode
                            )
                              return
                            kclManager.updateCodeEditor(
                              activeFileOutput.requestedCode,
                              {
                                shouldAddToHistory: false,
                                shouldClearHistory: true,
                                shouldExecute: true,
                                shouldResetCamera: true,
                                shouldWriteToDisk: true,
                              }
                            )
                          },
                        }
                      : {}),
                  },
                })
              })().catch((error: unknown) => {
                if (pendingHistoryReserved || pendingHistoryStarted) {
                  cancelPendingZookeeperHistoryWrite({ exchangeId })
                }
                console.error(
                  'Failed to process Zookeeper file request.',
                  error
                )
                settleRequest()
              })
            })
        )
    }
  )

  // Save the conversation id for the project id if necessary.
  useProjectIdToConversationId(
    mlEphantManagerActor,
    zookeeperConversationStore,
    settingsValues
  )

  // During the makethon, this was set to the following:
  // !isPlaywright() &&
  // !location.pathname.includes(String(PATHS.ONBOARDING)) &&
  // !billingContext.isOrg
  const showMakeathonAnnouncement = false

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="sparkles"
        title="Zookeeper"
        onClose={props.onClose}
        Menu={MlEphantConversationMenu}
      />
      <MlEphantConversationPane
        {...{
          mlEphantManagerActor: mlEphantManagerActor,
          conversationStore: zookeeperConversationStore,
          kclManager,
          contextModeling,
          sendModeling,
          sendBillingUpdate: () => {
            billing.send({
              type: BillingTransition.Update,
              apiToken: token,
            })
          },
          sendBillingUsageStarted: () => {
            billing.send({
              type: BillingTransition.UsageStarted,
            })
          },
          sendBillingUsageEnded: () => {
            billing.send({
              type: BillingTransition.UsageEnded,
            })
          },
          theProject: theProject.current,
          loaderFile,
          settings: settingsValues,
          user,
          showMakeathonAnnouncement,
          onMlCopilotModeChange: (mode) => {
            settings.actor.send({
              type: 'set.app.zookeeperMode',
              data: { level: 'project', value: mode },
            })
          },
        }}
      />
    </LayoutPanel>
  )
}

function useZookeeperEditPatchHistory({
  kclManager,
  mlEphantManagerActor,
}: {
  kclManager: KclManager
  mlEphantManagerActor: MlEphantManagerActor
}) {
  const pendingZookeeperHistoryByExchange = useRef(
    new Map<number, PendingZookeeperHistory>()
  )

  useEffect(() => {
    const pendingZookeeperHistories = pendingZookeeperHistoryByExchange.current
    return () => {
      pendingZookeeperHistories.clear()
      kclManager.zookeeperHistoryRecordingInProgress = false
    }
  }, [kclManager])

  const recordZookeeperHistory = useCallback(
    (pending: ReadyPendingZookeeperHistory) => {
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
    },
    [kclManager]
  )

  const tryFlushPendingZookeeperHistory = useCallback(
    (exchangeId: number) => {
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
    },
    [kclManager, recordZookeeperHistory]
  )

  const reservePendingZookeeperHistoryWrite = useCallback(
    ({
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
    },
    [kclManager]
  )

  const beginPendingZookeeperHistoryWrite = useCallback(
    async ({
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
    },
    [kclManager]
  )

  const cancelPendingZookeeperHistoryWrite = useCallback(
    ({ exchangeId }: CancelPendingZookeeperHistoryWriteProps) => {
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
    },
    [kclManager, tryFlushPendingZookeeperHistory]
  )

  const completePendingZookeeperHistoryWrite = useCallback(
    async ({
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
    },
    [tryFlushPendingZookeeperHistory]
  )

  useFlushZookeeperHistoryOnResponseEnd(
    mlEphantManagerActor,
    pendingZookeeperHistoryByExchange,
    tryFlushPendingZookeeperHistory
  )

  return {
    beginPendingZookeeperHistoryWrite,
    cancelPendingZookeeperHistoryWrite,
    completePendingZookeeperHistoryWrite,
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

function useFlushZookeeperHistoryOnResponseEnd(
  mlEphantManagerActor: MlEphantManagerActor,
  pendingZookeeperHistoryByExchange: MutableRefObject<
    Map<number, PendingZookeeperHistory>
  >,
  tryFlushPendingZookeeperHistory: (exchangeId: number) => void
) {
  useEffect(() => {
    let lastId: number | undefined = undefined
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (next.context.lastMessageId === lastId) return
      lastId = next.context.lastMessageId

      if (next.context.lastMessageType !== 'end_of_stream') return
      const exchangeId = (next.context.conversation?.exchanges.length ?? 0) - 1
      if (exchangeId < 0) return

      const pending = pendingZookeeperHistoryByExchange.current.get(exchangeId)
      if (!pending) return

      pending.streamEnded = true
      pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
      tryFlushPendingZookeeperHistory(exchangeId)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [
    mlEphantManagerActor,
    pendingZookeeperHistoryByExchange,
    tryFlushPendingZookeeperHistory,
  ])
}

export const MlEphantConversationMenu = () => {
  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() => {
            const context = mlEphantManagerActor.getSnapshot().context
            const md = MlEphantConversationToMarkdown(context.conversation)
            const blob = new Blob([new TextEncoder().encode(md)], {
              type: 'text/markdown',
            })
            void browserSaveFile(
              blob,
              `${context.conversationId ?? new Date().toISOString()}.md`,
              ''
            )
          }}
          className={styles.button}
        >
          <span>Export conversation</span>
        </button>
      </Menu.Item>
    </HeaderMenu>
  )
}
