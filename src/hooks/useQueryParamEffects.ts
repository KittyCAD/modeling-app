import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import { base64ToString } from '@src/lib/base64'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  DEFAULT_FILE_NAME,
  POOL_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileLinkParams } from '@src/lib/links'
import { commandBarActor } from '@src/lib/singletons'

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
  const [searchParams, setSearchParams] = useSearchParams()
  const shouldInvokeCreateFile = searchParams.has(CREATE_FILE_URL_PARAM)
  const shouldInvokeGenericCmd =
    searchParams.has(CMD_NAME_QUERY_PARAM) &&
    searchParams.has(CMD_GROUP_QUERY_PARAM)

  /**
   * Watches for legacy `?create-file` hook, which share links currently use.
   */
  useEffect(() => {
    if (shouldInvokeCreateFile) {
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
  }, [shouldInvokeCreateFile, setSearchParams])

  /**
   * Generic commands are triggered by query parameters
   * with the pattern: `?cmd=<command-name>&groupId=<group-id>`
   */
  useEffect(() => {
    if (shouldInvokeGenericCmd) {
      const commandData = buildGenericCommandArgs(searchParams)
      if (!commandData) {
        return
      }
      commandBarActor.send({
        type: 'Find and select command',
        data: commandData,
      })

      // Delete all the query parameters that aren't reserved
      searchParams.delete(CMD_NAME_QUERY_PARAM)
      searchParams.delete(CMD_GROUP_QUERY_PARAM)
      const keysToDelete = searchParams
        .entries()
        .toArray()
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
  }, [shouldInvokeGenericCmd, setSearchParams])
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

  const filteredParams = searchParams
    .entries()
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
