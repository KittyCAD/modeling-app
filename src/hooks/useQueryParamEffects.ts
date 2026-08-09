import { base64ToString } from '@src/lib/base64'
import type { App } from '@src/lib/app'
import { useApp } from '@src/lib/boot'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CODE_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  FILE_NAME_QUERY_PARAM,
  POOL_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
  PROJECT_ID_QUERY_PARAM,
  LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
  SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
} from '@src/lib/constants'
import {
  downloadProjectById,
  getPublicProjectNameById,
} from '@src/lib/downloadProject'
import { getUniqueProjectName } from '@src/lib/desktopFS'
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import { downloadKclSample } from '@src/lib/kclSamples'
import { PATHS, safeEncodeForRouterPaths } from '@src/lib/paths'
import { navigateToProjectFile } from '@src/lib/projectSessionNavigation'
import {
  CLOUD_PROJECT_LIBRARY_TYPE,
  getDefaultDirectoryProjectLibraryPath,
} from '@src/lib/projectLibraries'
import { DEFAULT_WEB_PROJECT_NAME } from '@src/lib/routeLoaders'
import { err } from '@src/lib/trap'
import { getAllSubDirectoriesAtProjectRoot } from '@src/lib/projectTree'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { homeProjectEntriesValueSpec } from '@src/registry/contracts/homeProjects'
import { projectLibraryRealizationsService } from '@src/registry/contracts/projectLibraries'
import {
  type ProjectSessionService,
  projectSession,
} from '@src/registry/contracts/projectSession'
import { useEffect } from 'react'
import toast from 'react-hot-toast'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { waitFor } from 'xstate'

// For initializing the command arguments, we actually want `method` to be undefined
// so that we don't skip it in the command palette.
export type CreateFileSchemaMethodOptional = Omit<
  ProjectsCommandSchema['Import file from URL'],
  'method'
> & {
  method?: 'newProject' | 'existingProject'
}

let pendingWebLayoutProjectCreation: Promise<string> | undefined

async function createFreshWebLayoutProject(
  app: App,
  projectSession: ProjectSessionService
) {
  await projectSession.waitForIdle()
  await waitFor(app.settings.actor, (state) => state.matches('idle'))

  const project = await projectSession.createKclFiles({
    requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
    requestedProjectTitle: DEFAULT_WEB_PROJECT_NAME,
    useReservedProjectName: true,
    files: [
      {
        requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
        requestedFileName: PROJECT_ENTRYPOINT,
        requestedCode: '',
      },
    ],
  })

  return project.filePath ?? fsZds.join(project.projectRoot, PROJECT_ENTRYPOINT)
}

/**
 * A set of hooks that watch for query parameters and dispatch a callback.
 * Currently watches for:
 * `?createFile`
 * "?cmd=<some-command-name>&groupId=<some-group-id>"
 */
