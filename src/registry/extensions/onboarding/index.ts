import { defineRegistryItem, provide } from '@kittycad/registry'
import { appOverlayContributionsValueSpec } from '@src/registry/contracts/appUrl'
import { onboardingOverlayContribution } from './overlay'

export default defineRegistryItem({
  id: 'onboarding',
  provides: [
    provide(appOverlayContributionsValueSpec, onboardingOverlayContribution, {
      key: onboardingOverlayContribution.id,
    }),
  ],
})
