import { assign, setup, fromPromise } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { Prompt } from '@src/lib/prompt'
import { generateFakeSubmittedPrompt } from '@src/lib/prompt'

export enum MlEphantManagerStates {
  Setup = 'setup',
  Idle = 'idle',
  Pending = 'pending',
}

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
      // For now we fake this, using project_name.
      projectId: string
      prompt: string
    }
  | {
      type: MlEphantManagerTransitionStates.PromptEditModel
      projectId: string
      prompt: string
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

// Used to specify a specific event in input properties
type XSEvent<T> = Extract<MlEphantManagerEvents, { type: T }>

export interface MlEphantManagerContext {
  promptsThatCreatedProjects: Map<Prompt['id'], Prompt>
  // If no project is selected: undefined.
  promptsBelongingToProject?: Map<Prompt['id'], Prompt>
}

export const mlEphantDefaultContext = () => ({
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
      fromPromise(async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        return new Promise((resolve) => {
          setTimeout(() => {
            const results = new Array(13)
              .fill(undefined)
              .map(generateFakeSubmittedPrompt)

            const promptsThatCreatedProjects = new Map(
              args.input.context.promptsThatCreatedProjects
            )
            results.forEach((result) => {
              promptsThatCreatedProjects.set(result.id, result)
            })
            resolve({
              promptsThatCreatedProjects,
            })
          }, 2000)
        })
      }),
    [MlEphantManagerTransitionStates.PromptCreateModel]: fromPromise(
      async function (args: {
        input: {
          event: XSEvent<MlEphantManagerTransitionStates.PromptCreateModel>
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        return new Promise((resolve) => {
          setTimeout(() => {
            const promptsThatCreatedProjects = new Map(
              args.input.context.promptsThatCreatedProjects
            )

            const result = generateFakeSubmittedPrompt()
            promptsThatCreatedProjects.set(result.id, result)

            resolve({
              promptsThatCreatedProjects,
            })
          }, 5000)
        })
      }
    ),
    [MlEphantManagerTransitionStates.PromptPollStatus]: fromPromise(
      async function (args: {
        input: {
          context: MlEphantManagerContext
        }
      }): Promise<Partial<MlEphantManagerContext>> {
        return new Promise((resolve) => {
          setTimeout(() => {
            const promptsThatCreatedProjects = new Map(
              args.input.context.promptsThatCreatedProjects
            )
            // Do the same for prompts of a project
            promptsThatCreatedProjects.values().forEach((prompt) => {
              if (prompt.status !== 'pending') return
              prompt.status = 'completed'
            })
            resolve({
              promptsThatCreatedProjects,
            })
          }, 3000)
        })
      }
    ),
  },
}).createMachine({
  initial: MlEphantManagerStates.Setup,
  context: mlEphantDefaultContext(),
  states: {
    [MlEphantManagerStates.Setup]: {
      invoke: {
        input: (args: { context: MlEphantManagerContext }) => args,
        src: MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects,
        onDone: {
          target: MlEphantManagerStates.Idle,
          actions: assign(({ event }) => event.output),
        },
        onError: { target: MlEphantManagerStates.Idle },
      },
    },
    [MlEphantManagerStates.Idle]: {
      on: {
        [MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects]: {
          target:
            MlEphantManagerStates.Pending +
            '.' +
            MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects,
        },
      },
    },
    [MlEphantManagerStates.Pending]: {
      initial: MlEphantManagerStates.Idle,
      states: {
        // Pop back out to Idle.
        [MlEphantManagerStates.Idle]: {
          type: 'final',
          target: MlEphantManagerStates.Idle,
        },
        [MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects]: {
          invoke: {
            input: (args) => ({
              context: args.context,
            }),
            src: MlEphantManagerTransitionStates.GetPromptsThatCreatedProjects,
            onDone: { target: MlEphantManagerStates.Idle },
            onError: { target: MlEphantManagerStates.Idle },
          },
        },
        [MlEphantManagerTransitionStates.PromptCreateModel]: {
          invoke: {
            input: (args) => ({
              event:
                args.event as XSEvent<MlEphantManagerTransitionStates.PromptCreateModel>,
              context: args.context,
            }),
            src: MlEphantManagerTransitionStates.PromptCreateModel,
            onDone: { target: MlEphantManagerStates.PromptPollStatus },
            onError: { target: MlEphantManagerStates.PromptPollStatus },
          },
        },
        [MlEphantManagerTransitionStates.PromptPollStatus]: {
          invoke: {
            input: (args) => ({
              event:
                args.event as XSEvent<MlEphantManagerTransitionStates.PromptPollStatus>,
              context: args.context,
            }),
            src: MlEphantManagerTransitionStates.PromptPollStatus,
            onDone: { target: MlEphantManagerStates.Idle },
            onError: { target: MlEphantManagerStates.Idle },
          },
        },
      },
    },
  },
})

export type MlEphantManagerActor = ActorRefFrom<typeof mlEphantManagerMachine>
