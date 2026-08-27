import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
} from '@kittycad/registry'
import { computed, signal } from '@preact/signals'
import { commandsValueSpec } from '@src/contracts/commands'
import type { AppLocation } from '@src/contracts/navigation'
import {
  locationSourcesValueSpec,
  urlRoutesValueSpec,
} from '@src/contracts/navigation'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { projectSessionService } from '@src/contracts/projectSession'
import { screensValueSpec, topBarItemsValueSpec } from '@src/contracts/shell'
import { HomeRefreshButton, HomeScreen } from '@src/features/home/HomeScreen'
import type { HomeView } from '@src/features/home/homeView'

/**
 * The screen you get when no project is open.
 *
 * Also the app's terminal fallback: its location source always answers and its
 * screen is always eligible, both at the highest order number. Whatever else
 * goes wrong, the app has somewhere to be.
 *
 * Which library is selected lives here as a signal, and both the location
 * source and the URL route are derived from it — so `/library/:id` is a
 * rendering of the selection, never the thing that causes it.
 */
export default defineRegistryItemFactory((ctx) => {
  const sessions = () => ctx.services.get(projectSessionService)
  const libraries = () => ctx.services.get(projectLibrariesService)

  const view = signal<HomeView>({ kind: 'auto' })
  const noProjectOpen = computed(() => sessions().current.value === null)

  /**
   * Both `auto` and `index` serialise to `/`.
   *
   * `index` is a transient request to manage libraries, not a place worth its
   * own URL: reloading should put someone back among their projects rather than
   * on a settings-ish screen they were passing through.
   */
  const location = computed<AppLocation | null>(() => {
    if (!noProjectOpen.value) return null
    const current = view.value
    return current.kind === 'library'
      ? { kind: 'library', libraryId: current.libraryId }
      : { kind: 'home' }
  })

  return {
    item: defineRuntimeRegistryItem({
      id: 'home',
      provides: [
        provide(screensValueSpec, {
          id: 'home',
          order: 100,
          active: noProjectOpen,
          render: () => <HomeScreen view={view} />,
        }),
        provide(topBarItemsValueSpec, {
          id: 'home.refresh',
          zone: 'end',
          order: 0,
          visible: noProjectOpen,
          render: () => <HomeRefreshButton />,
        }),

        provide(locationSourcesValueSpec, {
          id: 'home',
          order: 100,
          location,
        }),
        provide(urlRoutesValueSpec, {
          id: 'library',
          order: 50,
          toPath: (current) =>
            current.kind === 'library'
              ? `/library/${encodeURIComponent(current.libraryId)}`
              : null,
          load: (url) => {
            const match = url.pathname.match(/^\/library\/([^/]+)$/)
            if (!match) return false

            // Arriving here means "no project open, this library selected", so
            // both parts are made true rather than only recorded.
            sessions().close()
            view.value = {
              kind: 'library',
              libraryId: decodeURIComponent(match[1]),
            }
            return true
          },
        }),
        provide(urlRoutesValueSpec, {
          id: 'home',
          order: 100,
          toPath: (current) => (current.kind === 'home' ? '/' : null),
          load: (url) => {
            if (url.pathname !== '/') return false
            sessions().close()
            // The root means "no particular library", which is `auto`: one
            // library lands on its projects, several land on the index.
            view.value = { kind: 'auto' }
            return true
          },
        }),

        provide(commandsValueSpec, {
          id: 'project.new',
          title: 'New project',
          category: 'Project',
          icon: 'plus',
          run: async () => {
            const service = libraries()
            // Prefer whatever the user is looking at; otherwise the first
            // library, which is the one a single-library setup has.
            const current = view.peek()
            const targetId =
              (current.kind === 'library' ? current.libraryId : undefined) ??
              service.libraries.value.at(0)?.id
            if (!targetId) {
              console.warn('home: no library to create a project in')
              return
            }

            const created = await service.createProject(targetId, 'untitled')
            if (created) await sessions().open(created.id)
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
        provide(commandsValueSpec, {
          id: 'libraries.showAll',
          title: 'Show all libraries',
          category: 'Project',
          icon: 'folder',
          run: () => {
            sessions().close()
            view.value = { kind: 'index' }
          },
        }),
      ],
    }),
  }
}, 'home')
