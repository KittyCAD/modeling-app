import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { type Signal, effect, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import {
  type PreparedZookeeperPatchFileReplay,
  buildZookeeperHistoryExtension,
} from '@src/editor/plugins/zookeeper'
import { ZDSProject } from '@src/lang/KclManager'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { getProjectInfo } from '@src/lib/desktop'
import { getStringAfterLastSeparator } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  type ExecutingEditorHandle,
  type OpenEditorOptions,
  type OpenedProjectHandle,
  type ProjectSessionService,
  executingEditorHandleValueSpec,
  openedProjectHandleValueSpec,
  openedProjectValueSpec,
  projectSessionService,
} from '@src/registry/contracts/projectSession'
import type { Subscription } from 'xstate'
import { waitFor } from 'xstate'

interface ClearProjectSessionOptions {
  clearHandles?: boolean
  clearProjectSettings?: boolean
}

function zookeeperReplayChangesProjectFileSet(
  replayFiles: readonly PreparedZookeeperPatchFileReplay[]
) {
  return replayFiles.some(
    (replayFile) =>
      replayFile.previousContent === null || replayFile.nextContent === null
  )
}

function getZookeeperReplayFallbackFilePath(
  project: ZDSProject,
  deletedPaths: Set<string>
) {
  const defaultFile = project.projectIORefSignal.value.default_file
  const candidates = [
    defaultFile,
    ...project.files.map((file) => file.path),
  ].filter((path, index, paths) => paths.indexOf(path) === index)

  return candidates.find((path) => path && !deletedPaths.has(path))
}

