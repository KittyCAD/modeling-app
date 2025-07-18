import type { Models } from '@kittycad/lib'
import { VITE_KC_API_BASE_URL } from '@src/env'
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
  const url = VITE_KC_API_BASE_URL + '/ai/text-to-cad'
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
  const url = VITE_KC_API_BASE_URL + '/user/text-to-cad/' + id
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
