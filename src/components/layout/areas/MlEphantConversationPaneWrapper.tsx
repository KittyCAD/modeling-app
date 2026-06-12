import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { MlEphantConversationPane } from '@src/components/layout/areas/MlEphantConversationPane'
import { zookeeperEditPatchHistoryEvent } from '@src/editor/plugins/zookeeper'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { useApp, useSingletons } from '@src/lib/boot'
import { browserSaveFile } from '@src/lib/browserSaveFile'
import fsZds from '@src/lib/fs-zds'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import {
  type ZookeeperEditPatch,
  type ZookeeperEditPatchFile,
  mergeZookeeperEditPatches,
} from '@src/lib/zookeeperEditPatch'
import { BillingTransition } from '@src/machines/billingMachine'
import {
  MlEphantConversationToMarkdown,
  type MlEphantManagerActor,
  MlEphantManagerReactContext,
} from '@src/machines/mlEphantManagerMachine'
import {
  useProjectIdToConversationId,
  useWatchForNewFileRequestsFromMlEphant,
} from '@src/machines/systemIO/hooks'
import {
  SystemIOMachineEvents,
  normalizeKCLFileDeletePath,
  prepareMlEphantNewFileRequest,
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
    ({
      activeFileDeleted,
      activeFilePath,
      activeFileRequestedCode,
      currentFilePath,
      currentFileRequestedCode,
      patch,
      projectPath,
    }: ReadyPendingZookeeperHistory) => {
      const codeChangeFilePath =
        currentFilePath ?? (!activeFileDeleted ? activeFilePath : undefined)
      const codeChangeRequestedCode =
        currentFileRequestedCode ??
        (!activeFileDeleted ? activeFileRequestedCode : undefined)
      const codeChangeRelativePath = codeChangeFilePath
        ? normalizeKCLFileDeletePath(
            fsZds.relative(projectPath, codeChangeFilePath)
          )
        : undefined
      const patchChangesCodeChangeFile =
        codeChangeRelativePath !== undefined &&
        patch.changed_files?.some(
          (file) =>
            normalizeKCLFileDeletePath(file.path) === codeChangeRelativePath
        )

      if (
        codeChangeFilePath &&
        patchChangesCodeChangeFile &&
        codeChangeRequestedCode !== undefined &&
        kclManager.path === codeChangeFilePath
      ) {
        const codeChangePreviousCode = getZookeeperPatchPreviousCode(
          patch,
          codeChangeRelativePath,
          codeChangeRequestedCode
        )
        kclManager.addGlobalHistoryEventWithCodeChange(
          zookeeperEditPatchHistoryEvent({
            projectPath,
            patch,
            activeFilePath,
          }),
          codeChangeRequestedCode,
          codeChangePreviousCode
        )
        return
      }

      kclManager.addGlobalHistoryEvent(
        zookeeperEditPatchHistoryEvent({
          projectPath,
          patch,
          activeFilePath,
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
          activeFileRequestedCode: pending.activeFileRequestedCode,
          currentFilePath: pending.currentFilePath,
          currentFileRequestedCode: pending.currentFileRequestedCode,
          patch: pending.patch,
          projectPath: pending.projectPath,
        })
      } finally {
        if (pendingZookeeperHistoryByExchange.current.size === 0) {
          kclManager.zookeeperHistoryRecordingInProgress = false
        }
      }
    },
    [kclManager, recordZookeeperHistory]
  )
  const beginPendingZookeeperHistoryWrite = useCallback(
    (exchangeId: number) => {
      const pending =
        pendingZookeeperHistoryByExchange.current.get(exchangeId) ??
        createPendingZookeeperHistory()
      pending.outstandingWrites += 1
      pendingZookeeperHistoryByExchange.current.set(exchangeId, pending)
      kclManager.zookeeperHistoryRecordingInProgress = true
    },
    [kclManager]
  )
  const completePendingZookeeperHistoryWrite = useCallback(
    ({
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
      pending.outstandingWrites = Math.max(0, pending.outstandingWrites - 1)
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

  useWatchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor,
    billing.actor,
    token,
    kclManager.engineCommandManager,
    (requestProps) => {
      const activeFilePath =
        requestProps.fileFocusedOnInEditor?.path ?? kclManager.path
      const payload = prepareMlEphantNewFileRequest({
        ...requestProps,
        fallbackFilePath: activeFilePath,
      })

      if (payload) {
        let historyRecorded = false
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
        if (shouldRecordZookeeperHistory) {
          beginPendingZookeeperHistoryWrite(exchangeId)
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
            onFileSystemSuccess: () => {
              if (historyRecorded) return
              historyRecorded = true
              if (
                shouldRecordZookeeperHistory &&
                project?.path &&
                payload.zookeeperEditPatch
              ) {
                const currentFile = payload.files.find(
                  (file) =>
                    normalizeKCLFileDeletePath(file.requestedFileName) ===
                    activeRelativePath
                )
                const currentEditorRelativePath =
                  project.path && kclManager.path
                    ? normalizeKCLFileDeletePath(
                        fsZds.relative(project.path, kclManager.path)
                      )
                    : ''
                const currentEditorFile = payload.files.find(
                  (file) =>
                    normalizeKCLFileDeletePath(file.requestedFileName) ===
                    currentEditorRelativePath
                )
                completePendingZookeeperHistoryWrite({
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
              }
            },
            ...(shouldRefreshActiveEditorAfterPlainOutput && activeFileOutput
              ? {
                  onSuccess: () => {
                    if (kclManager.path !== activeFilePath) return
                    if (kclManager.code === activeFileOutput.requestedCode)
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
      }
    }
  )

  // Save the conversation id for the project id if necessary.
  useProjectIdToConversationId(
    mlEphantManagerActor,
    systemIOActor,
    settingsValues
  )

  const sendBillingUpdate = () => {
    billing.send({
      type: BillingTransition.Update,
      apiToken: token,
    })
  }
  const sendBillingUsageStarted = () => {
    billing.send({
      type: BillingTransition.UsageStarted,
    })
  }
  const sendBillingUsageEnded = () => {
    billing.send({
      type: BillingTransition.UsageEnded,
    })
  }

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
          systemIOActor,
          kclManager,
          contextModeling,
          sendModeling,
          sendBillingUpdate,
          sendBillingUsageStarted,
          sendBillingUsageEnded,
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

type PendingZookeeperHistory = {
  activeFileDeleted: boolean
  activeFilePath?: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  outstandingWrites: number
  patch?: ZookeeperEditPatch
  projectPath?: string
  streamEnded: boolean
}

type ReadyPendingZookeeperHistory = {
  activeFileDeleted: boolean
  activeFilePath: string
  activeFileRequestedCode?: string
  currentFilePath?: string
  currentFileRequestedCode?: string
  patch: ZookeeperEditPatch
  projectPath: string
}

type CompletePendingZookeeperHistoryWriteProps =
  ReadyPendingZookeeperHistory & {
    exchangeId: number
  }

function createPendingZookeeperHistory(): PendingZookeeperHistory {
  return {
    activeFileDeleted: false,
    outstandingWrites: 0,
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
