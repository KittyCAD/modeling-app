import { defineRegistryItem, provide } from '@kittycad/registry'
import { appNavigationIntentContributionsValueSpec } from '@src/registry/contracts/appNavigation'
import { appNavigationUrlContributionsValueSpec } from '@src/registry/contracts/appUrl'
import {
  onboardingNavigationUrlContribution,
  startOnboardingIntentContribution,
} from './overlay'

export default defineRegistryItem({
  id: 'onboarding',
  provides: [
    provide(
      appNavigationIntentContributionsValueSpec,
      startOnboardingIntentContribution,
      { key: startOnboardingIntentContribution.intentId }
    ),
    provide(
      appNavigationUrlContributionsValueSpec,
      onboardingNavigationUrlContribution,
      { key: onboardingNavigationUrlContribution.intent.id }
    ),
  ],
})
