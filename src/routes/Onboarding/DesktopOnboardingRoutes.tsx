import {
  type DesktopOnboardingPath,
  desktopOnboardingPaths,
} from '@src/lib/onboardingPaths'
import type { RouteObject } from 'react-router-dom'
import { OnboardingButtons } from './utils'
import { useEffect } from 'react'
import { useModelingContext } from '@src/hooks/useModelingContext'

type DesktopOnboardingRoute = RouteObject & {
  path: keyof typeof desktopOnboardingPaths
}

const OnboardingCard = ({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={`max-w-3xl bg-chalkboard-10 dark:bg-chalkboard-90 p-8 rounded ${className || ''}`}
    {...props}
  >
    {children}
  </div>
)

const onboardingComponents: Record<DesktopOnboardingPath, JSX.Element> = {
  '/desktop': <Welcome />,
  '/desktop/scene': <Scene />,
  '/desktop/toolbar': <Toolbar />,
  '/desktop/text-to-cad': <TextToCad />,
  '/desktop/text-to-cad-prompt': <TextToCadPrompt />,
  '/desktop/feature-tree-pane': <FeatureTreePane />,
  '/desktop/code-pane': <CodePane />,
  '/desktop/project-pane': <ProjectPane />,
  '/desktop/other-panes': <OtherPanes />,
  '/desktop/prompt-to-edit': <PromptToEdit />,
  '/desktop/prompt-to-edit-prompt': <PromptToEditPrompt />,
  '/desktop/prompt-to-edit-result': <PromptToEditResult />,
  '/desktop/imports': <Imports />,
  '/desktop/exports': <Exports />,
  '/desktop/conclusion': <OnboardingConclusion />,
}

function Welcome() {
  useEffect(() => {
    console.log('Onboarding welcome')
  }, [])
  const { send } = useModelingContext()
  useEffect(() => {
    send({
      type: 'Set context',
      data: {
        openPanes: [],
      },
    })
  }, [send])
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">Welcome to Zoo Design Studio</h1>
        <p>
          Here is an assembly of a CPU Cooler that was made in Zoo Design
          Studio.
        </p>
        <OnboardingButtons currentSlug="/desktop" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function Scene() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/scene</h1>
        <p>BLAHHH THIS IS SPECIAL CONTENT!!!</p>
        <OnboardingButtons currentSlug="/desktop/scene" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function Toolbar() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/toolbar</h1>
        <OnboardingButtons currentSlug="/desktop/toolbar" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function TextToCad() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/text-to-cad</h1>
        <OnboardingButtons
          currentSlug="/desktop/text-to-cad"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function TextToCadPrompt() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/text-to-cad-prompt</h1>
        <OnboardingButtons
          currentSlug="/desktop/text-to-cad-prompt"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function FeatureTreePane() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/feature-tree-pane</h1>
        <OnboardingButtons
          currentSlug="/desktop/feature-tree-pane"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function CodePane() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/code-pane</h1>
        <OnboardingButtons
          currentSlug="/desktop/code-pane"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function ProjectPane() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/project-pane</h1>
        <OnboardingButtons
          currentSlug="/desktop/project-pane"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function OtherPanes() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/other-panes</h1>
        <OnboardingButtons
          currentSlug="/desktop/other-panes"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEdit() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/prompt-to-edit</h1>
        <OnboardingButtons
          currentSlug="/desktop/prompt-to-edit"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditPrompt() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/prompt-to-edit-prompt</h1>
        <OnboardingButtons
          currentSlug="/desktop/prompt-to-edit-prompt"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditResult() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/prompt-to-edit-result</h1>
        <OnboardingButtons
          currentSlug="/desktop/prompt-to-edit-result"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function Imports() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/imports</h1>
        <OnboardingButtons currentSlug="/desktop/imports" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function Exports() {
  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/exports</h1>
        <OnboardingButtons currentSlug="/desktop/exports" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function OnboardingConclusion() {
  useEffect(() => {
    console.log('Onboarding conclusion')
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid place-content-center">
      <OnboardingCard>
        <h1 className="text-xl">/desktop/conclusion</h1>
        <OnboardingButtons
          currentSlug="/desktop/conclusion"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

export const desktopOnboardingRoutes: DesktopOnboardingRoute[] = [
  ...Object.values(desktopOnboardingPaths).map((path) => ({
    path,
    index: true,
    element: onboardingComponents[path],
  })),
]
