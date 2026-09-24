import { defineRegistryItem, provide } from '@kittycad/registry'
import { appNavigationUrlContributionsValueSpec } from '@src/registry/contracts/appUrl'
import { telemetryNavigationUrlContribution } from './overlay'

export default defineRegistryItem({
  id: 'telemetry',
  provides: [
    provide(
      appNavigationUrlContributionsValueSpec,
      telemetryNavigationUrlContribution,
      { key: telemetryNavigationUrlContribution.intent.id }
    ),
  ],
})
