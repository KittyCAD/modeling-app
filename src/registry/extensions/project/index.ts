import {
  type RegistryItem,
  Slot,
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import {
  type SketchSolveContext,
  refreshSketchSolveScenePlugins,
} from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  type ProjectService,
  projectService,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'
import type { AnyActorRef } from 'xstate'

export const projectRegistrySlot = new Slot()

function getSketchSolveActor(project: ZDSProject): AnyActorRef | undefined {
  return project.executingEditor.value?.modelingState?.children
    .sketchSolveMachine as AnyActorRef | undefined
}

function refreshProjectSketchSolveScenePlugins(project: ZDSProject): void {
  const sketchSolveActor = getSketchSolveActor(project)
  if (!sketchSolveActor || sketchSolveActor.getSnapshot().status !== 'active') {
    return
  }

  refreshSketchSolveScenePlugins(
    sketchSolveActor.getSnapshot().context as SketchSolveContext
  )
}

export function createProjectRegistryItem({
  project,
  settingsActor,
}: {
  project: ZDSProject
  settingsActor: SettingsActorType
}): RegistryItem {
  return defineRegistryItemFactory((ctx) => {
    const settings = signal<SettingsType>(
      getOnlySettingsFromContext(settingsActor.getSnapshot().context)
    )
    const sketchSolvePlugins = ctx.valueSpecs.signal(
      sketchSolveScenePluginsValueSpec
    )
    let disposed = false
    let disposeRegistryEffect: (() => void) | undefined
    const settingsSubscription = settingsActor.subscribe((snapshot) => {
      settings.value = getOnlySettingsFromContext(snapshot.context)
    })

    const serviceImpl: ProjectService = {
      project,
      settings,
      refreshSketchSolveScenePlugins() {
        refreshProjectSketchSolveScenePlugins(project)
      },
    }

    queueMicrotask(() => {
      if (disposed) {
        return
      }

      disposeRegistryEffect = effect(() => {
        void sketchSolvePlugins.value
        void settings.value
        serviceImpl.refreshSketchSolveScenePlugins()
      })
    })

    return {
      item: defineRuntimeRegistryItem({
        id: `project.${project.path}`,
        providesServices: [provideService(projectService, serviceImpl)],
        dispose: () => {
          disposed = true
          settingsSubscription.unsubscribe()
          disposeRegistryEffect?.()
        },
      }),
    }
  }, `project.${project.path}`)
}

const projectExtension = defineRegistryItem({
  id: 'project-extension',
  uses: [projectRegistrySlot.of()],
})

export default projectExtension
