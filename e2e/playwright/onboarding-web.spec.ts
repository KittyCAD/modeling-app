import {
  type CloudProject,
  createRemoteListGate,
  opfsPathExists,
  PROJECT_DIR,
  readOpfsTextFiles,
  routeCloudProjects,
} from '@e2e/playwright/lib/cloudSyncTestUtils'
import { setup } from '@e2e/playwright/test-utils'
import { expect, type Page, test } from '@playwright/test'
import { OPFS_CLOUD_FEATURE_FLAG } from '@src/lib/constants'

const TUTORIAL_PROJECT_IDS = [
  '12902000-0000-4000-8000-000000000001',
  '12902000-0000-4000-8000-000000000002',
] as const

async function replayOnboardingFromSettings(
  page: Page,
  expectedProjectName: string
) {
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

  await expect(page).toHaveURL(
    new RegExp(`${expectedProjectName}%2Fmain\\.kcl/onboarding/`)
  )
  await expect(page.getByText('Welcome to Zoo Design Studio')).toBeVisible()
}

async function expectBackDoesNotReopenOnboarding(page: Page) {
  await page.goBack()
  await expect(page).not.toHaveURL(/\/onboarding\//)
  await page.goForward()
  await expect(page).toHaveURL(/\/home$/)
}

test(
  'Replay onboarding creates a uniquely named Personal Cloud tutorial',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    const remoteProjects: CloudProject[] = []
    const remoteRevisions = new Map<string, number>()
    const remoteListGate = createRemoteListGate()
    const { calls: apiCalls } = await routeCloudProjects(context, {
      remoteProjects,
      remoteListGate,
      createProject: () => {
        const index = remoteProjects.length
        const id = TUTORIAL_PROJECT_IDS[index]
        if (!id) {
          throw new Error('Unexpected extra tutorial project creation.')
        }
        const title =
          index === 0 ? 'tutorial-project' : `tutorial-project-${index}`
        const project = {
          id,
          title,
          revision: `${id}-rev-1`,
          files: {},
        }
        remoteProjects.push(project)
        remoteRevisions.set(id, 1)
        return project
      },
      updateProject: ({ projectId }) => {
        const project = remoteProjects.find(({ id }) => id === projectId)
        if (!project) {
          return undefined
        }
        const revision = (remoteRevisions.get(project.id) ?? 1) + 1
        remoteRevisions.set(project.id, revision)
        project.revision = `${project.id}-rev-${revision}`
        return {
          status: 200,
          body: {
            id: project.id,
            title: project.title,
            revision: project.revision,
          },
        }
      },
    })
    await setup(context, page, testInfo, [OPFS_CLOUD_FEATURE_FLAG])

    await replayOnboardingFromSettings(page, 'tutorial-project')
    await expect
      .poll(async () => {
        const files = await readOpfsTextFiles(page, {
          main: `${PROJECT_DIR}/tutorial-project/main.kcl`,
        })
        return files.main
      })
      .toContain('plateLength = 10')

    const conclusionUrl = `/file/${encodeURIComponent(
      `${PROJECT_DIR}/tutorial-project/main.kcl`
    )}/onboarding/desktop/conclusion`
    await page.evaluate((url) => window.location.replace(url), conclusionUrl)
    await expect(page).toHaveURL(/\/onboarding\/desktop\/conclusion$/)
    await page.getByTestId('onboarding-next').click()
    await expect(page).toHaveURL(/\/home$/)
    await expectBackDoesNotReopenOnboarding(page)
    await expect(
      page.getByRole('heading', {
        name: /^(Project Libraries|Personal Cloud)$/,
      })
    ).toBeVisible()
    await expect(page.getByTestId('home-tutorial-button')).not.toBeVisible()
    const tutorialProjectLink = page.getByTestId('project-link').filter({
      has: page
        .getByTestId('project-title')
        .filter({ hasText: /^tutorial-project$/ }),
    })
    await expect(tutorialProjectLink).toHaveCount(1)
    await expect(
      tutorialProjectLink.getByTestId('project-file-count')
    ).toHaveText('1')
    remoteListGate.release()
    await expect.poll(() => apiCalls.creates.length).toBe(1)
    expect(apiCalls.creates[0]).toContain('tutorial-project')
    await expect
      .poll(() => apiCalls.remoteListResponses)
      .toBeGreaterThanOrEqual(1)
    await expect(tutorialProjectLink).toHaveCount(1)
    await expect(
      tutorialProjectLink.getByTestId('project-file-count')
    ).toHaveText('1')
    await tutorialProjectLink.click()
    await expect(page).toHaveURL(/tutorial-project%2Fmain\.kcl$/)

    await page.evaluate(async (mainPath) => {
      await window.fsZds.writeFile(
        mainPath,
        new TextEncoder().encode('changed = true')
      )
    }, `${PROJECT_DIR}/tutorial-project/main.kcl`)
    await expect.poll(() => apiCalls.updates.length).toBeGreaterThanOrEqual(1)

    await replayOnboardingFromSettings(page, 'tutorial-project-1')
    await expect.poll(() => apiCalls.creates.length).toBe(2)
    expect(apiCalls.creates[1]).toContain('tutorial-project-1')
    await expect
      .poll(async () => {
        const files = await readOpfsTextFiles(page, {
          main: `${PROJECT_DIR}/tutorial-project-1/main.kcl`,
        })
        return files.main
      })
      .toContain('plateLength = 10')

    await page.getByTestId('onboarding-next').click()
    await expect(page).toHaveURL(
      /tutorial-project-1%2Fblank\.kcl\/onboarding\/desktop\/scene/
    )
    await expect
      .poll(() =>
        opfsPathExists(page, `${PROJECT_DIR}/tutorial-project-1/blank.kcl`)
      )
      .toBe(true)
    expect(
      await opfsPathExists(page, `${PROJECT_DIR}/tutorial-project/blank.kcl`)
    ).toBe(false)

    const promptResultUrl = `/file/${encodeURIComponent(
      `${PROJECT_DIR}/tutorial-project-1/main.kcl`
    )}/onboarding/desktop/prompt-to-edit-result`
    await page.evaluate((url) => window.location.replace(url), promptResultUrl)
    await expect(page).toHaveURL(
      /tutorial-project-1%2Fmain\.kcl\/onboarding\/desktop\/prompt-to-edit-result/
    )
    await expect(
      page.getByRole('heading', { name: 'Result', exact: true })
    ).toBeVisible()
    await expect
      .poll(async () => {
        const files = await readOpfsTextFiles(page, {
          replayMain: `${PROJECT_DIR}/tutorial-project-1/main.kcl`,
        })
        return files.replayMain
      })
      .toContain('plateLength = 12')
    await expect
      .poll(() =>
        apiCalls.updates.some(
          ({ projectId }) => projectId === TUTORIAL_PROJECT_IDS[1]
        )
      )
      .toBe(true)

    const tutorialFiles = await readOpfsTextFiles(page, {
      originalMain: `${PROJECT_DIR}/tutorial-project/main.kcl`,
      originalSettings: `${PROJECT_DIR}/tutorial-project/project.toml`,
      replayMain: `${PROJECT_DIR}/tutorial-project-1/main.kcl`,
      replaySettings: `${PROJECT_DIR}/tutorial-project-1/project.toml`,
    })
    expect(tutorialFiles.originalMain).toBe('changed = true')
    expect(tutorialFiles.replayMain).toContain('plateLength = 12')
    expect(tutorialFiles.originalSettings).toContain(
      `project_id = "${TUTORIAL_PROJECT_IDS[0]}"`
    )
    expect(tutorialFiles.replaySettings).toContain(
      `project_id = "${TUTORIAL_PROJECT_IDS[1]}"`
    )
    expect(apiCalls.creates).toHaveLength(2)

    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/home$/)
    await expect(
      page.getByRole('heading', {
        name: /^(Project Libraries|Personal Cloud)$/,
      })
    ).toBeVisible()
    await expectBackDoesNotReopenOnboarding(page)
  }
)
