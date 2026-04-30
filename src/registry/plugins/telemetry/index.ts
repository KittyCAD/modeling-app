import { routesSignal, statusBarGlobalItemsSignal } from '@src/signals'
import { defineRegistryItem, provide } from '@kittycad/registry'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { PATHS, webSafeJoin } from '@src/lib/paths'
import { telemetryFileRoute, telemetryHomeRoute } from '@src/routes/Telemetry'

/** Contributes the telemetry modal routes for both home and file contexts. */
const telemetryRouteItem = defineRegistryItem({
  provides: [
    provide(routesSignal, telemetryHomeRoute),
    provide(routesSignal, telemetryFileRoute),
  ],
})

/** Contributes a status-bar entry point for the telemetry plugin. */
const telemetryStatusBarItem = defineRegistryItem({
  provides: [
    provide(statusBarGlobalItemsSignal, {
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
const telemetry = createZdsPlugin({
  id: 'telemetry',
  title: 'Telemetry',
  description:
    'Telemetry tracks app performance and exposes `/home/telemetry` and `/file/:id/telemetry`, plus a route-aware status bar entry point.',
  items: [telemetryRouteItem, telemetryStatusBarItem],
  defaultSetting: 'core',
})

export default telemetry
