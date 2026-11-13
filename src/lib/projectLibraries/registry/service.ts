import { defineRegistryItemFactory, provideService } from '@kittycad/registry'
import { createProjectLibraries } from '@src/lib/projectLibraries/service'
import { projectLibrariesService } from '@src/registry/contracts/projectLibraries'
import { projectOperationsService } from '@src/registry/contracts/fileOperations'
import { projectSession } from '@src/registry/contracts/projectSession'
import { settingsService } from '@src/registry/contracts/settings'
import { routerService } from '@src/registry/contracts/router'
import { PATHS } from '@src/lib/paths'

/** Resolve dependencies when used so library discovery does not eagerly open a session. */
export default defineRegistryItemFactory(
  ({ services }) => ({
    providesServices: [
      provideService(
        projectLibrariesService,
        createProjectLibraries({
          getProject: () => services.get(projectSession).getProject(),
          getLibraries: () =>
            services.get(settingsService).get().app.libraries.current,
          getDefaultProjectName: () =>
            services.get(settingsService).get().projects.defaultProjectName
              .current,
          listProjects: (directory) =>
            services.get(projectOperationsService).listProjects(directory),
          refreshProject: () => services.get(projectSession).refreshProject(),
          navigateHome: () => services.get(routerService).navigate(PATHS.HOME),
        })
      ),
    ],
  }),
  'project-libraries.service'
)
