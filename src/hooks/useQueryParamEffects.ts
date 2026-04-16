import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import toast from 'react-hot-toast'

import { base64ToString } from '@src/lib/base64'
import type { ProjectsCommandSchema } from '@src/lib/commandBarConfigs/projectsCommandConfig'
import {
  ASK_TO_OPEN_QUERY_PARAM,
  CMD_GROUP_QUERY_PARAM,
  CMD_NAME_QUERY_PARAM,
  CODE_QUERY_PARAM,
  CREATE_FILE_URL_PARAM,
  DEFAULT_FILE_NAME,
  FILE_NAME_QUERY_PARAM,
  PRIVATE_PROJECT_QUERY_PARAM,
  POOL_QUERY_PARAM,
  PROJECT_ENTRYPOINT,
  PUBLIC_PROJECT_QUERY_PARAM,
  SHARED_PROJECT_QUERY_PARAM,
} from '@src/lib/constants'
import { isDesktop } from '@src/lib/isDesktop'
import type { FileLinkParams } from '@src/lib/links'
import {
  downloadPrivateProject,
  downloadPublicProject,
  downloadSharedProject,
} from '@src/lib/publicProject'
import fsZds from '@src/lib/fs-zds'
import { DEFAULT_WEB_PROJECT_NAME } from '@src/lib/routeLoaders'
import { useApp } from '@src/lib/boot'
import type { KclManager } from '@src/lang/KclManager'
import { err } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'

// For initializing the command arguments, we actually want `method` to be undefined
// so that we don't skip it in the command palette.
export type CreateFileSchemaMethodOptional = Omit<
  ProjectsCommandSchema['Import file from URL'],
  'method'
> & {
  method?: 'newProject' | 'existingProject'
}

/**
 * A set of hooks that watch for query parameters and dispatch a callback.
 * Currently watches for:
 * `?createFile`
 * "?cmd=<some-command-name>&groupId=<some-group-id>"
 */
