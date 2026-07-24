import type { MlCopilotServerMessage, ReasoningMessage } from '@kittycad/lib'

export type ProjectFileReasoningMessage =
  | {
      content: string
      file_name: string
      type: 'created_project_file'
    }
  | {
      content: string
      file_name: string
      type: 'updated_project_file'
    }
  | {
      file_name: string
      type: 'deleted_project_file'
    }

export type AppReasoningMessage = ReasoningMessage | ProjectFileReasoningMessage

export type AppMlCopilotServerMessage =
  | Exclude<MlCopilotServerMessage, { reasoning: ReasoningMessage }>
  | { reasoning: AppReasoningMessage }

export function isDeletedFileReasoning(
  reasoning: AppReasoningMessage
): reasoning is Extract<
  AppReasoningMessage,
  { type: 'deleted_kcl_file' | 'deleted_project_file' }
> {
  return (
    reasoning.type === 'deleted_kcl_file' ||
    reasoning.type === 'deleted_project_file'
  )
}
