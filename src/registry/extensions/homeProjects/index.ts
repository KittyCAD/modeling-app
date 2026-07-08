import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { effect, signal } from '@preact/signals-core'
import { homeProjectEntryFromProject } from '@src/lib/homeProjects'
import type { Project } from '@src/lib/project'
import {
  type HomeProjectEntryContribution,
  homeProjectEntriesValueSpec,
} from '@src/registry/contracts/homeProjects'
import { systemIOService } from '@src/registry/contracts/systemIO'

function localHomeProjectEntriesFromProjects(
  projects: readonly Project[] | undefined
): HomeProjectEntryContribution[] {
  return projects?.map(homeProjectEntryFromProject) ?? []
}

const systemIOLocalHomeProjectEntries = defineRegistryItemFactory((ctx) => {
  const entries = signal<HomeProjectEntryContribution[]>([])
  const systemIO = ctx.services.signal(systemIOService)
  let systemIOSubscription: { unsubscribe: () => void } | undefined

  const disposeSystemIOEffect = effect(() => {
    const service = systemIO.value
    systemIOSubscription?.unsubscribe()
    systemIOSubscription = undefined
    entries.value = []

    if (!service) {
      return
    }

    const updateEntries = () => {
      entries.value = localHomeProjectEntriesFromProjects(
        service.actor.getSnapshot().context.folders
      )
    }

    updateEntries()
    systemIOSubscription = service.actor.subscribe(updateEntries)
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home-projects.system-io-local-projects',
      provides: [
        provide(homeProjectEntriesValueSpec, entries, {
          key: 'home-projects.system-io-local-projects',
        }),
      ],
      dispose: () => {
        disposeSystemIOEffect()
        systemIOSubscription?.unsubscribe()
      },
    }),
  }
}, 'home-projects.system-io-local-projects')

const homeProjectsExtension = defineRegistryItem({
  id: 'home-projects',
  uses: [systemIOLocalHomeProjectEntries],
})

export default homeProjectsExtension
