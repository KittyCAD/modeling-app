import {
  effect,
  type ReadonlySignal,
  signal,
  untracked,
} from '@preact/signals-core'
import type { KclManager, ZDSProject } from '@src/lang/KclManager'
import { BillingTransition } from '@src/lib/billing'
import type { BillingRegistryService } from '@src/lib/billing/registry/contract'
import { getParentAbsolutePath } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { reportRejection, trap } from '@src/lib/trap'
import { ZookeeperEditPatchHistory } from '@src/lib/zookeeper/registry/ZookeeperEditPatchHistory'
import { ZookeeperFileRequestProcessor } from '@src/lib/zookeeper/registry/ZookeeperFileRequestProcessor'
import {
  type ZookeeperConversationStore,
  zookeeperConversationStore,
} from '@src/lib/zookeeper/zookeeperConversationStore'
import {
  createZookeeperManagerActor,
  hasBeenInterruptedOnLast,
  type MlCopilotModeId,
  stopZookeeperManagerActor,
  updateZookeeperManagerAuthToken,
  type ZookeeperManagerActor,
  ZookeeperManagerStates,
  ZookeeperManagerTransitions,
} from '@src/lib/zookeeper/zookeeperManagerMachine'
import { activeFileRelativeToProject } from '@src/lib/zookeeper/zookeeperPromptRequest'
import { zookeeperPromptRunningSignal } from '@src/lib/zookeeper/zookeeperPromptState'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import type { DebugRegistryService } from '@src/registry/contracts/debug'
import type { SystemIORegistryService } from '@src/registry/contracts/systemIO'
import { IS_STAGING_OR_DEBUG } from '@src/routes/utils'
import { NIL as uuidNIL } from 'uuid'
import type { SnapshotFrom, Subscription } from 'xstate'

export interface ZookeeperSessionControllerDependencies {
  apiToken: string
  billing: BillingRegistryService
  conversationStore?: ZookeeperConversationStore
  debug?: DebugRegistryService
  kclManager: KclManager
  project: ReadonlySignal<ZDSProject | undefined>
  projectId: string | undefined
  projectPath: string
  systemIO: SystemIORegistryService
}

export interface QueuedMessage {
  id: string
  text: string
  mode?: MlCopilotModeId
  attachments: File[]
}

export interface ZookeeperSessionController {
  readonly actor: ZookeeperManagerActor
  readonly isClearingChat: ReadonlySignal<boolean>
  readonly isResumingInterruptedTurn: ReadonlySignal<boolean>
  readonly projectId: string | undefined
  readonly projectPath: string
  readonly queue: ReadonlySignal<readonly QueuedMessage[]>
  readonly showManualConnect: ReadonlySignal<boolean>
  cancel(): void
  checkBillingAccess(): void
  clearConversation(): Promise<void>
  dispose(): Promise<void>
  reconnect(): void
  removeQueued(id: string): void
  resumeInterruptedTurn(): void
  sendOrQueue(
    prompt: string,
    mode: MlCopilotModeId | undefined,
    attachments: File[]
  ): void
  steer(id: string): void
  updateAuthToken(apiToken: string): void
}

type ZookeeperSnapshot = SnapshotFrom<ZookeeperManagerActor>

class SessionController implements ZookeeperSessionController {
  readonly actor: ZookeeperManagerActor
  readonly projectId: string | undefined
  readonly projectPath: string

  private readonly queueSignal = signal<QueuedMessage[]>([])
  readonly queue: ReadonlySignal<readonly QueuedMessage[]> = this.queueSignal

  private readonly isClearingChatSignal = signal(false)
  readonly isClearingChat: ReadonlySignal<boolean> = this.isClearingChatSignal

  private readonly isResumingInterruptedTurnSignal = signal(false)
  readonly isResumingInterruptedTurn: ReadonlySignal<boolean> =
    this.isResumingInterruptedTurnSignal

  private readonly showManualConnectSignal = signal(
    typeof navigator !== 'undefined' && navigator.onLine === false
  )
  readonly showManualConnect: ReadonlySignal<boolean> =
    this.showManualConnectSignal

