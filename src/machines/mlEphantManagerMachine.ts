import { setup, fromPromise } from 'xstate'
import type { Prompt } from '@src/lib/prompt'
import { generateFakeSubmittedPrompt } from '@src/lib/prompt'

export enum MlEphantManagerTransitionStates {
  GetPromptsThatCreatedProjects = 'get-prompts-that-created-projects',
  GetPromptsBelongingToProject = 'get-prompts-belonging-to-project',
  PromptEditModel = 'prompt-edit-model',
  PromptCreateModel = 'prompt-create-model',
  PromptRate = 'prompt-rate',
  // Note, technically hiding.
  PromptDelete = 'prompt-delete',
  PromptPollStatus = 'prompt-poll-status',
}

export type MlEphantManagerEvents =
  | {
      type: MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects
    }
  | {
      type: MlEphantManagerTransitionStates.GetPromptsBelongingToProject
      projectId: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptCreateModel
      // May or may not belong to a project.
      projectId?: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptEditModel
      projectId: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptRate
      promptId: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptDelete
      promptId: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptPollStatus
      promptId: string
    }

export enum MlEphantManagerStates {
  Idle = 'idle',
  Pending = 'pending',
}

export interface MlEphantManagerContext {
  promptsThatCreatedProjects: Map<Prompt['id'], Prompt>
  // If no project is selected: undefined.
  promptsBelongingToProject?: Map<Prompt['id'], Prompt>
}

export const mlEphantDefaultContext = Object.freeze({
  promptsThatCreatedProjects: new Map(),
  promptsBelongingToProject: undefined,
  hasPendingPrompts: false,
})

export const mlEphantManagerMachine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
  actors: {
    [MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects]:
      fromPromise(async function (args) {
        console.log(arguments)
        return {
          promptsThatCreatedProjects: new Array(13)
            .fill(undefined)
            .map(generateFakeSubmittedPrompt),
        }
      }),
  },
}).createMachine({
  initial: MlEphantManagerStates.Idle,
  context: mlEphantDefaultContext,
  states: {
    [MlEphantManagerStates.Idle]: {
      on: {
        [MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects]: {
          target: MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects,
        },
      },
    },
    [MlEphantManagerStates.Pending]: {
      states: {
        [MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects]: {
          invoke: {
            input: (args: any) => args,
            src: MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects,
            onDone: { target: MlEphantManagerStates.Idle },
            onError: { target: MlEphantManagerStates.Idle },
          },
        },
      },
    },
  },
})
