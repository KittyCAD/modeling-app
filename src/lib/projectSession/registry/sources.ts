import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { editorsService } from '@src/lib/editors/registry/contract'
import {
  projectSessionService,
  projectSourcesService,
} from '@src/lib/projectSession/next/contract'
import { createProjectSources } from '@src/lib/projectSession/next/sources'

/** Shared by the project-session and KCL factories through `uses`; resolve documents and the selected opening lazily after registry configuration. */
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
