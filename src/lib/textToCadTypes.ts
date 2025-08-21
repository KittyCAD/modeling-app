import type { Models } from '@kittycad/lib'

export interface IResponseMlConversation {
  created_at: string
  first_prompt: string
  id: string
  updated_at: string
  user_id: string
}

export interface IResponseMlConversations {
  items: IResponseMlConversation[]
  next_page?: string
}

export type PromptsPaged = {
  items: Models['TextToCad_type'][]
  next_page?: string
}
