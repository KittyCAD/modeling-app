import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { type Signal, effect, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import { type KclManager, ZDSProject } from '@src/lang/KclManager'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { getProjectInfo, readAppSettingsFile } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import {
  PATHS,
  getProjectMetaByRouteId,
  getRouterSearchFromRequestUrl,
  getStringAfterLastSeparator,
} from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import { resetCameraPosition } from '@src/lib/resetCameraPosition'
import { loadAndValidateSettings } from '@src/lib/settings/settingsUtils'
import { reportRejection } from '@src/lib/trap'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
import {
  type ExecutingEditorHandle,
  type OpenEditorOptions,
  type OpenedProjectHandle,
  type ProjectRouteHandlesOptions,
  type ProjectRouteHandlesResult,
  type ProjectSessionService,
  executingEditorHandleValueSpec,
  openedProjectHandleValueSpec,
  openedProjectValueSpec,
  projectSessionService,
} from '@src/registry/contracts/projectSession'
import { appRegistryServicesSlot } from '@src/registry/registry'
import type { Subscription } from 'xstate'
import { waitFor } from 'xstate'

interface ClearProjectSessionOptions {
  clearHandles?: boolean
  clearProjectSettings?: boolean
}

const projectSessionExtension = defineRegistryItemFactory(() => {
  let app: App | undefined
  let unsubscribeFromSettings: Subscription | undefined
  let unsubscribeFromSystemIO: Subscription | undefined
  let stopFSHistoryEffect: (() => void) | undefined
  let stopExecutingEditorServiceEffect: (() => void) | undefined

  const openedProjectHandle =
    signal<ProjectSessionService['openedProjectHandle']['value']>(undefined)
  const executingEditorHandle =
    signal<ProjectSessionService['executingEditorHandle']['value']>(undefined)
  const openedProject =
    signal<ProjectSessionService['openedProject']['value']>(undefined)

  const projectSessionUnboundError = () =>
    new Error('Project session service has not been bound to App.')

  const isCurrentExecutingEditor = (
    editor: KclManager,
    handle: ExecutingEditorHandle
  ) => {
    const currentHandle = executingEditorHandle.peek()
    return (
      currentHandle?.projectPath === handle.projectPath &&
      currentHandle.filePath === handle.filePath &&
      openedProject.peek()?.executingEditor.value === editor
    )
  }

  const executeSelectedEditor = async (
    currentApp: App,
    editor: KclManager,
    handle: ExecutingEditorHandle
  ) => {
    if (!editor.engineCommandManager.started) {
      return
    }
    if (!isCurrentExecutingEditor(editor, handle)) {
      return
    }
    if (!editor.engineCommandManager.connection?.connected) {
      return
    }

    await editor.executeCode()
    if (!isCurrentExecutingEditor(editor, handle)) {
      return
    }

    await resetCameraPosition({
      sceneInfra: editor.sceneInfra,
      engineCommandManager: editor.engineCommandManager,
      settingsActor: currentApp.settings.actor,
    })
  }

  const syncExecutingEditorService = (currentApp: App) => {
    const editor = openedProject.value?.executingEditor.value
    currentApp.registry.reconfigure(
      appRegistryServicesSlot,
      editor
        ? [
            defineRegistryItem({
              id: 'executing-editor-services',
              providesServices: [
                provideService(
                  executingEditorService,
                  editor.executingEditorService
                ),
              ],
            }),
          ]
        : []
    )
  }

  const startExecutingEditorServiceEffect = (currentApp: App) => {
    stopExecutingEditorServiceEffect?.()
    stopExecutingEditorServiceEffect = effect(() => {
      syncExecutingEditorService(currentApp)
    })
  }

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

    if (clearHandles) {
      openedProjectHandle.value = undefined
      executingEditorHandle.value = undefined
      currentApp?.commands.actor.send({
        type: 'Set kclManager',
        data: undefined,
      })
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
      const editor = openedProject.value?.executingEditor.value
      if (!editor) {
        return
      }

      return buildFSHistoryExtension(currentApp.systemIOActor, editor)
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

    const editor = await currentProject.openEditor(
      filePath,
      providedEditor,
      providedCode,
      isExecuting
    )

    app?.commands.actor.send({ type: 'Set kclManager', data: editor })
    return editor
  }

  const setExecutingEditorHandle = async (
    handle: ExecutingEditorHandle | undefined,
    options: OpenEditorOptions = {}
  ) => {
    if (!handle) {
      const currentProject = openedProject.peek()
      if (currentProject?.executingPath) {
        currentProject.closeEditor(currentProject.executingPath)
      }
      if (currentProject) {
        currentProject.executingPath = null
      }
      executingEditorHandle.value = undefined
      app?.commands.actor.send({ type: 'Set kclManager', data: undefined })
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
    const targetProject = openedProject.peek()
    const previousExecutingPath = targetProject?.executingPath ?? undefined
    const shouldClosePreviousExecutingEditor =
      previousExecutingPath !== undefined &&
      previousExecutingPath !== handle.filePath
    const shouldExecuteSelectedEditor =
      options.isExecuting !== false && previousExecutingPath !== handle.filePath

    const nextEditor = await loadEditorFromHandle(handle.filePath, {
      providedEditor: options.providedEditor,
      providedCode:
        options.providedCode ??
        (window.electron?.process.env.NODE_ENV === 'test'
          ? currentApp.singletons.kclManager.localStoragePersistCode()
          : undefined),
      isExecuting: options.isExecuting,
    })

    if (shouldClosePreviousExecutingEditor) {
      targetProject?.closeEditor(previousExecutingPath)
    }
    if (shouldExecuteSelectedEditor) {
      executeSelectedEditor(currentApp, nextEditor, handle).catch(
        reportRejection
      )
    }

    return nextEditor
  }

  const setProjectRouteHandles = async ({
    routeId,
    requestUrl,
    usesHashRouter = Boolean(window.electron),
  }: ProjectRouteHandlesOptions): Promise<ProjectRouteHandlesResult> => {
    if (routeId?.startsWith('/browser')) {
      return { redirectTo: PATHS.HOME }
    }

    if (!routeId) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    const currentApp = app
    if (!currentApp) {
      return Promise.reject(projectSessionUnboundError())
    }

    const heuristicProjectFilePath = routeId
      ? fsZds.extname(routeId) === '.kcl'
        ? routeId.split(fsZds.sep).slice(0, -1).join(fsZds.sep)
        : routeId
      : undefined

    const wasmInstance = await currentApp.wasmPromise
    const settings = await loadAndValidateSettings(
      wasmInstance,
      heuristicProjectFilePath
    )

    const projectPathData = await getProjectMetaByRouteId(
      readAppSettingsFile,
      wasmInstance,
      routeId,
      settings.configuration
    )

    if (!projectPathData) {
      return Promise.reject(
        new Error('bug: projectPathData undefined, early return')
      )
    }

    const { projectPath, currentFileName, currentFilePath } = projectPathData

    const urlObj = new URL(requestUrl)
    const isSettingsRoute = urlObj.pathname.endsWith('/settings')

    await setOpenedProjectHandle({ projectPath })

    if (!currentFileName || !currentFilePath) {
      await setExecutingEditorHandle(undefined)
      return {}
    }

    if (!isSettingsRoute) {
      let fileExists = true
      try {
        await fsZds.stat(currentFilePath)
      } catch (e) {
        if (e === 'ENOENT') {
          fileExists = false
        }
      }

      if (!fileExists) {
        const routerSearch = getRouterSearchFromRequestUrl(
          requestUrl,
          usesHashRouter
        )
        return {
          redirectTo: `${PATHS.FILE}/${encodeURIComponent(
            projectPath
          )}${routerSearch}`,
        }
      }
    }

    await setExecutingEditorHandle({
      projectPath,
      filePath: currentFilePath,
    })

    return {}
  }

  const serviceImpl: ProjectSessionService = {
    openedProjectHandle,
    executingEditorHandle,
    openedProject,
    bindApp(boundApp) {
      app = boundApp
      startExecutingEditorServiceEffect(boundApp)
    },
    setOpenedProjectHandle,
    setExecutingEditorHandle,
    setProjectRouteHandles,
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
      dispose: () => {
        stopExecutingEditorServiceEffect?.()
        stopExecutingEditorServiceEffect = undefined
        clearProjectSession()
      },
    }),
  }
}, 'project-session-extension')

export default projectSessionExtension
