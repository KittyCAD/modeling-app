import type { App } from '@src/lib/app'
import { PATHS } from '@src/lib/paths'
import { loadHomeProjects } from '@src/lib/routeLoaderUtils'
import {
  defineAppNavigationIntentContribution,
  type AppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import { appUrlService } from '@src/registry/contracts/appUrl'
import {
  showHomeIntent,
  type ShowHomeRequest,
} from '@src/registry/contracts/homeProjects'

export interface HomeNavigationDependencies {
  showHome: (request: ShowHomeRequest) => Promise<void>
}

/** Build Home's navigation handler while keeping project cancellation private. */
export function createShowHomeIntentContribution(
  dependencies: HomeNavigationDependencies,
  cancelProjectOpen: () => void
): AppNavigationIntentContribution {
  return defineAppNavigationIntentContribution(
    showHomeIntent,
    async (request) => {
      cancelProjectOpen()
      await dependencies.showHome(request)
    }
  )
}

/**
 * Transitional App-backed implementation of entering Home.
 *
 * Replace the App parameter when Home project loading is owned entirely by its
 * registry capability.
 */
export function createHomeNavigationDependencies(
  app: App
): HomeNavigationDependencies {
  return {
    showHome: async (request) => {
      loadHomeProjects(app)
      if (!request.startup) {
        void app.registry.get(appUrlService).navigate(PATHS.HOME)
      }
    },
  }
}
