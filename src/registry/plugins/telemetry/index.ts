import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { defineRegistryItem, provide } from '@kittycad/registry'
import { createZdsPlugin } from '@src/registry/createZdsPlugin'
import { PATHS, webSafeJoin } from '@src/lib/paths'

/** Contributes a status-bar entry point for the telemetry plugin. */
const telemetryStatusBarItem = defineRegistryItem({
  provides: [
    provide(statusBarGlobalItemsValueSpec, {
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
    'Telemetry tracks app performance and exposes a route-aware status bar entry point.',
  items: [telemetryStatusBarItem],
  defaultSetting: 'core',
})

export default telemetry
