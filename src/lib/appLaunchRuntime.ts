import type { App } from '@src/lib/app'
import type { AppLaunchDependencies, LaunchExecution } from '@src/lib/appLaunch'
import { base64ToString } from '@src/lib/base64'
import { ASK_TO_OPEN_QUERY_PARAM, PROJECT_ENTRYPOINT } from '@src/lib/constants'
import {
  downloadProjectById,
  getPublicProjectNameById,
} from '@src/lib/downloadProject'
import fsZds from '@src/lib/fs-zds'
import { restoreApplicationDestination } from '@src/lib/initializeApplication'
import { isDesktop } from '@src/lib/isDesktop'
import { downloadKclSample } from '@src/lib/kclSamples'
import {
  DIRECTORY_PROJECT_LIBRARY_TYPE,
  PERSONAL_CLOUD_PROJECT_LIBRARY_ID,
} from '@src/lib/projectLibraries'
import { getProjectDirectoryNameFromTitle } from '@src/lib/projectName'
import { DEFAULT_WEB_PROJECT_NAME } from '@src/lib/routeInit'
import { err, isErr } from '@src/lib/trap'
import { SystemIOMachineEvents } from '@src/machines/systemIO/events'
import { SystemIOMachineStates } from '@src/machines/systemIO/states'
import type { AppLaunchInput } from '@src/registry/contracts/appLaunch'
import { appNavigationService } from '@src/registry/contracts/appNavigation'
import { appUrlService } from '@src/registry/contracts/appUrl'
import { cloudSyncService } from '@src/registry/contracts/cloudSync'
import { zookeeperPromptService } from '@src/registry/contracts/zookeeperPrompt'
import toast from 'react-hot-toast'
import { waitFor } from 'xstate'

type LaunchCommand = {
  name: string
  groupId: string
  argDefaultValues: Record<string, unknown>
}

