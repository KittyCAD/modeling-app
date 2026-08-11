import {
  PROJECT_DIR,
  readOpfsTextFiles,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { setup } from '@e2e/playwright/test-utils'
import { expect, test } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

test(
  'Replay onboarding from cloud home opens the tutorial',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects: [],
      createProject: () => ({
        id: 'tutorial-project-cloud-id',
        title: 'tutorial-project',
        revision: 'tutorial-project-rev-1',
        files: {},
      }),
    })
    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])

    await test.step('Open the cloud project home page', async () => {
      await page.goto('/')
      await expect(
        page.getByRole('heading', {
          name: /^(Project Libraries|Personal Cloud)$/,
        })
      ).toBeVisible()
    })

    await test.step('Open user settings from home', async () => {
      await page.getByRole('link', { name: 'Settings' }).last().click()
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible()
    })

    await test.step('Replay onboarding and open the tutorial project', async () => {
      await page.getByRole('button', { name: 'Replay onboarding' }).click()

      await expect(page).toHaveURL(/tutorial-project%2Fmain\.kcl\/onboarding\//)
      await expect(page.getByText('Welcome to Zoo Design Studio')).toBeVisible()
    })

    await test.step('Create and enroll the tutorial as a cloud project', async () => {
      const tutorialFiles = await readOpfsTextFiles(page, {
        main: `${PROJECT_DIR}/tutorial-project/main.kcl`,
        settings: `${PROJECT_DIR}/tutorial-project/project.toml`,
      })

      expect(tutorialFiles.main).toContain('plateLength = 10')
      await expect.poll(() => apiCalls.creates.length).toBeGreaterThanOrEqual(1)
      expect(apiCalls.creates[0]).toContain('tutorial-project')
      await expect
        .poll(async () => {
          const files = await readOpfsTextFiles(page, {
            settings: `${PROJECT_DIR}/tutorial-project/project.toml`,
          })
          return files.settings
        })
        .toContain('project_id = "tutorial-project-cloud-id"')
    })
  }
)
