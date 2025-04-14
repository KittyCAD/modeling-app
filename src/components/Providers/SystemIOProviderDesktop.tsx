import { PATHS } from '@src/lib/paths'
import { systemIOActor } from '@src/machines/appMachine'
import { useSelector } from '@xstate/react'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
export const useRequestedProjectName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedProjectName)
export const useRequestedFileName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedFileName)
export const useProjectDirectoryPath = () =>
  useSelector(systemIOActor, (state) => state.context.projectDirectoryPath)

export function SystemIOMachineLogicListener() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  console.log(requestedFileName, 'okay')
  const projectDirectoryPath = useProjectDirectoryPath()
  const navigate = useNavigate()

  // Handle global project name navigation
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

  // Handle global file name navigation
  useEffect(() => {
    if (!requestedFileName.file || !requestedFileName.project) {
      return
    }
    const projectPath = window.electron.join(
      projectDirectoryPath,
      requestedFileName.project
    )
    const filePath = window.electron.join(projectPath, requestedFileName.file)
    const requestedPath = `${PATHS.FILE}/${encodeURIComponent(filePath)}`
    navigate(requestedPath)
  }, [requestedFileName])

  return null
}
