import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page, TestInfo } from '@playwright/test'

const RELEASE_ONBOARDING_PROJECT_CREATION =
  '__playwrightReleaseOnboardingProjectCreation'

async function holdNextOnboardingProjectCreation(page: Page) {
  await page.evaluate((releaseKey) => {
    const originalGetTargets = window.app.getCreateProjectLibraryTargets
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    window.app.getCreateProjectLibraryTargets = () =>
      originalGetTargets().map((target) => {
        const originalRun = target.createProject.run
        return {
          ...target,
          createProject: {
            ...target.createProject,
            run: async (input) => {
              await gate
              return originalRun(input)
            },
          },
        }
      })

    Object.assign(window, {
      [releaseKey]: () => {
        window.app.getCreateProjectLibraryTargets = originalGetTargets
        release?.()
      },
    })
  }, RELEASE_ONBOARDING_PROJECT_CREATION)

  return async () => {
    await page.evaluate((releaseKey) => {
      const testWindow = window as unknown as Record<string, unknown>
      const release = testWindow[releaseKey]
      if (typeof release !== 'function') {
        throw new Error('Onboarding project creation gate is missing.')
      }
      release()
      delete testWindow[releaseKey]
    }, RELEASE_ONBOARDING_PROJECT_CREATION)
  }
}

async function capturePendingScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string
) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

async function expectHome(page: Page) {
  await expect(page).toHaveURL(/\/home\/?$/)
  await expect(
    page.getByRole('heading', {
      name: /^(Projects|Project Libraries|Personal Cloud)$/,
    })
  ).toBeVisible()
}

test.use({ trace: 'on' })

test.describe('Onboarding replay pending state', { tag: ['@desktop'] }, () => {
  test('disables Settings and Help replay while the tutorial project initializes', async ({
    page,
    toolbar,
  }, testInfo) => {
    await expectHome(page)

    await test.step('Settings Replay shows pending state', async () => {
      await toolbar.userSidebarButton.click()
      await page.getByRole('button', { name: 'User settings' }).click()
      await expect(
        page.getByRole('heading', { name: 'Settings', exact: true })
      ).toBeVisible()

      const releaseProjectCreation =
        await holdNextOnboardingProjectCreation(page)
      const replayButton = page.getByRole('button', {
        name: 'Replay Onboarding',
      })
      await replayButton.click()

      const pendingButton = page.getByRole('button', {
        name: 'Starting Onboarding...',
      })
      await expect(pendingButton).toBeDisabled()
      await expect(pendingButton).toHaveAttribute('aria-busy', 'true')
      await capturePendingScreenshot(page, testInfo, 'settings-replay-pending')

      await releaseProjectCreation()
      await expect(toolbar.projectName).toHaveText('tutorial-project')
      await expect(page.getByText('Welcome to Zoo Design Studio')).toBeVisible()
      await page.keyboard.press('Escape')
      await expectHome(page)
    })

    await test.step('Help Replay shows pending state', async () => {
      const releaseProjectCreation =
        await holdNextOnboardingProjectCreation(page)
      await page.getByRole('button', { name: 'Help and resources' }).click()
      await page
        .getByRole('button', { name: 'Replay onboarding tutorial' })
        .click()

      const pendingButton = page.getByRole('button', {
        name: 'Starting onboarding tutorial...',
      })
      await expect(pendingButton).toBeDisabled()
      await expect(pendingButton).toHaveAttribute('aria-busy', 'true')
      await capturePendingScreenshot(page, testInfo, 'help-replay-pending')

      await releaseProjectCreation()
      await expect(toolbar.projectName).toHaveText('tutorial-project-1')
      await expect(page.getByText('Welcome to Zoo Design Studio')).toBeVisible()
      await page.keyboard.press('Escape')
      await expectHome(page)
    })

    await expect(
      page
        .getByTestId('project-title')
        .filter({ hasText: /^tutorial-project$/ })
    ).toHaveCount(1)
    await expect(
      page
        .getByTestId('project-title')
        .filter({ hasText: /^tutorial-project-1$/ })
    ).toHaveCount(1)
  })
})
