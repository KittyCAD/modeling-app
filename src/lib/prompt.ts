import type {
  ApiCallStatus,
  FileExportFormat,
  MlFeedback,
  SourceRangePrompt,
  TextToCadModel as ZookeeperModel,
  TextToCadResponse as ZookeeperResponse,
} from '@kittycad/lib'

export type Prompt = {
  id: string
  conversation_id: string
  created_at: string
  updated_at: string
  status: ApiCallStatus
  model: ZookeeperModel
  model_version: string
  // Optional fields across variants
  started_at?: string
  feedback?: MlFeedback
  user_id?: string
  error?: string
  prompt?: string
  outputs?: Record<string, string>
  code?: string
  source_ranges?: SourceRangePrompt[]
  output_format?: FileExportFormat
  kcl_version?: string
  project_name?: string
  type?: ZookeeperResponse['type']
}

export enum PromptType {
  Create = 'create',
  Edit = 'edit',
}