  private apiToken: string
  private active = true
  private actorSubscription: Subscription | undefined
  private clearSubscription: Subscription | undefined
  private clearOperationGeneration = 0
  private continueCheckInFlight = false
  private continueCheckGeneration = 0
  private disposal: Promise<void> | undefined
  private activeSubmission: { messageId: string } | undefined
  private lastSavedConversationId: string | undefined
  private lookupLoaded = false
  private readonly persistenceOperations = new Set<Promise<void>>()
  private reconnectAfterLookup = false
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined
  private resumeInterruptedTurnPending = false
  private savedConversationId: string | undefined
  private readonly savingConversationIds = new Set<string>()
  private steeredId: string | null = null
  private stopProjectEffect: (() => void) | undefined
  private wasPromptRunning = false

  private readonly history: ZookeeperEditPatchHistory
  private readonly fileRequestProcessor: ZookeeperFileRequestProcessor

  constructor(private readonly deps: ZookeeperSessionControllerDependencies) {
    this.apiToken = deps.apiToken
    this.projectId = deps.projectId
    this.projectPath = deps.projectPath
    this.actor = createZookeeperManagerActor(deps.apiToken)
    if (IS_STAGING_OR_DEBUG) {
      deps.debug?.set('zookeeperManagerActor', this.actor)
    }
    this.history = new ZookeeperEditPatchHistory(deps.kclManager)
    this.fileRequestProcessor = new ZookeeperFileRequestProcessor({
      getProject: () => this.getProject(),
      history: this.history,
      isEditorCurrent: () => {
        const editor = this.getZdsProject()?.executingEditor.value
        return (
          editor === deps.kclManager ||
          (this.active && (editor === null || editor === undefined))
        )
      },
      isSessionCurrent: () => this.active && this.getZdsProject() !== undefined,
      kclManager: deps.kclManager,
      systemIOActor: deps.systemIO.actor,
    })

    this.actorSubscription = this.actor.subscribe((snapshot) => {
      this.handleSnapshot(snapshot)
    })

    if (typeof window !== 'undefined') {
      window.addEventListener('offline', this.handleOffline)
      window.addEventListener('online', this.handleOnline)
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.actor.send({ type: ZookeeperManagerTransitions.NetworkOffline })
    }

    this.loadConversationId()

    this.stopProjectEffect = effect(() => {
      const project = this.getZdsProject()
      const editor = project?.executingEditor.value
      const executingFilePath = project?.executingFileEntry.value.path
      const isReady =
        editor === deps.kclManager && executingFilePath === deps.kclManager.path

      if (!isReady) {
        return
      }

      untracked(() => {
        const snapshot = this.actor.getSnapshot()
        this.continueCheck(snapshot, this.resumeInterruptedTurnPending)
        this.flushQueue(snapshot)
      })
    })

    this.handleSnapshot(this.actor.getSnapshot())
  }

  updateAuthToken(apiToken: string) {
    if (!this.active || this.apiToken === apiToken) {
      return
    }
    this.apiToken = apiToken
    updateZookeeperManagerAuthToken(this.actor, apiToken)
  }

  sendOrQueue(
    prompt: string,
    mode: MlCopilotModeId | undefined,
    attachments: File[]
  ) {
    if (!this.active || this.isClearingChatSignal.peek()) {
      return
    }

    const message: QueuedMessage = {
      id: crypto.randomUUID(),
      text: prompt,
      mode,
      attachments,
    }
    this.queueSignal.value = [...this.queueSignal.peek(), message]
    this.flushQueue(this.actor.getSnapshot())
  }

  removeQueued(id: string) {
    if (this.activeSubmission?.messageId === id) {
      this.activeSubmission = undefined
    }
    if (this.steeredId === id) {
      this.steeredId = null
    }
    this.queueSignal.value = this.queueSignal
      .peek()
      .filter((message) => message.id !== id)
    this.flushQueue(this.actor.getSnapshot())
  }

