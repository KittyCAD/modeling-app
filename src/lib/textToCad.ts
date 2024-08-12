import { Models } from '@kittycad/lib'
import { ToastTextToCad } from 'components/ToastTextToCad'
import { VITE_KC_API_BASE_URL } from 'env'
import toast from 'react-hot-toast'
import { FILE_EXT } from './constants'
import { ContextFrom, EventData, EventFrom } from 'xstate'
import { fileMachine } from 'machines/fileMachine'
import { NavigateFunction } from 'react-router-dom'
import { isTauri } from './isTauri'

const headers = (token?: string): HeadersInit => ({
  'Content-Type': 'application/json',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
})

export async function submitTextToCadPrompt(
  prompt: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const body: Models['TextToCadCreateBody_type'] = { prompt }
  const response = await fetch(
    VITE_KC_API_BASE_URL + '/ai/text-to-cad/gltf?kcl=true',
    {
      method: 'POST',
      headers: headers(isTauri() ? token : undefined),
      body: JSON.stringify(body),
      ...(isTauri() ? {} : { credentials: 'include' }),
    }
  )

  if (!response.ok) {
    return new Error('Failed to request text-to-cad endpoint')
  }

  const data = (await response.json()) as Models['TextToCad_type'] | Error
  return data
}

export async function getTextToCadResult(
  id: string,
  token?: string
): Promise<Models['TextToCad_type'] | Error> {
  const response = await fetch(
    VITE_KC_API_BASE_URL + '/user/text-to-cad/' + id,
    {
      method: 'GET',
      headers: headers(isTauri() ? token : undefined),
      credentials: 'include',
    }
  )

  if (!response.ok) {
    return new Error('Failed to request text-to-cad endpoint')
  }

  const data = (await response.json()) as Models['TextToCad_type'] | Error
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
}

export async function submitAndAwaitTextToKcl({
  trimmedPrompt,
  fileMachineSend,
  navigate,
  context,
  token,
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

  const textToCadOutputCreated = await textToCadComplete.then((value) => {
    if (value.code === undefined || !value.code || value.code.length === 0) {
      toast.error('No KCL code returned', {
        id: toastId,
      })
      return Promise.reject(new Error('No KCL code returned'))
    }

    const TRUNCATED_PROMPT_LENGTH = 24
    const now = new Date().getTime()
    const newFileName = `${value.prompt
      .slice(0, TRUNCATED_PROMPT_LENGTH)
      .replace(/\s/gi, '-')
      .replace(/\W/gi, '')}-${now.toString().slice(-8)}`

    if (isTauri()) {
      fileMachineSend({
        type: 'Create file',
        data: {
          name: newFileName,
          makeDir: false,
          content: value.code,
          silent: true,
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

  toast.success(
    () =>
      ToastTextToCad({
        data: textToCadOutputCreated,
        navigate,
        context,
      }),
    {
      id: toastId,
      duration: Infinity,
    }
  )
}
