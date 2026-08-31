import {
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provide,
  provideService,
} from '@kittycad/registry'
import { computed } from '@preact/signals'
import { authService } from '@src/contracts/auth'
import { unitsService } from '@src/contracts/units'
import { commandsValueSpec } from '@src/contracts/commands'
import { fileSystemService } from '@src/contracts/fileSystem'
import {
  projectLibrariesService,
  projectLibraryDefaultsValueSpec,
  projectLibraryTypesValueSpec,
} from '@src/contracts/projectLibraries'
import { runtimeService } from '@src/contracts/runtime'
import { settingsSectionsValueSpec } from '@src/contracts/settings'
import { createProjectLibrariesService } from '@src/features/projectLibraries/createProjectLibrariesService'
import { ProjectLibrariesSettings } from '@src/features/projectLibraries/ProjectLibrariesSettings'

/**
 * Provides the libraries service.
 *
 * Holds no knowledge of any library type: types and starting defaults are both
 * contributions, so this feature is complete as it stands even when cloud
 * libraries arrive.
 */
export default defineRegistryItemFactory((ctx) => {
  const types = computed(() => ctx.valueSpecs.get(projectLibraryTypesValueSpec))
  const defaults = computed(() =>
    ctx.valueSpecs.get(projectLibraryDefaultsValueSpec)
  )

  // Constructed lazily on first read so the filesystem service is resolved
  // outside graph construction.
  let service: ReturnType<typeof createProjectLibrariesService> | null = null
  const get = () => {
    service ??= createProjectLibrariesService(
      ctx.services.get(fileSystemService),
      types,
      defaults,
      ctx.services.get(runtimeService).info.value.target,
      ctx.services.get(authService).status,
      /*
       * The same annotation a file created inside a project gets. Optional
       * service, so a build without units still makes projects — with an empty
       * `main.kcl`, which is what it made before.
       */
      async () =>
        (await ctx.services.optional(unitsService)?.newFileContents()) ?? ''
    )
    return service
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'projectLibraries',
      dispose: () => service?.dispose(),
      providesServices: [
        provideService(projectLibrariesService, {
          get settings() {
            return get().settings
          },
          get libraries() {
            return get().libraries
          },
          get types() {
            return get().types
          },
          get realizations() {
            return get().realizations
          },
          get state() {
            return get().state
          },
          get error() {
            return get().error
          },
          library: (id) => get().library(id),
          realization: (id) => get().realization(id),
          realizationsFor: (id) => get().realizationsFor(id),
          type: (name) => get().type(name),
          refresh: (id) => get().refresh(id),
          addLibrary: (setting) => get().addLibrary(setting),
          updateLibrary: (id, patch) => get().updateLibrary(id, patch),
          removeLibrary: (id) => get().removeLibrary(id),
          reorderLibrary: (from, to) => get().reorderLibrary(from, to),
          canRemoveLibrary: (id) => get().canRemoveLibrary(id),
          createProject: (id, title) => get().createProject(id, title),
          renameProject: (id, title) => get().renameProject(id, title),
          deleteProject: (id) => get().deleteProject(id),
          moveTargetsFor: (id) => get().moveTargetsFor(id),
          moveProject: (id, target) => get().moveProject(id, target),
        }),
      ],
      provides: [
        provide(settingsSectionsValueSpec, {
          id: 'libraries',
          title: 'Libraries',
          description:
            'Choose where projects live. Each library provider contributes its own connection and storage details.',
          icon: 'folder',
          order: 30,
          levels: ['user'],
          render: () => <ProjectLibrariesSettings />,
        }),
        provide(commandsValueSpec, {
          id: 'libraries.refresh',
          title: 'Refresh project libraries',
          category: 'Project',
          icon: 'refresh',
          run: () => get().refresh(),
        }),
      ],
    }),
  }
}, 'projectLibraries')
