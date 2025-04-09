import { PATHS } from '@src/lib/paths'
import { systemIOActor } from '@src/machines/appMachine'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineEvents
} from '@src/machines/systemIO/utils'
export const useRequestedProjectName = () => useSelector(systemIOActor, (state) => state.context.requestedProjectName)
export const useProjectDirectoryPath = () => useSelector(systemIOActor, (state) => state.context.projectDirectoryPath)


export function SystemIOMachineLogicListener() {
  const requestedProjectName = useRequestedProjectName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const navigate = useNavigate()
  useEffect(() => {
    // TODO: use a {requestedProjectName: string} to by pass this clear logic...
    if (!requestedProjectName) {return}
    let projectPathWithoutSpecificKCLFile =
      projectDirectoryPath + window.electron.path.sep + requestedProjectName
    const requestedPath = `${PATHS.FILE}/${encodeURIComponent(
projectPathWithoutSpecificKCLFile
       )}`
    navigate(requestedPath)
    systemIOActor.send({type:SystemIOMachineEvents.clearRequestedProjectName})
  }, [requestedProjectName])
  return null
}
