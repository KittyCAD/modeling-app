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
import fsZds from '@src/lib/fs-zds'
import { isDesktop } from '@src/lib/isDesktop'
import { downloadKclSample } from '@src/lib/kclSamples'
import { PATHS, safeEncodeForRouterPaths } from '@src/lib/paths'
import { PERSONAL_CLOUD_PROJECT_LIBRARY_ID } from '@src/lib/projectLibraries'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { DEFAULT_WEB_PROJECT_NAME } from '@src/lib/routeLoaders'
import { err } from '@src/lib/trap'
import {
  SystemIOMachineEvents,
  SystemIOMachineStates,
  waitForIdleState,
} from '@src/machines/systemIO/utils'
import { projectSession } from '@src/registry/contracts/projectSession'
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

async function createFreshWebLayoutProject(app: App) {
  await waitForIdleState({ systemIOActor: app.systemIOActor })
  await waitFor(app.settings.actor, (state) => state.matches('idle'))

  const targets = app.getCreateProjectLibraryTargets()
  const projectLibraryTarget =
    targets.find(
      (target) => target.library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
    ) ?? targets[0]
  if (!projectLibraryTarget) {
    return Promise.reject(
      new Error('No writable project library is available.')
    )
  }

  const project = await projectLibraryTarget.createProject.run({
    library: projectLibraryTarget.library,
    requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
    requestedProjectTitle: DEFAULT_WEB_PROJECT_NAME,
  })
  if (!project?.default_file) {
    return Promise.reject(new Error('Unable to create a blank project.'))
  }

  return project.default_file
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
      // File navigation removes the project-id param while preserving the new
      // file route. Calling setSearchParams here can re-navigate from the
      // original query-param route and reopen the project default file.
      await waitForIdleState({ systemIOActor: app.systemIOActor })
      if (cancelled) {
        return
      }

      await waitFor(app.settings.actor, (state) => state.matches('idle'))
      if (cancelled) {
        return
      }

      const projectLibraryTarget = app.getCreateProjectLibraryTargets()[0]
      if (!projectLibraryTarget) {
        return Promise.reject(
          new Error('No writable project library is available.')
        )
      }

      const projectName = await getPublicProjectNameById(projectId)
      if (err(projectName)) {
        return Promise.reject(projectName)
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

      const importedProject = await projectLibraryTarget.createProject.run({
        library: projectLibraryTarget.library,
        requestedProjectName: getProjectDirectoryNameFromTitle(
          projectName,
          'shared-project'
        ),
        requestedProjectTitle: projectName,
        initialProject: {
          files: downloadedProject.files,
          entrypointFilePath:
            downloadedProject.entrypointFilePath ?? PROJECT_ENTRYPOINT,
        },
      })
      if (!importedProject?.default_file) {
        return Promise.reject(new Error('Unable to create the shared project.'))
      }
      if (cancelled) {
        return
      }

      void navigate(
        `${PATHS.FILE}/${safeEncodeForRouterPaths(
          importedProject.default_file
        )}`
      )
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
      pendingWebLayoutProjectCreation ??= createFreshWebLayoutProject(app)

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
        await waitForIdleState({ systemIOActor: app.systemIOActor })
        if (cancelled) {
          return
        }

        await waitFor(app.settings.actor, (state) => state.matches('idle'))
        if (cancelled) {
          return
        }

        const projectLibraryTarget = app.getCreateProjectLibraryTargets()[0]
        if (!projectLibraryTarget) {
          return Promise.reject(
            new Error('No writable project library is available.')
          )
        }

        const downloadedSample = await downloadKclSample(samplePath)
        if (cancelled) {
          return
        }

        const importedProject = await projectLibraryTarget.createProject.run({
          library: projectLibraryTarget.library,
          requestedProjectName: downloadedSample.requestedProjectName,
          requestedProjectTitle: downloadedSample.sample.title,
          initialProject: downloadedSample.initialProject,
        })
        if (!importedProject?.default_file) {
          return Promise.reject(
            new Error('Unable to create the sample project.')
          )
        }
        if (cancelled) {
          return
        }

        void navigate(
          `${PATHS.FILE}/${safeEncodeForRouterPaths(
            importedProject.default_file
          )}`
        )
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

    // Web-only: wait for folders to load before sending the command
    if (
      !isDesktop() &&
      commandData.name === 'add-kcl-file-to-project' &&
      commandData.argDefaultValues?.projectName
    ) {
      const projectNameArg = String(commandData.argDefaultValues.projectName)
      const projectFolderName = fsZds.basename(projectNameArg)

      const systemIO = app.systemIOActor
      const foldersIncludeProject = (folders: { name: string }[] | undefined) =>
        (folders ?? []).some((f) => f.name === projectFolderName)
      let hasRequestedProjectCreate = false
      const sendOrCreateProject = (
        snapshot: ReturnType<typeof systemIO.getSnapshot>
      ) => {
        if (foldersIncludeProject(snapshot.context.folders)) {
          sendCommand()
          return true
        }

        if (
          shouldCreateDefaultWebProject &&
          !hasRequestedProjectCreate &&
          projectFolderName === DEFAULT_WEB_PROJECT_NAME &&
          snapshot.matches(SystemIOMachineStates.idle) &&
          snapshot.context.folders !== undefined
        ) {
          hasRequestedProjectCreate = true
          systemIO.send({
            type: SystemIOMachineEvents.createProject,
            data: {
              requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
            },
          })
        }

        return false
      }

      if (sendOrCreateProject(systemIO.getSnapshot())) {
        return
      }

      const subscription = systemIO.subscribe((snapshot) => {
        if (sendOrCreateProject(snapshot)) {
          subscription.unsubscribe()
        }
      })
      return () => subscription.unsubscribe()
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
