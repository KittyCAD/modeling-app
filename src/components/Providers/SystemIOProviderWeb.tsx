import { useEffect, useCallback } from 'react'
import {
  useClearURLParams,
  useRequestedTextToCadGeneration,
} from '@src/machines/systemIO/hooks'
import { useSearchParams } from 'react-router-dom'
import { CREATE_FILE_URL_PARAM } from '@src/lib/constants'
import { submitAndAwaitTextToKclSystemIO } from '@src/lib/textToCad'
import { reportRejection } from '@src/lib/trap'
import { useNavigate } from 'react-router-dom'
import { billingActor, useSettings, useToken } from '@src/lib/singletons'
import { BillingTransition } from '@src/machines/billingMachine'

export function SystemIOMachineLogicListenerWeb() {
  const clearURLParams = useClearURLParams()
  const navigate = useNavigate()
  const settings = useSettings()
  const requestedTextToCadGeneration = useRequestedTextToCadGeneration()
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
    }, [clearURLParams])
  }

  // TODO: Move this generateTextToCAD to another machine in the future and make a whole machine out of it.
  useEffect(() => {
    const requestedPromptTrimmed =
      requestedTextToCadGeneration.requestedPrompt.trim()
    const requestedProjectName =
      requestedTextToCadGeneration.requestedProjectName
    const isProjectNew = requestedTextToCadGeneration.isProjectNew
    if (!requestedPromptTrimmed || !requestedProjectName) return
    // Gotcha: web has no project name.
    const uniqueNameIfNeeded = requestedProjectName
    submitAndAwaitTextToKclSystemIO({
      trimmedPrompt: requestedPromptTrimmed,
      projectName: uniqueNameIfNeeded,
      navigate,
      token,
      isProjectNew,
      settings: { highlightEdges: settings.modeling.highlightEdges.current },
    })
      .then(() => {
        billingActor.send({ type: BillingTransition.Update, apiToken: token })
      })
      .catch(reportRejection)
  }, [requestedTextToCadGeneration])

  useClearQueryParams()
  return null
}
