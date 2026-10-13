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

export type ZookeeperNewFileRequest = {
  // This only ensures the order of the edits received; there is no guarantee the server is sending us edits in-order.
  orderedId: number
  toolOutput: MlToolResult
  projectNameCurrentlyOpened: string
  fileFocusedOnInEditor?: FileEntry
  exchangeId: number
}

type QueuedZookeeperFileRequest = {
  request: ZookeeperNewFileRequest
  run: () => Promise<void>
  completed: Promise<void>
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
  private activeRequest: QueuedZookeeperFileRequest | undefined
  private queue: QueuedZookeeperFileRequest[] = []
  private processingQueue = false

  constructor(
    private readonly deps: ZookeeperFileRequestProcessorDependencies
  ) {}

  dispose() {
    if (!this.disposed) {
      this.disposed = true
      this.abortController.abort()
    }
    return this.waitForQueuedRequests()
  }

  reset() {
    if (this.disposed) {
      return this.waitForQueuedRequests()
    }
    this.generation += 1
    this.abortController.abort()
    this.abortController = new AbortController()
    this.lastMessageId = undefined
    return this.waitForQueuedRequests()
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

  private async waitForQueuedRequests() {
    const requests = this.activeRequest
      ? [this.activeRequest, ...this.queue]
      : [...this.queue]
    await Promise.all(requests.map((request) => request.completed))
  }

  private async processQueue() {
    if (this.processingQueue) {
      return
    }
    this.processingQueue = true
    try {
      while (this.queue.length > 0) {
        const request = this.queue.shift()
        if (!request) {
          break
        }
        this.activeRequest = request
        this.activeOrderedId = request.request.orderedId
        try {
          await request.run()
        } catch (error: unknown) {
          console.error('Failed to process Zookeeper file request.', error)
        } finally {
          this.activeRequest = undefined
          if (this.activeOrderedId === request.request.orderedId) {
            this.activeOrderedId = undefined
          }
        }
      }
    } finally {
      this.processingQueue = false
    }
  }

  /** Queues an edit whose orderedId was assigned when it was received. */
  enqueue(request: ZookeeperNewFileRequest, onApplied: () => void) {
    // Re-ordering of the queue happens at the end of this function
    if (this.disposed) {
      return
    }
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

    const { promise: completed, resolve: finish } =
      Promise.withResolvers<undefined>()
    this.queue.push({
      request,
      completed,
      run: () =>
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
            if (stopIfStale()) {
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
                    console.warn(
                      'Ignoring Zookeeper filesystem error callback for a settled or inactive edit.',
                      {
                        orderedId: request.orderedId,
                        activeOrderedId: this.activeOrderedId,
                        settled,
                      }
                    )
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
        }).finally(() => finish(undefined)),
    })
    // Reorder waiting edits on arrival. The active edit finishes before the
    // worker takes the next request from this sorted queue.
    this.queue.sort(
      (left, right) => left.request.orderedId - right.request.orderedId
    )
    void this.processQueue().catch((error: unknown) => {
      console.error('Failed to process Zookeeper file queue.', error)
    })
  }
}
