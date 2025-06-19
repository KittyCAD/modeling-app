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
  return {
    conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
    code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
    completed_at: '2025-08-13T15:18:33.273Z',
    created_at: '2025-08-13T15:18:33.273Z',
    error: 'gIWGFQLTP257',
    feedback: 'accepted',
    id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
    kcl_version: 'T2g4ZxfkqPu6O4L',
    model: 'kcl',
    model_version: '8TTp1htP1MA9ZOY9YU',
    output_format: 'stl',
    outputs: {},
    prompt: 'E4kPKWS4T9WMoEqlJ98ki6tOHS',
    started_at: '2025-08-13T15:18:33.273Z',
    status: 'completed',
    updated_at: '2025-08-13T15:18:33.273Z',
    user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
  }

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
    sortBy: 'created_at'
  }
): Promise<IResponseMlConversations | Error> {
  return {
    items: [
      {
        first_prompt: 'A simple bottle with a hollow, watertight interior',
        id: 2,
        created_at: '2025-07-20T13:01:35Z',
      },
      {
        first_prompt:
          'A ball bearing is a type of rolling-element bearing that uses balls to maintain the separation between the bearing races. The primary purpose of a ball bearing is to reduce rotational friction and support radial and axial loads.',
        id: 3,
        created_at: '2025-07-30T13:01:35Z',
      },
      {
        first_prompt:
          'A 320mm vented brake disc (rotor), with straight vanes, 30mm thick. The disc bell should accommodate 5 M12 wheel studs on a 114.3mm pitch circle diameter.',
        id: 1,
        created_at: '2025-07-29T13:01:35Z',
      },
      {
        first_prompt:
          'This is a bracket that holds a shelf. It is made of aluminum and is designed to hold a force of 300 lbs. The bracket is 6 inches wide and the force is applied at the end of the shelf, 12 inches from the wall. The bracket has a factor of safety of 1.2. The legs of the bracket are 5 inches and 2 inches long. The thickness of the bracket is calculated from the constraints provided.',
        id: 4,
        created_at: '2025-06-30T13:01:35Z',
      },
    ],
  }

  const url = withAPIBaseURL(
    `/ml/conversations?limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}

export async function textToCadMlPromptsBelongingToConversation(
  token: string,
  args: {
    conversationId: string
    pageToken?: string
    limit?: number
    sortBy: 'created_at'
  }
): Promise<IResponseMlConversations | Error> {
  return {
    items: [
      {
        conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
        code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
        completed_at: '2025-08-13T15:18:33.273Z',
        created_at: '2025-08-13T15:18:33.273Z',
        error: 'gIWGFQLTP257',
        feedback: 'accepted',
        id: 'e951cde5-44d5-4e4d-b943-97d1bb4a400a',
        kcl_version: 'T2g4ZxfkqPu6O4L',
        model: 'kcl',
        model_version: '8TTp1htP1MA9ZOY9YU',
        output_format: 'stl',
        outputs: {},
        prompt: 'One prompt',
        started_at: '2025-08-13T15:18:33.273Z',
        status: 'completed',
        updated_at: '2025-08-13T15:18:33.273Z',
        user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
      },
      {
        conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
        code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
        completed_at: '2025-08-13T15:18:33.273Z',
        created_at: '2025-08-13T15:18:33.273Z',
        error: 'gIWGFQLTP257',
        feedback: 'accepted',
        id: 'e951cde8-44d5-4e4d-b943-97d1bb4a400a',
        kcl_version: 'T2g4ZxfkqPu6O4L',
        model: 'kcl',
        model_version: '8TTp1htP1MA9ZOY9YU',
        output_format: 'stl',
        outputs: {},
        prompt: 'Two prompt',
        started_at: '2025-08-13T15:18:33.273Z',
        status: 'completed',
        updated_at: '2025-08-13T15:18:33.273Z',
        user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
      },
      {
        conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
        code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
        completed_at: '2025-08-13T15:18:33.273Z',
        created_at: '2025-08-13T15:18:33.273Z',
        error: 'gIWGFQLTP257',
        feedback: 'accepted',
        id: 'e971c515-44d5-4e4d-b943-97d1bb4a400a',
        kcl_version: 'T2g4ZxfkqPu6O4L',
        model: 'kcl',
        model_version: '8TTp1htP1MA9ZOY9YU',
        output_format: 'stl',
        outputs: {},
        prompt: 'THree prompt',
        started_at: '2025-08-13T15:18:33.273Z',
        status: 'completed',
        updated_at: '2025-08-13T15:18:33.273Z',
        user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
      },
      {
        conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
        code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
        completed_at: '2025-08-13T15:18:33.273Z',
        created_at: '2025-08-13T15:18:33.273Z',
        error: 'gIWGFQLTP257',
        feedback: 'accepted',
        id: 'f971c515-44d5-4e4d-b043-97d1bb4a400a',
        kcl_version: 'T2g4ZxfkqPu6O4L',
        model: 'kcl',
        model_version: '8TTp1htP1MA9ZOY9YU',
        output_format: 'stl',
        outputs: {},
        prompt: 'four prompt',
        started_at: '2025-08-13T15:18:33.273Z',
        status: 'completed',
        updated_at: '2025-08-13T15:18:33.273Z',
        user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
      },
      {
        conversation_id: 'd951cd15-44c5-424d-b943-97d1bb4a400a',
        code: 'agLu8J7s7jsKjDbCRLJZPfY9nWuII',
        completed_at: '2025-08-13T15:18:33.273Z',
        created_at: '2025-08-13T15:18:33.273Z',
        error: 'gIWGFQLTP257',
        feedback: 'accepted',
        id: 'e971c525-44d5-4e7e-b943-97d1bb4a400a',
        kcl_version: 'T2g4ZxfkqPu6O4L',
        model: 'kcl',
        model_version: '8TTp1htP1MA9ZOY9YU',
        output_format: 'stl',
        outputs: {},
        prompt: 'five prompt',
        started_at: '2025-08-13T15:18:33.273Z',
        status: 'completed',
        updated_at: '2025-08-13T15:18:33.273Z',
        user_id: 'e4bda170-4ae6-4988-bc51-248b8e52f55b',
      },
    ],
  }

  const url = withAPIBaseURL(
    `/user/text-to-cad?conversation_id=${args.conversationId}&no_models=true&limit=${args.limit ?? '20'}&sort_by=${args.sortBy ?? 'created_at'}${args.pageToken ? '&page_token=' + args.pageToken : ''}`
  )
  const data:
    | { items: Models['TextToCad_type'][]; next_page?: string }
    | Error = await crossPlatformFetch(
    url,
    {
      method: 'GET',
    },
    token
  )

  return data
}
