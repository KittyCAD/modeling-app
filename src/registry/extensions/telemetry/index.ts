import { defineRegistryItem, provide } from '@kittycad/registry'
import { appNavigationIntentContributionsValueSpec } from '@src/registry/contracts/appNavigation'
import { appNavigationUrlContributionsValueSpec } from '@src/registry/contracts/appUrl'
import {
  openTelemetryIntentContribution,
  telemetryNavigationUrlContribution,
} from './overlay'

export default defineRegistryItem({
  id: 'telemetry',
  provides: [
    provide(
      appNavigationIntentContributionsValueSpec,
      openTelemetryIntentContribution,
      { key: openTelemetryIntentContribution.intentId }
    ),
    provide(
      appNavigationUrlContributionsValueSpec,
      telemetryNavigationUrlContribution,
      { key: telemetryNavigationUrlContribution.intent.id }
    ),
  ],
})
