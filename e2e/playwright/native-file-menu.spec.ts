import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { NativeMenuFixture } from '@e2e/playwright/fixtures/nativeMenuFixture'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import {
  expectKeybindingsSettingsVisible,
  openSettingsExpectLocator,
  openSettingsExpectText,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'

async function expectNewWindowMenuItem(
  nativeMenu: NativeMenuFixture,
  page?: Page
) {
  const menuItem = await nativeMenu.getItem('File.New window', page)

  expect(menuItem).toEqual({
    accelerator: 'CommandOrControl+Shift+N',
    label: 'New Window',
  })
}

async function expectModelingNativeMenuReady(page: Page) {
  await expect(page.getByTestId('app-header')).toHaveAttribute(
    'data-native-file-menu',
    'true'
  )
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Cancel Sketch' })
  ).not.toBeVisible()
}

test.describe(
  'Native menu window routing',
  { tag: ['@desktop', '@macos', '@windows'] },
  () => {
    test('Design menu actions target only the clicked BrowserWindow', async ({
      tronApp,
      homePage,
      nativeMenu,
      page,
      scene,
    }) => {
      if (!tronApp) {
        throwTronAppMissing()
        return
      }

      const projectName = 'native-menu-window-one'
      await homePage.goToModelingScene(projectName)
      await scene.settled()
      await scene.connectionEstablished()
      await scene.isNativeFileMenuCreated()

      const secondPage = await nativeMenu.openNewWindow(page)

      try {
        const secondHomePage = new HomePageFixture(secondPage)
        await secondHomePage.createAndGoToProject('native-menu-window-two')

        await expectModelingNativeMenuReady(page)
        await expectModelingNativeMenuReady(secondPage)

        await nativeMenu.find('Design.Start sketch', page)
        await nativeMenu.find('Design.Start sketch', secondPage)

        await nativeMenu.click('Design.Start sketch', page)
        await expect(
          page.getByRole('button', { name: 'Cancel Sketch' })
        ).toBeVisible()
        await expect(
          secondPage.getByRole('button', { name: 'Cancel Sketch' })
        ).not.toBeVisible()
        await expect(
          secondPage.getByRole('button', { name: 'Start Sketch' })
        ).toBeEnabled()

        await nativeMenu.click('Design.Start sketch', secondPage)
        await expect(
          secondPage.getByRole('button', { name: 'Cancel Sketch' })
        ).toBeVisible()
      } finally {
        await secondPage.close()
      }
    })
  }
)

/**
 * Not all menu actions are tested. Some are default electron menu actions.
 * Test file menu actions that trigger something in the frontend
 */
test.describe(
  'Native file menu',
  { tag: ['@desktop', '@macos', '@windows'] },
  () => {
    test('Home page', async ({
      tronApp,
      cmdBar,
      page,
      homePage,
      nativeMenu,
    }) => {
      if (!tronApp) {
        throw new Error('tronApp is missing.')
      }

      await test.step('Home.File.New window', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await expectNewWindowMenuItem(nativeMenu)

        const windowCountBefore = tronApp.electron.windows().length
        const newWindow = await nativeMenu.clickAndWait('File.New window', () =>
          tronApp.electron.waitForEvent('window')
        )

        await expect
          .poll(() => tronApp.electron.windows().length)
          .toBe(windowCountBefore + 1)

        await newWindow.close()
        await expect
          .poll(() => tronApp.electron.windows().length)
          .toBe(windowCountBefore)
      })
      await test.step('Home.File.Create project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Create project')
        await cmdBar.toBeOpened()
        await cmdBar.expectArgValue('untitled')
      })
      await test.step('Home.File.Open project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Open project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open project')
      })
      await test.step('Home.File.Preferences.User settings', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Preferences.User settings')
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      await test.step('Home.File.Preferences.Keybindings', async () => {
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Preferences.Keybindings')
        await expectKeybindingsSettingsVisible(page)
      })
      await test.step('Home.File.Preferences.User default units', async () => {
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Preferences.User default units')
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      await test.step('Home.File.Preferences.Theme', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Preferences.Theme')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Settings · app · theme')
      })
      await test.step('Home.Edit.Rename project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Edit.Rename project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Rename project')
      })
      await test.step('Home.Edit.Delete project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Edit.Delete project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete project')
      })
      await test.step('Home.Edit.Change project directory', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Edit.Change project directory')
        await openSettingsExpectLocator(page, '#libraries')
      })

      await test.step('Home.View.Command Palette...', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('View.Command Palette...')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })

      await test.step('Home.Help.Show all commands', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Help.Show all commands')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      await test.step('Home.Help.KCL code samples', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Help.KCL code samples')
      })
      await test.step('Home.Help.Report a bug', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('Help.Report a bug')
        await homePage.projectsLoaded()
      })
      await test.step('Home.Help.Replay onboarding tutorial', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.find('Help.Replay onboarding tutorial')
      })
      await test.step('Home.File.Preferences.Sign out', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await nativeMenu.click('File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })
  }
)
