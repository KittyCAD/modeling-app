import { useEffect, useCallback } from 'react'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { importFileFromURL } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { useClearURLParams } from '@src/machines/systemIO/hooks'
import { useSearchParams } from 'react-router-dom'
import { CREATE_FILE_URL_PARAM } from '@src/lib/constants'

export function SystemIOMachineLogicListenerWeb() {
  const clearURLParams = useClearURLParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const clearImportSearchParams = useCallback(() => {
    // Clear the search parameters related to the "Import file from URL" command
    // or we'll never be able cancel or submit it.
    searchParams.delete(CREATE_FILE_URL_PARAM)
    searchParams.delete('code')
    searchParams.delete('name')
    searchParams.delete('units')
    setSearchParams(searchParams)
  }, [searchParams, setSearchParams])

  const useAddProjectCommandsToCommandBar = () => {
    const commands = [importFileFromURL]
    useEffect(() => {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: commands,
        },
      })
      return () => {
        commandBarActor.send({
          type: 'Remove commands',
          data: {
            commands: commands,
          },
        })
      }
    }, [])
  }

  const useClearQueryParams = () => {
    useEffect(() => {
      if (clearURLParams.value) {
        clearImportSearchParams()
      }
    }, [clearURLParams])
  }

  useAddProjectCommandsToCommandBar()
  useClearQueryParams()
  return null
}
