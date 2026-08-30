import { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { NativeMenuFixture } from '@e2e/playwright/fixtures/nativeMenuFixture'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import {
  expectKeybindingsSettingsVisible,
  getUtils,
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
    test('Modeling page', async ({
      tronApp,
      cmdBar,
      editor,
      nativeMenu,
      page,
      homePage,
      scene,
    }) => {
      if (!tronApp) {
        throwTronAppMissing()
        return
      }
      const sourceProjectName = `native-menu-duplicate-source-${Date.now()}`
      await homePage.goToModelingScene(sourceProjectName)
      await scene.settled()
      await scene.connectionEstablished()
      await scene.isNativeFileMenuCreated()
      const u = await getUtils(page)
      const expectCommandAndClose = async (commandName: string) => {
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName(commandName)
        await page.keyboard.press('Escape')
        await cmdBar.toBeClosed()
      }

      await test.step('Modeling.File.New window', async () => {
        await expectNewWindowMenuItem(nativeMenu)
        await nativeMenu.find('File.New window')
      })
      await test.step('Modeling.File.Create project', async () => {
        await nativeMenu.click('File.Create project')
        await expectCommandAndClose('Create project')
      })
      await test.step('Modeling.File.Duplicate project', async () => {
        await nativeMenu.click('File.Duplicate project')
        await expect(page.getByTestId('app-header-project-name')).toHaveText(
          `${sourceProjectName}-copy`
        )
      })
      await test.step('Modeling.File.Open project', async () => {
        await nativeMenu.click('File.Open project')
        await expectCommandAndClose('Open project')
      })
      await test.step('Modeling.File.Add file to project', async () => {
        await nativeMenu.click('File.Add file to project')
        await expectCommandAndClose('Add file to project')
      })
      await test.step('Modeling.File.Export current part', async () => {
        await nativeMenu.click('File.Export current part')
        await expectCommandAndClose('Export')
      })
      await test.step('Modeling.File.Preferences.Project settings', async () => {
        await nativeMenu.click('File.Preferences.Project settings')
        await openSettingsExpectText(
          page,
          'Set the default length unit setting value to give any new files.'
        )
      })
      await test.step('Modeling.File.Preferences.User settings', async () => {
        await nativeMenu.click('File.Preferences.User settings')
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      await test.step('Modeling.File.Preferences.Keybindings', async () => {
        await nativeMenu.click('File.Preferences.Keybindings')
        await expectKeybindingsSettingsVisible(page)
      })
      await test.step('Modeling.File.Preferences.User default units', async () => {
        await nativeMenu.click('File.Preferences.User default units')
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      await test.step('Modeling.File.Preferences.Theme', async () => {
        await nativeMenu.click('File.Preferences.Theme')
        await expectCommandAndClose('Settings · app · theme')
      })
      await test.step('Modeling.Edit.Edit parameter', async () => {
        await nativeMenu.click('Edit.Edit parameter')
        await expectCommandAndClose('Edit parameter')
      })
      await test.step('Modeling.Edit.Format code', async () => {
        const settingsLine =
          '@settings(defaultLengthUnit = in, kclVersion = 2.0)'
        await editor.replaceCodeByTyping(
          settingsLine,
          `${settingsLine}\nmy_var=  1+2`
        )
        await expect
          .poll(() =>
            page.evaluate(() => window.app.singletons.kclManager.code)
          )
          .toContain('my_var=  1+2')
        await nativeMenu.click('Edit.Format code')
        await editor.expectEditor.toContain('my_var = 1 + 2')
      })
      await test.step('Modeling.Edit.Rename project', async () => {
        await nativeMenu.click('Edit.Rename project')
        await expectCommandAndClose('Rename project')
      })
      await test.step('Modeling.Edit.Delete project', async () => {
        await nativeMenu.click('Edit.Delete project')
        await expectCommandAndClose('Delete project')
      })
      await test.step('Modeling.Edit.Change project directory', async () => {
        await nativeMenu.click('Edit.Change project directory')
        await openSettingsExpectLocator(page, '#libraries')
        await page.getByTestId('settings-close-button').click()
        await expect(page.getByTestId('settings-dialog-panel')).toBeHidden()
      })
      await test.step('Modeling.View.Orthographic view', async () => {
        await nativeMenu.clickAndWait('View.Orthographic view', () =>
          page.waitForFunction(() => {
            const snapshot = window.app.settings.actor.getSnapshot()
            return (
              snapshot.matches('idle') &&
              snapshot.context.modeling.cameraProjection.current ===
                'orthographic'
            )
          })
        )
      })
      await test.step('Modeling.View.Perspective view', async () => {
        await nativeMenu.clickAndWait('View.Perspective view', () =>
          page.waitForFunction(() => {
            const snapshot = window.app.settings.actor.getSnapshot()
            return (
              snapshot.matches('idle') &&
              snapshot.context.modeling.cameraProjection.current ===
                'perspective'
            )
          })
        )
      })
      await test.step('Modeling.View.Standard views.Right view', async () => {
        await u.openAndClearDebugPanel()
        await nativeMenu.clickAndWait('View.Standard views.Right view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Back view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Back view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Top view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Top view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Left view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Left view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Front view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Front view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Bottom view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Bottom view', () =>
          u.waitForCmdReceive('default_camera_get_settings')
        )
      })
      await test.step('Modeling.View.Standard views.Reset view', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait('View.Standard views.Reset view', () =>
          u.waitForCmdReceive('zoom_to_fit')
        )
      })
      await test.step('Modeling.View.Standard views.Center view on selection', async () => {
        await u.clearCommandLogs()
        await nativeMenu.clickAndWait(
          'View.Standard views.Center view on selection',
          () => u.waitForCmdReceive('default_camera_center_to_selection')
        )
        await u.clearAndCloseDebugPanel()
      })
      await test.step('Modeling.View.Named views.Create named view', async () => {
        await nativeMenu.click('View.Named views.Create named view')
        await expectCommandAndClose('Create named view')
      })
      await test.step('Modeling.View.Named views.Load named view', async () => {
        await nativeMenu.click('View.Named views.Load named view')
        await expectCommandAndClose('Load named view')
      })
      await test.step('Modeling.View.Named views.Delete named view', async () => {
        await nativeMenu.click('View.Named views.Delete named view')
        await expectCommandAndClose('Delete named view')
      })
      await test.step('Modeling.View.Panes.Feature tree', async () => {
        await nativeMenu.click('View.Panes.Feature tree')
        const button = page.getByTestId('feature-tree-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.View.Panes.KCL code', async () => {
        await nativeMenu.click('View.Panes.KCL code')
        const button = page.getByTestId('code-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.View.Panes.Project files', async () => {
        await nativeMenu.click('View.Panes.Project files')
        const button = page.getByTestId('files-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.View.Panes.Variables', async () => {
        await nativeMenu.click('View.Panes.Variables')
        const button = page.getByTestId('variables-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.View.Panes.Logs', async () => {
        await nativeMenu.click('View.Panes.Logs')
        const button = page.getByTestId('logs-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.View.Panes.Zookeeper', async () => {
        await nativeMenu.click('View.Panes.Zookeeper')
        const button = page.getByTestId('ttc-pane-button')
        await expect(button).toHaveAttribute('aria-pressed', 'true')
      })
      await test.step('Modeling.Design.Create an offset plane', async () => {
        await nativeMenu.click('Design.Create an offset plane')
        await expectCommandAndClose('Offset plane')
      })
      await test.step('Modeling.Design.Create a helix', async () => {
        await nativeMenu.click('Design.Create a helix')
        await expectCommandAndClose('Helix')
      })
      await test.step('Modeling.Design.Create a parameter', async () => {
        await nativeMenu.click('Design.Create a parameter')
        await expectCommandAndClose('Create parameter')
      })

      await test.step('Modeling.Design.Create an additive feature.Extrude', async () => {
        await nativeMenu.click('Design.Create an additive feature.Extrude')
        await expectCommandAndClose('Extrude')
      })
      await test.step('Modeling.Design.Create an additive feature.Revolve', async () => {
        await nativeMenu.click('Design.Create an additive feature.Revolve')
        await expectCommandAndClose('Revolve')
      })
      await test.step('Modeling.Design.Create an additive feature.Sweep', async () => {
        await nativeMenu.click('Design.Create an additive feature.Sweep')
        await expectCommandAndClose('Sweep')
      })
      await test.step('Modeling.Design.Create an additive feature.Loft', async () => {
        await nativeMenu.click('Design.Create an additive feature.Loft')
        await expectCommandAndClose('Loft')
      })
      await test.step('Modeling.Design.Apply modification feature.Fillet', async () => {
        await nativeMenu.click('Design.Apply modification feature.Fillet')
        await expectCommandAndClose('Fillet')
      })
      await test.step('Modeling.Design.Apply modification feature.Chamfer', async () => {
        await nativeMenu.click('Design.Apply modification feature.Chamfer')
        await expectCommandAndClose('Chamfer')
      })

      await test.step('Modeling.Design.Apply modification feature.Shell', async () => {
        await nativeMenu.click('Design.Apply modification feature.Shell')
        await expectCommandAndClose('Shell')
      })

      await test.step('Modeling.Help.KCL code samples', async () => {
        await nativeMenu.find('Help.KCL code samples')
      })

      await test.step('Modeling.Help.Report a bug', async () => {
        await nativeMenu.find('Help.Report a bug')
      })

      await test.step('Modeling.Help.Replay onboarding tutorial', async () => {
        await nativeMenu.find('Help.Replay onboarding tutorial')
      })

      await test.step('Modeling.File.Preferences.Sign out', async () => {
        await nativeMenu.click('File.Sign out')
        await page.waitForFunction(() =>
          window.app.auth.actor.getSnapshot().matches('loggedOut')
        )
      })
    })
  }
)
