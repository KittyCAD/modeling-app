import type { OnboardingStatus } from '@rust/kcl-lib/bindings/OnboardingStatus'

export const ONBOARDING_SUBPATHS: Record<string, OnboardingStatus> = {
  INDEX: '/',
  CAMERA: '/camera',
  STREAMING: '/streaming',
  EDITOR: '/editor',
  PARAMETRIC_MODELING: '/parametric-modeling',
  INTERACTIVE_NUMBERS: '/interactive-numbers',
  COMMAND_K: '/command-k',
  USER_MENU: '/user-menu',
  PROJECT_MENU: '/project-menu',
  EXPORT: '/export',
  SKETCHING: '/sketching',
  FUTURE_WORK: '/future-work',
} as const

export const isOnboardingSubPath = (
  input: string
): input is OnboardingStatus => {
  return Object.values(ONBOARDING_SUBPATHS).includes(input as OnboardingStatus)
}
