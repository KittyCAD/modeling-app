import { useLoaderData } from 'react-router-dom'
import { useFileContext } from '@src/hooks/useFileContext'
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
  const { context: contextModeling } = useModelingContext()
  const { context: contextFile } = useFileContext()
  const { file: loaderFile } = useLoaderData() as IndexLoaderData

  const actor = mlEphantManagerActor.getSnapshot()
  const promptsBelongingToProject = useSelector(mlEphantManagerActor, () => {
    return actor.context.promptsBelongingToProject
  })
  const prompts = Array.from(
    promptsBelongingToProject
      ?.values()
      .map((promptId) => actor.context.promptsPool.get(promptId))
      .filter((x) => x !== undefined) ?? []
  )

  const onProcess = async (requestedPrompt: string) => {
    const projectFiles = await collectProjectFiles({
      selectedFileContents: codeManager.code,
      fileNames: kclManager.execState.filenames,
      projectContext: contextFile,
      targetFile: loaderFile,
    })

    // Only on initial project creation do we call the create endpoint, which
    // has more data for initial creations. TTC updates will close this gap.
    mlEphantManagerActor.send({
      type: MlEphantManagerTransitions.PromptEditModel,
      prompt: requestedPrompt,
      projectForPromptOutput: contextFile?.project,
      fileSelectedDuringPrompting: loaderFile,
      projectFiles,
      selections: contextModeling.selectionRanges,
      artifactGraph: kclManager.artifactGraph,
    })
  }

  return (
    <MlEphantConversation
      prompts={prompts}
      onProcess={onProcess}
      disabled={hasPromptsPending(prompts)}
    />
  )
}