  steer(id: string) {
    if (!this.active) {
      return
    }
    this.steeredId = id
    this.actor.send({ type: ZookeeperManagerTransitions.Interrupt })
  }

  cancel() {
    if (this.active) {
      this.actor.send({ type: ZookeeperManagerTransitions.Cancel })
    }
  }

  checkBillingAccess() {
    if (!this.active) {
      return
    }
    this.deps.billing.send({
      type: BillingTransition.Update,
      apiToken: this.apiToken,
    })
    this.reconnect()
  }

  reconnect = () => {
    if (!this.active || this.isClearingChatSignal.peek()) {
      return
    }

    this.showManualConnectSignal.value = false
    const snapshot = this.actor.getSnapshot()
    const actorConversationId = snapshot.context.conversationId
    const actorConversationMatchesProject =
      this.projectPath === this.getProject()?.path

    if (
      (!actorConversationMatchesProject || actorConversationId === undefined) &&
      !this.lookupLoaded
    ) {
      this.reconnectAfterLookup = true
      return
    }

    this.reconnectAfterLookup = false
    const conversationId =
      actorConversationMatchesProject && actorConversationId !== undefined
        ? actorConversationId
        : this.savedConversationId
    if (conversationId === uuidNIL) {
      return
    }

    this.actor.send({
      type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      refParentSend: this.actor.send,
      conversationId,
    })
  }

  resumeInterruptedTurn() {
    if (!this.active) {
      return
    }
    const snapshot = this.actor.getSnapshot()
    if (
      !snapshot.matches(ZookeeperManagerStates.WaitForContinueCheck) ||
      !hasBeenInterruptedOnLast(snapshot.context.conversation?.exchanges ?? [])
    ) {
      return
    }
    this.resumeInterruptedTurnPending = true
    this.isResumingInterruptedTurnSignal.value = true
    this.continueCheck(snapshot, true)
  }

  async clearConversation() {
    if (!this.active || this.isClearingChatSignal.peek()) {
      return
    }

    this.isClearingChatSignal.value = true
    this.activeSubmission = undefined
    this.continueCheckGeneration += 1
    this.continueCheckInFlight = false
    this.resumeInterruptedTurnPending = false
    this.isResumingInterruptedTurnSignal.value = false
    this.reconnectAfterLookup = false
    this.reconcileReconnect(this.actor.getSnapshot())
    const generation = ++this.clearOperationGeneration
    const isCurrentOperation = () =>
      this.active &&
      this.clearOperationGeneration === generation &&
      this.isClearingChatSignal.peek()
    const projectId = this.projectId

    try {
      if (projectId !== undefined && projectId !== uuidNIL) {
        await this.trackPersistence(
          (
            this.deps.conversationStore ?? zookeeperConversationStore
          ).deleteProjectConversationId(projectId)
        )
      }
    } catch (error: unknown) {
      if (!isCurrentOperation()) {
        return
      }
      this.isClearingChatSignal.value = false
      const snapshot = this.actor.getSnapshot()
      this.reconcileReconnect(snapshot)
      this.flushQueue(snapshot)
      trap(error instanceof Error ? error : new Error(String(error)), {
        altErr: new Error('Could not clear chat. Please try again.'),
      })
      return
    }

    if (!isCurrentOperation()) {
      return
    }

    this.steeredId = null
    this.queueSignal.value = []
    this.lookupLoaded = true
    this.savedConversationId = undefined

    let startingFreshConversation = false
    const startFreshConversation = () => {
      if (startingFreshConversation) {
        return
      }
      this.clearSubscription?.unsubscribe()
      this.clearSubscription = undefined
      if (!isCurrentOperation()) {
        return
      }
      startingFreshConversation = true
      this.history.finishPending()
      void this.fileRequestProcessor.reset().then(() => {
        if (!isCurrentOperation()) {
          return
        }
        this.history.reset()
        this.actor.send({
          type: ZookeeperManagerTransitions.CacheSetupAndConnect,
          refParentSend: this.actor.send,
          conversationId: undefined,
        })
        this.isClearingChatSignal.value = false
        this.reconcileReconnect(this.actor.getSnapshot())
      })
    }

    this.clearSubscription = this.actor.subscribe((snapshot) => {
      if (snapshot.matches(S.Await)) {
        startFreshConversation()
      }
    })
    this.actor.send({
      type: ZookeeperManagerTransitions.ConversationClose,
    })
    if (this.actor.getSnapshot().matches(S.Await)) {
      startFreshConversation()
    }
  }

