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
} from '@src/lib/zookeeper/editorPlugin'
import { ZDSProject } from '@src/lang/KclManager'
import { projectFsManager } from '@src/lang/std/fileSystemManager'
import type { App } from '@src/lib/app'
import type { Project } from '@src/lib/project'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  type OpenEditorOptions,
  type OpenProjectEditorInput,
  type ProjectSessionService,
  executingEditorHandleValueSpec,
  openedProjectHandleValueSpec,
  openedProjectValueSpec,
  projectSessionService,
} from '@src/registry/contracts/projectSession'
import type { Subscription } from 'xstate'
import { waitFor } from 'xstate'

interface CloseProjectOptions {
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

  const stopProjectEffects = () => {
    unsubscribeFromSettings?.unsubscribe()
    unsubscribeFromSettings = undefined
    unsubscribeFromSystemIO?.unsubscribe()
    unsubscribeFromSystemIO = undefined
    stopFSHistoryEffect?.()
    stopFSHistoryEffect = undefined
  }

  const closeProject = ({
    clearHandles = true,
    clearProjectSettings = true,
  }: CloseProjectOptions = {}) => {
    const currentApp = app
    const currentProject = openedProject.peek()

    stopProjectEffects()
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

  const openProject = async (project: Project) => {
    const currentApp = app
    if (!currentApp) {
      return Promise.reject(
        new Error('Project session service has not been bound to App.')
      )
    }
    const currentProject = openedProject.peek()

    openedProjectHandle.value = {
      projectPath: project.path,
    }
    projectFsManager.dir = project.path

    if (currentProject && currentProject.path !== project.path) {
      closeProject({ clearHandles: false, clearProjectSettings: false })
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

  const openEditor = async (
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

  const serviceImpl: ProjectSessionService = {
    openedProjectHandle,
    executingEditorHandle,
    openedProject,
    bindApp(boundApp) {
      app = boundApp
    },
    openProject,
    openEditor,
    async openProjectEditor({
      project,
      filePath,
      providedEditor,
      providedCode,
      isExecuting,
    }: OpenProjectEditorInput) {
      const opened = await openProject(project)
      const editor = await openEditor(filePath, {
        providedEditor,
        providedCode,
        isExecuting,
      })
      return { project: opened, editor }
    },
    closeProject: () => closeProject(),
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
      dispose: () => closeProject(),
    }),
  }
}, 'project-session-extension')

export default projectSessionExtension
