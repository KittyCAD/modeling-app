import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import {
  PATHS,
  joinRouterPaths,
  joinOSPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { systemIOActor, useSettings, useToken } from '@src/lib/singletons'
import {
  useHasListedProjects,
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
  useRequestedTextToCadGeneration,
  useFolders,
} from '@src/machines/systemIO/hooks'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { submitAndAwaitTextToKclSystemIO } from '@src/lib/textToCad'
import { reportRejection } from '@src/lib/trap'
import { getUniqueProjectName } from '@src/lib/desktopFS'

export function SystemIOMachineLogicListenerDesktop() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const navigate = useNavigate()
  const settings = useSettings()
  const requestedTextToCadGeneration = useRequestedTextToCadGeneration()
  const token = useToken()
  const folders = useFolders()

  const useGlobalProjectNavigation = () => {
    useEffect(() => {
      if (!requestedProjectName.name) {
        return
      }
      const projectPathWithoutSpecificKCLFile = joinOSPaths(
        projectDirectoryPath,
        requestedProjectName.name
      )
      const requestedPath = joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(projectPathWithoutSpecificKCLFile)
      )
      navigate(requestedPath)
    }, [requestedProjectName])
  }

  const useGlobalFileNavigation = () => {
    useEffect(() => {
      if (!requestedFileName.file || !requestedFileName.project) {
        return
      }
      const filePath = joinOSPaths(
        projectDirectoryPath,
        requestedFileName.project,
        requestedFileName.file
      )
      const requestedPath = joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(filePath),
        requestedFileName.subRoute || ''
      )
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
      async (eventType, path) => {
        // Gotcha: Chokidar is buggy. It will emit addDir or add on files that did not get created.
        // This means while the application initialize and Chokidar initializes you cannot tell if
        // a directory or file is actually created or they are buggy signals. This means you must
        // ignore all signals during initialization because it is ambiguous. Once those signals settle
        // you can actually start listening to real signals.
        // If someone creates folders or files during initialization we ignore those events!
        if (!hasListedProjects) {
          return
        }

        const folderName =
          systemIOActor.getSnapshot().context.lastProjectDeleteRequest.project
        const folderPath = `${projectDirectoryPath}${window.electron.sep}${folderName}`
        if (
          folderName !== NO_PROJECT_DIRECTORY &&
          (eventType === 'unlinkDir' || eventType === 'unlink') &&
          path.includes(folderPath)
        ) {
          // NO OP: The systemIOMachine will be triggering the read in the state transition, don't spam it again
          // once this event is processed after the deletion.
        } else {
          // Prevents spamming reading from disk twice on deletion due to files and folders being deleted async
          systemIOActor.send({
            type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
          })
        }
      },
      settings.app.projectDirectory.current
        ? [settings.app.projectDirectory.current]
        : []
    )

    // TODO: Move this generateTextToCAD to another machine in the future and make a whole machine out of it.
    useEffect(() => {
      const requestedPromptTrimmed =
        requestedTextToCadGeneration.requestedPrompt.trim()
      const requestedProjectName =
        requestedTextToCadGeneration.requestedProjectName
      const isProjectNew = requestedTextToCadGeneration.isProjectNew
      if (!requestedPromptTrimmed || !requestedProjectName) return
      const uniqueNameIfNeeded = isProjectNew
        ? getUniqueProjectName(requestedProjectName, folders)
        : requestedProjectName
      submitAndAwaitTextToKclSystemIO({
        trimmedPrompt: requestedPromptTrimmed,
        projectName: uniqueNameIfNeeded,
        navigate,
        token,
        isProjectNew,
        settings: { highlightEdges: settings.modeling.highlightEdges.current },
      }).catch(reportRejection)
    }, [requestedTextToCadGeneration])
  }

  useGlobalProjectNavigation()
  useGlobalFileNavigation()
  useApplicationProjectDirectory()
  useDefaultProjectName()
  useWatchingApplicationProjectDirectory()

  return null
}
