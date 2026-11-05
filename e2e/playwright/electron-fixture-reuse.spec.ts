import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Electron fixture reuse', { tag: '@desktop' }, () => {
  test.describe.configure({ mode: 'serial' })
  test.use({ mockApiRoutes: false })

  let electronProcessId: number | undefined

  test('leaves project Settings open for the next fixture setup', async ({
    page,
    homePage,
    toolbar,
    tronApp,
  }) => {
    if (!tronApp) throwTronAppMissing()
    electronProcessId = tronApp.electron.process().pid
    expect(electronProcessId).toBeDefined()
    await expect(homePage.projectSection).toBeVisible()

    await homePage.projectButtonNew.click()
    await homePage.projectTextName.fill('fixture-settings')
    await homePage.projectButtonContinue.click()
    await expect(page).toHaveURL(/\/file\//)
    await expect(toolbar.startSketchBtn).toBeVisible()

    await page.keyboard.press('ControlOrMeta+,')
    await expect(page).toHaveURL(/\/settings(?:[/?#]|$)/)
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()
    // Deliberately leave the route open: teardown must not hide the setup bug.
  })

  test('starts the next test at Home in the same Electron process', async ({
    page,
    homePage,
    tronApp,
  }) => {
    if (!tronApp) throwTronAppMissing()
    expect(tronApp.electron.process().pid).toBe(electronProcessId)
    await expect(homePage.projectSection).toBeVisible()
    await expect(homePage.projectButtonNew).toBeVisible()
    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).not.toBeVisible()
  })
})
