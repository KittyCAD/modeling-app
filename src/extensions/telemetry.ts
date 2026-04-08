import { routesFacet, statusBarGlobalItemsFacet } from '@src/facets'
import { defineExtension, provide, createPlugin } from '@src/lib/extensions'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import { telemetryFileRoute, telemetryHomeRoute } from '@src/routes/Telemetry'

/** Contributes the telemetry modal routes for both home and file contexts. */
const telemetryRouteExt = defineExtension({
  provides: [
    provide(routesFacet, telemetryHomeRoute),
    provide(routesFacet, telemetryFileRoute),
  ],
})

/** Contributes a status-bar entry point for the telemetry plugin. */
const telemetryStatusBarExt = defineExtension({
  provides: [
    provide(statusBarGlobalItemsFacet, {
      id: 'telemetry',
      element: 'link',
      icon: 'stopwatch',
      href: (location) => webSafeJoin([location.pathname, PATHS.TELEMETRY]),
      'data-testid': 'telemetry-link',
      label: 'Telemetry',
      hideLabel: true,
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
