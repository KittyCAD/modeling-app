import type { Models } from '@kittycad/lib'

export type Prompt = Models['TextToCad_type'] &
  Models['TextToCadMultiFileIteration_type']

export enum PromptType {
  Create = 'create',
  Edit = 'edit',
}
