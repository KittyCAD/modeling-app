import {
  type CloudProject,
  PROJECT_DIR,
  readOpfsTextFiles,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { setup } from '@e2e/playwright/test-utils'
import { expect, type Page, test } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

const TUTORIAL_PROJECT_ID = '12902000-0000-4000-8000-000000000001'

async function replayOnboardingFromSettings(page: Page) {
  await page.goto('/')
  await expect(
    page.getByRole('heading', {
      name: /^(Project Libraries|Personal Cloud)$/,
    })
  ).toBeVisible()

  await page.getByRole('link', { name: 'Settings' }).last().click()
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true })
  ).toBeVisible()
  await page.getByRole('button', { name: 'Replay onboarding' }).click()

  await expect(page).toHaveURL(/tutorial-project%2Fmain\.kcl\/onboarding\//)
  await expect(page.getByText('Welcome to Zoo Design Studio')).toBeVisible()
}

test(
  'Replay onboarding creates and reuses the Personal Cloud tutorial',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const remoteProjects: CloudProject[] = []
    let remoteRevision = 1
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      createProject: () => {
        const project = {
          id: TUTORIAL_PROJECT_ID,
          title: 'tutorial-project',
          revision: 'tutorial-project-rev-1',
          files: {},
        }
        remoteProjects.push(project)
        return project
      },
      updateProject: ({ projectId }) => {
        remoteRevision += 1
        const revision = `tutorial-project-rev-${remoteRevision}`
        if (remoteProjects[0]) {
          remoteProjects[0].revision = revision
        }
        return {
          status: 200,
          body: { id: projectId, title: 'tutorial-project', revision },
        }
      },
    })
    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])

    await replayOnboardingFromSettings(page)
    await expect.poll(() => apiCalls.creates.length).toBe(1)
    await page.evaluate(async (mainPath) => {
      await window.fsZds.writeFile(
        mainPath,
        new TextEncoder().encode('changed = true')
      )
    }, `${PROJECT_DIR}/tutorial-project/main.kcl`)
    await expect.poll(() => apiCalls.updates.length).toBeGreaterThanOrEqual(1)
    await replayOnboardingFromSettings(page)

    const tutorialFiles = await readOpfsTextFiles(page, {
      main: `${PROJECT_DIR}/tutorial-project/main.kcl`,
      settings: `${PROJECT_DIR}/tutorial-project/project.toml`,
    })
    expect(tutorialFiles.main).toContain('plateLength = 10')
    await expect.poll(() => apiCalls.updates.length).toBeGreaterThanOrEqual(2)
    await expect
      .poll(async () => {
        const files = await readOpfsTextFiles(page, {
          settings: `${PROJECT_DIR}/tutorial-project/project.toml`,
        })
        return files.settings
      })
      .toContain(`project_id = "${TUTORIAL_PROJECT_ID}"`)
  }
)
