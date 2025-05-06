import {
  type BrowserOnboardingPath,
  browserOnboardingPaths,
} from '@src/lib/onboardingPaths'
import { Link, useRouteLoaderData, type RouteObject } from 'react-router-dom'
import {
  isModelingCmdGroupReady,
  OnboardingButtons,
  OnboardingCard,
  useOnboardingHighlight,
  useOnboardingPanes,
  useOnModelingCmdGroupReadyOnce,
} from './utils'
import { Spinner } from '@src/components/Spinner'
import {
  ONBOARDING_PROJECT_NAME,
  ONBOARDING_DATA_ATTRIBUTE,
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { PATHS, joinRouterPaths } from '@src/lib/paths'
import type { Selections } from '@src/lib/selections'
import { systemIOActor, commandBarActor } from '@src/lib/singletons'
import type { IndexLoaderData } from '@src/lib/types'
import { useRequestedProjectName } from '@src/machines/systemIO/hooks'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useEffect, useState } from 'react'
import { VITE_KC_SITE_BASE_URL } from '@src/env'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'

type BrowserOnboaringRoute = RouteObject & {
  path: keyof typeof browserOnboardingPaths
}

/**
 * This is the mapping between browser onboarding paths and the components that will be rendered.
 * All components are defined below in this file.
 *
 * Browser onboarding content is completely seperate from desktop onboarding content.
 */
const browserOnboardingComponents: Record<BrowserOnboardingPath, JSX.Element> =
  {
    '/browser': <Welcome />,
    '/browser/scene': <Scene />,
    '/browser/toolbar': <Toolbar />,
    '/browser/text-to-cad': <TextToCad />,
    '/browser/text-to-cad-prompt': <TextToCadPrompt />,
    '/browser/feature-tree-pane': <FeatureTreePane />,
    '/browser/prompt-to-edit': <PromptToEdit />,
    '/browser/prompt-to-edit-prompt': <PromptToEditPrompt />,
    '/browser/prompt-to-edit-result': <PromptToEditResult />,
    '/browser/conclusion': <OnboardingConclusion />,
  }

