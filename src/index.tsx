import '@kittycad/ui-kit/styles.css'
import { render } from 'preact'
import { AppProvider } from '@src/app/context'
import { createApp } from '@src/app/createApp'
import { navigationService } from '@src/contracts/navigation'
import { authService } from '@src/contracts/auth'
import { engineConnectionService } from '@src/contracts/engine'
import { executionCoordinatorService } from '@src/contracts/execution'
import { projectLibrariesService } from '@src/contracts/projectLibraries'
import { projectSessionService } from '@src/contracts/projectSession'
import { themeService } from '@src/contracts/theme'
import { AppShell } from '@src/features/shell/AppShell'

const app = createApp()

/**
 * Wake the services whose construction is the point.
 *
 * Registry services are lazy: nothing is built until something reads it. That
 * is the right default — a capability nobody uses costs nothing — but a few
 * features exist precisely for their side effects, and they would otherwise
 * never run. Naming them here keeps that explicit rather than hiding an
 * initialisation order inside the features themselves.
 */
const theme = app.registry.get(themeService)
const navigation = app.registry.get(navigationService)

// Seed state from the URL once, on the way in. From here on the URL is written
// from application state and never read again except on a history pop.
void navigation.loadUrl(new URL(window.location.href))

const root = document.getElementById('root')
if (!root) {
  throw new Error('index.html is missing its #root element')
}

render(
  <AppProvider value={app}>
    <AppShell />
  </AppProvider>,
  root
)

if (import.meta.env.DEV) {
  // Handy at a console breakpoint. `__zds.app.registry.inspect()` prints every
  // resolved value spec and service provider with its source path, and the
  // services below are the ones worth poking at by hand:
  // `__zds.session.current.value.activeBuffer.value.snapshot()`.
  Object.assign(window, {
    __zds: {
      app,
      theme,
      navigation,
      get session() {
        return app.registry.get(projectSessionService)
      },
      get libraries() {
        return app.registry.get(projectLibrariesService)
      },
      get execution() {
        return app.registry.get(executionCoordinatorService)
      },
      get engine() {
        return app.registry.get(engineConnectionService)
      },
      get auth() {
        return app.registry.get(authService)
      },
    },
  })
}
