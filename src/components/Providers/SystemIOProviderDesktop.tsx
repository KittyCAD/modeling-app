import { useSelector } from '@xstate/react'
import { useLspContext } from '@src/components/LspProvider'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { fsManager } from '@src/lang/std/fileSystemManager'
import { EXECUTE_AST_INTERRUPT_ERROR_MESSAGE } from '@src/lib/constants'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import {
  PATHS,
  getFilePathRelativeToProject,
  getProjectDirectoryFromKCLFilePath,
  joinOSPaths,
  joinRouterPaths,
  safeEncodeForRouterPaths,
  webSafePathSplit,
} from '@src/lib/paths'
import {
  engineCommandManager,
  kclManager,
  systemIOActor,
  useSettings,
} from '@src/lib/singletons'
import { MlEphantManagerReactContext } from '@src/machines/mlEphantManagerMachine'
import {
  useHasListedProjects,
  useProjectDirectoryPath,
  useProjectIdToConversationId,
  useRequestedFileName,
  useRequestedProjectName,
  useWatchForNewFileRequestsFromMlEphant,
} from '@src/machines/systemIO/hooks'
import {
  NO_PROJECT_DIRECTORY,
  type RequestedKCLFile,
  SystemIOMachineEvents,
} from '@src/machines/systemIO/utils'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'

