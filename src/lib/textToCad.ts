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

export async function submitTextToCadPrompt(
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
  const url = VITE_KC_API_BASE_URL + '/ai/text-to-cad/glb?kcl=true'
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

export async function submitAndAwaitTextToKclSystemIO({
  trimmedPrompt,
  token,
  projectName,
  navigate,
  isProjectNew,
  settings,
}: TextToKclPropsApplicationLevel) {
  const toastId = toast.loading('Submitting to Text-to-CAD API...')
  const showFailureToast = (message: string) => {
    toast.error(
      () =>
        ToastTextToCadError({
          toastId,
          message,
          prompt: trimmedPrompt,
          method: isProjectNew ? 'newProject' : 'existingProject',
          projectName: isProjectNew ? '' : projectName,
          newProjectName: isProjectNew ? projectName : '',
        }),
      {
        id: toastId,
        duration: Infinity,
      }
    )
  }

  const textToCadQueued = await submitTextToCadPrompt(
    trimmedPrompt,
    projectName,
    token
  )
    .then((value) => {
      if (value instanceof Error) {
        return Promise.reject(value)
      }
      return value
    })
    .catch((error) => {
      const message = err(error)
        ? error.message
        : 'Failed to submit to Text-to-CAD API'
      showFailureToast(message)
      return error
    })

  if (err(textToCadQueued)) {
    showFailureToast(textToCadQueued.message)
    return
  }

  toast.loading('Generating parametric model...', {
    id: toastId,
  })

  // Check the status of the text-to-cad API job
  // until it is completed
  const textToCadComplete = new Promise<Models['TextToCad_type']>(
    (resolve, reject) => {
      ;(async () => {
        const value = await textToCadQueued
        if (value instanceof Error) {
          reject(value)
        }

        const MAX_CHECK_TIMEOUT = 3 * 60_000
        const CHECK_INTERVAL = 3000

        let timeElapsed = 0
        const interval = setInterval(
          toSync(async () => {
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
          }, reportRejection),
          CHECK_INTERVAL
        )
      })().catch(reportRejection)
    }
  )

  let newFileName = PROJECT_ENTRYPOINT
  let uniqueProjectName = projectName

  const textToCadOutputCreated = await textToCadComplete
    .catch((e) => {
      showFailureToast('Failed to generate parametric model')
      return e
    })
    .then(async (value) => {
      console.log('completed')
      console.log(value)
      if (value.code === undefined || !value.code || value.code.length === 0) {
        // We want to show the real error message to the user.
        if (value.error && value.error.length > 0) {
          const error = value.error.replace('Text-to-CAD server:', '').trim()
          showFailureToast(error)
          return Promise.reject(new Error(error))
        } else {
          showFailureToast('No KCL code returned')
          return Promise.reject(new Error('No KCL code returned'))
        }
      }

      const TRUNCATED_PROMPT_LENGTH = 24
      // Only add the prompt name if it is a preexisting project
      const subDirectoryAsPromptName = `${value.prompt
        .slice(0, TRUNCATED_PROMPT_LENGTH)
        .replace(/\s/gi, '-')
        .replace(/\W/gi, '-')
        .toLowerCase()}`

      if (isDesktop()) {
        if (!isProjectNew) {
          // If the project is new, use a sub dir
          const firstLevelDirectories = getAllSubDirectoriesAtProjectRoot({
            projectFolderName: projectName,
          })
          const uniqueSubDirectoryName = getUniqueProjectName(
            subDirectoryAsPromptName,
            firstLevelDirectories
          )
          uniqueProjectName = joinOSPaths(projectName, uniqueSubDirectoryName)
        }
        systemIOActor.send({
          type: SystemIOMachineEvents.createKCLFile,
          data: {
            requestedProjectName: uniqueProjectName,
            requestedCode: value.code,
            requestedFileNameWithExtension: newFileName,
          },
        })
      }

      // wait for the createKCLFile action to be completed
      await waitForIdleState({ systemIOActor })

      return {
        ...value,
        fileName: newFileName,
      }
    })

  if (textToCadOutputCreated instanceof Error) {
    showFailureToast('Failed to generate parametric model')
    return
  }

  // Show a custom toast with the .glb model preview
  // and options to reject or accept the model
  toast.success(
    () =>
      // EXPECTED: This will throw a error in dev mode, do not worry about it.
      // Warning: Internal React error: Expected static flag was missing. Please notify the React team.
      ToastTextToCadSuccess({
        toastId,
        data: textToCadOutputCreated,
        token,
        // This can be a subdir within the rootProjectName
        projectName: uniqueProjectName,
        fileName: newFileName,
        navigate,
        isProjectNew,
        settings,
        // This is always the root project name, no subdir
        rootProjectName: projectName,
      }),
    {
      id: toastId,
      duration: Infinity,
      icon: null,
    }
  )
  return textToCadOutputCreated
}