  dispose() {
    if (!this.active) {
      return this.disposal ?? Promise.resolve()
    }

    this.active = false
    this.clearOperationGeneration += 1
    this.continueCheckGeneration += 1
    this.clearReconnectTimer()
    this.clearSubscription?.unsubscribe()
    this.actorSubscription?.unsubscribe()
    this.stopProjectEffect?.()
    this.resumeInterruptedTurnPending = false
    this.isResumingInterruptedTurnSignal.value = false
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', this.handleOffline)
      window.removeEventListener('online', this.handleOnline)
    }

    if (this.wasPromptRunning) {
      this.wasPromptRunning = false
      this.deps.billing.send({ type: BillingTransition.UsageEnded })
      this.deps.billing.send({
        type: BillingTransition.Update,
        apiToken: this.apiToken,
      })
    }
    zookeeperPromptRunningSignal.value = false
    if (IS_STAGING_OR_DEBUG) {
      this.deps.debug?.clear('zookeeperManagerActor', this.actor)
    }
    this.history.finishPending()
    const workerDisposal = this.fileRequestProcessor
      .dispose()
      .finally(() => this.history.dispose())
    this.disposal = Promise.allSettled([
      workerDisposal,
      ...this.persistenceOperations,
    ]).then((results) => {
      const failure = results.find((result) => result.status === 'rejected')
      if (failure?.status === 'rejected') {
        return Promise.reject(failure.reason)
      }
    })
    stopZookeeperManagerActor(this.actor)
    return this.disposal
  }

  private getZdsProject(): ZDSProject | undefined {
    const project = this.deps.project.value
    const projectRef = project?.projectIORefSignal.value
    return projectRef?.path === this.projectPath &&
      projectRef.projectId === this.projectId
      ? project
      : undefined
  }

  private getReadyZdsProject(): ZDSProject | undefined {
    const project = this.getZdsProject()
    return project?.executingEditor.value === this.deps.kclManager &&
      project.executingFileEntry.value.path === this.deps.kclManager.path
      ? project
      : undefined
  }

  private getProject(): Project | undefined {
    return this.getZdsProject()?.projectIORefSignal.value
  }

  private async process(
    prompt: string,
    mode: MlCopilotModeId | undefined,
    attachments: File[],
    isCurrent = () => true
  ): Promise<boolean | Error> {
    const zdsProject = this.getReadyZdsProject()
    if (!zdsProject) {
      return false
    }
    const project = zdsProject.projectIORefSignal.value
    const loaderFile = zdsProject.executingFileEntry.value

    const kclManager = this.deps.kclManager
    const editorCode = kclManager.code
    const editorPath = kclManager.path
    const selections = kclManager.modelingState?.context.selectionRanges ?? null
    let projectFiles: Awaited<ReturnType<typeof collectProjectFiles>>
    let wasmInstance: Awaited<KclManager['wasmInstancePromise']>
    try {
      const promptInputs = await Promise.all([
        collectProjectFiles({
          selectedFileContents: editorCode,
          selectedFilePath: editorPath,
          fileNames: kclManager.execState.filenames,
          projectContext: project,
        }),
        kclManager.wasmInstancePromise,
      ])
      projectFiles = promptInputs[0]
      wasmInstance = promptInputs[1]
    } catch (error: unknown) {
      if (
        !this.active ||
        !isCurrent() ||
        !this.isProjectEpochCurrent(
          zdsProject,
          loaderFile.path,
          editorPath,
          editorCode
        )
      ) {
        return false
      }
      return error instanceof Error ? error : new Error(String(error))
    }
    const snapshot = this.actor.getSnapshot()
    if (
      !this.active ||
      !isCurrent() ||
      !this.isProjectEpochCurrent(
        zdsProject,
        loaderFile.path,
        editorPath,
        editorCode
      ) ||
      !this.isReadyForPrompt(snapshot)
    ) {
      return false
    }

    this.actor.send({
      type: ZookeeperManagerTransitions.MessageSend,
      prompt,
      projectForPromptOutput: project,
      applicationProjectDirectory: getParentAbsolutePath(project.path),
      fileSelectedDuringPrompting: {
        entry: loaderFile,
        content: editorCode,
      },
      projectFiles,
      selections,
      artifactGraph: kclManager.artifactGraph,
      kclManager,
      engineCommandManager: kclManager.engineCommandManager,
      wasmInstance,
      mode,
      additionalFiles: attachments,
    })
    return true
  }

  private handleSnapshot(snapshot: ZookeeperSnapshot) {
    if (!this.active) {
      return
    }

    try {
      this.history.handleActorSnapshot(snapshot)
    } catch (error: unknown) {
      console.error('Failed to update Zookeeper history.', error)
    }
    try {
      this.fileRequestProcessor.handleActorSnapshot(snapshot)
    } catch (error: unknown) {
      console.error('Failed to process Zookeeper file updates.', error)
    }
    this.updateBilling(snapshot.context.awaitingResponse)
    this.saveConversationId(snapshot)
    this.continueCheck(snapshot)
    this.tryConnectWhenIdle(snapshot)
    this.reconcileReconnect(snapshot)
    this.flushQueue(snapshot)
  }

  private updateBilling(isPromptRunning: boolean) {
    zookeeperPromptRunningSignal.value = isPromptRunning
    if (isPromptRunning === this.wasPromptRunning) {
      return
    }

    this.wasPromptRunning = isPromptRunning
    if (isPromptRunning) {
      this.deps.billing.send({ type: BillingTransition.UsageStarted })
      return
    }

    this.deps.billing.send({ type: BillingTransition.UsageEnded })
    this.deps.billing.send({
      type: BillingTransition.Update,
      apiToken: this.apiToken,
    })
  }

  private saveConversationId(snapshot: ZookeeperSnapshot) {
    const projectId = this.projectId
    const conversationId = snapshot.context.conversationId
    if (
      this.isClearingChatSignal.peek() ||
      projectId === undefined ||
      projectId === uuidNIL ||
      conversationId === undefined ||
      conversationId === this.lastSavedConversationId ||
      this.savingConversationIds.has(conversationId)
    ) {
      return
    }

    this.savingConversationIds.add(conversationId)
    const operation = (
      this.deps.conversationStore ?? zookeeperConversationStore
    )
      .saveProjectConversationId({ projectId, conversationId })
      .then(() => {
        this.lastSavedConversationId = conversationId
      }, reportRejection)
      .finally(() => this.savingConversationIds.delete(conversationId))
    void this.trackPersistence(operation)
  }

  private trackPersistence<T>(operation: Promise<T>): Promise<T> {
    const completion = operation.then(
      () => undefined,
      () => undefined
    )
    this.persistenceOperations.add(completion)
    void completion.then(() => this.persistenceOperations.delete(completion))
    return operation
  }

  private loadConversationId() {
    const projectId = this.projectId
    this.lookupLoaded = false
    this.savedConversationId = undefined
    this.lastSavedConversationId =
      this.actor.getSnapshot().context.conversationId

    const finish = (conversationId: string | undefined) => {
      if (!this.active || this.lookupLoaded) {
        return
      }
      this.lookupLoaded = true
      this.savedConversationId = conversationId
      if (this.reconnectAfterLookup) {
        this.reconnect()
        return
      }
      this.tryConnectWhenIdle(this.actor.getSnapshot())
    }

    if (projectId === undefined || projectId === uuidNIL) {
      finish(undefined)
      return
    }

    const lookup = (this.deps.conversationStore ?? zookeeperConversationStore)
      .getProjectConversationId(projectId)
      .then(finish)
      .catch((error: unknown) => {
        if (!this.active || this.lookupLoaded) {
          return
        }
        reportRejection(error)
        finish(undefined)
      })
    void this.trackPersistence(lookup)
  }

  private tryConnectWhenIdle(snapshot: ZookeeperSnapshot) {
    if (
      !this.active ||
      this.isClearingChatSignal.peek() ||
      this.showManualConnectSignal.peek() ||
      !this.lookupLoaded ||
      this.projectId === uuidNIL ||
      this.savedConversationId === uuidNIL ||
      snapshot.context.cachedSetup !== undefined
    ) {
      return
    }

    const isIdle =
      snapshot.matches({
        [ZookeeperManagerStates.Ready]: {
          [ZookeeperManagerStates.Request]: S.Await,
        },
      }) || snapshot.value === S.Await
    if (
      !isIdle ||
      snapshot.context.conversation !== undefined ||
      snapshot.context.abruptlyClosed ||
      this.getProject() === undefined
    ) {
      return
    }

    this.actor.send({
      type: ZookeeperManagerTransitions.CacheSetupAndConnect,
      refParentSend: this.actor.send,
      conversationId: this.savedConversationId,
    })
  }

  private continueCheck(
    snapshot: ZookeeperSnapshot,
    resumeInterruptedTurn = false
  ) {
    if (!this.active || this.isClearingChatSignal.peek()) {
      return
    }
    if (!snapshot.matches(ZookeeperManagerStates.WaitForContinueCheck)) {
      if (this.continueCheckInFlight) {
        this.continueCheckGeneration += 1
      }
      this.continueCheckInFlight = false
      this.resumeInterruptedTurnPending = false
      this.isResumingInterruptedTurnSignal.value = false
      return
    }
    if (this.continueCheckInFlight) {
      return
    }

    const interrupted = hasBeenInterruptedOnLast(
      snapshot.context.conversation?.exchanges ?? []
    )
    if (!interrupted) {
      const project = this.getProject()
      if (!project) {
        return
      }
      this.actor.send({
        type: ZookeeperManagerStates.ContinueCheck,
        projectName: project.name,
        projectFiles: [],
      })
      return
    }
    if (!resumeInterruptedTurn) {
      return
    }

    const zdsProject = this.getReadyZdsProject()
    if (!zdsProject) {
      return
    }
    const project = zdsProject.projectIORefSignal.value
    this.continueCheckInFlight = true
    const generation = ++this.continueCheckGeneration
    const loaderFile = zdsProject.executingFileEntry.value
    const kclManager = this.deps.kclManager
    const editorCode = kclManager.code
    const editorPath = kclManager.path
    this.isResumingInterruptedTurnSignal.value = resumeInterruptedTurn
    void collectProjectFiles({
      selectedFileContents: editorCode,
      selectedFilePath: editorPath,
      fileNames: kclManager.execState.filenames,
      projectContext: project,
    })
      .then((projectFiles) => {
        if (
          !this.active ||
          this.continueCheckGeneration !== generation ||
          !this.isProjectEpochCurrent(
            zdsProject,
            loaderFile.path,
            editorPath,
            editorCode
          ) ||
          !this.actor
            .getSnapshot()
            .matches(ZookeeperManagerStates.WaitForContinueCheck)
        ) {
          return
        }
        this.resumeInterruptedTurnPending = false
        this.actor.send({
          type: ZookeeperManagerStates.ContinueCheck,
          projectName: project.name,
          projectFiles,
          engineApiCallId: kclManager.engineCommandManager.apiCallId,
          activeFile: activeFileRelativeToProject({
            currentFileEntry: loaderFile,
            applicationProjectDirectory: getParentAbsolutePath(project.path),
          }),
        })
      })
      .catch((error: unknown) => {
        if (!this.active || this.continueCheckGeneration !== generation) {
          return
        }
        if (
          !this.isProjectEpochCurrent(
            zdsProject,
            loaderFile.path,
            editorPath,
            editorCode
          )
        ) {
          return
        }
        this.resumeInterruptedTurnPending = false
        this.continueCheckInFlight = false
        reportRejection(error)
      })
      .finally(() => {
        if (this.continueCheckGeneration === generation) {
          this.continueCheckInFlight = false
          this.isResumingInterruptedTurnSignal.value = false
          if (
            this.resumeInterruptedTurnPending &&
            this.getReadyZdsProject() !== undefined
          ) {
            queueMicrotask(() => {
              this.continueCheck(this.actor.getSnapshot(), true)
            })
          }
        }
      })
  }

  private isReadyForPrompt(snapshot: ZookeeperSnapshot) {
    return (
      snapshot.matches({
        [ZookeeperManagerStates.Ready]: {
          [ZookeeperManagerStates.Request]: S.Await,
        },
      }) && !snapshot.context.awaitingResponse
    )
  }

  private isProjectEpochCurrent(
    project: ZDSProject,
    filePath: string,
    editorPath: string,
    editorCode: string
  ) {
    return (
      this.getReadyZdsProject() === project &&
      this.deps.kclManager.path === editorPath &&
      this.deps.kclManager.code === editorCode &&
      project.executingFileEntry.value.path === filePath
    )
  }

  private flushQueue(snapshot: ZookeeperSnapshot) {
    if (
      !this.active ||
      !this.isReadyForPrompt(snapshot) ||
      this.isClearingChatSignal.peek() ||
      this.activeSubmission !== undefined ||
      this.getReadyZdsProject() === undefined ||
      this.queueSignal.peek().length === 0
    ) {
      return
    }

    const queue = this.queueSignal.peek()
    const steeredIndex =
      this.steeredId === null
        ? -1
        : queue.findIndex((message) => message.id === this.steeredId)
    const nextIndex = steeredIndex === -1 ? 0 : steeredIndex
    const next = queue[nextIndex]
    const submission = {
      messageId: next.id,
    }
    this.activeSubmission = submission
    let processingFailed = false

    void this.process(
      next.text,
      next.mode,
      next.attachments,
      () =>
        this.activeSubmission === submission &&
        !this.isClearingChatSignal.peek() &&
        this.queueSignal.peek().some((message) => message.id === next.id)
    )
      .then((result) => {
        if (result instanceof Error) {
          processingFailed = true
          reportRejection(result)
          return
        }
        if (!result) {
          return
        }
        if (this.steeredId === next.id) {
          this.steeredId = null
        }
        this.queueSignal.value = this.queueSignal
          .peek()
          .filter((message) => message.id !== next.id)
      })
      .catch((error: unknown) => {
        processingFailed = true
        reportRejection(error)
      })
      .finally(() => {
        if (this.activeSubmission !== submission) {
          return
        }
        this.activeSubmission = undefined
        if (!processingFailed) {
          this.flushQueue(this.actor.getSnapshot())
        }
      })
  }

  private handleOffline = () => {
    if (!this.active) {
      return
    }
    this.reconnectAfterLookup = false
    this.showManualConnectSignal.value = true
    this.actor.send({ type: ZookeeperManagerTransitions.NetworkOffline })
  }

  private handleOnline = () => {
    if (!this.active) {
      return
    }
    this.showManualConnectSignal.value = false
    this.reconnect()
  }

  private reconcileReconnect(snapshot: ZookeeperSnapshot) {
    const shouldReconnect =
      snapshot.context.abruptlyClosed &&
      !snapshot.context.setupFailed &&
      !this.showManualConnectSignal.peek() &&
      !this.isClearingChatSignal.peek()

    if (!shouldReconnect) {
      this.clearReconnectTimer()
      return
    }
    if (this.reconnectTimer !== undefined) {
      return
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined
      this.reconnect()
    }, 3000)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer === undefined) {
      return
    }
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = undefined
  }
}

export function createZookeeperSessionController(
  dependencies: ZookeeperSessionControllerDependencies
): ZookeeperSessionController {
  return new SessionController(dependencies)
}
