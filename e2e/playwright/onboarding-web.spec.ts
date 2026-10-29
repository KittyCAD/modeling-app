import { expect, test } from '@e2e/playwright/base-test'
import {
  type CloudProject,
  mockCloudUser,
  opfsPathExists,
  PROJECT_DIR,
  projectToml,
  routeCloudProjects,
  seedCloudSyncState,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import {
  mockClientErrorReports,
  setup,
  waitForWebKitBillingToSettle,
} from '@e2e/playwright/test-utils'
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
    await mockCloudUser(context)
    await setup(context, page, testInfo, [], { cloudSyncEnabled: true })
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
      `/project/${TUTORIAL_PROJECT_ID}/onboarding/desktop/scene?file=main.kcl`
    )

    await expect(page).toHaveURL(
      new RegExp(
        `/project/${TUTORIAL_PROJECT_ID}/onboarding/desktop/scene\\?file=blank.kcl`
      ),
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
