import type { MlCopilotServerMessage, MlToolResult } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import type { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import {
  normalizeKCLFileDeletePath,
  prepareZookeeperNewFileRequest,
  type SystemIOActor,
  SystemIOMachineEvents,
  waitForIdleState,
} from '@src/machines/systemIO/utils'

interface ZookeeperFileRequestProcessorDependencies {
  history: ZookeeperEditPatchHistory
  getProject: () => Project | undefined
  isEditorCurrent: () => boolean
  isSessionCurrent: () => boolean
  kclManager: KclManager
  systemIOActor: SystemIOActor
  onEditApplied: (response: MlCopilotServerMessage) => void
}

type ZookeeperNewFileRequest = {
  // This only ensures the order of the edits received; there is no guarantee the server is sending us edits in-order.
  orderedId: number
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
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
  // IDs stay monotonic when reset() replaces the conversation.
  private nextOrderedId = 0
  private activeOrderedId: number | undefined
  private pendingOrderedIds: number[] = []
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

    this.nextOrderedId += 1
    this.enqueue(
      {
        orderedId: this.nextOrderedId,
        toolOutput: lastResponse.tool_output.result,
        projectNameCurrentlyOpened: projectName,
        fileFocusedOnInEditor: snapshot.context.fileFocusedOnInEditor,
        exchangeId: exchanges.length - 1,
      },
      () => this.deps.onEditApplied(lastResponse)
    )

    this.deps.kclManager.engineCommandManager.modelingSend({
      type: 'Set selection',
      data: { selection: {}, selectionType: 'singleCodeCursor' },
    })
  }

  private enqueue(request: ZookeeperNewFileRequest, onApplied: () => void) {
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
    if (shouldRecordHistory && requestProjectPath) {
      this.deps.history.reserve({
        activeFilePath,
        exchangeId: request.exchangeId,
        projectPath: requestProjectPath,
      })
    }

    this.pendingOrderedIds.push(request.orderedId)
    this.queue = this.queue.then(
      () =>
        new Promise<void>((resolve) => {
          let historyCanceled = false
          let dispatched = false
          let settled = false
          let fileSystemCompleted = false
          let fileSystemSucceeded = false
          let historyCompleted = !shouldRecordHistory
          let historySucceeded = !shouldRecordHistory
          let postWriteCompleted = !shouldRefreshActiveEditor
          const requestCanFinish = () =>
            this.activeOrderedId === request.orderedId &&
            (dispatched
              ? requestProjectIsCurrent() && this.deps.isEditorCurrent()
              : requestIsCurrent())

          const settle = () => {
            if (settled || !historyCompleted || !postWriteCompleted) {
              return
            }
            settled = true
            this.pendingOrderedIds = this.pendingOrderedIds.filter(
              (orderedId) => orderedId !== request.orderedId
            )
            if (this.activeOrderedId === request.orderedId) {
              this.activeOrderedId = undefined
            }
            abortSignal.removeEventListener('abort', cancelPostWrite)
            resolve()
            // The queued request and undo history now own everything needed
            // for the edit. The transcript may release its redundant copy.
            if (fileSystemSucceeded && historySucceeded && requestIsCurrent()) {
              onApplied()
            }
          }
          function cancelPostWrite() {
            postWriteCompleted = true
            settle()
          }
          const cancelHistory = () => {
            if (historyCanceled || !shouldRecordHistory) {
              return
            }
            historyCanceled = true
            this.deps.history.cancel({ exchangeId: request.exchangeId })
          }
          const stopIfOutOfOrder = () => {
            const expectedOrderedId = this.pendingOrderedIds[0]
            if (request.orderedId === expectedOrderedId) {
              return false
            }
            console.error(
              'Refusing to dispatch an out-of-order Zookeeper edit.',
              {
                orderedId: request.orderedId,
                expectedOrderedId,
              }
            )
            cancelHistory()
            historyCompleted = true
            postWriteCompleted = true
            settle()
            return true
          }
          const stopIfStale = ({
            fileSystemWriteFinished = false,
          }: {
            fileSystemWriteFinished?: boolean
          } = {}) => {
            if (settled) {
              return true
            }
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

          if (stopIfOutOfOrder()) {
            return
          }
          this.activeOrderedId = request.orderedId
          if (stopIfStale()) {
            return
          }

          void (async () => {
            if (
              shouldRecordHistory &&
              requestProjectPath &&
              payload.zookeeperEditPatch
            ) {
              await this.deps.history.begin({
                activeFilePath,
                exchangeId: request.exchangeId,
                patch: payload.zookeeperEditPatch,
                projectPath: requestProjectPath,
                reserved: true,
              })
            }
            if (stopIfStale()) {
              return
            }

            await waitForIdleState({
              abortSignal,
              systemIOActor,
            })
            if (stopIfStale() || stopIfOutOfOrder()) {
              return
            }

            kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = true
            dispatched = true
            systemIOActor.send({
              type: SystemIOMachineEvents.bulkCreateAndDeleteKCLFilesAndNavigateToFile,
              data: {
                orderedId: request.orderedId,
                files: payload.files,
                filesToDelete: payload.filesToDelete,
                override: true,
                requestedProjectName: payload.requestedProjectName,
                requestedProjectPath: requestProjectPath,
                requestedFileNameWithExtension:
                  payload.requestedFileNameWithExtension ?? '',
                onFileSystemError: () => {
                  if (settled || this.activeOrderedId !== request.orderedId) {
                    return
                  }
                  if (fileSystemCompleted) {
                    cancelPostWrite()
                    return
                  }
                  fileSystemCompleted = true
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
                    fileSystemCompleted ||
                    settled ||
                    this.activeOrderedId !== request.orderedId
                  ) {
                    return
                  }
                  fileSystemCompleted = true
                  if (
                    stopIfStale({
                      fileSystemWriteFinished: true,
                    })
                  ) {
                    return
                  }
                  fileSystemSucceeded = true
                  if (!postWriteCompleted) {
                    if (
                      abortSignal.aborted ||
                      kclManager.path !== activeFilePath
                    ) {
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
                        activeFileRequestedCode:
                          activeFileOutput?.requestedCode,
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
                      .then(() => {
                        historySucceeded = true
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
                ...(shouldRefreshActiveEditor
                  ? {
                      onSuccess: () => {
                        try {
                          if (settled || !requestCanFinish()) {
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
                                shouldExecute: false,
                                shouldResetCamera: true,
                                shouldWriteToDisk: !shouldRecordHistory,
                              }
                            )
                          }
                        } finally {
                          postWriteCompleted = true
                          settle()
                        }
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
