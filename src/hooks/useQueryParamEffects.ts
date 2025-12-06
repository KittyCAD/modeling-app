import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

import { base64ToString } from '@src/lib/base64'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CODE_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  DEFAULT_FILE_NAME,
  FILE_NAME_QUERY_PARAM,
  POOL_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileLinkParams } from '@src/lib/links'
import { useSingletons } from '@src/lib/boot'
import type { KclManager } from '@src/lang/KclManager'

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
export function useQueryParamEffects(kclManager: KclManager) {
  const { commandBarActor, useAuthState } = useSingletons()
  const authState = useAuthState()
  const [searchParams, setSearchParams] = useSearchParams()
  const hasAskToOpen = !isDesktop() && searchParams.has(ASK_TO_OPEN_QUERY_PARAM)
  // Let hasAskToOpen be handled by the OpenInDesktopAppHandler component first to avoid racing with it,
  // only deal with other params after user decided to open in desktop or web.
  // Without this the "Zoom to fit to shared model on web" test fails, although manually testing works due
  // to different timings.
  const shouldInvokeCreateFile =
    !hasAskToOpen && searchParams.has(CREATE_FILE_URL_PARAM)
  const shouldInvokeGenericCmd =
    !hasAskToOpen &&
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

      // Delete the query params after the command has been invoked.
      searchParams.delete(CREATE_FILE_URL_PARAM)
      searchParams.delete(FILE_NAME_QUERY_PARAM)
      searchParams.delete(CODE_QUERY_PARAM)
      setSearchParams(searchParams)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
    commandBarActor.send({
      type: 'Find and select command',
      data: commandData,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
