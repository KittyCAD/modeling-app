import { Spinner } from '@src/components/Spinner'
import { useApp } from '@src/lib/boot'
import {
  ONBOARDING_PROJECT_NAME,
  SEARCH_PARAM_ML_PROMPT_KEY,
} from '@src/lib/constants'
import { modifiedColdPlate } from '@src/lib/exampleKcl'
import fsZds from '@src/lib/fs-zds'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import {
  type DesktopOnboardingPath,
  desktopOnboardingPaths,
} from '@src/lib/onboardingPaths'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import {
  PATHS,
  joinRouterPaths,
  safeEncodeForRouterPaths,
} from '@src/lib/paths'
import { reportRejection } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import type { Selections } from '@src/machines/modelingSharedTypes'
import {
  OnboardingButtons,
  OnboardingCard,
  isModelingCmdGroupReady,
  useAdvanceOnboardingOnFormSubmit,
  useOnModelingCmdGroupReadyOnce,
  useOnboardingHighlight,
  useOnboardingPanes,
} from '@src/routes/Onboarding/utils'
import { useCallback, useEffect, useState } from 'react'
import {
  type RouteObject,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'

type DesktopOnboardingRoute = RouteObject & {
  path: keyof typeof desktopOnboardingPaths
}

/**
 * This is the mapping between desktop onboarding paths and the components that will be rendered.
 * All components are defined below in this file.
 *
 * Desktop onboarding content is completely separate from browser onboarding content.
 */
const onboardingComponents: Record<DesktopOnboardingPath, React.JSX.Element> = {
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

function useNavigateToOnboardingFile() {
  const app = useApp()
  const navigate = useNavigate()

  return useCallback(
    ({
      projectName,
      fileName,
      subRoute,
    }: {
      projectName: string
      fileName: string
      subRoute: DesktopOnboardingPath
    }) => {
      const projectPath =
        app.project?.name === projectName
          ? app.project.path
          : fsZds.join(
              app.settings.get().app.projectDirectory.current,
              projectName
            )
      const filePath = fsZds.join(projectPath, fileName)
      void navigate(
        joinRouterPaths(
          PATHS.FILE,
          safeEncodeForRouterPaths(filePath),
          String(PATHS.ONBOARDING),
          subRoute
        )
      )
    },
    [app, navigate]
  )
}

function Welcome() {
  const app = useApp()
  const navigateToOnboardingFile = useNavigateToOnboardingFile()
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop'

  // Ensure panes are closed
  useOnboardingPanes()

  // Things that happen when we load this route
  useEffect(() => {
    // Navigate to the `main.kcl` file
    navigateToOnboardingFile({
      projectName: app.project?.name || ONBOARDING_PROJECT_NAME,
      fileName: 'main.kcl',
      subRoute: thisOnboardingStatus,
    })
  }, [app.project?.name, navigateToOnboardingFile])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 grid items-end justify-center p-2">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Welcome to Zoo Design Studio</h1>
        <p className="my-4">
          Here is a cold plate that was made in Zoo Design Studio.
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
  const { systemIO } = useApp()
  const navigateToOnboardingFile = useNavigateToOnboardingFile()
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/scene'

  // Ensure panes are closed
  useOnboardingPanes()

  // Things that happen when we load this route
  useEffect(() => {
    // Create if necessary and navigate to the `blank.kcl` file
    void systemIO
      .request({
        type: 'files.bulkCreateKCL',
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        requestedFileNameWithExtension: 'blank.kcl',
        files: [
          {
            requestedProjectName: ONBOARDING_PROJECT_NAME,
            requestedFileName: 'blank.kcl',
            requestedCode: '',
          },
        ],
        override: true,
      })
      .then(() => {
        navigateToOnboardingFile({
          projectName: ONBOARDING_PROJECT_NAME,
          fileName: 'blank.kcl',
          subRoute: thisOnboardingStatus,
        })
      })
      .catch(reportRejection)
  }, [navigateToOnboardingFile, systemIO])

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
    <div className="cursor-not-allowed fixed inset-0 z-[99] grid items-start justify-center p-24">
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
          month. Upgrade to a paid plan for additional usage. Pro and Team plans
          come with unlimited Zookeeper generations.
        </p>
        <p className="my-4">
          Let’s walk through an example of how to use Zookeeper.
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
  const [searchParams, setSearchParams] = useSearchParams()
  const prompt =
    'Design a cold plate with a serpentine copper coolant tube and recessed channels for thermal management'

  // Ensure panes are closed except TTC
  useOnboardingPanes([DefaultLayoutPaneID.TTC])

  // Enter the zookeeper flow with a prebaked prompt
  useEffect(() => {
    searchParams.set(SEARCH_PARAM_ML_PROMPT_KEY, prompt)
    setSearchParams(searchParams)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [])

  // Make it so submitting the command just advances the onboarding
  useAdvanceOnboardingOnFormSubmit(thisOnboardingStatus, 'desktop')

  return (
    <div className="cursor-not-allowed fixed inset-0 z-[99] grid items-center justify-center">
      <OnboardingCard className="pointer-events-auto">
        <h1 className="text-xl font-bold">Zookeeper prompt</h1>
        <p className="my-4">
          To save you money, we are going to use a pre-rolled Zookeeper prompt
          for this example. Click next to see an example of what Zookeeper can
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
  const navigateToOnboardingFile = useNavigateToOnboardingFile()
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/feature-tree-pane'
  const generatedFileName = 'main.kcl'

  // Highlight the feature tree pane button if it's present
  useOnboardingHighlight('feature-tree-pane-button')

  // Open the feature tree pane on mount, close on unmount
  useOnboardingPanes([DefaultLayoutPaneID.FeatureTree])

  // navigate to the "generated" file
  useEffect(() => {
    navigateToOnboardingFile({
      projectName: ONBOARDING_PROJECT_NAME,
      fileName: generatedFileName,
      subRoute: thisOnboardingStatus,
    })
  }, [navigateToOnboardingFile])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Cold Plate</h1>
        <p className="my-4">
          This is an example of the generated CAD model using Zookeeper. We
          skipped the real generation for this tutorial.
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
  useOnboardingPanes([DefaultLayoutPaneID.Code])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-8 grid justify-center items-end">
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
  useOnboardingPanes([DefaultLayoutPaneID.Files])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-8 grid justify-center items-end">
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
  useOnboardingPanes([DefaultLayoutPaneID.Logs, DefaultLayoutPaneID.Variables])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Other panes</h1>
        <p className="my-4">
          These last two panes are the Variables Pane and Logs Pane. The
          Variables pane will display the numeric values of any parameters you
          made, along with other entities and types created in your file. The
          Logs pane will show error logs.
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
  const navigateToOnboardingFile = useNavigateToOnboardingFile()
  const thisOnboardingStatus: DesktopOnboardingPath = '/desktop/prompt-to-edit'

  // Highlight the text-to-cad button if it's present
  useOnboardingHighlight('ttc-pane-button')

  // Open the text-to-cad pane
  // Navigate to the sample file
  useEffect(() => {
    navigateToOnboardingFile({
      projectName: ONBOARDING_PROJECT_NAME,
      fileName: 'main.kcl',
      subRoute: thisOnboardingStatus,
    })
  }, [navigateToOnboardingFile])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-8 grid justify-center items-center">
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
          platform="desktop"
        />
      </OnboardingCard>
    </div>
  )
}

function PromptToEditPrompt() {
  const { commands } = useApp()
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/prompt-to-edit-prompt'
  const prompt =
    'Increase the cold plate length to 12 inches and make the copper tube blue.'

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
    isModelingCmdGroupReady(commands.actor.getSnapshot())
  )
  useOnModelingCmdGroupReadyOnce(() => {
    setIsReady(true)
    commands.send({
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
          We are going to use Zookeeper to modify an existing model. Let’s
          update the cold plate dimensions and appearance.
        </p>
        <p className="my-4">
          To save you money, we are using a pre-rolled Zookeeper prompt to edit
          your existing cold plate. You can see the prompt in the window above.
          Click next to see an example of what modifying with Zookeeper would
          look like.
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
  const { systemIO } = useApp()
  const navigateToOnboardingFile = useNavigateToOnboardingFile()
  const thisOnboardingStatus: DesktopOnboardingPath =
    '/desktop/prompt-to-edit-result'

  // Open the code pane on mount, close on unmount
  useOnboardingPanes([DefaultLayoutPaneID.Code])

  useEffect(() => {
    // Navigate to the `main.kcl` file
    void systemIO
      .request({
        type: 'files.bulkCreateKCL',
        requestedProjectName: ONBOARDING_PROJECT_NAME,
        files: [
          {
            requestedFileName: 'main.kcl',
            requestedProjectName: ONBOARDING_PROJECT_NAME,
            requestedCode: modifiedColdPlate,
          },
        ],
        override: true,
      })
      .then(() => {
        navigateToOnboardingFile({
          projectName: ONBOARDING_PROJECT_NAME,
          fileName: 'main.kcl',
          subRoute: thisOnboardingStatus,
        })
      })
      .catch(reportRejection)
  }, [navigateToOnboardingFile, systemIO])

  return (
    <div className="cursor-not-allowed fixed inset-0 z-[99] p-8 grid justify-center items-end">
      <OnboardingCard className="col-start-3 col-span-2">
        <h1 className="text-xl font-bold">Result</h1>
        <p className="my-4">
          This is an example of an edit that Zookeeper can make for you. We
          skipped the real generation for this tutorial.
        </p>
        <p className="my-4">
          Zookeeper can update named parameters and related geometry together,
          so changes to dimensions and appearance stay connected to the source
          model.
        </p>
        <p className="my-4">
          All of our Zookeeper capabilities are experimental, so please report
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
    <div className="cursor-not-allowed fixed inset-0 z-50 p-24 flex flex-col gap-8 items-center">
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
    <div className="cursor-not-allowed fixed inset-0 z-50 p-24 grid justify-start items-center">
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
    [
      DefaultLayoutPaneID.FeatureTree,
      DefaultLayoutPaneID.Code,
      DefaultLayoutPaneID.Files,
    ],
    [
      DefaultLayoutPaneID.FeatureTree,
      DefaultLayoutPaneID.Code,
      DefaultLayoutPaneID.Files,
    ]
  )

  return (
    <div className="cursor-not-allowed fixed inset-0 z-50 p-24 grid justify-center items-center">
      <OnboardingCard>
        <h1 className="text-xl font-bold">Time to start building</h1>
        <p className="my-4">
          We appreciate you downloading Zoo Design Studio and taking the time to
          walk through the basics. To navigate back home to create your own
          project, click the Zoo button in the top left. To learn more detailed
          and advanced techniques,{' '}
          <a
            onClick={openExternalBrowserIfDesktop(withSiteBaseURL('/docs'))}
            href={`${withSiteBaseURL('/docs')}`}
          >
            check out our docs
          </a>
          .
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
