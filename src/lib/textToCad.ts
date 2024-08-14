import { Models } from '@kittycad/lib'
import { ToastTextToCad } from 'components/ToastTextToCad'
import { VITE_KC_API_BASE_URL } from 'env'
import toast from 'react-hot-toast'
import { FILE_EXT } from './constants'
import { ContextFrom, EventData, EventFrom } from 'xstate'
import { fileMachine } from 'machines/fileMachine'
import { NavigateFunction } from 'react-router-dom'
import crossPlatformFetch from './crossPlatformFetch'
import { isTauri } from './isTauri'
import { Themes } from './theme'

export async function submitTextToCadPrompt(
  prompt: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = { prompt }
  // Glb has a smaller footprint than gltf, should we want to render it.
  const url = VITE_KC_API_BASE_URL + '/ai/text-to-cad/glb?kcl=true'
  const data: Models['TextToCad_type'] | Error = await crossPlatformFetch(
    url,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
    token
  )

  return data
}

export async function getTextToCadResult(
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

interface TextToKclProps {
  trimmedPrompt: string
  fileMachineSend: (
    type: EventFrom<typeof fileMachine>,
    data?: EventData
  ) => unknown
  navigate: NavigateFunction
  context: ContextFrom<typeof fileMachine>
  token?: string
  settings: {
    theme: Themes
    highlightEdges: boolean
  }
}

export async function submitAndAwaitTextToKcl({
  trimmedPrompt,
  fileMachineSend,
  navigate,
  context,
  token,
  settings,
}: TextToKclProps) {
  const toastId = toast.loading('Submitting to Text-to-CAD API...')

  const textToCadQueued = await submitTextToCadPrompt(trimmedPrompt, token)
    .then((value) => {
      if (value instanceof Error) {
        return Promise.reject(value)
      }
      return value
    })
    .catch((error) => {
      toast.error('Failed to submit to Text-to-CAD API', {
        id: toastId,
      })
      return error
    })

  if (textToCadQueued instanceof Error) {
    toast.error('Failed to submit to Text-to-CAD API', {
      id: toastId,
    })
    return
  }

  toast.loading('Generating parametric model...', {
    id: toastId,
  })

  // Check the status of the text-to-cad API job
  // until it is completed
  const textToCadComplete = new Promise<Models['TextToCad_type']>(
    async (resolve, reject) => {
      const value = await textToCadQueued
      if (value instanceof Error) {
        reject(value)
      }

      const MAX_CHECK_TIMEOUT = 3 * 60_000
      const CHECK_INTERVAL = 3000

      let timeElapsed = 0
      const interval = setInterval(async () => {
        timeElapsed += CHECK_INTERVAL
        if (timeElapsed >= MAX_CHECK_TIMEOUT) {
          clearInterval(interval)
          reject(new Error('Text-to-CAD API timed out'))
        }

        const check = await getTextToCadResult(value.id, token)
        if (check instanceof Error) {
          clearInterval(interval)
          reject(check)
        }

        if (check instanceof Error || check.status === 'failed') {
          clearInterval(interval)
          reject(check)
        } else if (check.status === 'completed') {
          clearInterval(interval)
          resolve(check)
        }
      }, CHECK_INTERVAL)
    }
  )

  const textToCadOutputCreated = await textToCadComplete
    .catch((e) => {
      toast.error('Failed to generate parametric model', {
        id: toastId,
      })
      return e
    })
    .then((value) => {
      if (value.code === undefined || !value.code || value.code.length === 0) {
        toast.error('No KCL code returned', {
          id: toastId,
        })
        return Promise.reject(new Error('No KCL code returned'))
      }

      const TRUNCATED_PROMPT_LENGTH = 24
      const newFileName = `${value.prompt
        .slice(0, TRUNCATED_PROMPT_LENGTH)
        .replace(/\s/gi, '-')
        .replace(/\W/gi, '-')
        .toLowerCase()}`

      if (isTauri()) {
        fileMachineSend({
          type: 'Create file',
          data: {
            name: newFileName,
            makeDir: false,
            content: value.code,
            silent: true,
            makeUnique: true,
          },
        })
      }

      return {
        ...value,
        fileName: newFileName + FILE_EXT,
      }
    })

  if (textToCadOutputCreated instanceof Error) {
    toast.error('Failed to generate parametric model', {
      id: toastId,
    })
    return
  }

  // Show a custom toast with the .glb model preview
  // and options to reject or accept the model
  toast.success(
    () =>
      ToastTextToCad({
        data: textToCadOutputCreated,
        token,
        navigate,
        context,
        settings,
      }),
    {
      id: toastId,
      duration: Infinity,
      icon: null,
    }
  )
  return textToCadOutputCreated
}

export async function sendTelemetry(
  id: string,
  feedback: Models['AiFeedback_type'],
  token?: string
): Promise<void> {
  const url =
    VITE_KC_API_BASE_URL + '/user/text-to-cad/' + id + '?feedback=' + feedback
  await crossPlatformFetch(
    url,
    {
      method: 'POST',
    },
    token
  )
}
