import { defineRegistryItem, provide } from '@kittycad/registry'
import { appOverlayContributionsValueSpec } from '@src/registry/contracts/appUrl'
import { telemetryOverlayContribution } from './overlay'

export default defineRegistryItem({
  id: 'telemetry',
  provides: [
    provide(appOverlayContributionsValueSpec, telemetryOverlayContribution, {
      key: telemetryOverlayContribution.id,
    }),
  ],
})
