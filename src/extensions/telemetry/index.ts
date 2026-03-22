import { routesFacet, statusBarFacet } from '@src/facets'
import { defineExtension, provide, createPlugin } from '@src/lib/extensions'
import { PATHS } from '@src/lib/paths'
import { telemetryFileRoute, telemetryHomeRoute } from '@src/routes/Telemetry'

const telemetryRouteExt = defineExtension({
  provides: [
    provide(routesFacet, telemetryHomeRoute),
    provide(routesFacet, telemetryFileRoute),
  ],
})

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

export const telemetry = createPlugin({
  id: 'telemetry',
  title: 'Telemetry',
  description:
    'Telemetry tracks the performance of the app, allowing other extensions to mark timers and events. It adds a `/telemetry` route and a status bar item.',
  extensions: [telemetryRouteExt, telemetryStatusBarExt],
})
