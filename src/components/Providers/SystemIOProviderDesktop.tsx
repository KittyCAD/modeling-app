import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { PATHS } from '@src/lib/paths'
import { systemIOActor, useSettings, useToken } from '@src/lib/singletons'
import {
  useHasListedProjects,
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
  useRequestedTextToCadGeneration
} from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { submitAndAwaitTextToKclSystemIO } from "@src/lib/textToCad"
import { reportRejection} from '@src/lib/trap'

export function SystemIOMachineLogicListenerDesktop() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const navigate = useNavigate()
  const settings = useSettings()
  const requestedTextToCadGeneration = useRequestedTextToCadGeneration()
  const token = useToken()

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

    useEffect(() => {
      systemIOActor.send({
        type: SystemIOMachineEvents.setProjectDirectoryPath,
        data: {
          requestedProjectDirectoryPath:
            settings.app.projectDirectory.current || '',
        },
      })
    }, [settings.app.projectDirectory.current])

    useEffect(() => {
      systemIOActor.send({
        type: SystemIOMachineEvents.setDefaultProjectFolderName,
        data: {
          requestedDefaultProjectFolderName:
            settings.projects.defaultProjectName.current || '',
        },
      })
    }, [settings.projects.defaultProjectName.current])

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



  useEffect(()=>{
    const requestedPromptTrimmed = requestedTextToCadGeneration.requestedPrompt.trim()
    const requestedProjectName = requestedTextToCadGeneration.requestedProjectName
    if (!requestedPromptTrimmed || !requestedProjectName) return
    submitAndAwaitTextToKclSystemIO({
      trimmedPrompt: requestedPromptTrimmed,
      projectName: requestedProjectName,
        navigate,
        token,
        settings: {
          theme: settings.app.theme.current,
          highlightEdges: settings.modeling.highlightEdges.current,
        },
      }).catch(reportRejection)
  },[requestedTextToCadGeneration])

  return null
}
