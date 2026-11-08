import { expect, test } from '@e2e/playwright/base-test'
import { projectToml } from '@e2e/playwright/lib/cloudProjectTestUtils'
import { mockCloudStorage } from '@e2e/playwright/lib/cloudStorageFixture'
import {
  mockClientErrorReports,
  setup,
  waitForAppLoad,
  waitForWebKitBillingToSettle,
} from '@e2e/playwright/test-utils'
import { PLAYWRIGHT_PROJECT_DIRECTORY } from '@e2e/playwright/storageStates'
import { test as liveTest } from '@e2e/playwright/zoo-test'
const TUTORIAL_PROJECT_ID = '12902000-0000-4000-8000-000000000001'

for (const loadDelay of [0, 7_000]) {
  test(
    `Onboarding Scene creates and opens blank.kcl before allowing advance${loadDelay ? ' after a seven-second project load' : ''}`,
    { tag: '@web' },
    async ({ context, page }, testInfo) => {
      const tutorialProjectFiles = {
        'main.kcl': 'plateLength = 10\n',
        'project.toml': projectToml('tutorial-project', TUTORIAL_PROJECT_ID),
      }
      await mockClientErrorReports(context)
      const remote = await mockCloudStorage(context, { startEmpty: true })
      remote.projects.push({
        id: TUTORIAL_PROJECT_ID,
        title: 'tutorial-project',
        revision: '1',
        files: tutorialProjectFiles,
      })
      await setup(context, page, testInfo)
      await page.goto('/')

      // Avoid interrupting WebKit's in-flight billing request when onboarding
      // replaces the current document.
      await waitForWebKitBillingToSettle(page)

      const loading = Promise.withResolvers<boolean>()
      const requested = Promise.withResolvers<boolean>()
      if (loadDelay) {
        await context.route(
          (url) => url.pathname === `/user/projects/${TUTORIAL_PROJECT_ID}`,
          async (route) => {
            if (route.request().method() === 'GET') {
              requested.resolve(true)
              await loading.promise
            }
            await route.fallback()
          }
        )
      }

      try {
        await page.goto(
          `/file/${encodeURIComponent(
            `/__zoo_cloud__/${TUTORIAL_PROJECT_ID}/main.kcl`
          )}/onboarding/desktop/scene`
        )
        if (loadDelay) {
          await requested.promise
          await page.clock.install()
          await page.clock.fastForward(loadDelay)
          await expect(page.getByTestId('onboarding-next')).toBeHidden()
        }
      } finally {
        loading.resolve(true)
      }
      // Document load does not await the deferred app bootstrap.
      await waitForAppLoad(page)

      await expect(page).toHaveURL(
        /__zoo_cloud__.*%2Fblank\.kcl\/onboarding\/desktop\/scene/,
        { timeout: 15_000 }
      )
      await expect(page.getByRole('heading', { name: 'Scene' })).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(
            (id) =>
              window.app.fileOperations.exists(
                `/__zoo_cloud__/${id}/blank.kcl`
              ),
            TUTORIAL_PROJECT_ID
          )
        )
        .toBe(true)
      await expect(page.getByTestId('onboarding-next')).toBeVisible()
      expect(remote.projects[0].files['main.kcl']).toBe(
        tutorialProjectFiles['main.kcl']
      )
      expect(remote.projects[0].files['blank.kcl']).toMatch(
        /kclVersion\s*=\s*3\.0/
      )
      await page.reload()
      await expect(page).toHaveURL(/%2Fblank\.kcl\/onboarding\/desktop\/scene/)
      await expect(page.getByTestId('onboarding-next')).toBeVisible()
    }
  )
}

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
