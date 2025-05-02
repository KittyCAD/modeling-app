import { browserOnboardingPaths } from '@src/lib/onboardingPaths'
import type { RouteObject } from 'react-router-dom'
import { OnboardingButtons } from './utils'

type BrowserOnboaringRoute = RouteObject & {
  path: keyof typeof browserOnboardingPaths
}
export const browserOnboardingRoutes: BrowserOnboaringRoute[] = [
  ...Object.values(browserOnboardingPaths).map((path) => ({
    path,
    element: (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">{path}</h1>
        <OnboardingButtons currentSlug={path} platform="browser" />
      </div>
    ),
  })),
]
