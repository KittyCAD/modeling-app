import { connectReasoningStream } from '@src/lib/reasoningWs'
import { reportRejection } from '@src/lib/trap'
import { NIL as uuidNIL } from 'uuid'
import { type settings } from '@src/lib/settings/initialSettings'
import type CodeManager from '@src/lang/codeManager'
import type { KclManager } from '@src/lang/KclSingleton'
import type { SystemIOActor } from '@src/lib/singletons'
import { useEffect } from 'react'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useSelector } from '@xstate/react'
import { MlEphantConversation } from '@src/components/MlEphantConversation'
import type {
  MlEphantManagerActor,
  Thought,
} from '@src/machines/mlEphantManagerMachine'
import {
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import type { Prompt } from '@src/lib/prompt'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { S } from '@src/machines/utils'
import type { ModelingMachineContext } from '@src/machines/modelingMachine'
import type { FileEntry, Project } from '@src/lib/project'
import type { Models } from '@kittycad/lib'

const hasPromptsPending = (promptsPool: Prompt[]) => {
  return (
    promptsPool.filter((prompt) => prompt.status === 'in_progress').length > 0
  )
}

export const MlEphantConversationPane = (props: {
  mlEphantManagerActor: MlEphantManagerActor
  systemIOActor: SystemIOActor
  kclManager: KclManager
  codeManager: CodeManager
  theProject: Project | undefined
  contextModeling: ModelingMachineContext
  loaderFile: FileEntry | undefined
  settings: typeof settings
  user?: Models['User_type']
}) => {
  const mlEphantManagerActorSnapshot = props.mlEphantManagerActor.getSnapshot()
  const promptsBelongingToConversation = useSelector(
    props.mlEphantManagerActor,
    () => {
      return mlEphantManagerActorSnapshot.context.promptsBelongingToConversation
    }
  )
  const prompts = Array.from(
    promptsBelongingToConversation
      ?.map((promptId) =>
        mlEphantManagerActorSnapshot.context.promptsPool.get(promptId)
      )
      .filter((x) => x !== undefined) ?? []
  )

  const promptsMeta = useSelector(props.mlEphantManagerActor, () => {
    return mlEphantManagerActorSnapshot.context.promptsMeta
  })

  const onProcess = async (requestedPrompt: string) => {
    if (props.theProject === undefined) {
      console.warn('theProject is `undefined` - should not be possible')
      return
    }

    const projectFiles = await collectProjectFiles({
      selectedFileContents: props.codeManager.code,
      fileNames: props.kclManager.execState.filenames,
      projectContext: props.theProject,
      targetFile: props.loaderFile,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. Improvements to the TTC service
    // will close this gap in performance.
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.PromptEditModel,
      prompt: requestedPrompt,
      projectForPromptOutput: props.theProject,
      fileSelectedDuringPrompting: props.loaderFile,
      projectFiles,
      selections: props.contextModeling.selectionRanges,
      artifactGraph: props.kclManager.artifactGraph,
    })
  }

  const onSeeMoreHistory = (nextPage?: string) => {
    if (!nextPage) return

    const conversationId = props.systemIOActor
      .getSnapshot()
      .context.mlEphantConversations?.get(props.settings.meta.id.current)

    if (conversationId === undefined || conversationId === uuidNIL) {
      console.warn('Unexpected conversationId is undefined!')
    }

    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.GetPromptsBelongingToConversation,
      conversationId,
      nextPage:
        mlEphantManagerActorSnapshot.context
          .pageTokenPromptsBelongingToConversation,
    })
  }

  const onFeedback = (id: Prompt['id'], feedback: Prompt['feedback']) => {
    props.mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.PromptFeedback,
      promptId: id,
      feedback,
    })
  }

  const isProcessing =
    mlEphantManagerActorSnapshot.matches({
      [MlEphantManagerStates.Ready]: {
        [MlEphantManagerStates.Foreground]: S.Await,
      },
    }) === false

  const tryToGetPrompts = () => {
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
      props.mlEphantManagerActor.getSnapshot().context
        .promptsBelongingToConversation === undefined
    ) {
      props.mlEphantManagerActor.send({
        type: MlEphantManagerTransitions.GetPromptsBelongingToConversation,
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

        tryToGetPrompts()
      }
    )

    const subscriptionMlEphantManagerActor =
      props.mlEphantManagerActor.subscribe((mlEphantManagerActorSnapshot2) => {
        const isProcessing =
          mlEphantManagerActorSnapshot2.matches({
            [MlEphantManagerStates.Ready]: {
              [MlEphantManagerStates.Foreground]: S.Await,
            },
          }) === false

        if (isProcessing) {
          return
        }

        tryToGetPrompts()
      })

    props.systemIOActor.send({
      type: SystemIOMachineEvents.getMlEphantConversations,
    })

    tryToGetPrompts()

    return () => {
      subscriptionSystemIOActor.unsubscribe()
      subscriptionMlEphantManagerActor.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [props.settings.meta.id.current])

  // If a prompt was just created or iterated, let's connect to the websocket,
  // watch its reasoning, and store the thoughts in the mlephant actor for
  // passing to components to render.
  useEffect(() => {
    let promptIdLastSeen = ''
    const subscription = props.mlEphantManagerActor.subscribe((next) => {
      if (next.context.conversationId === undefined) {
        return
      }

      if (next.context.promptsBelongingToConversation === undefined) {
        return
      }

      const promptIdLastAdded =
        next.context.promptsBelongingToConversation[
          next.context.promptsBelongingToConversation.length - 1
        ]

      if (promptIdLastSeen === '') {
        promptIdLastSeen = promptIdLastAdded
        return
      }

      if (promptIdLastSeen === promptIdLastAdded) {
        return
      }

      promptIdLastSeen = promptIdLastAdded

      if (next.context.apiTokenMlephant === undefined) {
        console.warn('apiTokenMlephant is unexpectedly undefined')
        return
      }

      connectReasoningStream(next.context.apiTokenMlephant, promptIdLastAdded, {
        on: {
          message(msg: any) {
            if (!msg) return

            if ((msg as Thought).reasoning) {
              props.mlEphantManagerActor.send({
                type: MlEphantManagerTransitions.AppendThoughtForPrompt,
                promptId: promptIdLastAdded,
                thought: msg,
              })
            }
          },
        },
      })
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  return (
    <MlEphantConversation
      isLoading={promptsBelongingToConversation === undefined || isProcessing}
      prompts={prompts}
      promptsMeta={promptsMeta}
      onProcess={(requestedPrompt: string) => {
        onProcess(requestedPrompt).catch(reportRejection)
      }}
      onFeedback={onFeedback}
      disabled={hasPromptsPending(prompts) || isProcessing}
      hasPromptCompleted={
        mlEphantManagerActorSnapshot.context.promptsInProgressToCompleted.size >
        0
      }
      nextPage={
        mlEphantManagerActorSnapshot.context
          .pageTokenPromptsBelongingToConversation
      }
      onSeeMoreHistory={onSeeMoreHistory}
      userAvatarSrc={props.user?.image}
    />
  )
}
