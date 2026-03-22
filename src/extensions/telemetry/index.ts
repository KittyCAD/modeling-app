import { routesFacet } from '@src/facets'
import {
  Compartment,
  type ExtensionNode,
  createTogglableExtension,
  defineExtension,
  provide,
} from '@src/lib/extensions'
import { telemetryFileRoute, telemetryHomeRoute } from '@src/routes/Telemetry'

const telemetryRouteExt = defineExtension({
  provides: [
    provide(routesFacet, telemetryHomeRoute),
    provide(routesFacet, telemetryFileRoute),
  ],
})

const compartment = new Compartment()
const telemetryBase = [telemetryRouteExt]
export const telemetryToggle = createTogglableExtension({
  name: 'telemetry',
  extensions: telemetryBase,
  compartment,
})
window.telemetryToggle = telemetryToggle

export const telemetry: ExtensionNode[] = [
  compartment.of(...telemetryBase),
  telemetryToggle.extension,
]
