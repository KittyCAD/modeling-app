import { base64ToString } from 'lib/base64'
import { CREATE_FILE_URL_PARAM, DEFAULT_FILE_NAME } from 'lib/constants'
import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useSettingsAuthContext } from './useSettingsAuthContext'
import { isDesktop } from 'lib/isDesktop'
import { FileLinkParams } from 'lib/createFileLink'
import { ProjectsCommandSchema } from 'lib/commandBarConfigs/projectsCommandConfig'
import { baseUnitsUnion } from 'lib/settings/settingsTypes'

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
export function useCreateFileLinkQuery(callback: (args: CreateFileSchemaMethodOptional) => void) {
  const [searchParams] = useSearchParams()
  const { settings } = useSettingsAuthContext()

  useEffect(() => {
    const createFileParam = searchParams.has(CREATE_FILE_URL_PARAM)

    console.log('checking for createFileParam', {
      createFileParam,
      searchParams: [...searchParams.entries()],
    })

    if (createFileParam) {
      const params: FileLinkParams = {
        code: base64ToString(
          decodeURIComponent(searchParams.get('code') ?? '')
        ),

        name: searchParams.get('name') ?? DEFAULT_FILE_NAME,

        units:
          (baseUnitsUnion.find((unit) => searchParams.get('units') === unit) ||
            settings.context.modeling.defaultUnit.default) ??
          settings.context.modeling.defaultUnit.current,
      }

      const argDefaultValues: CreateFileSchemaMethodOptional = {
        name: params.name
          ? isDesktop()
            ? params.name.replace('.kcl', '')
            : params.name
          : isDesktop()
          ? settings.context.projects.defaultProjectName.current
          : DEFAULT_FILE_NAME,
        code: params.code || '',
        units: params.units,
        method: isDesktop() ? undefined : 'existingProject',
      }

      callback(argDefaultValues)
    }
  }, [searchParams])
}
