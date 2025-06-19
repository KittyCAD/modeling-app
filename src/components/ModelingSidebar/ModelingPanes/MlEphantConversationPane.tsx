import { useEffect, useState } from 'react'
import { useSettings, systemIOActor } from '@src/lib/singletons'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useLoaderData } from 'react-router-dom'
import { useSelector } from '@xstate/react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { MlEphantConversation } from '@src/components/MlEphantConversation'
import {
  MlEphantManagerContext,
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
import { Prompt } from '@src/lib/prompt'
import { collectProjectFiles } from '@src/machines/systemIO/utils'

const hasMlEditableSelection = (graphSelections, codeSelections) => {
  return graphSelections.length > 0 || codeSelections.length > 0
}

const hasPromptsPending = (promptsPool: Prompt[]) => {
  return (
    promptsPool.filter((prompt) => prompt.status === 'in_progress').length > 0
  )
}

export const MlEphantConversationPane = () => {
  const settings = useSettings()
  const { context: contextModeling, theProject } = useModelingContext()
  const { file: loaderFile } = useLoaderData() as IndexLoaderData

  const [hasCheckedForMlConversations, setHasCheckedForMlConversations] =
    useState(false)

  const actor = mlEphantManagerActor.getSnapshot()
  const promptsBelongingToConversation = useSelector(
    mlEphantManagerActor,
    () => {
      return actor.context.promptsBelongingToConversation
    }
  )
  const prompts = Array.from(
    promptsBelongingToConversation
      ?.values()
      .map((promptId) => actor.context.promptsPool.get(promptId))
      .filter((x) => x !== undefined) ?? []
  )

  const onProcess = async (requestedPrompt: string) => {
    const projectFiles = await collectProjectFiles({
      selectedFileContents: codeManager.code,
      fileNames: kclManager.execState.filenames,
      projectContext: theProject,
      targetFile: loaderFile,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. TTC updates will close this gap.
    mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.PromptEditModel,
      prompt: requestedPrompt,
      projectForPromptOutput: theProject?.current,
      fileSelectedDuringPrompting: loaderFile,
      projectFiles,
      selections: contextModeling.selectionRanges,
      artifactGraph: kclManager.artifactGraph,
    })
  }

  useEffect(() => {
    const subscription = systemIOActor.subscribe((snapshot) => {
      if (snapshot.value === 'idle' && !hasCheckedForMlConversations) {
        setHasCheckedForMlConversations(true)
        systemIOActor.send({
          type: SystemIOMachineEvents.getMlEphantConversations,
        })
        return
      }

      // We can now reliably use the mlConversations data.
      // THIS IS WHERE PROJECT IDS ARE MAPPED TO CONVERSATION IDS.
      if (
        snapshot.value === 'idle' &&
        hasCheckedForMlConversations &&
        snapshot.context.promptsBelongingToConversation === undefined
      ) {
        const conversationId = snapshot.context.mlEphantConversations.get(
          settings.meta.id.project
        )

        mlEphantManagerActor.send({
          type: MlEphantManagerTransitions.GetPromptsBelongingToConversation,
          conversationId,
        })
      }
    })
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
