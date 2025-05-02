import {
  type DesktopOnboardingPath,
  desktopOnboardingPaths,
} from '@src/lib/onboardingPaths'
import type { RouteObject } from 'react-router-dom'
import { OnboardingButtons } from './utils'

type DesktopOnboardingRoute = RouteObject & {
  path: keyof typeof desktopOnboardingPaths
}

const onboardingComponents: Record<DesktopOnboardingPath, JSX.Element> = {
  '/desktop': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop</h1>
      <OnboardingButtons currentSlug="/desktop" platform="desktop" />
    </div>
  ),
  '/desktop/scene': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/scene</h1>
      <p>BLAHHH THIS IS SPECIAL CONTENT!!!</p>
      <OnboardingButtons currentSlug="/desktop/scene" platform="desktop" />
    </div>
  ),
  '/desktop/toolbar': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/toolbar</h1>
      <OnboardingButtons currentSlug="/desktop/toolbar" platform="desktop" />
    </div>
  ),
  '/desktop/text-to-cad': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/text-to-cad</h1>
      <OnboardingButtons
        currentSlug="/desktop/text-to-cad"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/text-to-cad-prompt': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/text-to-cad-prompt</h1>
      <OnboardingButtons
        currentSlug="/desktop/text-to-cad-prompt"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/feature-tree-pane': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/feature-tree-pane</h1>
      <OnboardingButtons
        currentSlug="/desktop/feature-tree-pane"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/code-pane': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/code-pane</h1>
      <OnboardingButtons currentSlug="/desktop/code-pane" platform="desktop" />
    </div>
  ),
  '/desktop/project-pane': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/project-pane</h1>
      <OnboardingButtons
        currentSlug="/desktop/project-pane"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/other-panes': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/other-panes</h1>
      <OnboardingButtons
        currentSlug="/desktop/other-panes"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/prompt-to-edit': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/prompt-to-edit</h1>
      <OnboardingButtons
        currentSlug="/desktop/prompt-to-edit"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/prompt-to-edit-prompt': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/prompt-to-edit-prompt</h1>
      <OnboardingButtons
        currentSlug="/desktop/prompt-to-edit-prompt"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/prompt-to-edit-result': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/prompt-to-edit-result</h1>
      <OnboardingButtons
        currentSlug="/desktop/prompt-to-edit-result"
        platform="desktop"
      />
    </div>
  ),
  '/desktop/imports': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/imports</h1>
      <OnboardingButtons currentSlug="/desktop/imports" platform="desktop" />
    </div>
  ),
  '/desktop/exports': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/exports</h1>
      <OnboardingButtons currentSlug="/desktop/exports" platform="desktop" />
    </div>
  ),
  '/desktop/conclusion': (
    <div className="fixed inset-0 z-50 bg-red-300 grid place-content-center">
      <h1 className="text-xl">/desktop/conclusion</h1>
      <OnboardingButtons currentSlug="/desktop/conclusion" platform="desktop" />
    </div>
  ),
}

export const desktopOnboardingRoutes: DesktopOnboardingRoute[] = [
  ...Object.values(desktopOnboardingPaths).map((path) => ({
    path,
    index: true,
    element: onboardingComponents[path],
  })),
]
