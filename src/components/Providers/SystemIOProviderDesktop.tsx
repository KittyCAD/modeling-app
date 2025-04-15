import { PATHS } from '@src/lib/paths'
import { systemIOActor, useSettings } from '@src/machines/appMachine'
import {
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export function SystemIOMachineLogicListener() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const navigate = useNavigate()
  const settings = useSettings()

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

  // Reload all folders when the project directory path changes
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.setProjectDirectoryPath,
      data: {
        requestedProjectDirectoryPath:
          settings.app.projectDirectory.current || '',
      },
    })
  }, [settings.app.projectDirectory.current])

  // Implement setting the default project folder name
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.setDefaultProjectFolderName,
      data: {
        requestedDefaultProjectFolderName:
          settings.projects.defaultProjectName.current || '',
      },
    })
  }, [settings.projects.defaultProjectName.current])

  return null
}