function Welcome() {
  const thisOnboardingStatus: BrowserOnboardingPath = '/browser'

  // Ensure panes are closed
  useOnboardingPanes()

  // Things that happen when we load this route
  useEffect(() => {
    // Navigate to the `main.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileName: PROJECT_ENTRYPOINT,
        requestedCode: '',
        requestedSubRoute: joinRouterPaths(
          PATHS.ONBOARDING,
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Welcome to Zoo Design Studio</h1>
        <p className="my-4">
          Here is an assembly of a CPU Cooler that was made in Zoo Design
          Studio.
        </p>
        <p className="my-4">
          Let’s walk through the basics of how to get started, and how you can
          use several tools at your disposal to create great designs.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function Scene() {
  const thisOnboardingStatus: BrowserOnboardingPath = '/browser/scene'

  // Ensure panes are closed
  useOnboardingPanes()

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Here is a blank scene</h1>
        <p className="my-4">
          There are three default planes shown when the scene is empty. Try
          middle clicking to orbit around.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function Toolbar() {
  // Highlight the toolbar if it's present
  useOnboardingHighlight('toolbar')

  // Ensure panes are closed
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-[99] grid items-start justify-center p-16">
      <OnboardingCard>
        <h1 className="text-xl font-bold">This is the toolbar</h1>
        <p className="my-4">
          You can perform modeling and sketching actions by clicking any of the
          tools.
        </p>
        <OnboardingButtons currentSlug="/browser/toolbar" platform="browser" />
      </OnboardingCard>
    </div>
  )
}

function TextToCad() {
  // Highlight the text-to-cad button if it's present
  useOnboardingHighlight('ai-group')

  // Ensure panes are closed
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-50 grid items-start justify-center p-16">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Text-to-CAD</h1>
        <p className="my-4">
          This last button is Text-to-CAD. This allows you to write up a
          description of what you want, and our AI will generate the CAD for
          you.
        </p>
        <p className="my-4">
          If you are on the free plan, you get 20 free credits. With any of our
          paid plans, you get unlimited Text-to-CAD generations.
        </p>
        <p className="my-4">
          Let’s walk through an example of how to use Text-to-CAD.
        </p>
        <OnboardingButtons
          currentSlug="/browser/text-to-cad"
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function TextToCadPrompt() {
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const prompt = 'Design a CPU cooler housing with <insert params here>.'

  // Ensure panes are closed
  useOnboardingPanes()

  // Enter the text-to-cad flow with a prebaked prompt
  useEffect(() => {
    commandBarActor.send({
      type: 'Find and select command',
      data: {
        groupId: 'application',
        name: 'Text-to-CAD',
        argDefaultValues: {
          method: 'existingProject',
          projectName: loaderData?.project?.name,
          prompt,
        },
      },
    })
  }, [loaderData?.project?.name])

  return (
    <div className="fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Text-to-CAD prompt</h1>
        <p className="my-4">
          When you click the Text-to-CAD button, it opens the command palette to
          where you can input a text prompt. To save you a Text-to-CAD
          generation credit, we are going to use a pre-rolled Text-to-CAD prompt
          for this example. Click next to see an example of what Text-to-CAD can
          generate.
        </p>
        <OnboardingButtons
          currentSlug="/browser/text-to-cad-prompt"
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function FeatureTreePane() {
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/feature-tree-pane'

  // Hightlight the feature tree pane button if it's present
  useOnboardingHighlight('feature-tree-pane-button')

  // Open the feature tree pane on mount, close on unmount
  useOnboardingPanes(['feature-tree'])

  // navigate to the "generated" file
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileName: PROJECT_ENTRYPOINT,
        requestedCode: '// Whatever who cares',
        requestedSubRoute: joinRouterPaths(
          PATHS.ONBOARDING,
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">CPU Housing</h1>
        <p className="my-4">
          This is an example of a generated CAD model. We skipped the real
          generation for this tutorial, but normally you'll be asked to approve
          the generation first.
        </p>
        <p className="my-4">
          To the left are the panes. We have opened the feature tree pane for
          you. The feature tree pane displays all the CAD functions that were
          performed to create this part. You can double click feature tree items
          to edit their parameters.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEdit() {
  const thisOnboardingStatus: BrowserOnboardingPath = '/browser/prompt-to-edit'

  // Click the text-to-cad dropdown button if it's available
  useEffect(() => {
    const dropdownButton = document.querySelector(
      `[data-${ONBOARDING_DATA_ATTRIBUTE}="ai-dropdown-button"]`
    )
    if (dropdownButton === null) {
      console.error(
        `Expected dropdown is not present in onboarding step '${thisOnboardingStatus}'`
      )
      return
    }

    if (dropdownButton instanceof HTMLButtonElement) {
      dropdownButton.click()
    }
  }, [])
  // Close the panes on mount, close on unmount
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-50 grid items-start justify-center p-16">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Modify with Zoo Text-to-CAD</h1>
        <p className="my-4">
          One more way to edit your part is through "Modify" in this dropdown,
          which we also call "Prompt-to-Edit".
        </p>
        <p className="my-4">
          Similar to generating with Text-to-CAD, you describe how you want your
          CAD model to be changed, and our AI will generate the changes for you.
          Using Modify with Zoo Text-to-CAD also costs credits.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditPrompt() {
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/prompt-to-edit-prompt'
  const prompt =
    'Change the housing to be _____, add ____, change the color to be tan.'

  // Ensure panes are closed
  useOnboardingPanes()

  // Enter the prompt-to-edit flow with a prebaked prompt
  const [isReady, setIsReady] = useState(
    isModelingCmdGroupReady(commandBarActor.getSnapshot())
  )
  useOnModelingCmdGroupReadyOnce(() => {
    setIsReady(true)
    commandBarActor.send({
      type: 'Find and select command',
      data: {
        groupId: 'modeling',
        name: 'Prompt-to-edit',
        argDefaultValues: {
          selection: {
            graphSelections: [],
            otherSelections: [],
          } satisfies Selections,
          prompt,
        },
      },
    })
  }, [])

  return (
    <div className="fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Text-to-CAD prompt</h1>
        {!isReady && (
          <p className="absolute top-0 right-0 m-4 w-fit flex items-center py-1 px-2 rounded bg-chalkboard-20 dark:bg-chalkboard-80">
            <Spinner className="w-5 h-5 inline-block mr-2" />
            Waiting for connection...
          </p>
        )}
        <p className="my-4">
          When you click the Text-to-CAD button, it opens the command palette to
          where you can input a text prompt. To save you a Text-to-CAD
          generation credit, we are going to use a pre-rolled Text-to-CAD prompt
          for this example. Click next to see an example of what Text-to-CAD can
          generate.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditResult() {
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/prompt-to-edit-result'
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  // Open the code pane on mount, close on unmount
  useOnboardingPanes(['code'])

  useEffect(() => {
    // Navigate to the `main.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.navigateToFile,
      data: {
        requestedProjectName:
          loaderData?.project?.name || ONBOARDING_PROJECT_NAME,
        requestedFileName: 'main.kcl',
        requestedSubRoute: joinRouterPaths(
          PATHS.ONBOARDING,
          thisOnboardingStatus
        ),
      },
    })
  }, [loaderData?.project?.name])

  return (
    <div className="fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Prompt-to-Edit results</h1>
        <p className="my-4">
          This is an example of edits Prompt-to-Edit can make to your CAD model.
          We skipped the real generation for this tutorial, but normally you'll
          be asked to approve the generation first.
        </p>
        <p className="my-4">
          Prompt-to-Edit will make changes across files in your project, so if
          you have named parameters in another file that need to change to
          complete your request, it is smart enough to go find their source and
          change them.
        </p>
        <p className="my-4">
          All our Text-to-CAD capabilities are in beta, so please report any
          issues to us and stay tuned for updates!
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function OnboardingConclusion() {
  // Highlight the App logo
  useOnboardingHighlight('app-logo')
  // Close the panes on mount, close on unmount
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-50 p-16 grid justify-center items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Download the desktop app</h1>
        <p className="my-4">
          We highly encourage you to{' '}
          <a
            onClick={openExternalBrowserIfDesktop(
              `${VITE_KC_SITE_BASE_URL}/modeling-app/download/nightly`
            )}
            href="https://zoo.dev/modeling-app/download/nightly"
            target="_blank"
            rel="noopener noreferrer"
          >
            download our desktop app
          </a>{' '}
          so you can experience full functionalities of Zoo Design Studio,
          including multi-part assemblies, project management, and local file
          saving.
        </p>
        <OnboardingButtons
          currentSlug="/browser/conclusion"
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

export const browserOnboardingRoutes: BrowserOnboaringRoute[] = [
  ...Object.values(browserOnboardingPaths).map((path) => ({
    path,
    element: browserOnboardingComponents[path],
  })),
]
