import {
  defineRegistryItem,
  defineRegistryItemFactory,
  defineRuntimeRegistryItem,
  provideService,
} from '@kittycad/registry'
import { signal } from '@preact/signals-core'
import type { ZDSProject } from '@src/lang/KclManager'
import {
  type ProjectSessionRegistryService,
  projectSessionService,
} from '@src/registry/contracts/projectSession'

export const projectSessionExtension = defineRegistryItemFactory(() => {
  const project = signal<ZDSProject | undefined>(undefined)
  const currentProjectLibraryId = signal<string | undefined>(undefined)

  const serviceImpl: ProjectSessionRegistryService = {
    project,
    currentProjectLibraryId,
    getProject: () => project.value,
    setProject: (nextProject) => {
      project.value = nextProject
    },
    clearProject: () => {
      project.value = undefined
    },
    getCurrentProjectLibraryId: () => currentProjectLibraryId.value,
    setCurrentProjectLibraryId: (libraryId) => {
      currentProjectLibraryId.value = libraryId
    },
  }

  return {
    item: defineRuntimeRegistryItem({
      id: 'project-session-extension',
      providesServices: [provideService(projectSessionService, serviceImpl)],
    }),
  }
}, 'project-session-extension')

export default defineRegistryItem({
  id: 'project-session',
  uses: [projectSessionExtension],
})
