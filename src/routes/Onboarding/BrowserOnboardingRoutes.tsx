import {
  type BrowserOnboardingPath,
  browserOnboardingPaths,
} from '@src/lib/onboardingPaths'
import type { RouteObject } from 'react-router-dom'
import { OnboardingButtons } from './utils'

type BrowserOnboaringRoute = RouteObject & {
  path: keyof typeof browserOnboardingPaths
}

const browserOnboardingComponents: Record<BrowserOnboardingPath, JSX.Element> =
  {
    '/browser': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser</h1>
        <OnboardingButtons currentSlug="/browser" platform="browser" />
      </div>
    ),
    '/browser/scene': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/scene</h1>
        <p>BAHAHAHA CUSTOM CONTENT BOIII</p>
        <OnboardingButtons currentSlug="/browser/scene" platform="browser" />
      </div>
    ),
    '/browser/toolbar': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/toolbar</h1>
        <OnboardingButtons currentSlug="/browser/toolbar" platform="browser" />
      </div>
    ),
    '/browser/text-to-cad': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/text-to-cad</h1>
        <OnboardingButtons
          currentSlug="/browser/text-to-cad"
          platform="browser"
        />
      </div>
    ),
    '/browser/text-to-cad-prompt': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/text-to-cad-prompt</h1>
        <OnboardingButtons
          currentSlug="/browser/text-to-cad-prompt"
          platform="browser"
        />
      </div>
    ),
    '/browser/feature-tree-pane': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/feature-tree-pane</h1>
        <OnboardingButtons
          currentSlug="/browser/feature-tree-pane"
          platform="browser"
        />
      </div>
    ),
    '/browser/prompt-to-edit': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/prompt-to-edit</h1>
        <OnboardingButtons
          currentSlug="/browser/prompt-to-edit"
          platform="browser"
        />
      </div>
    ),
    '/browser/prompt-to-edit-prompt': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/prompt-to-edit-prompt</h1>
        <OnboardingButtons
          currentSlug="/browser/prompt-to-edit-prompt"
          platform="browser"
        />
      </div>
    ),
    '/browser/prompt-to-edit-result': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/prompt-to-edit-result</h1>
        <OnboardingButtons
          currentSlug="/browser/prompt-to-edit-result"
          platform="browser"
        />
      </div>
    ),
    '/browser/conclusion': (
      <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
        <h1 className="text-xl">/browser/conclusion</h1>
        <OnboardingButtons
          currentSlug="/browser/conclusion"
          platform="browser"
        />
      </div>
    ),
  }

export const browserOnboardingRoutes: BrowserOnboaringRoute[] = [
  ...Object.values(browserOnboardingPaths).map((path) => ({
    path,
    element: browserOnboardingComponents[path],
  })),
]
