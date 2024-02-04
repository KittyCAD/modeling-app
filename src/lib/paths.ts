import { onboardingPaths } from 'routes/Onboarding/paths'

const prependRoutes =
  (routesObject: Record<string, string>) => (prepend: string) => {
    return Object.fromEntries(
      Object.entries(routesObject).map(([constName, path]) => [
        constName,
        prepend + path,
      ])
    )
  }

export const paths = {
  INDEX: '/',
  HOME: '/home',
  FILE: '/file',
  SETTINGS: '/settings',
  SIGN_IN: '/signin',
  ONBOARDING: prependRoutes(onboardingPaths)(
    '/onboarding'
  ) as typeof onboardingPaths,
}
