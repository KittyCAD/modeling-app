import { expect, test } from '@e2e/playwright/base-test'
import {
  type CloudProject,
  opfsPathExists,
  PROJECT_DIR,
  projectToml,
  routeCloudProjects,
  seedCloudSyncState,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import {
  mockClientErrorReports,
  setup,
  waitForAppLoad,
  waitForWebKitBillingToSettle,
} from '@e2e/playwright/test-utils'
import { PLAYWRIGHT_PROJECT_DIRECTORY } from '@e2e/playwright/storageStates'
import { test as liveTest } from '@e2e/playwright/zoo-test'
const TUTORIAL_PROJECT_ID = '12902000-0000-4000-8000-000000000001'

test(
  'Onboarding Scene creates and opens blank.kcl before allowing advance',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const tutorialProjectFiles = {
      'main.kcl': 'plateLength = 10\n',
      'project.toml': projectToml('tutorial-project', TUTORIAL_PROJECT_ID),
    }
    const remoteProjects: CloudProject[] = [
      {
        id: TUTORIAL_PROJECT_ID,
        title: 'tutorial-project',
        revision: `${TUTORIAL_PROJECT_ID}-rev-1`,
        files: tutorialProjectFiles,
      },
    ]
    await mockClientErrorReports(context)
    await routeCloudProjects(context, { remoteProjects })
    await setup(context, page, testInfo)
    await page.goto('/')

    await seedCloudSyncState(page, {
      projects: [
        {
          projectName: 'tutorial-project',
          files: tutorialProjectFiles,
        },
      ],
      metadata: [
        {
          projectName: 'tutorial-project',
          remoteProjectId: TUTORIAL_PROJECT_ID,
          remoteRevision: `${TUTORIAL_PROJECT_ID}-rev-1`,
          baseFiles: tutorialProjectFiles,
        },
      ],
    })
    // Avoid interrupting WebKit's in-flight billing request when onboarding
    // replaces the current document.
    await waitForWebKitBillingToSettle(page)

    await page.goto(
      `/file/${encodeURIComponent(
        `${PROJECT_DIR}/tutorial-project/main.kcl`
      )}/onboarding/desktop/scene`
    )
    // Document load does not await the deferred app bootstrap.
    await waitForAppLoad(page)

    await expect(page).toHaveURL(
      /tutorial-project%2Fblank\.kcl\/onboarding\/desktop\/scene/,
      { timeout: 15_000 }
    )
    await expect(page.getByRole('heading', { name: 'Scene' })).toBeVisible()
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/tutorial-project/blank.kcl`)
      )
      .toBe(true)
    await expect(page.getByTestId('onboarding-next')).toBeVisible()
  }
)

liveTest.describe('Local onboarding with real API routes', () => {
  liveTest.use({ mockApiRoutes: false })

  liveTest(
    'Onboarding Scene creates and opens a local blank.kcl before Next advances',
    { tag: '@web' },
    async ({ page, fs }) => {
      const projectPath = await fs.join(
        PLAYWRIGHT_PROJECT_DIRECTORY,
        'onboarding-local'
      )
      const mainPath = await fs.join(projectPath, 'main.kcl')
      const blankPath = await fs.join(projectPath, 'blank.kcl')
      const mainCode = '@settings(kclVersion = 3.0)\ninitial = 1\n'
      const blankCode = '@settings(kclVersion = 3.0)\n'
      await fs.mkdir(projectPath, { recursive: true })
      await fs.writeFile(mainPath, new TextEncoder().encode(mainCode))
      await waitForWebKitBillingToSettle(page)
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              window.app.settings.actor.getSnapshot().context.modeling
                .defaultUnit.current
          )
        )
        .toBe('mm')

      const blankRoute = `/file/${encodeURIComponent(blankPath)}/onboarding/desktop/scene`
      await page.goto(
        `/file/${encodeURIComponent(mainPath)}/onboarding/desktop/scene`
      )
      await waitForAppLoad(page)

      await expect(page).toHaveURL(new URL(blankRoute, page.url()).href, {
        timeout: 15_000,
      })
      await expect(page.getByRole('heading', { name: 'Scene' })).toBeVisible()
      await expect.poll(() => fs.readFile(blankPath, 'utf8')).toBe(blankCode)
      await expect.poll(() => fs.readFile(mainPath, 'utf8')).toBe(mainCode)
      await expect
        .poll(() =>
          page.evaluate((blankPath) => {
            const editor = window.app.project?.executingEditor.value
            return Boolean(
              editor?.path === blankPath &&
                !editor.hasErrors() &&
                !editor.isExecutingSignal.value &&
                Object.keys(editor.engineCommandManager.pendingCommands)
                  .length === 0
            )
          }, blankPath)
        )
        .toBe(true)
      const next = page.getByTestId('onboarding-next')
      await expect(next).toBeVisible()
      await expect(next).toBeEnabled()
      await next.click()
      await expect(page).toHaveURL(
        new URL(
          `/file/${encodeURIComponent(blankPath)}/onboarding/desktop/toolbar`,
          page.url()
        ).href
      )
      await expect(
        page.getByRole('heading', { name: 'This is the toolbar' })
      ).toBeVisible()
    }
  )
})
