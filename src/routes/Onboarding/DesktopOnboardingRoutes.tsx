import { desktopOnboardingPaths } from '@src/lib/onboardingPaths'
import type { RouteObject } from 'react-router-dom'
import { OnboardingButtons } from './utils'

type DesktopOnboardingRoute = RouteObject & {
  path: keyof typeof desktopOnboardingPaths
}
export const desktopOnboardingRoutes: DesktopOnboardingRoute[] = [
  ...Object.values(desktopOnboardingPaths).map((path) => ({
    path,
    index: true,
    element: (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">{path}</h1>
        <OnboardingButtons currentSlug={path} platform="desktop" />
      </div>
    ),
  })),
]
