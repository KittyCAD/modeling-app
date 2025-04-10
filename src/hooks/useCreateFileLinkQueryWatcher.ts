import { useEffect } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

import { useNetworkContext } from '@src/hooks/useNetworkContext'
import { EngineConnectionStateType } from '@src/lang/std/engineConnection'
import { base64ToString } from '@src/lib/base64'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { CREATE_FILE_URL_PARAM, DEFAULT_FILE_NAME } from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileLinkParams } from '@src/lib/links'
import { PATHS } from '@src/lib/paths'
import { useSettings } from '@src/machines/appMachine'

// For initializing the command arguments, we actually want `method` to be undefined
// so that we don't skip it in the command palette.
export type CreateFileSchemaMethodOptional = Omit<
  ProjectsCommandSchema['Import file from URL'],
  'method'
> & {
  method?: 'newProject' | 'existingProject'
}

/**
 * companion to createFileLink. This hook runs an effect on mount that
 * checks the URL for the CREATE_FILE_URL_PARAM and triggers the "Create file"
 * command if it is present, loading the command's default values from the other
 * URL parameters.
 */
export function useCreateFileLinkQuery(
  callback: (args: CreateFileSchemaMethodOptional) => void
) {
  const { immediateState } = useNetworkContext()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const settings = useSettings()

  useEffect(() => {
    const isHome = pathname === PATHS.HOME
    const createFileParam = searchParams.has(CREATE_FILE_URL_PARAM)

    if (
      createFileParam &&
      (immediateState.type ===
        EngineConnectionStateType.ConnectionEstablished ||
        isHome)
    ) {
      const params: FileLinkParams = {
        code: base64ToString(
          decodeURIComponent(searchParams.get('code') ?? '')
        ),
        name: searchParams.get('name') ?? DEFAULT_FILE_NAME,
      }

      const argDefaultValues: CreateFileSchemaMethodOptional = {
        name: params.name
          ? isDesktop()
            ? params.name.replace('.kcl', '')
            : params.name
          : isDesktop()
            ? settings.projects.defaultProjectName.current
            : DEFAULT_FILE_NAME,
        code: params.code || '',
        method: isDesktop() ? undefined : 'existingProject',
      }

      callback(argDefaultValues)
    }
  }, [searchParams, immediateState])
}
