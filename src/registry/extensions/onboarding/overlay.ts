import { isOnboardingPath, type OnboardingPath } from '@src/lib/onboardingPaths'
import { PATHS } from '@src/lib/paths'
import {
  defineAppNavigationIntent,
  defineAppNavigationIntentContribution,
} from '@src/registry/contracts/appNavigation'
import { defineAppNavigationUrlContribution } from '@src/registry/contracts/appUrl'

export interface StartOnboardingInput {
  step?: OnboardingPath
}

export const startOnboardingIntent = defineAppNavigationIntent<
  StartOnboardingInput,
  undefined
>('onboarding.start', { placement: 'additional' })

export const startOnboardingIntentContribution =
  defineAppNavigationIntentContribution(
    startOnboardingIntent,
    async () => undefined
  )

export const onboardingNavigationUrlContribution =
  defineAppNavigationUrlContribution(startOnboardingIntent, {
    parse: ({ destination, path }) => {
      if (destination !== 'project' || !path.startsWith(PATHS.ONBOARDING)) {
        return undefined
      }

      const step = path.slice(PATHS.ONBOARDING.length)
      if (step && !isOnboardingPath(step)) {
        return undefined
      }
      const parsedStep = step as OnboardingPath | ''

      return {
        ...(parsedStep ? { step: parsedStep } : {}),
      } satisfies StartOnboardingInput
    },
    format: (state: StartOnboardingInput) => ({
      path: `${PATHS.ONBOARDING}${state.step ?? ''}`,
    }),
  })
