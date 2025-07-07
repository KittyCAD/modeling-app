import { useSelector } from '@xstate/react'
import { useModelingContext } from '@src/hooks/useModelingContext'
import { MlEphantConversation } from '@src/components/MlEphantConversation'
import {
  MlEphantManagerContext,
  MlEphantManagerStates,
} from '@src/machines/mlEphantManagerMachine'
import { Prompt } from '@src/lib/prompt'

const hasMlEditableSelection = (graphSelections) => {
  return graphSelections.length > 0
}

const hasPromptsPending = (promptsPool: Prompt[]) => {
  return (
    promptsPool.filter((prompt) => prompt.status === 'in_progress').length > 0
  )
}

export const MlEphantConversationPane = () => {
  const { context } = useModelingContext()

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

  return (
    <MlEphantConversation
      prompts={prompts}
      hasSelection={hasMlEditableSelection(
        context.selectionRanges.graphSelections
      )}
      disabled={hasPromptsPending(prompts)}
    />
  )
}
