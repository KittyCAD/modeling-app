import type { ProjectOperationsService } from '@src/lib/fileSystem/projectOperations'
import type { ProjectSessionService } from '@src/registry/contracts/projectSession'
import { signal, type ReadonlySignal } from '@preact/signals-core'
import type { MlCopilotServerMessage, MlToolResult } from '@kittycad/lib'
import type { KclManager } from '@src/lang/KclManager'
import fsZds from '@src/lib/fs-zds'
import type { FileEntry, Project } from '@src/lib/project'
import type { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import type { ZookeeperManagerActor } from '@src/lib/zookeeper/zookeeperManagerMachine'
import { normalizeKCLFileDeletePath } from '@src/lib/fileSystem/projectFiles'
import {
  prepareZookeeperNewFileRequest,
  type BulkFileWriteProgress,
} from '@src/lib/zookeeper/projectFiles'

interface ZookeeperFileRequestProcessorDependencies {
  history: ZookeeperEditPatchHistory
  getProject: () => Project | undefined
  isEditorCurrent: () => boolean
  isSessionCurrent: () => boolean
  kclManager: KclManager
  projectOperations: Pick<ProjectOperationsService, 'applyEdits'>
  session: Pick<ProjectSessionService, 'refreshProject' | 'openFile'>
  onEditApplied: (response: MlCopilotServerMessage) => void
  onQueueIdle?: () => void
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
  private disposed = false
  private generation = 0
  private lastMessageId: number | undefined
  // IDs stay monotonic when reset() replaces the conversation.
  private nextOrderedId = 0
  private activeOrderedId: number | undefined
  private activeRequest: QueuedZookeeperFileRequest | undefined
  private queue: QueuedZookeeperFileRequest[] = []
  private processingQueue = false
  private pendingRequestCount = 0
  private readonly fileWriteProgressSignal = signal<
    BulkFileWriteProgress | undefined
  >(undefined)
  readonly fileWriteProgress: ReadonlySignal<
    BulkFileWriteProgress | undefined
  > = this.fileWriteProgressSignal

  get hasPendingRequests() {
    return this.pendingRequestCount > 0
  }

  constructor(
    private readonly deps: ZookeeperFileRequestProcessorDependencies
  ) {}

  dispose() {
    if (!this.disposed) {
      this.disposed = true
      this.fileWriteProgressSignal.value = undefined
    }
    return this.waitForQueuedRequests()
  }

  reset() {
    if (this.disposed) {
      return this.waitForQueuedRequests()
    }
    this.generation += 1
    this.fileWriteProgressSignal.value = undefined
    this.lastMessageId = undefined
    return this.waitForQueuedRequests()
  }

  handleActorSnapshot(
    snapshot: ReturnType<ZookeeperManagerActor['getSnapshot']>
  ) {
    if (
      this.disposed ||
      Boolean(this.deps.getProject()?.cloudProjectId) ||
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
        const queuedEdit = this.queue.shift()
        if (!queuedEdit) {
          break
        }
        this.activeRequest = queuedEdit
        this.activeOrderedId = queuedEdit.request.orderedId
        try {
          await queuedEdit.run()
        } catch (error: unknown) {
          console.error('Failed to process Zookeeper file request.', error)
        } finally {
          this.activeRequest = undefined
          if (this.activeOrderedId === queuedEdit.request.orderedId) {
            this.activeOrderedId = undefined
          }
          this.pendingRequestCount -= 1
          if (!this.hasPendingRequests) {
            this.fileWriteProgressSignal.value = undefined
            this.deps.onQueueIdle?.()
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
    if (this.disposed || this.deps.getProject()?.cloudProjectId) {
      return
    }
    const project = this.deps.getProject()
    const { kclManager, projectOperations, session } = this.deps
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
    if (payload.files.length === 0 && payload.filesToDelete.length === 0) {
      onApplied()
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

    this.pendingRequestCount += 1
    const previousProgress = this.fileWriteProgressSignal.peek()
    this.fileWriteProgressSignal.value = {
      written: previousProgress?.written ?? 0,
      total: (previousProgress?.total ?? 0) + payload.files.length,
    }
    let writtenCount = 0
    const updateWriteProgress = (written: number) => {
      if (!requestIsCurrent()) return
      const progress = this.fileWriteProgressSignal.peek()
      if (!progress) return
      const nextWritten = Math.min(
        payload.files.length,
        Math.max(writtenCount, written)
      )
      if (nextWritten === writtenCount) return
      this.fileWriteProgressSignal.value = {
        ...progress,
        written: progress.written + nextWritten - writtenCount,
      }
      writtenCount = nextWritten
    }

    const { promise: completed, resolve: finish } =
      Promise.withResolvers<undefined>()
    this.queue.push({
      request,
      completed,
      run: async () => {
        let dispatched = false
        const canFinish = () =>
          dispatched
            ? requestProjectIsCurrent() && this.deps.isEditorCurrent()
            : requestIsCurrent()
        const cancelHistory = () => {
          if (shouldRecordHistory)
            this.deps.history.cancel({ exchangeId: request.exchangeId })
        }
        try {
          if (!requestIsCurrent() || !requestProjectPath) {
            cancelHistory()
            return
          }
          if (shouldRecordHistory && payload.zookeeperEditPatch) {
            await this.deps.history.begin({
              activeFilePath,
              exchangeId: request.exchangeId,
              patch: payload.zookeeperEditPatch,
              projectPath: requestProjectPath,
              reserved: true,
            })
          }
          if (!requestIsCurrent()) {
            cancelHistory()
            return
          }
          dispatched = true
          kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = true
          await projectOperations.applyEdits(
            requestProjectPath,
            [
              ...payload.files.map((file) => ({
                path: fsZds.join(requestProjectPath, file.requestedFileName),
                contents: file.requestedCode,
              })),
              ...payload.filesToDelete.map((file) => ({
                path: fsZds.join(requestProjectPath, file.requestedFileName),
                contents: null,
              })),
            ],
            ({ written }) => updateWriteProgress(written)
          )
          updateWriteProgress(payload.files.length)
          if (!canFinish()) {
            cancelHistory()
            return
          }
          if (shouldRecordHistory && payload.zookeeperEditPatch) {
            const currentRelative = kclManager.path
              ? normalizeKCLFileDeletePath(
                  fsZds.relative(requestProjectPath, kclManager.path)
                )
              : ''
            const currentFile = payload.files.find(
              (file) =>
                normalizeKCLFileDeletePath(file.requestedFileName) ===
                currentRelative
            )
            await this.deps.history.complete({
              activeFileDeleted,
              activeFilePath,
              activeFileRequestedCode: activeFileOutput?.requestedCode,
              currentFilePath: currentFile ? kclManager.path : undefined,
              currentFileRequestedCode: currentFile?.requestedCode,
              exchangeId: request.exchangeId,
              requestIsCurrent: canFinish,
              patch: payload.zookeeperEditPatch,
              projectPath: requestProjectPath,
            })
          }
          if (!requestIsCurrent() || !canFinish()) return
          await session.refreshProject()
          if (!requestIsCurrent() || !canFinish()) return
          if (
            shouldRefreshActiveEditor &&
            activeFileOutput &&
            kclManager.path === activeFilePath &&
            kclManager.code !== activeFileOutput.requestedCode
          ) {
            kclManager.updateCodeEditor(activeFileOutput.requestedCode, {
              shouldAddToHistory: false,
              shouldClearHistory: !shouldRecordHistory,
              shouldExecute: false,
              shouldResetCamera: true,
              shouldWriteToDisk: !shouldRecordHistory,
            })
          }
          if (activeFileDeleted && kclManager.path === activeFilePath) {
            await session.openFile(
              fsZds.join(
                requestProjectPath,
                payload.requestedFileNameWithExtension || 'main.kcl'
              ),
              { projectPath: requestProjectPath }
            )
          }
          if (requestIsCurrent() && canFinish()) {
            const modeling = kclManager.modelingState
            if (modeling?.matches('sketchSolveMode'))
              kclManager.engineCommandManager.modelingSend({
                type: 'Exit sketch',
              })
            else
              kclManager.scheduleCurrentCodeExecution(
                !modeling?.matches('Sketch')
              )
            onApplied()
          }
        } catch (error) {
          cancelHistory()
          console.error('Failed to apply Zookeeper file edits.', error)
        } finally {
          if (dispatched)
            kclManager.zookeeperManagerMachineBulkManipulatingFileSystem = false
          finish(undefined)
        }
      },
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
