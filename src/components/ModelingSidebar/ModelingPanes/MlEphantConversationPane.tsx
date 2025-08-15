import { type settings } from '@src/lib/settings/initialSettings'
import type CodeManager from '@src/lang/codeManager'
import type { KclManager } from '@src/lang/KclSingleton'
import type { IndexLoaderData } from '@src/lib/types'
import type { SystemIOActor } from '@src/lib/singletons'
import { useEffect, useState } from 'react'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useLoaderData } from 'react-router-dom'
import { useSelector } from '@xstate/react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { MlEphantConversation } from '@src/components/MlEphantConversation'
import type { MlEphantManagerActor } from '@src/machines/mlEphantManagerMachine'
import {
  MlEphantManagerContext,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import { Prompt } from '@src/lib/prompt'
import { collectProjectFiles } from '@src/machines/systemIO/utils'
import { ModelingMachineContext } from '@src/machines/modelingMachine'
import type { FileEntry, Project } from '@src/lib/project'
import type { Selections } from '@src/lib/selections'

const hasMlEditableSelection = (
  graphSelections: Selections['graphSelections'],
  codeSelections: Selections['otherSelections']
) => {
  return graphSelections.length > 0 || codeSelections.length > 0
}

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
}) => {
  const [hasCheckedForMlConversations, setHasCheckedForMlConversations] =
    useState(false)

  const mlEphantManagerActorSnapshot = props.mlEphantManagerActor.getSnapshot()
  const promptsBelongingToConversation = useSelector(
    props.mlEphantManagerActor,
    () => {
      return mlEphantManagerActorSnapshot.context.promptsBelongingToConversation
    }
  )
  const prompts = Array.from(
    promptsBelongingToConversation
      ?.values()
      .map((promptId) =>
        mlEphantManagerActorSnapshot.context.promptsPool.get(promptId)
      )
      .filter((x) => x !== undefined) ?? []
  )

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

  useEffect(() => {
    const subscription = props.systemIOActor.subscribe(
      (systemIOActorSnapshot) => {
        if (
          systemIOActorSnapshot.value === 'idle' &&
          !hasCheckedForMlConversations
        ) {
          setHasCheckedForMlConversations(true)
          props.systemIOActor.send({
            type: SystemIOMachineEvents.getMlEphantConversations,
          })
          return
        }

        // We can now reliably use the mlConversations data.
        // THIS IS WHERE PROJECT IDS ARE MAPPED TO CONVERSATION IDS.
        if (
          systemIOActorSnapshot.value === 'idle' &&
          hasCheckedForMlConversations &&
          mlEphantManagerActorSnapshot.context
            .promptsBelongingToConversation === undefined
        ) {
          const conversationId =
            systemIOActorSnapshot.context.mlEphantConversations.get(
              props.settings.meta.id.current
            )

          props.mlEphantManagerActor.send({
            type: MlEphantManagerTransitions.GetPromptsBelongingToConversation,
            conversationId,
          })
        }
      }
    )
    return () => {
      subscription.unsubscribe()
    }
  }, [hasCheckedForMlConversations])

  return (
    <MlEphantConversation
      isLoading={promptsBelongingToConversation === undefined}
      prompts={prompts}
      onProcess={onProcess}
      disabled={hasPromptsPending(prompts)}
    />
  )
}