/** Adapt the existing share/import workflows to one owned launch operation. */
export function createAppLaunchDependencies(app: App): AppLaunchDependencies {
  const desktop = isDesktop()
  const reportError = (error: unknown) => {
    toast.error(err(error) ? error.message : 'Failed to open this link.')
  }

  const waitForProjectServices = async (signal: AbortSignal) => {
    signal.throwIfAborted()
    await waitFor(
      app.systemIOActor,
      (state) => state.matches(SystemIOMachineStates.idle),
      { signal }
    )
    signal.throwIfAborted()
    await waitFor(app.settings.actor, (state) => state.matches('idle'), {
      signal,
    })
    signal.throwIfAborted()
  }

  const dispatchCommand = async (
    command: LaunchCommand,
    signal: AbortSignal
  ) => {
    signal.throwIfAborted()
    // Avoid the command service's global pending queue: a canceled launch must
    // not execute later when an unrelated project registers the command.
    try {
      await waitFor(
        app.commands.actor,
        (state) =>
          state.context.commands.some(
            (registered) =>
              registered.name === command.name &&
              registered.groupId === command.groupId
          ),
        { signal, timeout: 30_000 }
      )
    } catch (error) {
      if (signal.aborted) return Promise.reject(error)
      return Promise.reject(
        new Error(
          `The command "${command.groupId}/${command.name}" is unavailable.`,
          { cause: error }
        )
      )
    }
    signal.throwIfAborted()
    app.commands.send({ type: 'Find and select command', data: command })
  }

  const execute = async (
    input: AppLaunchInput,
    { signal, openProject }: LaunchExecution
  ) => {
    const { request } = input
    const startup = {
      search: input.remainingSearch,
      hash: input.urlState.hash,
    }
    const openTarget = async (target: string) => {
      signal.throwIfAborted()
      await openProject({ target, startup })
      signal.throwIfAborted()
    }

    signal.throwIfAborted()
    await restoreApplicationDestination(
      app,
      {
        type: 'launch',
        destination:
          input.destination.type === 'sign-in'
            ? { type: 'index' }
            : input.destination,
        ...input.urlState,
        search: input.remainingSearch,
      },
      { openProject, signal, projectUrl: true }
    )
    signal.throwIfAborted()

    if (request.projectId) {
      await waitForProjectServices(signal)
      signal.throwIfAborted()
      const target = app.getCreateProjectLibraryTargets()[0]
      if (!target) {
        return Promise.reject(
          new Error('No writable project library is available.')
        )
      }
      const projectName = await getPublicProjectNameById(request.projectId)
      signal.throwIfAborted()
      if (isErr(projectName)) return Promise.reject(projectName)
      const downloaded = await downloadProjectById(request.projectId)
      signal.throwIfAborted()
      if (isErr(downloaded)) return Promise.reject(downloaded)
      const project = await target.createProject.run({
        library: target.library,
        requestedProjectName: getProjectDirectoryNameFromTitle(
          projectName,
          'shared-project'
        ),
        requestedProjectTitle: projectName,
        initialProject: {
          files: downloaded.files,
          entrypointFilePath:
            downloaded.entrypointFilePath ?? PROJECT_ENTRYPOINT,
        },
      })
      signal.throwIfAborted()
      if (!project?.default_file) {
        return Promise.reject(new Error('Unable to create the shared project.'))
      }
      const cloudSync = app.registry.get(cloudSyncService)
      if (
        target.library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID &&
        cloudSync.status.value.enabled
      ) {
        await cloudSync.syncNow(project.path)
        signal.throwIfAborted()
      }
      await openTarget(project.default_file)
      signal.throwIfAborted()
    }

    const command = request.genericCommand
      ? {
          ...request.genericCommand,
          argDefaultValues: { ...request.genericCommand.argDefaultValues },
        }
      : undefined

    if (
      !desktop &&
      command?.groupId === 'application' &&
      command.name === 'set-layout' &&
      !app.project
    ) {
      await waitForProjectServices(signal)
      signal.throwIfAborted()
      const targets = app.getCreateProjectLibraryTargets()
      const target =
        targets.find(
          ({ library }) => library.id === PERSONAL_CLOUD_PROJECT_LIBRARY_ID
        ) ?? targets[0]
      if (!target) {
        return Promise.reject(
          new Error('No writable project library is available.')
        )
      }
      const project = await target.createProject.run({
        library: target.library,
        requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
        requestedProjectTitle: DEFAULT_WEB_PROJECT_NAME,
      })
      signal.throwIfAborted()
      if (!project?.default_file) {
        return Promise.reject(new Error('Unable to create a blank project.'))
      }
      await openTarget(project.default_file)
      signal.throwIfAborted()
    }

    let importedSample = false
    const samplePath = command?.argDefaultValues.sample
    const requestedProjectName = command?.argDefaultValues.projectName
    if (
      !desktop &&
      command?.name === 'add-kcl-file-to-project' &&
      command.groupId === 'application' &&
      command.argDefaultValues.source === 'kcl-samples' &&
      typeof samplePath === 'string' &&
      (requestedProjectName === 'browser' ||
        requestedProjectName === DEFAULT_WEB_PROJECT_NAME)
    ) {
      await waitForProjectServices(signal)
      signal.throwIfAborted()
      const target = app.getCreateProjectLibraryTargets()[0]
      if (!target) {
        return Promise.reject(
          new Error('No writable project library is available.')
        )
      }
      const sample = await downloadKclSample(samplePath)
      signal.throwIfAborted()
      const project = await target.createProject.run({
        library: target.library,
        requestedProjectName: sample.requestedProjectName,
        requestedProjectTitle: sample.sample.title,
        initialProject: sample.initialProject,
      })
      signal.throwIfAborted()
      if (!project?.default_file) {
        return Promise.reject(new Error('Unable to create the sample project.'))
      }
      await openTarget(project.default_file)
      signal.throwIfAborted()
      importedSample = true
    }

    if (
      !desktop &&
      !importedSample &&
      command?.name === 'add-kcl-file-to-project'
    ) {
      const currentProjectName =
        app.settings.actor.getSnapshot().context.currentProject?.name
      const requestedBrowserProject =
        command.argDefaultValues.projectName === 'browser' ||
        command.argDefaultValues.projectName === DEFAULT_WEB_PROJECT_NAME
      if (requestedBrowserProject) {
        command.argDefaultValues.projectName =
          currentProjectName ?? DEFAULT_WEB_PROJECT_NAME
        if (!currentProjectName) {
          await waitForProjectServices(signal)
          signal.throwIfAborted()
          const snapshot = app.systemIOActor.getSnapshot()
          if (
            !snapshot.context.folders?.some(
              ({ name }) => name === DEFAULT_WEB_PROJECT_NAME
            )
          ) {
            const targets = app.getCreateProjectLibraryTargets()
            // The legacy command creates under SystemIO's directory. Use the
            // library operation so navigation stays owned by this launch.
            const target =
              targets.find(
                ({ library }) =>
                  library.path === snapshot.context.projectDirectoryPath
              ) ??
              targets.find(
                ({ library }) => library.type === DIRECTORY_PROJECT_LIBRARY_TYPE
              ) ??
              targets[0]
            if (!target) {
              return Promise.reject(
                new Error('No writable project library is available.')
              )
            }
            const project = await target.createProject.run({
              library: target.library,
              requestedProjectName: DEFAULT_WEB_PROJECT_NAME,
              requestedProjectTitle: DEFAULT_WEB_PROJECT_NAME,
            })
            signal.throwIfAborted()
            if (!project?.default_file) {
              return Promise.reject(
                new Error('Unable to create the default project.')
              )
            }
            await openTarget(project.default_file)
            signal.throwIfAborted()
            command.argDefaultValues.projectName = project.name
            app.systemIOActor.send({
              type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
            })
          }
        }
      }
      if (command.argDefaultValues.projectName) {
        command.argDefaultValues.method = 'existingProject'
      }
    }

    // Retain the prompt in its final project's runtime before waiting for a
    // command or lazy pane. This prefills the input; it never submits a prompt.
    if (request.zookeeperPrompt) {
      signal.throwIfAborted()
      const projectPath = app.project?.projectIORefSignal.value.path
      const prompts = app.registry.optional(zookeeperPromptService)
      if (
        !projectPath ||
        !prompts?.seedPrompt(projectPath, request.zookeeperPrompt)
      ) {
        reportError(new Error('Unable to prefill Zookeeper for this project.'))
      }
    }

    if (request.createFile) {
      signal.throwIfAborted()
      await dispatchCommand(
        {
          groupId: 'projects',
          name: 'Import file from URL',
          argDefaultValues: {
            name: PROJECT_ENTRYPOINT,
            code: base64ToString(request.createFile.code),
            method: desktop ? undefined : 'existingProject',
            ...(!desktop
              ? {
                  projectName:
                    app.settings.actor.getSnapshot().context.currentProject
                      ?.name ?? DEFAULT_WEB_PROJECT_NAME,
                }
              : {}),
          },
        },
        signal
      )
      signal.throwIfAborted()
    }

    if (!command || importedSample) return

    if (
      !desktop &&
      command.name === 'add-kcl-file-to-project' &&
      command.argDefaultValues.projectName
    ) {
      const projectName = fsZds.basename(command.argDefaultValues.projectName)
      await waitFor(
        app.systemIOActor,
        (snapshot) =>
          snapshot.context.folders?.some(({ name }) => name === projectName) ??
          false,
        { signal }
      )
      signal.throwIfAborted()
    }
    await dispatchCommand(command, signal)
    signal.throwIfAborted()
  }

  return {
    isLoggedIn: app.auth.isLoggedIn,
    navigation: app.registry.get(appNavigationService),
    isDesktop: desktop,
    execute,
    chooseWeb: async (input) => {
      const appUrl = app.registry.get(appUrlService)
      const location = appUrl.getLocation()
      const search = new URLSearchParams(location.search)
      search.delete(ASK_TO_OPEN_QUERY_PARAM)
      const remaining = search.toString()
      const originalSearch = new URLSearchParams(input.urlState.search)
      originalSearch.delete(ASK_TO_OPEN_QUERY_PARAM)
      const originalRemaining = originalSearch.toString()
      input.urlState.search = originalRemaining ? `?${originalRemaining}` : ''
      await appUrl.navigate(
        {
          pathname: location.pathname,
          search: remaining ? `?${remaining}` : '',
          hash: location.hash,
        },
        { replace: true }
      )
    },
    reportError,
  }
}
