import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { type Signal, computed, effect, signal } from '@preact/signals-core'
import { buildFSHistoryExtension } from '@src/editor/plugins/fs'
import { KclManager, ZDSProject } from '@src/lang/KclManager'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import { getProjectInfo } from '@src/lib/desktop'
import { getStringAfterLastSeparator } from '@src/lib/paths'
import type { Project } from '@src/lib/project'
import type { ExecutingEditorService } from '@src/registry/contracts/executingEditor'
import { executingEditorService } from '@src/registry/contracts/executingEditor'
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
  const executingEditor = computed(
    () => openedProject.value?.executingEditor.value ?? undefined
  )

  const getApp = () => {
    if (!app) {
      throw new Error('Project session service has not been bound to App.')
    }
    return app
  }

  const getProjectFromHandle = async ({
    projectPath,
  }: OpenedProjectHandle): Promise<Project> => {
    const currentApp = getApp()
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
    currentProject?.executingEditor.value?.cancelAllExecutions()
    currentProject?.close()
    openedProject.value = undefined

    if (clearHandles) {
      openedProjectHandle.value = undefined
      executingEditorHandle.value = undefined
    }

    if (clearProjectSettings) {
      currentApp?.settings.actor.send({
        type: 'clear.project',
      })
    }
    currentApp?.commands.actor.send({ type: 'Set kclManager', data: undefined })
  }

  const syncProjectFromSystemIO = (projectIORefSignal: Signal<Project>) => {
    const currentApp = getApp()

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

  const startProjectEffects = (projectIORefSignal: Signal<Project>) => {
    const currentApp = getApp()

    stopProjectEffects()
    stopFSHistoryEffect = effect(() => {
      const editor = openedProject.value?.executingEditor.value
      if (!editor) {
        return
      }

      return buildFSHistoryExtension(currentApp.systemIOActor, editor)
    })
    syncProjectFromSystemIO(projectIORefSignal)
    unsubscribeFromSettings = currentApp.settings.actor.subscribe(
      currentApp.onSettingsUpdate
    )
  }

  const loadProjectFromInfo = async (project: Project) => {
    const currentApp = getApp()
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
    startProjectEffects(projectIORefSignal)
    return nextProject
  }

  const setOpenedProjectHandle = async (
    handle: OpenedProjectHandle | undefined
  ) => {
    if (!handle) {
      clearProjectSession()
      return undefined
    }

    return loadProjectFromInfo(await getProjectFromHandle(handle))
  }

  const loadEditorFromHandle = async (
    filePath: string,
    { providedCode, isExecuting = true }: OpenEditorOptions = {}
  ) => {
    const currentProject = openedProject.peek()
    if (!currentProject) {
      throw new Error('Cannot open an editor without an opened project.')
    }

    executingEditorHandle.value = {
      projectPath: currentProject.path,
      filePath,
    }

    const previousExecutingPath = currentProject.executingPath
    const previousExecutingEditor = currentProject.executingEditor.value
    if (previousExecutingPath !== filePath) {
      const existingTargetEditor = currentProject.findEditor(filePath)?.[1]
      if (existingTargetEditor) {
        currentProject.closeEditor(filePath)
      }
    }

    const editor = await currentProject.openEditor(
      filePath,
      providedCode,
      isExecuting
    )
    if (
      previousExecutingPath &&
      previousExecutingPath !== filePath &&
      previousExecutingEditor &&
      previousExecutingEditor !== editor
    ) {
      previousExecutingEditor.cancelAllExecutions()
      currentProject.closeEditor(previousExecutingPath)
    }
    getApp().commands.actor.send({ type: 'Set kclManager', data: editor })
    return editor
  }

  const setExecutingEditorHandle = async (
    handle: ExecutingEditorHandle | undefined,
    options: OpenEditorOptions = {}
  ) => {
    if (!handle) {
      executingEditorHandle.value = undefined
      const currentProject = openedProject.peek()
      currentProject?.executingEditor.value?.cancelAllExecutions()
      if (currentProject) {
        currentProject.executingPath = null
      }
      getApp().commands.actor.send({ type: 'Set kclManager', data: undefined })
      return undefined
    }

    const currentApp = getApp()
    const currentProject = openedProject.peek()
    if (currentProject?.path !== handle.projectPath) {
      await setOpenedProjectHandle({ projectPath: handle.projectPath })
    }

    return loadEditorFromHandle(handle.filePath, {
      providedCode:
        options.providedCode ??
        (window.electron?.process.env.NODE_ENV === 'test'
          ? KclManager.localStoragePersistCode()
          : undefined),
      isExecuting: options.isExecuting,
    })
  }

  const emptyCode = signal('')
  const hasNoEditsSinceLastExecution = signal(false)
  const isNotExecuting = signal(false)
  const emptyExecutionElapsedMs = signal(0)
  const noSelectionStatusLabel = signal('No selection')
  const hideExperimentalFeaturesStatusBarItem = signal(false)

  const executingEditorServiceImpl: ExecutingEditorService = {
    editor: executingEditor,
    code: computed(() => executingEditor.value?.codeSignal.value ?? ''),
    hasEditsSinceLastExecution: computed(
      () =>
        executingEditor.value?.hasEditsSinceLastExecutionSignal.value ??
        hasNoEditsSinceLastExecution.value
    ),
    isExecuting: computed(
      () =>
        executingEditor.value?.isExecutingSignal.value ?? isNotExecuting.value
    ),
    executionElapsedMs: computed(
      () =>
        executingEditor.value?.executingEditorService.executionElapsedMs
          .value ?? emptyExecutionElapsedMs.value
    ),
    selectionStatusLabel: computed(
      () =>
        executingEditor.value?.executingEditorService.selectionStatusLabel
          .value ?? noSelectionStatusLabel.value
    ),
    showExperimentalFeaturesStatusBarItem: computed(
      () =>
        executingEditor.value?.executingEditorService
          .showExperimentalFeaturesStatusBarItem.value ??
        hideExperimentalFeaturesStatusBarItem.value
    ),
    getPendingCommandCount: () =>
      executingEditor.value?.executingEditorService.getPendingCommandCount() ??
      0,
    executeCode: async (code) => {
      await executingEditor.value?.executeCode(code)
    },
    updateCode: (code, options) => {
      executingEditor.value?.updateCodeEditor(code, options)
    },
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
      providesServices: [
        provideService(projectSessionService, serviceImpl),
        provideService(executingEditorService, executingEditorServiceImpl),
      ],
      dispose: () => clearProjectSession(),
    }),
  }
}, 'project-session-extension')

export default projectSessionExtension
