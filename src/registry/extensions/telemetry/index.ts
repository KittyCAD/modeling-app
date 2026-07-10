import { defineRegistryItem, provideService } from '@kittycad/registry'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import { PATHS } from '@src/lib/paths'
import { maybeWriteToDisk } from '@src/lib/telemetry'
import {
  defineRegistryRoute,
  lazyRouteComponent,
  provideRoute,
} from '@src/registry/contracts/router'
import {
  telemetryService,
  type TelemetryRegistryService,
} from '@src/registry/contracts/telemetry'

const telemetryServiceImpl: TelemetryRegistryService = {
  maybeWriteToDisk,
}

const fileTelemetryRoute = defineRegistryRoute({
  id: `${PATHS.FILE}.telemetry`,
  parentId: PATHS.FILE,
  order: 20,
  buildRoute: () => ({
    path: makeUrlPathRelative(PATHS.TELEMETRY),
    lazy: lazyRouteComponent(
      async () => (await import('@src/routes/Telemetry')).Telemetry
    ),
  }),
})

const homeTelemetryRoute = defineRegistryRoute({
  id: `${PATHS.HOME}.telemetry`,
  parentId: PATHS.HOME,
  order: 20,
  buildRoute: () => ({
    path: makeUrlPathRelative(PATHS.TELEMETRY),
    lazy: lazyRouteComponent(
      async () => (await import('@src/routes/Telemetry')).Telemetry
    ),
  }),
})

const telemetryExtension = defineRegistryItem({
  id: 'telemetry',
  providesServices: [provideService(telemetryService, telemetryServiceImpl)],
  provides: [fileTelemetryRoute, homeTelemetryRoute].map(provideRoute),
})

export default telemetryExtension
