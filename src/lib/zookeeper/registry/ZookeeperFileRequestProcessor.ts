import type { MlToolResult } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import type { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import {
  normalizeKCLFileDeletePath,
  prepareZookeeperNewFileRequest,
  type RequestedKCLFileDelete,
  type SystemIOActor,
  SystemIOMachineEvents,
  waitForIdleState,
} from '@src/machines/systemIO/utils'

export interface ZookeeperFileRequestProcessorDependencies {
  history: ZookeeperEditPatchHistory
  getProject: () => Project | undefined
  isEditorCurrent: () => boolean
  isSessionCurrent: () => boolean
  kclManager: KclManager
  systemIOActor: SystemIOActor
}

type ZookeeperNewFileRequest = {
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
  filesToDelete?: RequestedKCLFileDelete[]
  exchangeId: number
}

/**
 * Applies file edits emitted by one Zookeeper session. The session controller
 * forwards actor snapshots; this helper owns the serialized write queue.
 */
export class ZookeeperFileRequestProcessor {
  private abortController = new AbortController()
  private disposed = false
  private generation = 0
  private lastMessageId: number | undefined
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly deps: ZookeeperFileRequestProcessorDependencies
  ) {}

  dispose() {
    if (!this.disposed) {
      this.disposed = true
      this.abortController.abort()
    }
    return this.queue
  }

  reset() {
    if (this.disposed) {
      return this.queue
    }
    this.generation += 1
    this.abortController.abort()
    this.abortController = new AbortController()
    this.lastMessageId = undefined
    return this.queue
  }

  handleActorSnapshot(
    snapshot: ReturnType<ZookeeperManagerActor['getSnapshot']>
  ) {
    if (
      this.disposed ||
      snapshot.context.lastMessageId === this.lastMessageId
    ) {
      return
    }
    this.lastMessageId = snapshot.context.lastMessageId

    if (snapshot.context.lastMessageType === 'delta') {
      return
    }

    const exchanges = snapshot.context.conversation?.exchanges ?? []
    const lastExchange = exchanges.at(-1)
    if (!lastExchange) {
      return
    }
    const lastResponse = lastExchange.responses?.at(-1)
    if (!lastResponse || !('tool_output' in lastResponse)) {
      return
    }

    const projectName = snapshot.context.projectNameCurrentlyOpened
    if (!projectName) {
      return
    }

    const filesToDelete = new Set(
      lastExchange.responses.flatMap((response) => {
        if (!('reasoning' in response)) {
          return []
        }
        if (
          response.reasoning.type !== 'deleted_kcl_file' &&
          response.reasoning.type !== 'deleted_project_file'
        ) {
          return []
        }
        return response.reasoning.file_name
      })
    )

    this.enqueue({
      toolOutput: lastResponse.tool_output.result,
      projectNameCurrentlyOpened: projectName,
      fileFocusedOnInEditor: snapshot.context.fileFocusedOnInEditor,
      filesToDelete: Array.from(filesToDelete, (requestedFileName) => ({
        requestedFileName,
      })),
      exchangeId: exchanges.length - 1,
    })

    this.deps.kclManager.engineCommandManager.modelingSend({
      type: 'Set selection',
      data: { selection: undefined, selectionType: 'singleCodeCursor' },
    })
  }

  private enqueue(request: ZookeeperNewFileRequest) {
    const project = this.deps.getProject()
    const { kclManager, systemIOActor } = this.deps
    const abortSignal = this.abortController.signal
    const requestGeneration = this.generation
    const requestProjectPath = project?.path
    const requestProjectIsCurrent = () =>
      this.deps.getProject()?.path === requestProjectPath
    const requestIsCurrent = () =>
      !this.disposed &&
      this.generation === requestGeneration &&
      this.deps.isSessionCurrent() &&
      requestProjectIsCurrent()
    const activeFilePath =
      request.fileFocusedOnInEditor?.path ?? kclManager.path
    const payload = prepareZookeeperNewFileRequest({
      ...request,
      fallbackFilePath: activeFilePath,
    })

    if (!payload) {
      return
    }

    const activeRelativePath =
      requestProjectPath && activeFilePath
        ? normalizeKCLFileDeletePath(
            fsZds.relative(requestProjectPath, activeFilePath)
          )
        : ''
    const activeFileDeleted =
      activeRelativePath.length > 0 &&
      payload.filesToDelete.some(
        (file) =>
          normalizeKCLFileDeletePath(file.requestedFileName) ===
          activeRelativePath
      )
    const shouldRecordHistory = Boolean(
      requestProjectPath && payload.zookeeperEditPatch?.changed_files?.length
    )
    const activeFileOutput = payload.files.find(
      (file) =>
        normalizeKCLFileDeletePath(file.requestedFileName) ===
        activeRelativePath
    )
    const shouldRefreshActiveEditor = Boolean(
      !activeFileDeleted &&
        activeFileOutput &&
        project?.name === payload.requestedProjectName &&
        activeFilePath === kclManager.path
    )
    const historyReserved = Boolean(
      shouldRecordHistory && requestProjectPath && payload.zookeeperEditPatch
    )

    if (historyReserved && requestProjectPath) {
      this.deps.history.reserve({
        activeFilePath,
        exchangeId: request.exchangeId,
        projectPath: requestProjectPath,
      })
    }

    this.queue = this.queue.then(
      () =>
        new Promise<void>((resolve) => {
          let historyStarted = false
          let historyCanceled = false
          let dispatched = false
          let settled = false
          let historyCompleted = !shouldRecordHistory
          let postWriteCompleted =
            !shouldRecordHistory && !shouldRefreshActiveEditor
          const requestCanFinish = () =>
            dispatched
              ? requestProjectIsCurrent() && this.deps.isEditorCurrent()
              : requestIsCurrent()

          function settle() {
            if (settled || !historyCompleted || !postWriteCompleted) {
              return
            }
            settled = true
            abortSignal.removeEventListener('abort', cancelPostWrite)
            resolve()
          }
          function cancelPostWrite() {
            postWriteCompleted = true
            settle()
          }
          const cancelHistory = () => {
            if (historyCanceled || (!historyReserved && !historyStarted)) {
              return
            }
            historyCanceled = true
            this.deps.history.cancel({ exchangeId: request.exchangeId })
          }
          const stopIfStale = ({
            fileSystemWriteFinished = false,
          }: {
            fileSystemWriteFinished?: boolean
          } = {}) => {
            if (requestCanFinish()) {
              return false
            }
            if (fileSystemWriteFinished) {
              kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = false
            }
            cancelHistory()
            historyCompleted = true
            postWriteCompleted = true
            settle()
            return true
          }

          if (stopIfStale()) {
            return
          }

          void (async () => {
            let historyRecorded = false
            if (
              shouldRecordHistory &&
              requestProjectPath &&
              payload.zookeeperEditPatch
            ) {
              historyStarted = true
              await this.deps.history.begin({
                activeFilePath,
                exchangeId: request.exchangeId,
                patch: payload.zookeeperEditPatch,
                projectPath: requestProjectPath,
                reserved: historyReserved,
              })
            }
            if (stopIfStale()) {
              return
            }

            await waitForIdleState({
              abortSignal,
              systemIOActor,
            })
            if (stopIfStale()) {
              return
            }

            kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = true
            dispatched = true
            systemIOActor.send({
              type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
              data: {
                files: payload.files,
                filesToDelete: payload.filesToDelete,
                override: true,
                requestedProjectName: payload.requestedProjectName,
                requestedProjectPath: requestProjectPath,
                requestedFileNameWithExtension:
                  payload.requestedFileNameWithExtension ?? '',
                onFileSystemError: () => {
                  if (stopIfStale({ fileSystemWriteFinished: true })) {
                    return
                  }
                  cancelHistory()
                  historyCompleted = true
                  postWriteCompleted = true
                  settle()
                },
                onFileSystemSuccess: () => {
                  if (
                    stopIfStale({
                      fileSystemWriteFinished: true,
                    })
                  ) {
                    return
                  }
                  if (historyRecorded) {
                    historyCompleted = true
                    settle()
                    return
                  }
                  historyRecorded = true
                  if (!postWriteCompleted) {
                    if (abortSignal.aborted) {
                      cancelPostWrite()
                    } else {
                      abortSignal.addEventListener('abort', cancelPostWrite, {
                        once: true,
                      })
                    }
                  }

                  if (
                    shouldRecordHistory &&
                    requestProjectPath &&
                    payload.zookeeperEditPatch
                  ) {
                    const activeFile = payload.files.find(
                      (file) =>
                        normalizeKCLFileDeletePath(file.requestedFileName) ===
                        activeRelativePath
                    )
                    const currentEditorRelativePath = kclManager.path
                      ? normalizeKCLFileDeletePath(
                          fsZds.relative(requestProjectPath, kclManager.path)
                        )
                      : ''
                    const currentEditorFile = payload.files.find(
                      (file) =>
                        normalizeKCLFileDeletePath(file.requestedFileName) ===
                        currentEditorRelativePath
                    )

                    void this.deps.history
                      .complete({
                        activeFileDeleted,
                        activeFilePath,
                        activeFileRequestedCode: activeFile?.requestedCode,
                        currentFilePath: currentEditorFile
                          ? kclManager.path
                          : undefined,
                        currentFileRequestedCode:
                          currentEditorFile?.requestedCode,
                        exchangeId: request.exchangeId,
                        requestIsCurrent: requestCanFinish,
                        patch: payload.zookeeperEditPatch,
                        projectPath: requestProjectPath,
                      })
                      .catch((error: unknown) => {
                        console.error(
                          'Failed to complete Zookeeper history write.',
                          error
                        )
                      })
                      .finally(() => {
                        historyCompleted = true
                        settle()
                      })
                    return
                  }

                  historyCompleted = true
                  if (!shouldRefreshActiveEditor) {
                    postWriteCompleted = true
                  }
                  settle()
                },
                ...(shouldRecordHistory || shouldRefreshActiveEditor
                  ? {
                      onSuccess: () => {
                        if (settled || !requestCanFinish()) {
                          postWriteCompleted = true
                          settle()
                          return
                        }
                        if (
                          shouldRefreshActiveEditor &&
                          activeFileOutput &&
                          kclManager.path === activeFilePath &&
                          kclManager.code !== activeFileOutput.requestedCode
                        ) {
                          kclManager.updateCodeEditor(
                            activeFileOutput.requestedCode,
                            {
                              shouldAddToHistory: false,
                              shouldClearHistory:
                                !shouldRecordHistory || !requestCanFinish(),
                              shouldExecute: true,
                              shouldResetCamera: true,
                              shouldWriteToDisk: !shouldRecordHistory,
                            }
                          )
                        }
                        postWriteCompleted = true
                        settle()
                      },
                    }
                  : {}),
              },
            })
          })().catch((error: unknown) => {
            if (stopIfStale()) {
              return
            }
            cancelHistory()
            console.error('Failed to process Zookeeper file request.', error)
            historyCompleted = true
            postWriteCompleted = true
            settle()
          })
        })
    )
  }
}
