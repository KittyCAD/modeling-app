import { useLspContext } from '@src/components/LspProvider'
import { useFileSystemWatcher } from '@src/hooks/useFileSystemWatcher'
import { useApp, useSingletons } from '@src/lib/boot'
import fsZds from '@src/lib/fs-zds'
import { transitionToFileRoute } from '@src/lib/fileRouteTransition'
import {
  PATHS,
  joinOSPaths,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import {
  useHasListedProjects,
  useLastOperation,
  useProjectDirectoryPath,
  useRequestedFileName,
  useRequestedProjectName,
} from '@src/machines/systemIO/hooks'
import {
  NO_PROJECT_DIRECTORY,
  SystemIOMachineEvents,
  SystemIOMachineStates,
} from '@src/machines/systemIO/utils'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLocation } from 'react-router-dom'

export function SystemIOMachineLogicListener() {
  const { settings, systemIOActor } = useApp()
  const { kclManager } = useSingletons()
  // We gotta stop with this pattern. It doesn't scale. "Eager hook creation"
  const requestedProjectName = useRequestedProjectName()
  const requestedFileName = useRequestedFileName()
  const projectDirectoryPath = useProjectDirectoryPath()
  const hasListedProjects = useHasListedProjects()
  const lastOperation = useLastOperation()

  const navigate = useNavigate()
  const settingsValues = settings.useSettings()
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
    transitionToFileRoute({
      requestedPath,
      requestedFilePathWithExtension,
      requestedProjectDirectory,
      currentPathname: pathname,
      projectDirectoryPath: settingsValues.app.projectDirectory.current,
      kclManager,
      lsp: { onFileClose, onFileOpen },
      navigate,
      clearProjectIdQueryParam:
        lastOperation ===
        SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
    })
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

      const fileNavigationOperations = [
        SystemIOMachineStates.importFileFromURL,
        SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToFile,
        SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
        SystemIOMachineStates.bulkCreateAndDeletingKCLFilesAndNavigateToFile,
        SystemIOMachineStates.renamingFileAndNavigateToFile,
        SystemIOMachineStates.renamingFolderAndNavigateToFile,
      ]
      if (
        requestedFileName.project &&
        requestedFileName.file &&
        fileNavigationOperations.includes(lastOperation)
      ) {
        return
      }

      const isCreating = [
        SystemIOMachineStates.creatingProject,
        SystemIOMachineStates.bulkCreatingKCLFilesAndNavigateToProject,
        SystemIOMachineStates.bulkImportingProjectFilesAndNavigateToFile,
        SystemIOMachineStates.importFileFromURL,
      ].includes(lastOperation)
      const isHomeAndNotCreating = pathname === PATHS.HOME && !isCreating
      if (isHomeAndNotCreating) {
        // Don't navigate
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
    }, [requestedProjectName, lastOperation])
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
        requestedFileName.project
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
      if (pathname === PATHS.HOME || pathname === PATHS.HOME_SETTINGS) {
        systemIOActor.send({
          type: SystemIOMachineEvents.setProjectDirectoryPath,
          data: {
            requestedProjectDirectoryPath:
              settingsValues.app.projectDirectory.current || '',
          },
        })
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [settingsValues.app.projectDirectory.current, pathname])
  }

  const useDefaultProjectName = () => {
    useEffect(() => {
      systemIOActor.send({
        type: SystemIOMachineEvents.setDefaultProjectFolderName,
        data: {
          requestedDefaultProjectFolderName:
            settingsValues.projects.defaultProjectName.current || '',
        },
      })
      // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    }, [settingsValues.projects.defaultProjectName.current])
  }

  const useWatchingApplicationProjectDirectory = () => {
    useFileSystemWatcher(
      async (eventType, targetPath) => {
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
        const folderPath = `${projectDirectoryPath}${fsZds.sep}${folderName}`
        if (
          folderName !== NO_PROJECT_DIRECTORY &&
          (eventType === 'unlinkDir' || eventType === 'unlink') &&
          targetPath.includes(folderPath)
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
      settingsValues.app.projectDirectory.current
        ? [settingsValues.app.projectDirectory.current]
        : []
    )
  }

  useGlobalProjectNavigation()
  useGlobalFileNavigation()
  useApplicationProjectDirectory()
  useDefaultProjectName()
  useWatchingApplicationProjectDirectory()

  return null
}
