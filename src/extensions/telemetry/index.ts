import { routesFacet, statusBarFacet } from '@src/facets'
import { defineExtension, provide, createPlugin } from '@src/lib/extensions'
import { PATHS } from '@src/lib/paths'
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
    provide(statusBarFacet, {
      global: [
        {
          id: 'telemetry',
          element: 'link',
          icon: 'stopwatch',
          href: `${PATHS.TELEMETRY}?tab=project`,
          'data-testid': 'telemetry-link',
          label: 'Telemetry',
          hideLabel: true,
          toolTip: {
            children: 'Telemetry',
          },
        },
      ],
    }),
  ],
})

/** Runtime-toggleable telemetry plugin definition. */
export const telemetry = createPlugin({
  id: 'telemetry',
  title: 'Telemetry',
  description:
    'Telemetry tracks app performance and exposes routes at `/home/telemetry` and `/file/:id/telemetry`, plus a status bar item.',
  extensions: [telemetryRouteExt, telemetryStatusBarExt],
})
