import { PATHS } from '@src/lib/paths'
import { createProjectLibraries } from '@src/lib/projectLibraries/service'
import { observations as fileOperationsObservations } from '@src/registry/contracts/fileOperations'
import { projectLibrariesService } from '@src/registry/contracts/projectLibraries'
import { observations as projectSessionObservations } from '@src/registry/contracts/projectSession'
import { observations as routerObservations } from '@src/registry/contracts/router'
import { observations as settingsObservations } from '@src/registry/contracts/settings'
import { factory as defineFactory, provide, type Factory } from 'plankton'

/** Resolve dependencies when used so library discovery does not eagerly open a session. */
export default defineFactory({
  dependencies: {
    projectSession: projectSessionObservations,
    settings: settingsObservations,
    fileOperations: fileOperationsObservations,
    router: routerObservations,
  },
  key: 'project-libraries.service',
  create: ({
    projectSession: projectSessionInputs,
    settings: settingsInputs,
    fileOperations: fileOperationsInputs,
    router: routerInputs,
  }) => ({
    items: [
      provide(
        projectLibrariesService,
        createProjectLibraries({
          getProject: () =>
            projectSessionInputs.projectSession.required().getProject(),
          getLibraries: () =>
            settingsInputs.settingsService.required().get().app.libraries
              .current,
          getDefaultProjectName: () =>
            settingsInputs.settingsService.required().get().projects
              .defaultProjectName.current,
          listProjects: (directory) =>
            fileOperationsInputs.projectOperationsService
              .required()
              .listProjects(directory),
          refreshProject: () =>
            projectSessionInputs.projectSession.required().refreshProject(),
          navigateHome: () =>
            routerInputs.routerService.required().navigate(PATHS.HOME),
        })
      ),
    ],
  }),
}) satisfies Factory
