import {
  type BrowserOnboardingPath,
  browserOnboardingPaths,
} from '@src/lib/onboardingPaths'
import { useRouteLoaderData, type RouteObject } from 'react-router-dom'
import {
  isModelingCmdGroupReady,
  OnboardingButtons,
  OnboardingCard,
  useAdvanceOnboardingOnFormSubmit,
  useOnboardingHighlight,
  useOnboardingPanes,
  useOnModelingCmdGroupReadyOnce,
} from '@src/routes/Onboarding/utils'
import { Spinner } from '@src/components/Spinner'
import {
  ONBOARDING_DATA_ATTRIBUTE,
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
} from '@src/lib/constants'
import { PATHS, joinRouterPaths } from '@src/lib/paths'
import type { Selections } from '@src/lib/selections'
import { systemIOActor, commandBarActor } from '@src/lib/singletons'
import type { IndexLoaderData } from '@src/lib/types'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { useEffect, useState } from 'react'
import { VITE_KC_SITE_BASE_URL } from '@src/env'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  browserAxialFan,
  browserAxialFanAfterTextToCad,
} from '@src/lib/exampleKcl'

type BrowserOnboaringRoute = RouteObject & {
  path: keyof typeof browserOnboardingPaths
}

/**
 * This is the mapping between browser onboarding paths and the components that will be rendered.
 * All components are defined below in this file.
 *
 * Browser onboarding content is completely separate from desktop onboarding content.
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
    // Overwrite the code with the browser-version of the axial-fan example
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
        requestedCode: browserAxialFan,
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Welcome to Zoo Design Studio</h1>
        <p className="my-4">
          Here is an axial fan that was made in Zoo Design Studio. It's a part
          of a larger CPU cooler assembly sample you can view in the desktop
          app, which supports multiple-part assemblies.
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

  // Things that happen when we load this route
  useEffect(() => {
    // Navigate to the `main.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
        requestedCode: '',
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  // Ensure panes are closed
  useOnboardingPanes()

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Scene</h1>
        <p className="my-4">
          Here is a blank scene. There are three default planes shown when the
          scene is empty. Try right-clicking and dragging to orbit around, and
          scroll to zoom in and out.
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
          you. Text-to-CAD is currently in an experimental stage. We are
          improving it every day.
        </p>
        <p className="my-4">
          <strong>One</strong> Text-to-CAD generation costs{' '}
          <strong>one credit per minute</strong>, rounded up to the nearest
          minute. A large majority of Text-to-CAD generations take under a
          minute. If you are on the free plan, you get 40 free credits per
          month. With any of our paid plans, you get unlimited Text-to-CAD
          generations.
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
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/text-to-cad-prompt'
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const prompt =
    'Design a fan housing for a CPU cooler for a 120mm diameter fan with four holes for retaining clips.'

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

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus)

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
          currentSlug={thisOnboardingStatus}
          platform="browser"
        />
      </OnboardingCard>
    </div>
  )
}

function FeatureTreePane() {
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/feature-tree-pane'

  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('feature-tree-pane-button')

  // Open the feature tree pane on mount, close on unmount
  useOnboardingPanes(['feature-tree'])

  // Overwrite the code with the "generated" KCL
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
        requestedCode: browserAxialFan,
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">CPU Fan Housing</h1>
        <p className="my-4">
          This is an example of a generated CAD model; it's the same model we
          showed you at the start. We skipped the real generation for this
          tutorial, but normally you'll be asked to approve the generation
          first.
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

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus)

  return (
    <div className="fixed inset-0 z-50 grid items-center justify-center p-16">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Modify with Zoo Text-to-CAD</h1>
        <p className="my-4">
          Text-to-CAD not only can <strong>create</strong> a part, but also{' '}
          <strong>modify</strong> an existing part. In the dropdown, you’ll see
          “Modify with Zoo Text-to-CAD”. Once clicked, you’ll describe the
          change you want for your part, and our AI will generate the change.
          Once again, this will cost <strong>one credit per minute</strong> it
          took to generate. Once again, most of the time, this is under a
          minute.
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
    'Change the housing to be for a 150 mm diameter fan, make it 30 mm tall, and change the color to purple.'

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

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus)

  return (
    <div className="fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Modify with Text-to-CAD prompt</h1>
        {!isReady && (
          <p className="absolute top-0 right-0 m-4 w-fit flex items-center py-1 px-2 rounded bg-chalkboard-20 dark:bg-chalkboard-80">
            <Spinner className="w-5 h-5 inline-block mr-2" />
            Waiting for connection...
          </p>
        )}
        <p className="my-4">
          To save you a credit, we are using a pre-rolled Text-to-CAD prompt to
          edit your existing fan housing. You can see the prompt in the window
          above. Click next to see an example of what modifying with Text-to-CAD
          would look like.
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

  // Open the code pane on mount, close on unmount
  useOnboardingPanes(['code'])

  // Overwrite the code with the "generated" KCL
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: BROWSER_PROJECT_NAME,
        requestedFileNameWithExtension: PROJECT_ENTRYPOINT,
        requestedCode: browserAxialFanAfterTextToCad,
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Result</h1>
        <p className="my-4">
          This is an example of an edit that Text-to-CAD can make for you. We
          skipped the real generation for this tutorial, but normally you'll be
          asked to approve the generation first.
        </p>
        <p className="my-4">
          Text-to-CAD will make changes across files in your project, so if you
          have named parameters in another file that need to change to complete
          your request, it is smart enough to go find their source and change
          them.
        </p>
        <p className="my-4">
          All of our Text-to-CAD capabilities are experimental, so please report
          any issues to us and stay tuned for updates! We are working on it
          every day.
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
          so you can experience the full functionality of Zoo Design Studio,
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
