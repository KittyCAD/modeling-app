import { ActionButton } from '@src/components/ActionButton'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import { useAbsoluteFilePath } from '@src/hooks/useAbsoluteFilePath'
import { routesFacet, statusBarGlobalItemsFacet } from '@src/facets'
import { defineExtension, provide, createPlugin } from '@src/lib/extensions'
import { PATHS } from '@src/lib/paths'
import { telemetryFileRoute, telemetryHomeRoute } from '@src/routes/Telemetry'
import { useLocation } from 'react-router-dom'

/** Contributes the telemetry modal routes for both home and file contexts. */
const telemetryRouteExt = defineExtension({
  provides: [
    provide(routesFacet, telemetryHomeRoute),
    provide(routesFacet, telemetryFileRoute),
  ],
})

/**
 * Plugin UI runs inside the app's existing React tree, so it can derive route
 * context through hooks instead of needing `App` on `ExtensionContext`.
 */
function TelemetryStatusBarItem() {
  const location = useLocation()
  const filePath = useAbsoluteFilePath()
  const href =
    location.pathname.includes(PATHS.FILE) && filePath
      ? filePath + PATHS.TELEMETRY + '?tab=project'
      : PATHS.HOME + PATHS.TELEMETRY

  return (
    <ActionButton
      Element="link"
      to={href}
      className={defaultStatusBarItemClassNames}
      data-testid="telemetry-link"
      aria-label="Telemetry"
      title="Telemetry"
      iconStart={{
        icon: 'stopwatch',
        bgClassName: 'bg-transparent dark:bg-transparent',
      }}
    />
  )
}

/** Contributes a status-bar entry point for the telemetry plugin. */
const telemetryStatusBarExt = defineExtension({
  provides: [
    provide(statusBarGlobalItemsFacet, {
      id: 'telemetry',
      component: TelemetryStatusBarItem,
    }),
  ],
})

/** Runtime-toggleable telemetry plugin definition. */
export const telemetry = createPlugin({
  id: 'telemetry',
  title: 'Telemetry',
  description:
    'Telemetry tracks app performance and exposes `/home/telemetry` and `/file/:id/telemetry`, plus a route-aware status bar entry point.',
  extensions: [telemetryRouteExt, telemetryStatusBarExt],
})