const projectSessionExtension = defineRegistryItemFactory(() => {
  let app: App | undefined
  let unsubscribeFromSettings: Subscription | undefined
  let unsubscribeFromSystemIO: Subscription | undefined
  let stopFSHistoryEffect: (() => void) | undefined

  const openedProjectHandle =
    signal<ProjectSessionService['openedProjectHandle']['value']>(undefined)
  const executingEditorHandle =
    signal<ProjectSessionService['executingEditorHandle']['value']>(undefined)
  const openedProject =
    signal<ProjectSessionService['openedProject']['value']>(undefined)

  const projectSessionUnboundError = () =>
    new Error('Project session service has not been bound to App.')

  const getProjectFromHandle = async (
    currentApp: App,
    { projectPath }: OpenedProjectHandle
  ): Promise<Project> => {
    const wasmInstance = await currentApp.wasmPromise
    const maybeProjectInfo = await getProjectInfo(projectPath, wasmInstance)

    return (
      maybeProjectInfo ?? {
        name: getStringAfterLastSeparator(projectPath) || 'unnamed',
        path: projectPath,
        children: [],
        kcl_file_count: 0,
        directory_count: 0,
        metadata: null,
        default_file: projectPath,
        readWriteAccess: true,
      }
    )
  }

  const stopProjectEffects = () => {
    unsubscribeFromSettings?.unsubscribe()
    unsubscribeFromSettings = undefined
    unsubscribeFromSystemIO?.unsubscribe()
    unsubscribeFromSystemIO = undefined
    stopFSHistoryEffect?.()
    stopFSHistoryEffect = undefined
  }

  const clearProjectSession = ({
    clearHandles = true,
    clearProjectSettings = true,
  }: ClearProjectSessionOptions = {}) => {
    const currentApp = app
    const currentProject = openedProject.peek()

    stopProjectEffects()
    currentProject?.close()
    openedProject.value = undefined
    executingEditorHandle.value = undefined

    if (clearHandles) {
      openedProjectHandle.value = undefined
    }

    if (clearProjectSettings) {
      currentApp?.settings.actor.send({
        type: 'clear.project',
      })
    }
  }

  const syncProjectFromSystemIO = (
    currentApp: App,
    projectIORefSignal: Signal<Project>
  ) => {
    unsubscribeFromSystemIO = currentApp.systemIOActor.subscribe(
      ({ context }) => {
        const foundProject = (context.folders ?? []).find(
          (project) =>
            project.name === projectIORefSignal.value.name &&
            project.path === projectIORefSignal.value.path
        )
        if (foundProject && projectIORefSignal.value !== foundProject) {
          projectIORefSignal.value = foundProject
        }
      }
    )
  }

  const startProjectEffects = (
    currentApp: App,
    projectIORefSignal: Signal<Project>
  ) => {
    stopProjectEffects()
    stopFSHistoryEffect = effect(() => {
      const project = openedProject.value
      const editor = project?.executingEditor.value
      if (!project || !editor) {
        return
      }

      const disposeFSHistory = buildFSHistoryExtension(
        currentApp.systemIOActor,
        editor
      )
      const disposeZookeeperHistory = buildZookeeperHistoryExtension({
        kclManager: editor,
        onCurrentFileDelete: async (deletedPaths) => {
          const fallbackPath = getZookeeperReplayFallbackFilePath(
            project,
            deletedPaths
          )
          if (!fallbackPath) {
            return Promise.reject(
              new Error(
                'Cannot replay this Zookeeper edit because no fallback KCL file is available.'
              )
            )
          }

          await openEditor(fallbackPath, { providedEditor: editor })
        },
        onActiveFileRestore: async (restoredPath, restoredContents) => {
          await openEditor(restoredPath, {
            providedEditor: editor,
            providedCode: restoredContents,
          })
        },
        onProjectFilesReplay: async (replayFiles) => {
          await project.syncReplayedFilesToRust(replayFiles)
          if (zookeeperReplayChangesProjectFileSet(replayFiles)) {
            currentApp.systemIOActor.send({
              type: SystemIOMachineEvents.readFoldersFromProjectDirectory,
            })
          }
        },
      })

      return () => {
        disposeFSHistory()
        disposeZookeeperHistory()
      }
    })
    syncProjectFromSystemIO(currentApp, projectIORefSignal)
    unsubscribeFromSettings = currentApp.settings.actor.subscribe(
      currentApp.onSettingsUpdate
    )
  }

  const loadProjectFromInfo = async (currentApp: App, project: Project) => {
    const currentProject = openedProject.peek()

    openedProjectHandle.value = {
      projectPath: project.path,
    }
    projectFsManager.dir = project.path

    if (currentProject && currentProject.path !== project.path) {
      clearProjectSession({
        clearHandles: false,
        clearProjectSettings: false,
      })
    }

    await waitFor(currentApp.settings.actor, (state) => state.matches('idle'))
    currentApp.settings.actor.send({
      type: 'load.project',
      project,
    })
    await waitFor(currentApp.settings.actor, (state) => state.matches('idle'))

    if (currentProject?.path === project.path) {
      currentProject.projectIORefSignal.value = project
      return currentProject
    }

    const projectIORefSignal = signal(project)
    const nextProject = await ZDSProject.open(projectIORefSignal, currentApp)
    openedProject.value = nextProject
    startProjectEffects(currentApp, projectIORefSignal)
    return nextProject
  }

  const setOpenedProjectHandle = async (
    handle: OpenedProjectHandle | undefined
  ) => {
    if (!handle) {
      clearProjectSession()
      return undefined
    }

    const currentApp = app
    if (!currentApp) {
      return Promise.reject(projectSessionUnboundError())
    }

    return loadProjectFromInfo(
      currentApp,
      await getProjectFromHandle(currentApp, handle)
    )
  }

  const loadEditorFromHandle = async (
    filePath: string,
    { providedEditor, providedCode, isExecuting = true }: OpenEditorOptions = {}
  ) => {
    const currentProject = openedProject.peek()
    if (!currentProject) {
      return Promise.reject(
        new Error('Cannot open an editor without an opened project.')
      )
    }

    executingEditorHandle.value = {
      projectPath: currentProject.path,
      filePath,
    }

    return currentProject.openEditor(
      filePath,
      providedEditor,
      providedCode,
      isExecuting
    )
  }

  const setExecutingEditorHandle = async (
    handle: ExecutingEditorHandle | undefined,
    options: OpenEditorOptions = {}
  ) => {
    if (!handle) {
      executingEditorHandle.value = undefined
      return undefined
    }

    const currentApp = app
    if (!currentApp) {
      return Promise.reject(projectSessionUnboundError())
    }
    const currentProject = openedProject.peek()
    if (currentProject?.path !== handle.projectPath) {
      await setOpenedProjectHandle({ projectPath: handle.projectPath })
    }

    return loadEditorFromHandle(handle.filePath, {
      providedEditor:
        options.providedEditor ?? currentApp.singletons.kclManager,
      providedCode:
        options.providedCode ??
        (window.electron?.process.env.NODE_ENV === 'test'
          ? currentApp.singletons.kclManager.localStoragePersistCode()
          : undefined),
      isExecuting: options.isExecuting,
    })
  }

  const serviceImpl: ProjectSessionService = {
    openedProjectHandle,
    executingEditorHandle,
    openedProject,
    bindApp(boundApp) {
      app = boundApp
    },
    setOpenedProjectHandle,
    setExecutingEditorHandle,
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-session-extension',
      provides: [
        provide(openedProjectHandleValueSpec, openedProjectHandle, {
          key: 'project-session',
        }),
        provide(executingEditorHandleValueSpec, executingEditorHandle, {
          key: 'project-session',
        }),
        provide(openedProjectValueSpec, openedProject, {
          key: 'project-session',
        }),
      ],
      providesServices: [provideService(projectSessionService, serviceImpl)],
      dispose: () => clearProjectSession(),
    }),
  }
}, 'project-session-extension')

export default projectSessionExtension
