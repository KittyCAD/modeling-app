import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import {
  projectSessionService,
  projectSourcesService,
} from '@src/lib/projectSession/next/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'

export default defineRegistryItemFactory(
  ({ services }) => ({
    id: 'project-sources',
    providesServices: [
      provideService(
        projectSourcesService,
        createProjectSources(
          () => services.signal(projectSessionService).value,
          () => services.signal(editorsService).value?.editors.value ?? []
        )
      ),
    ],
  }),
  'project-sources'
)
