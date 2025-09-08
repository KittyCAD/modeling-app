import type { TextToCad, TextToCadMultiFileIteration } from '@kittycad/lib'

export type Prompt = TextToCad & TextToCadMultiFileIteration

export enum PromptType {
  Create = 'create',
  Edit = 'edit',
}