export function SystemIOMachineLogicListenerDesktop() {
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const navigate = useNavigate()
  const settings = useSettings()
  const { onFileOpen, onFileClose } = useLspContext()
  const { pathname } = useLocation()

  function safestNavigateToFile({
    requestedPath,
    requestedFilePathWithExtension,
    requestedProjectDirectory,
  }: {
    requestedPath: string
    requestedFilePathWithExtension: string | null
    requestedProjectDirectory: string | null
  }) {
    let filePathWithExtension = null
    let projectDirectory = null
    // assumes /file/<encodedURIComponent>
    // e.g '/file/%2Fhome%2Fkevin-nadro%2FDocuments%2Fzoo-modeling-app-projects%2Fbracket-1%2Fbracket.kcl'
    const [iAmABlankString, file, encodedURI] = webSafePathSplit(pathname)
    if (
      iAmABlankString === '' &&
      file === makeUrlPathRelative(PATHS.FILE) &&
      encodedURI
    ) {
      filePathWithExtension = decodeURIComponent(encodedURI)
      const applicationProjectDirectory = settings.app.projectDirectory.current
      projectDirectory = getProjectDirectoryFromKCLFilePath(
        filePathWithExtension,
        applicationProjectDirectory
      )
    }

    // Close current file in current project if it exists
    onFileClose(filePathWithExtension, projectDirectory)
    // Open the requested file in the requested project
    onFileOpen(requestedFilePathWithExtension, requestedProjectDirectory)

    engineCommandManager.rejectAllModelingCommands(
      EXECUTE_AST_INTERRUPT_ERROR_MESSAGE
    )

    /**
     * Check that both paths are truthy strings and if they do not match
     * then mark it is switchedFiles.
     * If they do not match but the origin is falsey we do not want to mark as
     * switchedFiles because checkIfSwitchedFilesShouldClear will trigger
     * clearSceneAndBustCache if there is a parse error!
     *
     * i.e. Only do switchedFiles check against two file paths, not null and a file path
     */
    if (
      filePathWithExtension &&
      requestedFilePathWithExtension &&
      filePathWithExtension !== requestedFilePathWithExtension
    ) {
      kclManager.switchedFiles = true
    }

    kclManager.isExecuting = false
    navigate(requestedPath)
  }

  /**
   * We watch objects because we want to be able to navigate to itself
   * if we used a string the useEffect would not change
   * e.g. context.projectName if this was a string we would not be able to
   * navigate to CoolProject N times in a row. If we wrap this in an object
   * the object is watched not the string value
   */
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
        safeEncodeForRouterPaths(projectPathWithoutSpecificKCLFile),
        requestedProjectName.subRoute || ''
      )
      safestNavigateToFile({
        requestedPath,
        requestedFilePathWithExtension: null,
        requestedProjectDirectory: projectPathWithoutSpecificKCLFile,
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [requestedProjectName])
  }

  /**
   * We watch objects because we want to be able to navigate to itself
   * if we used a string the useEffect would not change
   * e.g. context.projectName if this was a string we would not be able to
   * navigate to coolFile.kcl N times in a row. If we wrap this in an object
   * the object is watched not the string value
   */
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
      const projectPathWithoutSpecificKCLFile = joinOSPaths(
        projectDirectoryPath,
        requestedProjectName.name
      )
      const requestedPath = joinRouterPaths(
        PATHS.FILE,
        safeEncodeForRouterPaths(filePath),
        requestedFileName.subRoute || ''
      )
      safestNavigateToFile({
        requestedPath,
        requestedFilePathWithExtension: filePath,
        requestedProjectDirectory: projectPathWithoutSpecificKCLFile,
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [requestedFileName])
  }

  const useApplicationProjectDirectory = () => {
    useEffect(() => {
      if (pathname === PATHS.HOME) {
        systemIOActor.send({
          type: SystemIOMachineEvents.setProjectDirectoryPath,
          data: {
            requestedProjectDirectoryPath:
              settings.app.projectDirectory.current || '',
          },
        })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [settings.app.projectDirectory.current, pathname])
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
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
        const folderPath = `${projectDirectoryPath}${fsManager.path.sep}${folderName}`
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
  }

  const mlEphantManagerActor2 = MlEphantManagerReactContext.useActorRef()

  useWatchForNewFileRequestsFromMlEphant(
    mlEphantManagerActor2,
    (toolOutput, projectNameCurrentlyOpened, fileFocusedOnInEditor) => {
      if (
        toolOutput.type !== 'text_to_cad' &&
        toolOutput.type !== 'edit_kcl_code'
      ) {
        return
      }
      const outputsRecord: Record<string, string> = {
        ...(toolOutput.outputs ?? {}),
      }
      const requestedFiles: RequestedKCLFile[] = Object.entries(
        outputsRecord
      ).map(([relativePath, fileContents]) => {
        const lastSep = relativePath.lastIndexOf(window.electron?.sep ?? '')
        let pathPart = relativePath.slice(0, lastSep)
        let filePart = relativePath.slice(lastSep)
        if (lastSep < 0) {
          pathPart = ''
          filePart = relativePath
        }
        return {
          requestedCode: fileContents,
          requestedFileName: filePart,
          requestedProjectName:
            projectNameCurrentlyOpened + window.electron?.sep + pathPart,
        }
      })

      const targetFilePathRelativeToProjectDir = getFilePathRelativeToProject(
        fileFocusedOnInEditor?.path || '',
        projectNameCurrentlyOpened
      )

      kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = true
      systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile,
        data: {
          files: requestedFiles,
          override: true,
          // Gotcha: Both are called "project name" and "file name", but one of them
          // has to include the project-relative file path between the two.
          requestedProjectName: projectNameCurrentlyOpened,
          requestedFileNameWithExtension:
            targetFilePathRelativeToProjectDir ?? '',
        },
      })
    }
  )

  // ZOOKEEPER BEHAVIOR EXCEPTION
  // Only fires on state changes, to deal with Zookeeper control.
  const systemIOState = useSelector(systemIOActor, (actor) => actor.value)
  useEffect(() => {
    if (systemIOState !== 'idle') return
    void kclManager.executeCode()
    kclManager.mlEphantManagerMachineBulkManipulatingFileSystem = false
  }, [systemIOState])

  // Save the conversation id for the project id if necessary.
  useProjectIdToConversationId(mlEphantManagerActor2, systemIOActor, settings)

  useGlobalProjectNavigation()
  useGlobalFileNavigation()
  useApplicationProjectDirectory()
  useDefaultProjectName()
  useWatchingApplicationProjectDirectory()

  return null
}
