import { reportRejection } from '@src/lib/trap'
import { NIL as uuidNIL } from 'uuid'
import type { settings } from '@src/lib/settings/initialSettings'
import type CodeManager from '@src/lang/codeManager'
import type { KclManager } from '@src/lang/KclSingleton'
import type { SystemIOActor } from '@src/lib/singletons'
import { useEffect, useState } from 'react'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { MlEphantConversation2 } from '@src/components/MlEphantConversation2'
import type { MlEphantManagerActor2 } from '@src/machines/mlEphantManagerMachine2'
import {
  MlEphantManagerStates2,
  MlEphantManagerTransitions2,
} from '@src/machines/mlEphantManagerMachine2'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import type { ModelingMachineContext } from '@src/machines/modelingSharedTypes'
import type { FileEntry, Project } from '@src/lib/project'
import type { BillingActor } from '@src/machines/billingMachine'
import { useSelector } from '@xstate/react'
import type { User, MlCopilotServerMessage, MlCopilotMode } from '@kittycad/lib'
import { useSearchParams } from 'react-router-dom'
import { SEARCH_PARAM_ML_PROMPT_KEY } from '@src/lib/constants'
import { type useModelingContext } from '@src/hooks/useModelingContext'

export const MlEphantConversationPane2 = (props: {
  mlEphantManagerActor: MlEphantManagerActor2
  billingActor: BillingActor
  systemIOActor: SystemIOActor
  kclManager: KclManager
  codeManager: CodeManager
  theProject: Project | undefined
  contextModeling: ModelingMachineContext
  sendModeling: ReturnType<typeof useModelingContext>['send']
  loaderFile: FileEntry | undefined
  settings: typeof settings
  user?: User
}) => {
  const [defaultPrompt, setDefaultPrompt] = useState('')
  const [searchParams, setSearchParams] = useSearchParams()

  let conversation = useSelector(props.mlEphantManagerActor, (actor) => {
    return actor.context.conversation
  })

  if (props.mlEphantManagerActor.getSnapshot().matches(S.Await)) {
    conversation = undefined
  }

  const abruptlyClosed = useSelector(props.mlEphantManagerActor, (actor) => {
    return actor.context.abruptlyClosed
  })

  const billingContext = useSelector(props.billingActor, (actor) => {
    return actor.context
  })

  const onProcess = async (request: string, mode: MlCopilotMode) => {
    if (props.theProject === undefined) {
      console.warn('theProject is `undefined` - should not be possible')
      return
    }
    if (props.loaderFile === undefined) {
      console.warn('loaderFile is `undefined` - should not be possible')
      return
    }

    let project: Project = props.theProject

    if (!window.electron) {
      // If there is no project, we'll create a fake one. Expectation is for
      // this to only happen on web.
      project = {
        metadata: null,
        kcl_file_count: 1,
        directory_count: 0,
        default_file: '/main.kcl',
        path: '/' + props.settings.meta.id.current,
        name: props.settings.meta.id.current,
        children: [
          {
            name: 'main.kcl',
            path: `/main.kcl`,
            children: null,
          },
        ],
        readWriteAccess: true,
      }
    }

    const projectFiles = await collectProjectFiles({
      selectedFileContents: props.codeManager.code,
      fileNames: props.kclManager.execState.filenames,
      projectContext: project,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. Improvements to the TTC service
    // will close this gap in performance.
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions2.MessageSend,
      prompt: request,
      projectForPromptOutput: project,
      applicationProjectDirectory: props.settings.app.projectDirectory.current,
      fileSelectedDuringPrompting: {
        entry: props.loaderFile,
        content: props.codeManager.code,
      },
      projectFiles,
      selections: props.contextModeling.selectionRanges,
      artifactGraph: props.kclManager.artifactGraph,
      mode,
    })

    // Clear selections since new model
    props.sendModeling({
      type: 'Set selection',
      data: { selection: undefined, selectionType: 'singleCodeCursor' },
    })
  }

  const lastExchange = conversation?.exchanges.slice(-1) ?? []

  const isProcessing = lastExchange[0]
    ? lastExchange[0].responses.some(
        (x: MlCopilotServerMessage) => 'end_of_stream' in x || 'error' in x
      ) === false
    : false

  const needsReconnect = abruptlyClosed

  const onReconnect = () => {
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions2.CacheSetupAndConnect,
      refParentSend: props.mlEphantManagerActor.send,
    })
  }

  const onClickClearChat = () => {
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions2.ConversationClose,
    })
    const sub = props.mlEphantManagerActor.subscribe((next) => {
      if (!next.matches(S.Await)) {
        return
      }

      props.mlEphantManagerActor.send({
        type: MlEphantManagerTransitions2.CacheSetupAndConnect,
        refParentSend: props.mlEphantManagerActor.send,
        conversationId: undefined,
      })
      sub.unsubscribe()
    })
  }

  const tryToGetExchanges = () => {
    const mlEphantConversations =
      props.systemIOActor.getSnapshot().context.mlEphantConversations

    // Not ready yet.
    if (mlEphantConversations === undefined) {
      return
    }
    if (props.settings.meta.id.current === uuidNIL) {
      return
    }

    const conversationId = mlEphantConversations.get(
      props.settings.meta.id.current
    )

    if (conversationId === uuidNIL) {
      return
    }

    // We can now reliably use the mlConversations data.
    // THIS IS WHERE PROJECT IDS ARE MAPPED TO CONVERSATION IDS.
    if (
      props.theProject !== undefined &&
      props.mlEphantManagerActor.getSnapshot().context.abruptlyClosed === false
    ) {
      props.mlEphantManagerActor.send({
        type: MlEphantManagerTransitions2.CacheSetupAndConnect,
        refParentSend: props.mlEphantManagerActor.send,
        conversationId,
      })
    }
  }

  useEffect(() => {
    const subscriptionSystemIOActor = props.systemIOActor.subscribe(
      (systemIOActorSnapshot) => {
        if (systemIOActorSnapshot.value !== 'idle') {
          return
        }
        if (props.settings.meta.id.current === uuidNIL) {
          return
        }
        if (systemIOActorSnapshot.context.mlEphantConversations === undefined) {
          props.systemIOActor.send({
            type: SystemIOMachineEvents.getMlEphantConversations,
          })
          return
        }

        const { context } = props.mlEphantManagerActor.getSnapshot()

        if (context.conversation !== undefined) {
          return
        }

        tryToGetExchanges()
      }
    )

    const subscriptionMlEphantManagerActor =
      props.mlEphantManagerActor.subscribe((mlEphantManagerActorSnapshot2) => {
        const isProcessing =
          (mlEphantManagerActorSnapshot2.matches({
            [MlEphantManagerStates2.Ready]: {
              [MlEphantManagerStates2.Request]: S.Await,
            },
          }) || mlEphantManagerActorSnapshot2.value === S.Await) === false

        const { context } = mlEphantManagerActorSnapshot2

        if (isProcessing) {
          return
        }

        if (context.conversation !== undefined) {
          return
        }

        tryToGetExchanges()
      })

    props.systemIOActor.send({
      type: SystemIOMachineEvents.getMlEphantConversations,
    })

    tryToGetExchanges()

    return () => {
      subscriptionSystemIOActor.unsubscribe()
      subscriptionMlEphantManagerActor.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.meta.id.current])

  // We watch the URL for a query parameter to set the defaultPrompt
  // for the conversation.
  useEffect(() => {
    const ttcPromptParam = searchParams.get(SEARCH_PARAM_ML_PROMPT_KEY)
    if (ttcPromptParam) {
      setDefaultPrompt(ttcPromptParam)

      // Now clear that param
      const newSearchParams = new URLSearchParams(searchParams)
      newSearchParams.delete(SEARCH_PARAM_ML_PROMPT_KEY)
      setSearchParams(newSearchParams, { replace: true })
    }
  }, [searchParams, setSearchParams])

  return (
    <MlEphantConversation2
      isLoading={conversation === undefined}
      contexts={[
        { type: 'selections', data: props.contextModeling.selectionRanges },
      ]}
      conversation={conversation}
      billingContext={billingContext}
      onProcess={(request: string, mode: MlCopilotMode) => {
        onProcess(request, mode).catch(reportRejection)
      }}
      onClickClearChat={onClickClearChat}
      onReconnect={onReconnect}
      disabled={isProcessing || needsReconnect}
      needsReconnect={needsReconnect}
      hasPromptCompleted={isProcessing}
      userAvatarSrc={props.user?.image}
      defaultPrompt={defaultPrompt}
    />
  )
}
