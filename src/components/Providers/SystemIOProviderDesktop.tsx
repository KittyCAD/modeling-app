import { PATHS } from '@src/lib/paths'
import { systemIOActor } from '@src/machines/appMachine'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
export const useRequestedProjectName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedProjectName)
export const useProjectDirectoryPath = () =>
  useSelector(systemIOActor, (state) => state.context.projectDirectoryPath)

export function SystemIOMachineLogicListener() {
  const requestedProjectName = useRequestedProjectName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const navigate = useNavigate()
  useEffect(() => {
    if (!requestedProjectName.name) {
      return
    }
    let projectPathWithoutSpecificKCLFile =
      projectDirectoryPath +
      window.electron.path.sep +
      requestedProjectName.name
    const requestedPath = `${PATHS.FILE}/${encodeURIComponent(
      projectPathWithoutSpecificKCLFile
    )}`
    navigate(requestedPath)
  }, [requestedProjectName])
  return null
}
