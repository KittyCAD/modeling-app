import {
  type DesktopOnboardingPath,
  desktopOnboardingPaths,
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
import { useEffect, useState } from 'react'
import { commandBarActor, systemIOActor } from '@src/lib/singletons'
import { SystemIOMachineEvents } from '@src/machines/systemIO/utils'
import { joinRouterPaths, PATHS } from '@src/lib/paths'
import {
  ONBOARDING_DATA_ATTRIBUTE,
  ONBOARDING_PROJECT_NAME,
} from '@src/lib/constants'
import type { IndexLoaderData } from '@src/lib/types'
import type { Selections } from '@src/lib/selections'
import { Spinner } from '@src/components/Spinner'
import { modifiedFanHousing } from '@src/lib/exampleKcl'

type DesktopOnboardingRoute = RouteObject & {
  path: keyof typeof desktopOnboardingPaths
}

/**
 * This is the mapping between desktop onboarding paths and the components that will be rendered.
 * All components are defined below in this file.
 *
 * Desktop onboarding content is completely separate from browser onboarding content.
 */
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
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop'
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData

  // Ensure panes are closed
  useOnboardingPanes()

  // Things that happen when we load this route
  useEffect(() => {
    // Navigate to the `main.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.navigateToFile,
      data: {
        requestedProjectName:
          loaderData?.project?.name || ONBOARDING_PROJECT_NAME,
        requestedFileName: 'main.kcl',
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [loaderData?.project?.name])

  return (
    <div className="fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Welcome to Zoo Design Studio</h1>
        <p className="my-4">
          Here is an assembly of a CPU fan that was made in Zoo Design Studio.
        </p>
        <p className="my-4">
          Let’s walk through the basics of how to get started, and how you can
          use several tools at your disposal to create great designs.
        </p>
        <OnboardingButtons currentSlug="/desktop" platform="desktop" />
      </OnboardingCard>
    </div>
  )
}

function Scene() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/scene'

  // Ensure panes are closed
  useOnboardingPanes()

  // Things that happen when we load this route
  useEffect(() => {
    // Create if necessary and navigate to the `blank.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.importFileFromURL,
      data: {
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        requestedFileNameWithExtension: 'blank.kcl',
        requestedCode: '',
        requestedSubRoute: joinRouterPaths(
          String(PATHS.ONBOARDING),
          thisOnboardingStatus
        ),
      },
    })
  }, [])

  return (
    <div className="pointer-events-none fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Scene</h1>
        <p className="my-4">
          Here is a blank scene. There are three default planes shown when the
          scene is empty. Try right-clicking and dragging to orbit around, and
          scroll to zoom in and out.
        </p>
        <OnboardingButtons currentSlug="/desktop/scene" platform="desktop" />
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
        <OnboardingButtons currentSlug="/desktop/toolbar" platform="desktop" />
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
          minute. If you are on the free plan, you get 20 free credits per
          month. With any of our paid plans, you get unlimited Text-to-CAD
          generations.
        </p>
        <p className="my-4">
          Let’s walk through an example of how to use Text-to-CAD.
        </p>
        <OnboardingButtons
          currentSlug="/desktop/text-to-cad"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function TextToCadPrompt() {
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/text-to-cad-prompt'
  const loaderData = useRouteLoaderData(PATHS.FILE) as IndexLoaderData
  const prompt =
    'Design a fan housing for a CPU cooler for a 120mm diameter fan with four holes for retaining clips'

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
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus, 'desktop')

  return (
    <div className="fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard className="pointer-events-auto">
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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function FeatureTreePane() {
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/feature-tree-pane'
  const generatedFileName = 'fan-housing.kcl'

  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('feature-tree-pane-button')

  // Open the feature tree pane on mount, close on unmount
  useOnboardingPanes(['feature-tree'])

  // navigate to the "generated" file
  useEffect(() => {
    systemIOActor.send({
      type: SystemIOMachineEvents.navigateToFile,
      data: {
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        requestedFileName: generatedFileName,
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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function CodePane() {
  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('code-pane-button')

  // Open the code pane on mount, close on unmount
  useOnboardingPanes(['code'])

  return (
    <div className="fixed inset-0 z-50 p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">KCL Code</h1>
        <p className="my-4">
          This is the KCL Pane. KCL (KittyCAD Language) is a scripting language
          we created to describe CAD geometries. This code is the source of
          truth, everything you do to the model will change the code.
        </p>
        <p className="my-4">
          KCL boasts other scripting features such as imports, functions and
          logic. Not only can you edit your geometry from the feature tree, but
          you can also edit the code directly.
        </p>
        <OnboardingButtons
          currentSlug="/desktop/code-pane"
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function ProjectPane() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/project-pane'
  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('files-pane-button')

  // Open the code pane on mount, close on unmount
  useOnboardingPanes(['files'])

  return (
    <div className="fixed inset-0 z-50 p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Files Pane</h1>
        <p className="my-4">
          The next pane is the Project Files Pane. Here you can see all of the
          files you have in this project. This can be other KCL files as well as
          external CAD files (STEP, STL, OBJ, etc.).
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function OtherPanes() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/other-panes'
  // Highlight the log and variable panes button if it's present
  useOnboardingHighlight('logs-pane-button')
  useOnboardingHighlight('variables-pane-button')

  // Open the panes on mount, close on unmount
  useOnboardingPanes(['logs', 'variables'])

  return (
    <div className="fixed inset-0 z-50 p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Other panes</h1>
        <p className="my-4">
          These last two panes are the Variables Pane and Logs Pane. The
          Variables pane will display the numeric values of any parameters you
          made, along with other entities and types created in your in your
          file. The Logs pane will show error logs.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEdit() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/prompt-to-edit'

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

  // Make it so pressing Enter advances instead of toggling the dropdown
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus, 'desktop')

  return (
    <div className="fixed inset-0 z-50 p-8 grid justify-center items-center">
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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditPrompt() {
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/prompt-to-edit-prompt'
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
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus, 'desktop')

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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditResult() {
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/prompt-to-edit-result'

  // Open the code pane on mount, close on unmount
  useOnboardingPanes(['code'])

  useEffect(() => {
    // Navigate to the `main.kcl` file
    systemIOActor.send({
      type: SystemIOMachineEvents.bulkCreateKCLFilesAndNavigateToProject,
      data: {
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        files: [
          {
            requestedFileName: 'main.kcl',
            requestedProjectName: ONBOARDING_PROJECT_NAME,
            requestedCode: modifiedFanHousing,
          },
        ],
        override: true,
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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function Imports() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/imports'

  // Highlight the import and insert buttons if they're present
  useOnboardingHighlight('add-file-to-project-pane-button')
  useOnboardingHighlight('insert')
  // Close the panes on mount, close on unmount
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-50 p-16 flex flex-col gap-8 items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Add file(s) to project</h1>
        <p className="my-4">
          "Add file(s) to project" is available in the left sidebar. Use it to
          bring files into your project, whether from the sample library or from
          your local drive.
        </p>
        <h1 className="text-xl font-bold">Insert parts</h1>
        <p className="my-4">
          Once a file has been added to your project, you can add it to the
          scene using insert. Insert is available in the toolbar. This is the
          first step to making assemblies!
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function Exports() {
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/exports'
  // Highlight the export button if it's present
  useOnboardingHighlight('export-pane-button')
  // Close the panes on mount, close on unmount
  useOnboardingPanes()

  return (
    <div className="fixed inset-0 z-50 p-16 grid justify-start items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Exporting</h1>
        <p className="my-4">
          You can export the currently-opened part by clicking the Export button
          in the left sidebar. We support exporting to STEP, gLTF, STL, OBJ, and
          more.
        </p>
        <OnboardingButtons
          currentSlug={thisOnboardingStatus}
          platform="desktop"
          dismissPosition="right"
        />
      </OnboardingCard>
    </div>
  )
}

function OnboardingConclusion() {
  // Highlight the App logo
  useOnboardingHighlight('app-logo')
  // Close the panes on mount, close on unmount
  useOnboardingPanes(
    ['feature-tree', 'code', 'files'],
    ['feature-tree', 'code', 'files']
  )

  return (
    <div className="fixed inset-0 z-50 p-16 grid justify-center items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Time to start building</h1>
        <p className="my-4">
          We appreciate you downloading Zoo Design Studio and taking the time to
          walk through the basics. To navigate back home to create your own
          project, click the Zoo button in the top left (gesture). To learn more
          detailed and advanced techniques, go here (TODO tutorials).
        </p>
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
