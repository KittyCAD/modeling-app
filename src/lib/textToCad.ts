import type { Models } from '@kittycad/lib'
import toast from 'react-hot-toast'
import type { NavigateFunction } from 'react-router-dom'
import {
  ToastTextToCadError,
  ToastTextToCadSuccess,
} from '@src/components/ToastTextToCad'
import { PROJECT_ENTRYPOINT } from '@src/lib/constants'
import crossPlatformFetch from '@src/lib/crossPlatformFetch'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { isDesktop } from '@src/lib/isDesktop'
import { kclManager, systemIOActor } from '@src/lib/singletons'
import {
  SystemIOMachineEvents,
  waitForIdleState,
} from '@src/machines/systemIO/utils'
import { err, reportRejection } from '@src/lib/trap'
import { toSync } from '@src/lib/utils'
import { getAllSubDirectoriesAtProjectRoot } from '@src/machines/systemIO/snapshotContext'
import { joinOSPaths } from '@src/lib/paths'
import { withAPIBaseURL } from '@src/lib/withBaseURL'

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

  return data
}

export async function getTextToCadCreateResult(
  id: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const url = withAPIBaseURL(`/user/text-to-cad/${id}`)
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
  created_at: string,
  first_prompt: string,
  id: string,
  updated_at: string,
  user_id: string,
}

export interface IResponseMlConversations {
  items: IResponseMlConversation[],
  next_page?: string,
}

export async function textToCadMlConversations(token: string, args: {
  pageToken?: string,
  limit?: number,
  sortBy: 'created_at'
}): Promise<IResponseMlConversations | Error> {

  return {
    items: [
     { first_prompt: "shamam lama bing bong", id: 1, created_at: new Date().toString(), },
     { first_prompt: "shamam lama bing bong", id: 2, created_at: new Date().toString(), },
     { first_prompt: "shamam lama bing bong", id: 3, created_at: new Date().toString(), },
     { first_prompt: "shamam lama bing bong", id: 4, created_at: new Date().toString(), },
     { first_prompt: "shamam lama bing bong", id: 5, created_at: new Date().toString(), },
    ],
  }

  const url = withAPIBaseURL(`/ml/conversations?limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at'}${args.pageToken ? ('&page_token=' + args.pageToken) : ''}`)
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}
