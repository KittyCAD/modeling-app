import type { Models } from '@kittycad/lib'

type Prompt = Models['TextToCad_Type']

// export interface TextToCad_type {
//     code?: string;
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     kcl_version?: string;
//     model: TextToCadModel_type;
//     model_version: string;
//     output_format: FileExportFormat_type;
//     outputs: {
//         [key: string]: string;
//     };
//     prompt: string;
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadCreateBody_type {
//     kcl_version?: string;
//     project_name?: string;
//     prompt: string;
// }
// export interface TextToCadIteration_type {
//     code: string;
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     model: TextToCadModel_type;
//     model_version: string;
//     original_source_code: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadIterationBody_type {
//     kcl_version?: string;
//     original_source_code: string;
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
// }
// export interface TextToCadMultiFileIteration_type {
//     completed_at?: string;
//     created_at: string;
//     error?: string;
//     feedback?: MlFeedback_type;
//     id: Uuid_type;
//     kcl_version?: string;
//     model: TextToCadModel_type;
//     model_version: string;
//     outputs: {
//         [key: string]: string;
//     };
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
//     started_at?: string;
//     status: ApiCallStatus_type;
//     updated_at: string;
//     user_id: Uuid_type;
// }
// export interface TextToCadMultiFileIterationBody_type {
//     kcl_version?: string;
//     project_name?: string;
//     prompt?: string;
//     source_ranges: SourceRangePrompt_type[];
// }
// export interface TextToCadResultsPage_type {
//     items: TextToCad_type[];
//     next_page?: string;
// }

const generateFakeSubmittedPrompt = () => ({
  code: Math.random().toString(),
  completed_at: Math.random().toString(),
  created_at: Math.random().toString(),
  error: Math.random().toString(),
  // declare type MlFeedback_type = 'thumbs_up' | 'thumbs_down' | 'accepted' | 'rejected';
  feedback: undefined,
  id: Math.random().toString(),
  kcl_version: Math.random().toString(),
  // export declare type TextToCadModel_type = 'cad' | 'kcl' | 'kcl_iteration'; model : 'kcl',
  model_version: Math.random().toString(),
  // export declare type FileExportFormat_type = 'fbx' | 'glb' | 'gltf' | 'obj' | 'ply' | 'step' | 'stl';
  output_format: 'glb',
  outputs: {
    [Math.random().toString()]: Math.random().toString(),
  },
  prompt: Math.random().toString(),
  started_at: Math.random().toString(),
  // declare type ApiCallStatus_type = 'queued' | 'uploaded' | 'in_progress' | 'completed' | 'failed';
  status: 'completed',
  updated_at: Math.random(),
  // declare type ApiTokenUuid_type = string;
  user_id: Math.random().toString(),
})

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
