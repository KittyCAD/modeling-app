import type { Models } from '@kittycad/lib'
import {
  ToastTextToCadError,
  ToastTextToCadSuccess,
} from '@src/components/ToastTextToCad'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import { joinOSPaths } from '@src/lib/paths'
import { connectReasoningStream } from '@src/lib/reasoningWs'
import { kclManager, systemIOActor } from '@src/lib/singletons'
import { err, reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { withAPIBaseURL } from '@src/lib/withBaseURL'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import {
  SystemIOMachineEvents,
  waitForIdleState,
} from '@src/machines/systemIO/utils'
import toast from 'react-hot-toast'
import type { NavigateFunction } from 'react-router-dom'

export async function submitTextToCadCreateRequest(
  prompt: string,
  projectName: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = {
    prompt,
    project_name:
      projectName !== '' && projectName !== 'browser' ? projectName : undefined,
    kcl_version: kclManager.kclVersion,
  }
  // Glb has a smaller footprint than gltf, should we want to render it.
  const url = withAPIBaseURL('/ai/text-to-cad/glb?kcl=true')
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token
  )

  // Make sure we have an id.
  if (data instanceof Error) {
    return data
  }

  if (!data.id) {
    return new Error('No id returned from Text-to-CAD API')
  }

  if (token) {
    connectReasoningStream(token, data.id)
  }

  return data
}

export async function getTextToCadCreateResult(
  id: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const url = withAPIBaseURL(`/async/operations/${id}`)
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

interface TextToKclPropsApplicationLevel {
  trimmedPrompt: string
  navigate: NavigateFunction
  token?: string
  projectName: string
  isProjectNew: boolean
  settings?: {
    highlightEdges: boolean
  }
}

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

export async function textToCadMlConversations(
  token: string,
  args: {
    pageToken?: string
    limit?: number
    sortBy: 'created_at_descending'
  }
): Promise<IResponseMlConversations | Error> {
  const url = withAPIBaseURL(
    `/ml/conversations?limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at_descending'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data: IResponseMlConversations | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export type PromptsPaged = {
  items: Models['TextToCad_type'][]
  next_page?: string
}

export async function textToCadMlPromptsBelongingToConversation(
  token: string,
  args: {
    conversationId: string
    pageToken?: string
    limit?: number
    sortBy: 'created_at_ascending'
  }
): Promise<PromptsPaged | Error> {
  const url = withAPIBaseURL(
    `/user/text-to-cad?conversation_id=${args.conversationId}&no_models=true&limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at_ascending'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data: PromptsPaged | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}
