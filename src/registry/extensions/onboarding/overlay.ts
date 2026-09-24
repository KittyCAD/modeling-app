import { isOnboardingPath, type OnboardingPath } from '@src/lib/onboardingPaths'
import { PATHS } from '@src/lib/paths'
import { defineAppNavigationIntent } from '@src/registry/contracts/appNavigation'
import { defineAppNavigationUrlContribution } from '@src/registry/contracts/appUrl'

export interface OnboardingOverlayState {
  step?: OnboardingPath
}

export const startOnboardingIntent = defineAppNavigationIntent<
  OnboardingOverlayState,
  void
>('onboarding.start')

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
      } satisfies OnboardingOverlayState
    },
    format: (state: OnboardingOverlayState) => ({
      path: `${PATHS.ONBOARDING}${state.step ?? ''}`,
    }),
  })
