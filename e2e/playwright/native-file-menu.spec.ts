import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'
import {
  clickElectronNativeMenuById,
  findElectronNativeMenuById,
  openSettingsExpectLocator,
  openSettingsExpectText,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

/**
 * Not all menu actions are tested. Some are default electron menu actions.
 * Test file menu actions that trigger something in the frontend
 */
test.describe(
  'Native file menu',
  { tag: ['@electron', '@macos', '@windows'] },
  () => {
    test('Home page', async ({ tronApp, cmdBar, page, homePage }) => {
      if (!tronApp) fail()

      await test.step('Home.File.Create project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Create project')
        await cmdBar.toBeOpened()
        await cmdBar.expectArgValue('untitled')
      })
      await test.step('Home.File.Open project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Open project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open project')
      })
      await test.step('Home.File.Preferences.User settings', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User settings'
        )
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      await test.step('Home.File.Preferences.Keybindings', async () => {
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Keybindings'
        )
        await openSettingsExpectLocator(page, '#enter-sketch-mode')
      })
      await test.step('Home.File.Preferences.User default units', async () => {
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User default units'
        )
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      await test.step('Home.File.Preferences.Theme', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Preferences.Theme')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Settings · app · theme')
      })
      await test.step('Home.File.Preferences.Theme color', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Theme color'
        )
        await openSettingsExpectLocator(page, '#themeColor')
      })
      await test.step('Home.Edit.Rename project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Edit.Rename project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Rename project')
      })
      await test.step('Home.Edit.Delete project', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Edit.Delete project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete project')
      })
      await test.step('Home.Edit.Change project directory', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Change project directory'
        )
        await openSettingsExpectLocator(page, '#projectDirectory')
      })

      await test.step('Home.View.Command Palette...', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Command Palette...')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })

      await test.step('Home.Help.Show all commands', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Show all commands')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      await test.step('Home.Help.KCL code samples', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.KCL code samples')
      })
      await test.step('Home.Help.Report a bug', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Report a bug')
        // Core dump and refresh magic number timeout
        await page.waitForTimeout(7000)
        await homePage.projectsLoaded()
      })
      await test.step('Home.Help.Replay onboarding tutorial', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await findElectronNativeMenuById(
          tronApp,
          'Help.Replay onboarding tutorial'
        )
      })
      await test.step('Home.File.Preferences.Sign out', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })
    test('Modeling page', async ({
      tronApp,
      cmdBar,
      page,
      homePage,
      scene,
    }) => {
      if (!tronApp) {
        throwTronAppMissing()
        return
      }
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await scene.connectionEstablished()
      await scene.isNativeFileMenuCreated()

      await test.step('Modeling.File.Create project', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Create project')
        await cmdBar.expectCommandName('Create project')
      })
      await test.step('Modeling.File.Open project', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Open project')
        await cmdBar.expectCommandName('Open project')
      })
      await test.step('Modeling.File.Add file to project', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Add file to project')
        await cmdBar.expectCommandName('Add file to project')
      })
      await test.step('Modeling.File.Export current part', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Export current part')
        await cmdBar.expectCommandName('Export')
      })
      await test.step('Modeling.File.Share part via Zoo link', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Share part via Zoo link'
        )
        const textToCheck =
          'Link copied to clipboard. Anyone who clicks this link will get a copy of this file. Share carefully!'
        // Check if text appears anywhere in the page
        const isTextVisible = page.getByText(textToCheck)
        await expect(isTextVisible).toBeVisible({ timeout: 10000 })
      })
      await test.step('Modeling.File.Preferences.Project settings', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Project settings'
        )
        await openSettingsExpectText(
          page,
          'The hue of the primary theme color for the app'
        )
      })
      await test.step('Modeling.File.Preferences.User settings', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User settings'
        )
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      await test.step('Modeling.File.Preferences.Keybindings', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Keybindings'
        )
        await openSettingsExpectLocator(page, '#enter-sketch-mode')
      })
      await test.step('Modeling.File.Preferences.User default units', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User default units'
        )
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      await test.step('Modeling.File.Preferences.Theme', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Preferences.Theme')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Settings · app · theme')
      })
      await test.step('Modeling.File.Preferences.Theme color', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Theme color'
        )
        await openSettingsExpectLocator(page, '#themeColor')
      })
      await test.step('Modeling.Edit.Modify with Zoo Text-To-CAD', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Modify with Zoo Text-To-CAD'
        )
        await cmdBar.expectCommandName('Prompt-to-edit')
      })
      await test.step('Modeling.Edit.Edit parameter', async () => {
        await clickElectronNativeMenuById(tronApp, 'Edit.Edit parameter')
        await cmdBar.expectCommandName('Edit parameter')
      })
      await test.step('Modeling.Edit.Format code', async () => {
        await clickElectronNativeMenuById(tronApp, 'Edit.Format code')
      })
      await test.step('Modeling.Edit.Rename project', async () => {
        await clickElectronNativeMenuById(tronApp, 'Edit.Rename project')
        await cmdBar.expectCommandName('Rename project')
      })
      await test.step('Modeling.Edit.Delete project', async () => {
        await clickElectronNativeMenuById(tronApp, 'Edit.Delete project')
        await cmdBar.expectCommandName('Delete project')
      })
      await test.step('Modeling.Edit.Change project directory', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Change project directory'
        )
        await openSettingsExpectLocator(page, '#projectDirectory')
      })
      await test.step('Modeling.View.Command Palette...', async () => {
        await cmdBar.closeCmdBar()
        await clickElectronNativeMenuById(tronApp, 'View.Command Palette...')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      await test.step('Modeling.View.Orthographic view', async () => {
        // wait for previous toast to disappear
        await page.waitForTimeout(10000)
        await clickElectronNativeMenuById(tronApp, 'View.Orthographic view')
        const textToCheck =
          'Set camera projection to "orthographic" as a user default'
        const toast = page.locator('#_rht_toaster')
        // Let the previous toast clear
        await expect(toast).toHaveText(textToCheck)
      })
      await test.step('Modeling.View.Perspective view', async () => {
        // wait for previous toast to disappear
        await page.waitForTimeout(10000)
        await clickElectronNativeMenuById(tronApp, 'View.Perspective view')
        const textToCheck =
          'Set camera projection to "perspective" as a user default'
        const toast = page.locator('#_rht_toaster')
        await expect(toast).toHaveText(textToCheck)
      })
      await test.step('Modeling.View.Standard views.Right view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Right view'
        )
      })
      await test.step('Modeling.View.Standard views.Back view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Back view'
        )
      })
      await test.step('Modeling.View.Standard views.Top view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Top view'
        )
      })
      await test.step('Modeling.View.Standard views.Left view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Left view'
        )
      })
      await test.step('Modeling.View.Standard views.Front view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Front view'
        )
      })
      await test.step('Modeling.View.Standard views.Bottom view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Bottom view'
        )
      })
      await test.step('Modeling.View.Standard views.Reset view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Reset view'
        )
      })
      await test.step('Modeling.View.Standard views.Center view on selection', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Center view on selection'
        )
      })
      await test.step('Modeling.View.Standard views.Refresh', async () => {
        await findElectronNativeMenuById(tronApp, 'View.Standard views.Refresh')
      })
      await test.step('Modeling.View.Named views.Create named view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Create named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Create named view')
      })
      await test.step('Modeling.View.Named views.Load named view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Load named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Load named view')
      })
      await test.step('Modeling.View.Named views.Delete named view', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Delete named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete named view')
      })
      await test.step('Modeling.View.Panes.Feature tree', async () => {
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Feature tree')
        const button = page.getByTestId('feature-tree-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      await test.step('Modeling.View.Panes.KCL code', async () => {
        await clickElectronNativeMenuById(tronApp, 'View.Panes.KCL code')
        const button = page.getByTestId('code-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      await test.step('Modeling.View.Panes.Project files', async () => {
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Project files')
        const button = page.getByTestId('files-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      await test.step('Modeling.View.Panes.Variables', async () => {
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Variables')
        const button = page.getByTestId('variables-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      await test.step('Modeling.View.Panes.Logs', async () => {
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Logs')
        const button = page.getByTestId('logs-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      await test.step('Modeling.Design.Create an offset plane', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an offset plane'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Offset plane')
      })
      await test.step('Modeling.Design.Create a helix', async () => {
        await clickElectronNativeMenuById(tronApp, 'Design.Create a helix')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Helix')
      })
      await test.step('Modeling.Design.Create a parameter', async () => {
        await clickElectronNativeMenuById(tronApp, 'Design.Create a parameter')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Create parameter')
      })

      await test.step('Modeling.Design.Create an additive feature.Extrude', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Extrude'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Extrude')
      })
      await test.step('Modeling.Design.Create an additive feature.Revolve', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Revolve'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Revolve')
      })
      await test.step('Modeling.Design.Create an additive feature.Sweep', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Sweep'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Sweep')
      })
      await test.step('Modeling.Design.Create an additive feature.Loft', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Loft'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Loft')
      })
      await test.step('Modeling.Design.Apply modification feature.Fillet', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Fillet'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Fillet')
      })
      await test.step('Modeling.Design.Apply modification feature.Chamfer', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Chamfer'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Chamfer')
      })

      await test.step('Modeling.Design.Apply modification feature.Shell', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Shell'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Shell')
      })

      await test.step('Modeling.Design.Create with Zoo Text-To-CAD', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create with Zoo Text-To-CAD'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Text to CAD')
      })

      await test.step('Modeling.Design.Modify with Zoo Text-To-CAD', async () => {
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Modify with Zoo Text-To-CAD'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Prompt-to-edit')
      })

      await test.step('Modeling.Help.Show all commands', async () => {
        await cmdBar.closeCmdBar()
        await clickElectronNativeMenuById(tronApp, 'Help.Show all commands')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })

      await test.step('Modeling.Help.KCL code samples', async () => {
        await findElectronNativeMenuById(tronApp, 'Help.KCL code samples')
      })

      await test.step('Modeling.Help.Report a bug', async () => {
        await findElectronNativeMenuById(tronApp, 'Help.Report a bug')
      })

      await test.step('Modeling.Help.Replay onboarding tutorial', async () => {
        await findElectronNativeMenuById(
          tronApp,
          'Help.Replay onboarding tutorial'
        )
      })

      await test.step('Modeling.File.Preferences.Sign out', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })
  }
)
