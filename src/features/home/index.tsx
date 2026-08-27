import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import type { AppLocation } from '@src/contracts/navigation'
import {
  locationSourcesValueSpec,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'
import { projectCatalogService } from '@src/contracts/projects'
import { projectSessionService } from '@src/contracts/projectSession'
import { screensValueSpec } from '@src/contracts/shell'
import { HomeScreen } from '@src/features/home/HomeScreen'

const HOME: AppLocation = { kind: 'home' }

/**
 * The screen you get when no project is open.
 *
 * Also the app's terminal fallback: its location source always answers, and its
 * screen is always eligible, both at the highest order number. Whatever else
 * goes wrong, the app has somewhere to be.
 */
export default defineRegistryItemFactory((ctx) => {
  // Services must not be resolved while the registry graph is being built, so
  // this stays a lazy accessor. Every call site below is inside a computed or
  // an event handler, which run after the graph is settled.
  const sessions = () => ctx.services.get(projectSessionService)

  const noProjectOpen = computed(() => sessions().current.value === null)

  return {
    item: defineRuntimeRegistryItem({
      id: 'home',
      provides: [
        provide(screensValueSpec, {
          id: 'home',
          order: 100,
          active: noProjectOpen,
          render: () => <HomeScreen />,
        }),
        provide(locationSourcesValueSpec, {
          id: 'home',
          order: 100,
          location: computed(() => (noProjectOpen.value ? HOME : null)),
        }),
        provide(urlRoutesValueSpec, {
          id: 'home',
          order: 100,
          toPath: (location) => (location.kind === 'home' ? '/' : null),
          load: (url) => {
            if (url.pathname !== '/') return false
            // Arriving at the root means "no project open", so make that true
            // rather than merely recording it.
            sessions().close()
            return true
          },
        }),
        provide(commandsValueSpec, {
          id: 'project.new',
          title: 'New project',
          category: 'Project',
          icon: 'plus',
          run: async () => {
            const catalog = ctx.services.get(projectCatalogService)
            const source = catalog.sources.value[0]
            if (!source) {
              console.warn('home: no project source is installed')
              return
            }
            const created = await source.create('untitled')
            await sessions().open(created.id)
          },
        }),
        provide(commandsValueSpec, {
          id: 'project.goHome',
          title: 'Go to projects',
          category: 'Project',
          icon: 'home',
          enabled: computed(() => !noProjectOpen.value),
          run: () => sessions().close(),
        }),
      ],
    }),
  }
}, 'home')
