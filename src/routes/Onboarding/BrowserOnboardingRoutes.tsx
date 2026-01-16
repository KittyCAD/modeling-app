import { Spinner } from '@src/components/Spinner'
import {
  BROWSER_PROJECT_NAME,
  PROJECT_ENTRYPOINT,
  SEARCH_PARAM_ML_PROMPT_KEY,
} from '@src/lib/constants'
import {
  browserAxialFan,
  browserAxialFanAfterTextToCad,
} from '@src/lib/exampleKcl'
import {
  type BrowserOnboardingPath,
  browserOnboardingPaths,
} from '@src/lib/onboardingPaths'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { PATHS, joinRouterPaths } from '@src/lib/paths'
import type { Selections } from '@src/machines/modelingSharedTypes'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import {
  OnboardingButtons,
  OnboardingCard,
  isModelingCmdGroupReady,
  useAdvanceOnboardingOnFormSubmit,
  useOnModelingCmdGroupReadyOnce,
  useOnboardingHighlight,
  useOnboardingPanes,
} from '@src/routes/Onboarding/utils'
import { APP_DOWNLOAD_PATH } from '@src/routes/utils'
import { useEffect, useState } from 'react'
import { type RouteObject, useSearchParams } from 'react-router-dom'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import { useSingletons } from '@src/lib/singletons'

type BrowserOnboaringRoute = RouteObject & {
  path: keyof typeof browserOnboardingPaths
}

/**
 * This is the mapping between browser onboarding paths and the components that will be rendered.
 * All components are defined below in this file.
 *
 * Browser onboarding content is completely separate from desktop onboarding content.
 */
const browserOnboardingComponents: Record<
  BrowserOnboardingPath,
  React.JSX.Element
> = {
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
  const { systemIOActor } = useSingletons()
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
    <div className="cursor-not-allowed fixed inset-0 z-50 grid items-end justify-center p-2">
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
  const { systemIOActor } = useSingletons()
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
    <div className="cursor-not-allowed fixed inset-0 z-[99] grid items-start justify-center p-24">
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
  useOnboardingHighlight('ttc-pane-button')

  // Ensure panes are closed
  useOnboardingPanes()

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 grid items-start justify-center p-24">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Zookeeper</h1>
        <p className="my-4">
          You can find Zookeeper in the right sidebar. This allows you to write
          up a description of what you want, and our AI will generate the CAD
          for you. Zookeeper is currently in an experimental stage. We are
          improving it every day.
        </p>
        <p className="my-4">
          Our free plan includes a limited number of Zookeeper generations each
          month. Upgrade to a paid plan for additional compute time. Pro and Org
          plans come with unlimited Zookeeper generations.
        </p>
        <p className="my-4">
          Let’s walk through an example of how to use Zookeeper.
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
  const [searchParams, setSearchParams] = useSearchParams()
  const prompt =
    'Design a fan housing for a CPU cooler for a 120mm diameter fan with four holes for retaining clips'

  // Ensure panes are closed except TTC
  useOnboardingPanes([DefaultLayoutPaneID.TTC])

  // Enter the zookeeper flow with a prebaked prompt
  useEffect(() => {
    searchParams.set(SEARCH_PARAM_ML_PROMPT_KEY, prompt)
    setSearchParams(searchParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus)

  return (
    <div className="cursor-not-allowed fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Zookeeper prompt</h1>
        <p className="my-4">
          To save you compute time, we are going to use a pre-rolled Zookeeper
          prompt for this example. Click next to see an example of what
          Zookeeper can generate.
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
  const { systemIOActor } = useSingletons()
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/feature-tree-pane'

  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('feature-tree-pane-button')

  // Open the feature tree pane on mount, close on unmount
  useOnboardingPanes([DefaultLayoutPaneID.FeatureTree])

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

  // Highlight the text-to-cad button if it's present
  useOnboardingHighlight('ttc-pane-button')

  // Open the text-to-cad pane
  useOnboardingPanes([DefaultLayoutPaneID.TTC], [DefaultLayoutPaneID.TTC])

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus)

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 grid items-center justify-center p-24">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Modify with Zookeeper</h1>
        <p className="my-4">
          Zookeeper not only can <strong>create</strong> a part, but also{' '}
          <strong>modify</strong> an existing part. Still in the right sidebar,
          under the “Zookeeper” pane, you’ll be able to describe the change you
          want for your part, and our AI will generate the change.
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
  const { commandBarActor } = useSingletons()
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/prompt-to-edit-prompt'
  const prompt =
    'Change the housing to be for a 150 mm diameter fan, make it 30 mm tall, and change the color to purple.'

  // Open the text-to-cad pane
  useOnboardingPanes([DefaultLayoutPaneID.TTC], [DefaultLayoutPaneID.TTC])

  // Fill in the prompt if available
  const [searchParams, setSearchParams] = useSearchParams()
  useEffect(() => {
    searchParams.set(SEARCH_PARAM_ML_PROMPT_KEY, prompt)
    setSearchParams(searchParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

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
    <div className="cursor-not-allowed fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Modify with Zookeeper</h1>
        {!isReady && (
          <p className="absolute top-0 right-0 m-4 w-fit flex items-center py-1 px-2 rounded bg-chalkboard-20 dark:bg-chalkboard-80">
            <Spinner className="w-5 h-5 inline-block mr-2" />
            Waiting for connection...
          </p>
        )}
        <p className="my-4">
          To save you compute time, we are using a pre-rolled Zookeeper prompt
          to edit your existing fan housing. You can see the prompt in the
          window above. Click next to see an example of what modifying with
          Zookeeper would look like.
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
  const { systemIOActor } = useSingletons()
  const thisOnboardingStatus: BrowserOnboardingPath =
    '/browser/prompt-to-edit-result'

  // Open the code pane on mount, close on unmount
  useOnboardingPanes([DefaultLayoutPaneID.Code])

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
    <div className="cursor-not-allowed fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Result</h1>
        <p className="my-4">
          This is an example of an edit that Zookeeper can make for you. We
          skipped the real generation for this tutorial.
        </p>
        <p className="my-4">
          Zookeeper will make changes across files in your project, so if you
          have named parameters in another file that need to change to complete
          your request, it is smart enough to go find their source and change
          them.
        </p>
        <p className="my-4">
          All of our Zookeeper capabilities are experimental, so please report
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
  const downloadLink = withSiteBaseURL(`/${APP_DOWNLOAD_PATH}`)

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-24 grid justify-center items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Download the desktop app</h1>
        <p className="my-4">
          We highly encourage you to{' '}
          <a
            onClick={openExternalBrowserIfDesktop(downloadLink)}
            href={downloadLink}
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
