import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { PATHS } from '@src/lib/paths'
import { systemIOActor, useSettings } from '@src/lib/singletons'
import {
  useHasListedProjects,
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useNavigate } from 'react-router-dom'
import { commandBarActor } from '@src/machines/commandBarMachine'
import { projectCommands } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import { useEffect, useCallback } from 'react'
import { useClearURLParams } from '@src/machines/systemIO/hooks'
import { useSearchParams } from 'react-router-dom'
import { CREATE_FILE_URL_PARAM } from '@src/lib/constants'

export function SystemIOMachineLogicListenerDesktop() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const navigate = useNavigate()
  const settings = useSettings()
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
    useEffect(() => {
      commandBarActor.send({
        type: 'Add commands',
        data: {
          commands: projectCommands,
        },
      })
      return () => {
        commandBarActor.send({
          type: 'Remove commands',
          data: {
            commands: projectCommands,
          },
        })
      }
    }, [])
  }

  const useGlobalProjectNavigation = () => {
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
  }

  const useGlobalFileNavigation = () => {
    useEffect(() => {
      console.log(requestedFileName, 'NEW!')
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
  }

  const useApplicationProjectDirectory = () => {
    useEffect(() => {
      systemIOActor.send({
        type: SystemIOMachineEvents.setProjectDirectoryPath,
        data: {
          requestedProjectDirectoryPath:
            settings.app.projectDirectory.current || '',
        },
      })
    }, [settings.app.projectDirectory.current])
  }

  const useDefaultProjectName = () => {
    useEffect(() => {
      systemIOActor.send({
        type: SystemIOMachineEvents.setDefaultProjectFolderName,
        data: {
          requestedDefaultProjectFolderName:
            settings.projects.defaultProjectName.current || '',
        },
      })
    }, [settings.projects.defaultProjectName.current])
  }

  const useWatchingApplicationProjectDirectory = () => {
    useFileSystemWatcher(
      async () => {
        // Gotcha: Chokidar is buggy. It will emit addDir or add on files that did not get created.
        // This means while the application initialize and Chokidar initializes you cannot tell if
        // a directory or file is actually created or they are buggy signals. This means you must
        // ignore all signals during initialization because it is ambiguous. Once those signals settle
        // you can actually start listening to real signals.
        // If someone creates folders or files during initialization we ignore those events!
        if (!hasListedProjects) {
          return
        }
        systemIOActor.send({
          type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
        })
      },
      settings.app.projectDirectory.current
        ? [settings.app.projectDirectory.current]
        : []
    )
  }

  useAddProjectCommandsToCommandBar()
  useGlobalProjectNavigation()
  useGlobalFileNavigation()
  useApplicationProjectDirectory()
  useDefaultProjectName()
  useWatchingApplicationProjectDirectory()

  return null
}
