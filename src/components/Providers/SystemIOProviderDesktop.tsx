import { NIL as uuidNIL } from 'uuid'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import {
  PATHS,
  joinRouterPaths,
  joinOSPaths,
  safeEncodeForRouterPaths,
  webSafePathSplit,
  getProjectDirectoryFromKCLFilePath,
} from '@src/lib/paths'
import {
  billingActor,
  systemIOActor,
  useSettings,
  useToken,
  kclManager,
  mlEphantManagerActor,
  engineCommandManager,
} from '@src/lib/singletons'
import { BillingTransition } from '@src/machines/billingMachine'
import { PromptType, Prompt } from '@src/lib/prompt'
import {
  MlEphantManagerStates,
  MlEphantManagerTransitions,
} from '@src/machines/mlEphantManagerMachine'
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
  SystemIOMachineStates,
  RequestedKCLFile,
} from '@src/machines/systemIO/utils'
import { useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { reportRejection } from '@src/lib/trap'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import { useLspContext } from '@src/components/LspProvider'
import { useLocation } from 'react-router-dom'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import {
  EXECUTE_AST_INTERRUPT_ERROR_MESSAGE,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'

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
      systemIOActor.send({
        type: SystemIOMachineEvents.setProjectDirectoryPath,
        data: {
          requestedProjectDirectoryPath:
            settings.app.projectDirectory.current || '',
        },
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
  }

  // Watch MlEphant for any responses that require files to be created.
  useEffect(() => {
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (
        !next.matches({
          [MlEphantManagerStates.Ready]: {
            [MlEphantManagerStates.Background]:
              MlEphantManagerTransitions.GetPromptsPendingStatuses,
          },
        })
      ) {
        return
      }

      let hadUpdate = next.context.promptsInProgressToCompleted.size > 0

      next.context.promptsInProgressToCompleted.forEach(
        (promptId: Prompt['id']) => {
          const prompt = next.context.promptsPool.get(promptId)
          if (prompt === undefined) return
          if (prompt.status === 'failed') return
          const promptMeta = next.context.promptsMeta.get(prompt.id)
          if (promptMeta === undefined) {
            console.warn('No metadata for this prompt - ignoring.')
            return
          }

          if (promptMeta.type === PromptType.Create) {
            if (prompt.code === undefined) return
            systemIOActor.send({
              type: SystemIOMachineEvents.importFileFromURL,
              data: {
                requestedCode: prompt.code,
                requestedProjectName: promptMeta.project.name,
                requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
              },
            })
          } else {
            const requestedFiles: RequestedKCLFile[] = Object.entries(
              prompt.outputs
            ).map(([relativePath, fileContents]) => {
              const lastSep = relativePath.lastIndexOf(window.electron.sep)
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
                  promptMeta.project.name + window.electron.sep + pathPart,
              }
            })
            systemIOActor.send({
              type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToFile,
              data: {
                files: requestedFiles,
                override: true,
                requestedProjectName: '',
                requestedFileNameWithExtension: '',
              },
            })
          }
        }
      )

      if (hadUpdate) {
        billingActor.send({
          type: BillingTransition.Update,
          apiToken: token,
        })
      }
    })
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  // Save the conversation id for the project id if necessary.
  useEffect(() => {
    const subscription = mlEphantManagerActor.subscribe((next) => {
      if (settings.meta.id.current === undefined) {
        return
      }
      if (settings.meta.id.current === uuidNIL) {
        return
      }
      if (next.context.conversationId === undefined) {
        return
      }
      const systemIOActorSnapshot = systemIOActor.getSnapshot()
      if (
        systemIOActorSnapshot.context.mlEphantConversations.has(
          settings.meta.id.current
        )
      ) {
        return
      }
      if (
        systemIOActorSnapshot.value ===
        SystemIOMachineStates.savingMlEphantConversations
      ) {
        return
      }
      systemIOActor.send({
        type: SystemIOMachineEvents.saveMlEphantConversations,
        data: {
          projectId: settings.meta.id.current,
          conversationId: next.context.conversationId,
        },
      })
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [settings])

  useGlobalProjectNavigation()
  useGlobalFileNavigation()
  useApplicationProjectDirectory()
  useDefaultProjectName()
  useWatchingApplicationProjectDirectory()

  return null
}
