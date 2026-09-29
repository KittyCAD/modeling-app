import { defineRegistryItem, provide } from '@kittycad/registry'
import { appNavigationUrlContributionsValueSpec } from '@src/registry/contracts/appUrl'
import { onboardingNavigationUrlContribution } from './overlay'

export default defineRegistryItem({
  id: 'onboarding',
  provides: [
    provide(
      appNavigationUrlContributionsValueSpec,
      onboardingNavigationUrlContribution,
      { key: onboardingNavigationUrlContribution.intent.id }
    ),
  ],
})
