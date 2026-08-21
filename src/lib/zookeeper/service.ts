import { signal } from '@preact/signals-core'
import { getParentAbsolutePath } from '@src/lib/paths'
import { activeFileRelativeToProject } from '@src/lib/promptToEdit'
import { reportRejection } from '@src/lib/trap'
import {
  type MlEphantManagerActor,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
  mlEphantManagerMachine,
} from '@src/lib/zookeeper/mlEphantManagerMachine'
import type {
  ZookeeperProjectRuntime,
  ZookeeperService,
} from '@src/lib/zookeeper/registry/contract'
import type { ZookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import { zookeeperConversationStore } from '@src/lib/zookeeper/zookeeperConversationStore'
import { BillingTransition } from '@src/machines/billingMachine'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import type { BillingRegistryService } from '@src/registry/contracts/billing'
import { NIL as uuidNIL } from 'uuid'
import { createActor } from 'xstate'

type CreateZookeeperServiceArgs = {
  getApiToken: () => string
  getBilling?: () => BillingRegistryService | undefined
  conversationStore?: ZookeeperConversationStore
  actor?: MlEphantManagerActor
}

type ProjectBinding = {
  generation: number
  key: string
  runtime: ZookeeperProjectRuntime
}

const projectKey = ({
  project,
  projectId,
}: Pick<ZookeeperProjectRuntime, 'project' | 'projectId'>) =>
  `${project?.path ?? ''}\n${projectId ?? ''}`

const validProjectId = (projectId: string | undefined): projectId is string =>
  projectId !== undefined && projectId !== uuidNIL

function actorIsIdleForSetup(actor: MlEphantManagerActor) {
  const snapshot = actor.getSnapshot()
  return (
    snapshot.matches(S.Await) && snapshot.context.conversation === undefined
  )
}

export function createZookeeperService({
  getApiToken,
  getBilling = () => undefined,
  conversationStore = zookeeperConversationStore,
  actor: providedActor,
}: CreateZookeeperServiceArgs): ZookeeperService {
  const actor =
    providedActor ??
    createActor(mlEphantManagerMachine, {
      input: {
        apiToken: '',
      },
    }).start()
  const showManualConnect = signal(false)
  const isClearingChat = signal(false)

  let binding: ProjectBinding | undefined
  let nextGeneration = 0
  let savedConversationLookupGeneration: number | undefined
  let savedConversationLookupLoaded = false
  let savedConversationId: string | undefined
  let reconnectAfterSavedConversationLookup = false
  let actorConversationProjectPath: string | undefined
  let clearChatOperationGeneration = 0
  let continueCheckGeneration: number | undefined
  let lastSavedConversationId = actor.getSnapshot().context.conversationId
  let lastAwaitingResponse = actor.getSnapshot().context.awaitingResponse
  let reconnectTimeout: ReturnType<typeof setTimeout> | undefined

  const syncApiToken = () => {
    const apiToken = getApiToken()
    if (!apiToken) {
      return false
    }

    actor.send({
      type: MlEphantManagerTransitions.SetApiToken,
      apiToken,
    })
    return true
  }

  const sendCacheSetupAndConnect = (conversationId: string | undefined) => {
    if (!syncApiToken()) {
      return
    }

    actor.send({
      type: MlEphantManagerTransitions.CacheSetupAndConnect,
      refParentSend: actor.send,
      conversationId,
    })
  }

  const clearReconnectTimeout = () => {
    if (reconnectTimeout === undefined) {
      return
    }

    clearTimeout(reconnectTimeout)
    reconnectTimeout = undefined
  }

  const currentRuntime = () => binding?.runtime

  const tryToGetExchanges = () => {
    if (isClearingChat.value) {
      return
    }

    const currentBinding = binding
    const runtime = currentBinding?.runtime
    if (!currentBinding || !runtime?.project) {
      return
    }

    if (
      !savedConversationLookupLoaded ||
      savedConversationLookupGeneration !== currentBinding.generation
    ) {
      return
    }

    if (runtime.projectId === uuidNIL || savedConversationId === uuidNIL) {
      return
    }

    if (actor.getSnapshot().context.abruptlyClosed) {
      return
    }

    actorConversationProjectPath = runtime.project.path
    sendCacheSetupAndConnect(savedConversationId)
  }

  const reconnect = () => {
    if (isClearingChat.value) {
      return
    }

    const currentBinding = binding
    const runtime = currentBinding?.runtime
    const currentProjectPath = runtime?.project?.path
    if (!currentBinding || !currentProjectPath) {
      return
    }

    const actorConversationId = actor.getSnapshot().context.conversationId
    const actorConversationMatchesCurrentProject =
      actorConversationProjectPath === currentProjectPath
    const savedProjectConversationLookupIsCurrent =
      savedConversationLookupGeneration === currentBinding.generation &&
      savedConversationLookupLoaded

    if (
      (!actorConversationMatchesCurrentProject ||
        actorConversationId === undefined) &&
      !savedProjectConversationLookupIsCurrent
    ) {
      reconnectAfterSavedConversationLookup = true
      return
    }

    reconnectAfterSavedConversationLookup = false
    actorConversationProjectPath = currentProjectPath
    sendCacheSetupAndConnect(
      actorConversationMatchesCurrentProject &&
        actorConversationId !== undefined
        ? actorConversationId
        : savedConversationId
    )
  }

  const continueAfterSavedConversationLookup = () => {
    if (reconnectAfterSavedConversationLookup) {
      reconnect()
      return
    }

    tryToGetExchanges()
  }

  const loadSavedConversationId = (currentBinding: ProjectBinding) => {
    const { projectId } = currentBinding.runtime
    savedConversationLookupGeneration = currentBinding.generation
    savedConversationLookupLoaded = false
    savedConversationId = undefined

    if (projectId === undefined) {
      savedConversationLookupLoaded = true
      continueAfterSavedConversationLookup()
      return
    }

    if (projectId === uuidNIL) {
      savedConversationLookupLoaded = true
      continueAfterSavedConversationLookup()
      return
    }

    void conversationStore
      .getProjectConversationId(projectId)
      .then((conversationId) => {
        if (
          binding?.generation !== currentBinding.generation ||
          savedConversationLookupLoaded
        ) {
          return
        }

        savedConversationLookupLoaded = true
        savedConversationId = conversationId
        continueAfterSavedConversationLookup()
      })
      .catch((error: unknown) => {
        if (
          binding?.generation !== currentBinding.generation ||
          savedConversationLookupLoaded
        ) {
          return
        }

        savedConversationLookupLoaded = true
        savedConversationId = undefined
        reportRejection(error)
        continueAfterSavedConversationLookup()
      })
  }

  const maybeSendContinueCheck = (
    snapshot: ReturnType<MlEphantManagerActor['getSnapshot']>
  ) => {
    if (!snapshot.matches(MlEphantManagerStates.WaitForContinueCheck)) {
      continueCheckGeneration = undefined
      return
    }

    const currentBinding = binding
    const runtime = currentBinding?.runtime
    const project = runtime?.project
    if (!currentBinding || !project) {
      return
    }

    if (continueCheckGeneration === currentBinding.generation) {
      return
    }

    continueCheckGeneration = currentBinding.generation
    const currentLoaderFile = runtime.loaderFile
    void collectProjectFiles({
      selectedFileContents: runtime.kclManager.code,
      selectedFilePath: runtime.kclManager.path,
      fileNames: runtime.kclManager.execState.filenames,
      projectContext: project,
    })
      .then((projectFiles) => {
        if (binding?.generation !== currentBinding.generation) {
          return
        }

        actor.send({
          type: MlEphantManagerStates.ContinueCheck,
          projectName: project.name,
          projectFiles,
          activeFile: currentLoaderFile
            ? activeFileRelativeToProject({
                currentFileEntry: currentLoaderFile,
                applicationProjectDirectory: getParentAbsolutePath(
                  project.path
                ),
              })
            : undefined,
        })
      })
      .catch(reportRejection)
  }

  const saveProjectConversationId = (
    snapshot: ReturnType<MlEphantManagerActor['getSnapshot']>
  ) => {
    const conversationId = snapshot.context.conversationId
    if (conversationId === undefined) {
      return
    }

    if (lastSavedConversationId === conversationId) {
      return
    }

    const runtime = currentRuntime()
    const projectId = runtime?.projectId
    if (!runtime?.project || !validProjectId(projectId)) {
      return
    }

    if (actorConversationProjectPath !== runtime.project.path) {
      return
    }

    lastSavedConversationId = conversationId

    void conversationStore
      .saveProjectConversationId({
        projectId,
        conversationId,
      })
      .catch(reportRejection)
  }

  const syncBillingUsage = (
    snapshot: ReturnType<MlEphantManagerActor['getSnapshot']>
  ) => {
    const isAwaitingResponse = snapshot.context.awaitingResponse
    if (isAwaitingResponse === lastAwaitingResponse) {
      return
    }

    lastAwaitingResponse = isAwaitingResponse
    const billing = getBilling()
    if (billing === undefined) {
      return
    }

    if (isAwaitingResponse) {
      billing.send({
        type: BillingTransition.UsageStarted,
      })
      return
    }

    billing.send({
      type: BillingTransition.UsageEnded,
    })
    billing.send({
      type: BillingTransition.Update,
      apiToken: getApiToken(),
    })
  }

  const scheduleReconnectIfNeeded = () => {
    const snapshot = actor.getSnapshot()
    const shouldReconnect =
      snapshot.context.abruptlyClosed &&
      !showManualConnect.value &&
      !isClearingChat.value &&
      binding?.runtime.project !== undefined

    if (!shouldReconnect) {
      clearReconnectTimeout()
      return
    }

    if (reconnectTimeout !== undefined) {
      return
    }

    reconnectTimeout = setTimeout(() => {
      reconnectTimeout = undefined
      reconnect()
    }, 3000)
  }

  const actorSubscription = actor.subscribe((snapshot) => {
    syncBillingUsage(snapshot)
    saveProjectConversationId(snapshot)
    maybeSendContinueCheck(snapshot)

    const isProcessing =
      (snapshot.matches({
        [MlEphantManagerStates.Ready]: {
          [MlEphantManagerStates.Request]: S.Await,
        },
      }) || snapshot.value === S.Await) === false

    if (
      !isProcessing &&
      snapshot.context.conversation === undefined &&
      actorIsIdleForSetup(actor)
    ) {
      tryToGetExchanges()
    }

    scheduleReconnectIfNeeded()
  })

  const bindProject = (runtime: ZookeeperProjectRuntime) => {
    const key = projectKey(runtime)
    if (binding?.key === key) {
      binding = {
        ...binding,
        runtime,
      }
      maybeSendContinueCheck(actor.getSnapshot())
      return
    }

    clearChatOperationGeneration += 1
    isClearingChat.value = false
    reconnectAfterSavedConversationLookup = false
    actorConversationProjectPath = undefined
    continueCheckGeneration = undefined
    savedConversationLookupLoaded = false
    savedConversationId = undefined
    clearReconnectTimeout()

    binding = {
      generation: nextGeneration + 1,
      key,
      runtime,
    }
    nextGeneration = binding.generation

    actor.send({
      type: MlEphantManagerTransitions.ConversationClose,
    })

    if (!runtime.project) {
      return
    }

    loadSavedConversationId(binding)
  }

  const clearProject = () => {
    clearChatOperationGeneration += 1
    isClearingChat.value = false
    reconnectAfterSavedConversationLookup = false
    actorConversationProjectPath = undefined
    continueCheckGeneration = undefined
    savedConversationLookupLoaded = false
    savedConversationId = undefined
    binding = undefined
    clearReconnectTimeout()
    actor.send({
      type: MlEphantManagerTransitions.ConversationClose,
    })
  }

  const clearChat = async () => {
    if (isClearingChat.value) {
      return
    }

    const currentBinding = binding
    const runtime = currentBinding?.runtime
    if (!currentBinding || !runtime?.project) {
      return
    }

    isClearingChat.value = true
    reconnectAfterSavedConversationLookup = false
    const clearOperationGeneration = clearChatOperationGeneration + 1
    clearChatOperationGeneration = clearOperationGeneration
    const isCurrentClearOperation = () =>
      clearChatOperationGeneration === clearOperationGeneration &&
      binding?.generation === currentBinding.generation

    try {
      const projectId = runtime.projectId
      if (validProjectId(projectId)) {
        await conversationStore.deleteProjectConversationId(projectId)
      }
    } catch (error: unknown) {
      if (!isCurrentClearOperation()) {
        return
      }

      isClearingChat.value = false
      reportRejection(error)
      return
    }

    if (!isCurrentClearOperation()) {
      return
    }

    savedConversationLookupGeneration = currentBinding.generation
    savedConversationLookupLoaded = true
    savedConversationId = undefined

    let sub: ReturnType<typeof actor.subscribe> | undefined
    const startFreshConversation = () => {
      sub?.unsubscribe()
      if (!isCurrentClearOperation() || !isClearingChat.value) {
        return
      }

      actorConversationProjectPath = runtime.project?.path
      sendCacheSetupAndConnect(undefined)
      isClearingChat.value = false
    }

    sub = actor.subscribe((next) => {
      if (next.matches(S.Await)) {
        startFreshConversation()
      }
    })
    actor.send({
      type: MlEphantManagerTransitions.ConversationClose,
    })

    if (actor.getSnapshot().matches(S.Await)) {
      startFreshConversation()
    }
  }

  const service: ZookeeperService = {
    actor,
    showManualConnect,
    isClearingChat,
    bindProject,
    clearProject,
    reconnect,
    handleNetworkOffline: () => {
      reconnectAfterSavedConversationLookup = false
      showManualConnect.value = true
      clearReconnectTimeout()
      actor.send({
        type: MlEphantManagerTransitions.AbruptClose,
        closeReason: 'Browser is offline.',
      })
    },
    handleNetworkOnline: () => {
      showManualConnect.value = false
      reconnect()
    },
    clearChat,
    dispose: () => {
      clearReconnectTimeout()
      actorSubscription.unsubscribe()
      actor.stop()
    },
  }

  return service
}
