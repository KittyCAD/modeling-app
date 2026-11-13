import { PATHS } from '@src/lib/paths'
import { createProjectLibraries } from '@src/lib/projectLibraries/service'
import { projectOperationsService } from '@src/registry/contracts/fileOperations'
import { projectLibrariesService } from '@src/registry/contracts/projectLibraries'
import { projectSession } from '@src/registry/contracts/projectSession'
import { routerService } from '@src/registry/contracts/router'
import { settingsService } from '@src/registry/contracts/settings'
import { extension as defineExtension, provide, type Extension } from 'plankton'

/** Resolve dependencies when used so library discovery does not eagerly open a session. */
export default defineExtension({
  key: 'project-libraries.service',
  create: (_dependencies, scope) => ({
    items: [
      provide(
        projectLibrariesService,
        createProjectLibraries({
          getProject: () => scope.required(projectSession).getProject(),
          getLibraries: () =>
            scope.required(settingsService).get().app.libraries.current,
          getDefaultProjectName: () =>
            scope.required(settingsService).get().projects.defaultProjectName
              .current,
          listProjects: (directory) =>
            scope.required(projectOperationsService).listProjects(directory),
          refreshProject: () => scope.required(projectSession).refreshProject(),
          navigateHome: () =>
            scope.required(routerService).navigate(PATHS.HOME),
        })
      ),
    ],
  }),
}) satisfies Extension