export function useQueryParamEffects() {
  const app = useApp()
  const { auth, commands } = app
  const session = app.registry.get(projectSession)
  const authState = auth.useAuthState()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const hasAskToOpen = !isDesktop() && searchParams.has(ASK_TO_OPEN_QUERY_PARAM)
  // Let hasAskToOpen be handled by the OpenInDesktopAppHandler component first to avoid racing with it,
  // only deal with other params after user decided to open in desktop or web.
  // Without this the "Zoom to fit to shared model on web" test fails, although manually testing works due
  // to different timings.
  const shouldInvokeCreateFile =
    !hasAskToOpen && searchParams.has(CREATE_FILE_URL_PARAM)
  const shouldOpenProjectId =
    !hasAskToOpen && searchParams.has(PROJECT_ID_QUERY_PARAM)
  const shouldInvokeGenericCmd =
    !hasAskToOpen &&
    searchParams.has(CMD_NAME_QUERY_PARAM) &&
    searchParams.has(CMD_GROUP_QUERY_PARAM)

  function getCurrentCloudLibraryPath() {
    const currentProject =
      session.project.value?.projectIORefSignal.value
    return currentProject?.libraryType === CLOUD_PROJECT_LIBRARY_TYPE
      ? currentProject.libraryPath
      : undefined
  }

  /**
   * Watches for legacy `?create-file` hook, which share links currently use.
   */
  useEffect(() => {
    if (shouldInvokeCreateFile && authState.matches('loggedIn')) {
      const webProjectName = !isDesktop()
        ? (app.settings.actor.getSnapshot().context.currentProject?.name ??
          DEFAULT_WEB_PROJECT_NAME)
        : undefined
      const argDefaultValues = buildCreateFileCommandArgs(
        searchParams,
        webProjectName
      )
      commands.send({
        type: 'Find and select command',
        data: {
          groupId: 'projects',
          name: 'Import file from URL',
          argDefaultValues,
        },
      })

      // Delete the query params after the command has been invoked.
      searchParams.delete(CREATE_FILE_URL_PARAM)
      searchParams.delete(FILE_NAME_QUERY_PARAM)
      searchParams.delete(CODE_QUERY_PARAM)
      setSearchParams(searchParams)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldInvokeCreateFile, setSearchParams, authState])

  useEffect(() => {
    if (!shouldOpenProjectId || !authState.matches('loggedIn')) return

    const projectId = searchParams.get(PROJECT_ID_QUERY_PARAM)
    if (!projectId) {
      return
    }

    let cancelled = false
    const clearProjectIdSearchParam = () => {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete(PROJECT_ID_QUERY_PARAM)
      setSearchParams(nextSearchParams)
    }

    void (async () => {
      await session.waitForIdle()
      if (cancelled) {
        return
      }

      const targetProjectDirectoryPath = getCurrentCloudLibraryPath()
      const localCloudProject = targetProjectDirectoryPath
        ? await app.registry
            .get(cloudSyncService)
            .ensureProjectLocallySynced(projectId, targetProjectDirectoryPath)
            .catch(() => undefined)
        : undefined
      if (cancelled) {
        return
      }
      if (localCloudProject) {
        app.registry.optional(projectLibraryRealizationsService)?.invalidate()
        void navigate(
          `${PATHS.FILE}/${safeEncodeForRouterPaths(
            localCloudProject.projectPath
          )}`
        )
        return
      }

      const reservedProjectDestination =
        await getReservedProjectDestination(projectId)
      if (err(reservedProjectDestination)) {
        clearProjectIdSearchParam()
        toast.error(reservedProjectDestination.message)
        return
      }
      if (cancelled) {
        return
      }

      const downloadedProject = await downloadProjectById(projectId)
      if (err(downloadedProject)) {
        return Promise.reject(downloadedProject)
      }
      if (cancelled) {
        return
      }

      const files = !isDesktop()
        ? downloadedProject.files.map((file) => ({
            ...file,
            requestedProjectName:
              reservedProjectDestination.requestedProjectName,
            requestedFileName: fsZds.join(
              reservedProjectDestination.requestedSubDirectoryName,
              file.requestedFileName
            ),
          }))
        : downloadedProject.files
      const requestedFileNameWithExtension =
        !isDesktop() && downloadedProject.entrypointFilePath
          ? fsZds.join(
              reservedProjectDestination.requestedSubDirectoryName,
              downloadedProject.entrypointFilePath
            )
          : downloadedProject.entrypointFilePath

      const importedProject = await session.importProjectFiles({
        files,
        requestedProjectName: reservedProjectDestination.requestedProjectName,
        requestedFileNameWithExtension,
      })
      if (cancelled) {
        return
      }

      await navigateToProjectFile({
        app,
        filePath: importedProject.filePath ?? importedProject.projectRoot,
      })
    })().catch((error) => {
      if (cancelled) {
        return
      }

      clearProjectIdSearchParam()
      toast.error(
        err(error) ? error.message : 'Failed to open the shared project.'
      )
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldOpenProjectId, setSearchParams, authState])

  async function getReservedProjectDestination(projectId: string): Promise<
    | {
        requestedProjectName: string
        requestedSubDirectoryName: string
      }
    | Error
  > {
    const projectName = await getPublicProjectNameById(projectId)
    if (projectName instanceof Error) {
      return projectName
    }

    await waitFor(app.settings.actor, (state) => state.matches('idle'))

    const projectDirectoryPath = getDefaultDirectoryProjectLibraryPath(
      app.settings.get().app.libraries.current
    )
    if (!projectDirectoryPath) {
      return new Error('Unable to determine the project directory.')
    }

    if (isDesktop()) {
      const projectDirectoryEntries = await fsZds.readdir(projectDirectoryPath)
      const requestedProjectName = getUniqueProjectName(
        projectName,
        projectDirectoryEntries.map((name) => ({
          name,
          path: fsZds.join(projectDirectoryPath, name),
          children: [],
        }))
      )
      await fsZds.mkdir(
        fsZds.join(projectDirectoryPath, requestedProjectName),
        {
          recursive: true,
        }
      )
      return {
        requestedProjectName,
        requestedSubDirectoryName: projectName,
      }
    }

    const requestedProjectName =
      app.settings.actor.getSnapshot().context.currentProject?.name ??
      DEFAULT_WEB_PROJECT_NAME
    const projectTree = session.getProjectTree()
    const requestedSubDirectoryName = getUniqueProjectName(
      projectName,
      getAllSubDirectoriesAtProjectRoot(
        { folders: projectTree ? [projectTree] : [] },
        {
          projectFolderName: requestedProjectName,
        }
      )
    )
    await fsZds.mkdir(
      fsZds.join(
        projectDirectoryPath,
        requestedProjectName,
        requestedSubDirectoryName
      ),
      { recursive: true }
    )

    return {
      requestedProjectName,
      requestedSubDirectoryName,
    }
  }

  /**
   * Generic commands are triggered by query parameters
   * with the pattern: `?cmd=<command-name>&groupId=<group-id>`
   */
  useEffect(() => {
    if (!shouldInvokeGenericCmd || !authState.matches('loggedIn')) return

    const rawCommandData = buildGenericCommandArgs(searchParams)
    if (!rawCommandData) return
    const commandData = rawCommandData
    const shouldCreateWebLayoutProject =
      !isDesktop() &&
      commandData.groupId === 'application' &&
      commandData.name === 'set-layout' &&
      !session.project.value

    if (shouldCreateWebLayoutProject) {
      let cancelled = false
      pendingWebLayoutProjectCreation ??= createFreshWebLayoutProject(
        app,
        projectSession
      )

      void pendingWebLayoutProjectCreation
        .then((defaultFile) => {
          if (cancelled) {
            return
          }

          void navigate(
            {
              pathname: `${PATHS.FILE}/${safeEncodeForRouterPaths(defaultFile)}`,
              search: searchParams.toString(),
            },
            { replace: true }
          )
        })
        .catch((error) => {
          pendingWebLayoutProjectCreation = undefined
          if (!cancelled) {
            toast.error(
              err(error) ? error.message : 'Failed to create a blank project.'
            )
          }
        })

      return () => {
        cancelled = true
      }
    }

    if (
      !isDesktop() &&
      commandData.groupId === 'application' &&
      commandData.name === 'set-layout'
    ) {
      pendingWebLayoutProjectCreation = undefined
    }

    let shouldCreateDefaultWebProject = false
    const samplePath = commandData.argDefaultValues?.sample
    const requestedProjectName = commandData.argDefaultValues?.projectName
    const shouldCreateWebSampleProject =
      !isDesktop() &&
      commandData.name === 'add-kcl-file-to-project' &&
      commandData.groupId === 'application' &&
      commandData.argDefaultValues?.source === 'kcl-samples' &&
      typeof samplePath === 'string' &&
      (requestedProjectName === 'browser' ||
        requestedProjectName === DEFAULT_WEB_PROJECT_NAME)

    if (shouldCreateWebSampleProject) {
      let cancelled = false

      void (async () => {
        await session.waitForIdle()
        if (cancelled) {
          return
        }

        await waitFor(app.settings.actor, (state) => state.matches('idle'))
        if (cancelled) {
          return
        }

        const downloadedSample = await downloadKclSample(samplePath)
        if (cancelled) {
          return
        }

        const importedProject = await session.importProjectFiles({
          files: downloadedSample.initialProject.files.map((file) => ({
            ...file,
            requestedProjectName: downloadedSample.requestedProjectName,
          })),
          requestedProjectName: downloadedSample.requestedProjectName,
          requestedFileNameWithExtension:
            downloadedSample.initialProject.entrypointFilePath,
        })
        if (cancelled) {
          return
        }

        await navigateToProjectFile({
          app,
          filePath: importedProject.filePath ?? importedProject.projectRoot,
        })
      })().catch((error) => {
        if (cancelled) {
          return
        }

        cleanupQueryParams()
        toast.error(
          err(error) ? error.message : 'Failed to open the KCL sample.'
        )
      })

      return () => {
        cancelled = true
      }
    }

    // Web-only: prefill command data to automatically add to the demo project
    if (!isDesktop() && commandData.name === 'add-kcl-file-to-project') {
      const currentProjectName =
        app.settings.actor.getSnapshot().context.currentProject?.name
      const requestedBrowserProject =
        commandData.argDefaultValues?.projectName === 'browser' ||
        commandData.argDefaultValues?.projectName === DEFAULT_WEB_PROJECT_NAME
      if (requestedBrowserProject) {
        shouldCreateDefaultWebProject = !currentProjectName
        commandData.argDefaultValues.projectName =
          currentProjectName ?? DEFAULT_WEB_PROJECT_NAME
      }
      if (commandData.argDefaultValues?.projectName) {
        commandData.argDefaultValues.method = 'existingProject'
      }
    }

    // Helper function to send the command exactly once
    let sent = false
    function sendCommand() {
      if (sent) return
      sent = true
      commands.send({
        type: 'Find and select command',
        data: commandData,
      })
      cleanupQueryParams()
    }

    // Web-only: make sure the default browser project exists before sending
    // commands that target it.
    if (
      !isDesktop() &&
      commandData.name === 'add-kcl-file-to-project' &&
      commandData.argDefaultValues?.projectName
    ) {
      const projectNameArg = String(commandData.argDefaultValues.projectName)
      const projectFolderName = fsZds.basename(projectNameArg)

      let cancelled = false
      void (async () => {
        const projectExists =
          session.getProjectTree()?.name === projectFolderName ||
          app.registry
            .get(homeProjectEntriesValueSpec)
            .some(
              (project) =>
                project.localProjectName === projectFolderName ||
                project.name === projectFolderName
            )
        if (
          shouldCreateDefaultWebProject &&
          !projectExists &&
          projectFolderName === DEFAULT_WEB_PROJECT_NAME
        ) {
          await session.createKclFiles({
            requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
            useReservedProjectName: true,
            files: [
              {
                requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
                requestedFileName: PROJECT_ENTRYPOINT,
                requestedCode: '',
              },
            ],
          })
        }

        await session.waitForIdle()
        if (!cancelled) {
          sendCommand()
        }
      })().catch(() => {
        if (!cancelled) {
          toast.error('Unable to prepare the browser project.')
        }
      })
      return () => {
        cancelled = true
      }
    }

    sendCommand()

    // Helper function to clean up query parameters
    function cleanupQueryParams() {
      // Delete all the query parameters that aren't reserved
      searchParams.delete(CMD_NAME_QUERY_PARAM)
      searchParams.delete(CMD_GROUP_QUERY_PARAM)
      const keysToDelete = [...searchParams.entries()]
        // Filter out known keys
        .filter(([key]) => {
          const reservedKeys = [
            CMD_NAME_QUERY_PARAM,
            CMD_GROUP_QUERY_PARAM,
            CREATE_FILE_URL_PARAM,
            POOL_QUERY_PARAM,
            SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
            LEGACY_SEARCH_PARAM_ZOOKEEPER_PROMPT_KEY,
          ]

          return !reservedKeys.includes(key)
        })

      for (const [key] of keysToDelete) {
        searchParams.delete(key)
      }
      setSearchParams(searchParams)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldInvokeGenericCmd, setSearchParams, authState])
}

function buildCreateFileCommandArgs(
  searchParams: URLSearchParams,
  webProjectName?: string
) {
  const argDefaultValues: CreateFileSchemaMethodOptional = {
    name: PROJECT_ENTRYPOINT,
    code: base64ToString(decodeURIComponent(searchParams.get('code') ?? '')),
    method: isDesktop() ? undefined : 'existingProject',
  }
  if (!isDesktop()) {
    argDefaultValues.projectName = webProjectName ?? DEFAULT_WEB_PROJECT_NAME
  }

  return argDefaultValues
}

function buildGenericCommandArgs(searchParams: URLSearchParams) {
  // We have already verified these exist before calling
  const name = searchParams.get('cmd')
  const groupId = searchParams.get('groupId')

  if (!name || !groupId) {
    return
  }

  const filteredParams = [...searchParams.entries()]
    // Filter out known keys
    .filter(
      ([key]) =>
        [
          CMD_NAME_QUERY_PARAM,
          CMD_GROUP_QUERY_PARAM,
          CREATE_FILE_URL_PARAM,
          POOL_QUERY_PARAM,
        ].indexOf(key) === -1
    )
  const argDefaultValues = filteredParams.reduce(
    (acc, [key, value]) => {
      const decodedKey = decodeURIComponent(key)
      const decodedValue = decodeURIComponent(value)
      acc[decodedKey] = decodedValue
      return acc
    },
    {} as Record<string, string>
  )

  return {
    name,
    groupId,
    argDefaultValues,
  }
}
