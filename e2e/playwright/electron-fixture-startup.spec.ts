import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { expect, test } from '@e2e/playwright/zoo-test'
import { PLAYWRIGHT_TEST_SCOPE_KEY } from '@e2e/playwright/test-utils'
import path from 'node:path'

// These must share a worker to exercise Electron's reuse path and old scripts.
test.describe('Electron fixture startup', { tag: '@desktop' }, () => {
  test.describe.configure({ mode: 'serial' })
  let processId: number
  let previousDirectory: string

  test('applies test init scripts immediately and discovers a prepared project', async ({
    tronApp,
    page,
    context,
    homePage,
    folderSetupFn,
    fs,
  }) => {
    if (!tronApp) throwTronAppMissing()
    processId = tronApp.electron.process().pid!
    previousDirectory = tronApp.projectDirName
    await homePage.waitForAuthentication()
    await homePage.projectsLoaded()

    await folderSetupFn(async (dir) => {
      await fs.mkdir(path.join(dir, 'startup-project'), { recursive: true })
      await fs.writeFile(
        path.join(dir, 'startup-project', 'main.kcl'),
        new Uint8Array()
      )
    })
    await expect(page.getByTestId('project-link')).toContainText(
      'startup-project'
    )

    await page.addInitScript(() =>
      localStorage.setItem('previousPageScript', 'ran')
    )
    expect(
      await page.evaluate(() => localStorage.getItem('previousPageScript'))
    ).toBe('ran')
    await context.addInitScript(() =>
      localStorage.setItem('previousContextScript', 'ran')
    )
    expect(
      await page.evaluate(() => localStorage.getItem('previousContextScript'))
    ).toBe('ran')
  })

  test('reuses Electron with fresh storage and a different project directory', async ({
    tronApp,
    page,
    homePage,
  }) => {
    if (!tronApp) throwTronAppMissing()
    expect(tronApp.electron.process().pid).toBe(processId)
    expect(tronApp.projectDirName).not.toBe(previousDirectory)
    await homePage.waitForAuthentication()
    await homePage.projectsLoaded()
    await expect(page.getByTestId('project-link')).toHaveCount(0)
    expect(
      await page.evaluate(
        (scopeKey) => ({
          scope: sessionStorage.getItem(scopeKey),
          pageScript: localStorage.getItem('previousPageScript'),
          contextScript: localStorage.getItem('previousContextScript'),
          playwright: localStorage.getItem('playwright'),
        }),
        PLAYWRIGHT_TEST_SCOPE_KEY
      )
    ).toEqual({
      scope: tronApp.projectDirName,
      pageScript: null,
      contextScript: null,
      playwright: 'true',
    })
  })
})
