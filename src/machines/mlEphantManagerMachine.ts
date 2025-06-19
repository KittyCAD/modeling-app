import type { Prompt } from '@src/lib/prompt'

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
  promptsThatCreatedProjects: Map<Prompt>
  // If no project is selected: undefined.
  promptsBelongingToProject?: Map<Prompt>
}

export const mlEphantDefaultContext = Object.freeze({
  promptsThatCreatedProjects: new Map(),
  promptsBelongingToProject: undefined,
  hasPendingPrompts: false,
})

const machine = setup({
  types: {
    context: {} as MlEphantManagerContext,
    events: {} as MlEphantManagerEvents,
  },
}).createMachine({
  initial: MlEphantManagerStates.Idle,
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
            input: (args) => args,
            src: fromPromise(async function (args) {
              console.log(arguments)
              return {
                promptsThatCreatedProjects: new Array(13)
                  .fill(undefined)
                  .map(generateFakeSubmittedPrompt),
              }
            }),
            onDone: { target: MlEphantManagerStates.Idle },
            onError: { target: MlEphantManagerStates.Idle },
          },
        },
      },
    },
  },
})
