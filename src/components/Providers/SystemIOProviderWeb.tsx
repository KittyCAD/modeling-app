import {
  CREATE_FILE_URL_PARAM,
  DEFAULT_PROJECT_KCL_FILE,
} from '@src/lib/constants'
import { useSingletons } from '@src/lib/singletons'
import { MlEphantManagerReactContext } from '@src/machines/mlEphantManagerMachine'
import {
  useClearURLParams,
  useProjectIdToConversationId,
  useWatchForNewFileRequestsFromMlEphant,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

export function SystemIOMachineLogicListenerWeb() {
  const {
    billingActor,
    engineCommandManager,
    systemIOActor,
    useSettings,
    useToken,
  } = useSingletons()
  const clearURLParams = useClearURLParams()
  const settings = useSettings()
  const token = useToken()
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

  const useClearQueryParams = () => {
    useEffect(() => {
      if (clearURLParams.value) {
        clearImportSearchParams()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [clearURLParams])
  }

  useClearQueryParams()

  const mlEphantManagerActor = MlEphantManagerReactContext.useActorRef()

  useWatchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor,
    billingActor,
    token,
    engineCommandManager,
    (toolOutput, projectNameCurrentlyOpened) => {
      if (
        toolOutput.type !== 'text_to_cad' &&
        toolOutput.type !== 'edit_kcl_code'
      ) {
        return
      }
      systemIOActor.send({
        type: SystemIOMachineEvents.createKCLFile,
        data: {
          requestedProjectName: projectNameCurrentlyOpened,
          requestedCode: toolOutput.outputs?.[DEFAULT_PROJECT_KCL_FILE] ?? '',
          requestedFileNameWithExtension: DEFAULT_PROJECT_KCL_FILE,
        },
      })
    }
  )

  useProjectIdToConversationId(mlEphantManagerActor, systemIOActor, settings)

  return null
}