export function useQueryParamEffects(kclManager: KclManager) {
  const app = useApp()
  const { auth, commands } = app
  const authState = auth.useAuthState()
  const [searchParams, setSearchParams] = useSearchParams()
  const hasAskToOpen = !isDesktop() && searchParams.has(ASK_TO_OPEN_QUERY_PARAM)
  // Let hasAskToOpen be handled by the OpenInDesktopAppHandler component first to avoid racing with it,
  // only deal with other params after user decided to open in desktop or web.
  // Without this the "Zoom to fit to shared model on web" test fails, although manually testing works due
  // to different timings.
  const shouldInvokeCreateFile =
    !hasAskToOpen && searchParams.has(CREATE_FILE_URL_PARAM)
  const shouldOpenPublicProject =
    !hasAskToOpen && searchParams.has(PUBLIC_PROJECT_QUERY_PARAM)
  const shouldOpenSharedProject =
    !hasAskToOpen && searchParams.has(SHARED_PROJECT_QUERY_PARAM)
  const shouldOpenPrivateProject =
    !hasAskToOpen && searchParams.has(PRIVATE_PROJECT_QUERY_PARAM)
  const shouldInvokeGenericCmd =
    !hasAskToOpen &&
    searchParams.has(CMD_NAME_QUERY_PARAM) &&
    searchParams.has(CMD_GROUP_QUERY_PARAM)

  /**
   * Watches for legacy `?create-file` hook, which share links currently use.
   */
  useEffect(() => {
    if (shouldInvokeCreateFile && authState.matches('loggedIn')) {
      const argDefaultValues = buildCreateFileCommandArgs(searchParams)
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
    if (!shouldOpenPublicProject || !authState.matches('loggedIn')) return

    const projectId = searchParams.get(PUBLIC_PROJECT_QUERY_PARAM)
    if (!projectId) {
      return
    }

    let cancelled = false
    const clearPublicProjectSearchParam = () => {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete(PUBLIC_PROJECT_QUERY_PARAM)
      setSearchParams(nextSearchParams)
    }

    void (async () => {
      console.info('[public-project] opening shared project from query param', {
        projectId,
      })
      const downloadedProject = await downloadPublicProject(projectId)
      const downloadFailed = err(downloadedProject)
      if (cancelled || downloadFailed) {
        if (!cancelled && downloadFailed) {
          console.error('[public-project] failed before import handoff', {
            projectId,
            message: downloadedProject.message,
          })
          clearPublicProjectSearchParam()
          toast.error(downloadedProject.message)
        }
        return
      }

      console.info('[public-project] handing parsed project to system IO', {
        projectId,
        projectName: downloadedProject.projectName,
        fileCount: downloadedProject.files.length,
        entrypointFilePath: downloadedProject.entrypointFilePath,
      })

      app.systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateProjectFilesAndNavigateToProject,
        data: {
          files: downloadedProject.files,
          requestedProjectName: downloadedProject.projectName,
          requestedFileNameWithExtension: downloadedProject.entrypointFilePath,
        },
      })
      clearPublicProjectSearchParam()
    })().catch((error) => {
      if (cancelled) {
        return
      }

      console.error('[public-project] unexpected failure while opening', {
        projectId,
        error,
      })
      clearPublicProjectSearchParam()

      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to open the shared project.'
      )
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldOpenPublicProject, setSearchParams, authState])

  useEffect(() => {
    if (!shouldOpenSharedProject || !authState.matches('loggedIn')) return

    const shareKey = searchParams.get(SHARED_PROJECT_QUERY_PARAM)
    if (!shareKey) {
      return
    }

    let cancelled = false
    const clearSharedProjectSearchParam = () => {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete(SHARED_PROJECT_QUERY_PARAM)
      setSearchParams(nextSearchParams)
    }

    void (async () => {
      console.info('[shared-project] opening project from share link', {
        shareKey,
      })
      const downloadedProject = await downloadSharedProject(shareKey)
      const downloadFailed = err(downloadedProject)
      if (cancelled || downloadFailed) {
        if (!cancelled && downloadFailed) {
          console.error('[shared-project] failed before import handoff', {
            shareKey,
            message: downloadedProject.message,
          })
          clearSharedProjectSearchParam()
          toast.error(downloadedProject.message)
        }
        return
      }

      console.info('[shared-project] handing parsed project to system IO', {
        shareKey,
        projectName: downloadedProject.projectName,
        fileCount: downloadedProject.files.length,
        entrypointFilePath: downloadedProject.entrypointFilePath,
      })

      app.systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateProjectFilesAndNavigateToProject,
        data: {
          files: downloadedProject.files,
          requestedProjectName: downloadedProject.projectName,
          requestedFileNameWithExtension: downloadedProject.entrypointFilePath,
        },
      })
      clearSharedProjectSearchParam()
    })().catch((error) => {
      if (cancelled) {
        return
      }

      console.error('[shared-project] unexpected failure while opening', {
        shareKey,
        error,
      })
      clearSharedProjectSearchParam()

      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to open the shared project.'
      )
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldOpenSharedProject, setSearchParams, authState])

  useEffect(() => {
    if (!shouldOpenPrivateProject || !authState.matches('loggedIn')) return

    const projectId = searchParams.get(PRIVATE_PROJECT_QUERY_PARAM)
    if (!projectId) {
      return
    }

    let cancelled = false
    const clearPrivateProjectSearchParam = () => {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete(PRIVATE_PROJECT_QUERY_PARAM)
      setSearchParams(nextSearchParams)
    }

    void (async () => {
      console.info('[private-project] opening private project from query param', {
        projectId,
      })
      const downloadedProject = await downloadPrivateProject(projectId)
      const downloadFailed = err(downloadedProject)
      if (cancelled || downloadFailed) {
        if (!cancelled && downloadFailed) {
          console.error('[private-project] failed before import handoff', {
            projectId,
            message: downloadedProject.message,
          })
          clearPrivateProjectSearchParam()
          toast.error(downloadedProject.message)
        }
        return
      }

      console.info('[private-project] handing parsed project to system IO', {
        projectId,
        projectName: downloadedProject.projectName,
        fileCount: downloadedProject.files.length,
        entrypointFilePath: downloadedProject.entrypointFilePath,
      })

      app.systemIOActor.send({
        type: SystemIOMachineEvents.bulkCreateProjectFilesAndNavigateToProject,
        data: {
          files: downloadedProject.files,
          requestedProjectName: downloadedProject.projectName,
          requestedFileNameWithExtension: downloadedProject.entrypointFilePath,
        },
      })
      clearPrivateProjectSearchParam()
    })().catch((error) => {
      if (cancelled) {
        return
      }

      console.error('[private-project] unexpected failure while opening', {
        projectId,
        error,
      })
      clearPrivateProjectSearchParam()

      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to open the private project.'
      )
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [shouldOpenPrivateProject, setSearchParams, authState])

  /**
   * Generic commands are triggered by query parameters
   * with the pattern: `?cmd=<command-name>&groupId=<group-id>`
   */
  useEffect(() => {
    if (!shouldInvokeGenericCmd || !authState.matches('loggedIn')) return

    const rawCommandData = buildGenericCommandArgs(searchParams)
    if (!rawCommandData) return
    const commandData = rawCommandData

    // Web-only: prefill command data to automatically add to the demo project
    if (!isDesktop() && commandData.name === 'add-kcl-file-to-project') {
      if (commandData.argDefaultValues?.projectName === 'browser') {
        const currentProjectName =
          app.settings.actor.getSnapshot().context.currentProject?.name
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

      if (foldersIncludeProject(systemIO.getSnapshot().context.folders)) {
        sendCommand()
        return
      }

      const subscription = systemIO.subscribe((snapshot) => {
        if (foldersIncludeProject(snapshot.context.folders)) {
          subscription.unsubscribe()
          sendCommand()
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

function buildCreateFileCommandArgs(searchParams: URLSearchParams) {
  const params: Omit<FileLinkParams, 'isRestrictedToOrg'> = {
    code: base64ToString(decodeURIComponent(searchParams.get('code') ?? '')),
    name: searchParams.get('name') ?? DEFAULT_FILE_NAME,
  }

  const argDefaultValues: CreateFileSchemaMethodOptional = {
    name: PROJECT_ENTRYPOINT,
    code: params.code || '',
    method: isDesktop() ? undefined : 'existingProject',
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
