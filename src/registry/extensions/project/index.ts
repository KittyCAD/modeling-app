import {
  type RegistryItem,
  Slot,
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import type { SettingsType } from '@src/lib/settings/initialSettings'
import { getOnlySettingsFromContext } from '@src/machines/settingsMachine'
import type { SettingsActorType } from '@src/machines/settingsMachine'
import {
  type ProjectService,
  projectService,
  sketchSolveScenePluginsValueSpec,
} from '@src/registry/contracts/project'

export const projectRegistrySlot = new Slot()

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
    const settingsSubscription = settingsActor.subscribe((snapshot) => {
      settings.value = getOnlySettingsFromContext(snapshot.context)
    })

    const serviceImpl: ProjectService = {
      project,
      settings,
      sketchSolveScenePlugins: sketchSolvePlugins,
    }

    return {
      item: defineRuntimeRegistryItem({
        id: `project.${project.path}`,
        providesServices: [provideService(projectService, serviceImpl)],
        dispose: () => {
          settingsSubscription.unsubscribe()
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
