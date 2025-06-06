import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { base64ToString } from '@src/lib/base64'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  LOCAL_STORAGE_TEMPORARY_WORKSPACE,
  LOCAL_STORAGE_OLD_CODE,
  LOCAL_STORAGE_REPLACED_WORKSPACE_THIS_SESSION,
  DEFAULT_FILE_NAME,
  POOL_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileLinkParams } from '@src/lib/links'
import { commandBarActor, useAuthState, codeManager } from '@src/lib/singletons'
import { findKclSample } from '@src/lib/kclSamples'
import { webSafePathSplit } from '@src/lib/paths'
import { askQuestionPrompt } from '@src/components/ToastQuestion'

// For initializing the command arguments, we actually want `method` to be undefined
// so that we don't skip it in the command palette.
export type CreateFileSchemaMethodOptional = Omit<
  ProjectsCommandSchema['Import file from URL'],
  'method'
> & {
  method?: 'newProject' | 'existingProject'
}

/**
 * A set of hooks that watch for query parameters and dispatch a callback.
 * Currently watches for:
 * `?createFile`
 * "?cmd=<some-command-name>&groupId=<some-group-id>"
 */
export function useQueryParamEffects() {
  const authState = useAuthState()
  const [searchParams, setSearchParams] = useSearchParams()
  const shouldInvokeCreateFile = searchParams.has(CREATE_FILE_URL_PARAM)
  const shouldInvokeGenericCmd =
    searchParams.has(CMD_NAME_QUERY_PARAM) &&
    searchParams.has(CMD_GROUP_QUERY_PARAM)

  /**
   * Watches for legacy `?create-file` hook, which share links currently use.
   */
  useEffect(() => {
    if (shouldInvokeCreateFile && authState.matches('loggedIn')) {
      const argDefaultValues = buildCreateFileCommandArgs(searchParams)
      commandBarActor.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Import file from URL',
          argDefaultValues,
        },
      })

      // Delete the query param after the command has been invoked.
      searchParams.delete(CREATE_FILE_URL_PARAM)
      setSearchParams(searchParams)
    }
  }, [shouldInvokeCreateFile, setSearchParams, authState])

  /**
   * Generic commands are triggered by query parameters
   * with the pattern: `?cmd=<command-name>&groupId=<group-id>`
   */
  useEffect(() => {
    if (!shouldInvokeGenericCmd || !authState.matches('loggedIn')) return

    const commandData = buildGenericCommandArgs(searchParams)
    if (!commandData) return

    // Process regular commands
    if (commandData.name !== 'add-kcl-file-to-project' || isDesktop()) {
      commandBarActor.send({
        type: 'Find and select command',
        data: commandData,
      })
      cleanupQueryParams()
      return
    }

    // From here we're only handling 'add-kcl-file-to-project' on web

    // Get the sample path from command arguments
    const samplePath = commandData.argDefaultValues?.sample
    if (!samplePath) {
      console.error('No sample path found in command arguments')
      cleanupQueryParams()
      return
    }

    // Find the KCL sample details
    const kclSample = findKclSample(samplePath)
    if (!kclSample) {
      console.error('KCL sample not found for path:', samplePath)
      cleanupQueryParams()
      return
    } else if (kclSample.files.length > 1) {
      console.error(
        'KCL sample has multiple files, only the first one will be used'
      )
      cleanupQueryParams()
      return
    }

    // Get the first part of the path (project directory)
    const pathParts = webSafePathSplit(samplePath)
    const projectPathPart = pathParts[0]

    // Get the first file from the sample
    const firstFile = kclSample.files[0]
    if (!firstFile) {
      console.error('No files found in KCL sample')
      cleanupQueryParams()
      return
    }

    // Build the URL to the sample file
    const sampleCodeUrl = `/kcl-samples/${encodeURIComponent(
      projectPathPart
    )}/${encodeURIComponent(firstFile)}`

    // Fetch the sample code and show the toast
    fetch(sampleCodeUrl)
      .then((response) => {
        if (!response.ok) {
          return Promise.reject(
            new Error(
              `Failed to fetch sample: ${response.status} ${response.statusText}`
            )
          )
        }
        return response.text()
      })
      .then((code) => {
        // Only create a temporary workspace on web.
        if (isDesktop()) { return }

        // We only support "Try in browser" demo'ing.
        // Originally I (lee) had actually written browser support but
        // removed it, because all the links will go directly to the
        // browser version anyway.

        // Save the current code in localStorage and load the new code.
        const oldCode = codeManager.localStoragePersistCode()

        // By default we throw users into a temporary workspace in case
        // they start modifying things on the side
        localStorage.setItem(LOCAL_STORAGE_TEMPORARY_WORKSPACE, 'truthy')
        localStorage.setItem(
          LOCAL_STORAGE_REPLACED_WORKSPACE_THIS_SESSION,
          'truthy'
        )
        localStorage.setItem(LOCAL_STORAGE_OLD_CODE, oldCode)
        codeManager.writeToFile().catch(console.warn)
        codeManager.updateCodeStateEditor(code, true)
      })
      .catch((error) => {
        console.error('Error loading KCL sample:', error)
      })

    cleanupQueryParams()

    // Helper function to clean up query parameters
    function cleanupQueryParams() {
      // Delete all the query parameters that aren't reserved
      searchParams.delete(CMD_NAME_QUERY_PARAM)
      searchParams.delete(CMD_GROUP_QUERY_PARAM)
      const keysToDelete = [...searchParams.entries()]
        // Filter out known keys
        .filter(([key]) => {
          const reservedKeys = [
            CMD_NAME_QUERY_PARAM,
            CMD_GROUP_QUERY_PARAM,
            CREATE_FILE_URL_PARAM,
            POOL_QUERY_PARAM,
          ]

          return !reservedKeys.includes(key)
        })

      for (const [key] of keysToDelete) {
        searchParams.delete(key)
      }
      setSearchParams(searchParams)
    }
  }, [shouldInvokeGenericCmd, setSearchParams, authState])
}

function buildCreateFileCommandArgs(searchParams: URLSearchParams) {
  const params: Omit<FileLinkParams, 'isRestrictedToOrg'> = {
    code: base64ToString(decodeURIComponent(searchParams.get('code') ?? '')),
    name: searchParams.get('name') ?? DEFAULT_FILE_NAME,
  }

  const argDefaultValues: CreateFileSchemaMethodOptional = {
    name: PROJECT_ENTRYPOINT,
    code: params.code || '',
    method: isDesktop() ? undefined : 'existingProject',
  }

  return argDefaultValues
}

function buildGenericCommandArgs(searchParams: URLSearchParams) {
  // We have already verified these exist before calling
  const name = searchParams.get('cmd')
  const groupId = searchParams.get('groupId')

  if (!name || !groupId) {
    return
  }

  const filteredParams = [...searchParams.entries()]
    // Filter out known keys
    .filter(
      ([key]) =>
        [
          CMD_NAME_QUERY_PARAM,
          CMD_GROUP_QUERY_PARAM,
          CREATE_FILE_URL_PARAM,
          POOL_QUERY_PARAM,
        ].indexOf(key) === -1
    )
  const argDefaultValues = filteredParams.reduce(
    (acc, [key, value]) => {
      const decodedKey = decodeURIComponent(key)
      const decodedValue = decodeURIComponent(value)
      acc[decodedKey] = decodedValue
      return acc
    },
    {} as Record<string, string>
  )

  return {
    name,
    groupId,
    argDefaultValues,
  }
}
