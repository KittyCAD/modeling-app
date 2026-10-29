import { expect, test } from '@e2e/playwright/base-test'
import {
  type CloudProject,
  projectToml,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudProjectTestUtils'
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
    await routeCloudProjects(context, {
      remoteProjects,
      updateProject: async () => ({
        status: 200,
        body: {
          ...remoteProjects[0],
          description: '',
          category_ids: [],
          revision: 'next',
        },
      }),
    })
    await setup(context, page, testInfo)
    await page.goto('/')

    // Avoid interrupting WebKit's in-flight billing request when onboarding
    // replaces the current document.
    await waitForWebKitBillingToSettle(page)

    await page.goto(
      `/file/${encodeURIComponent(
        `/__zoo_cloud__/${TUTORIAL_PROJECT_ID}/main.kcl`
      )}/onboarding/desktop/scene`
    )

    await expect(page).toHaveURL(
      /__zoo_cloud__.*%2Fblank\.kcl\/onboarding\/desktop\/scene/,
      { timeout: 15_000 }
    )
    await expect(page.getByRole('heading', { name: 'Scene' })).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(
          (id) =>
            window.app.fileOperations.exists(`/__zoo_cloud__/${id}/blank.kcl`),
          TUTORIAL_PROJECT_ID
        )
      )
      .toBe(true)
    await expect(page.getByTestId('onboarding-next')).toBeVisible()
  }
)
