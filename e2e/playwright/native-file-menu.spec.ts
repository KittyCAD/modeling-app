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
test.describe('Native file menu', { tag: ['@electron'] }, () => {
  test(
    'Home page all in one test but uses steps',
    { tag: ['@electron'] },
    async ({ tronApp, cmdBar, page, homePage }) => {
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
      await test.step('Home.Help.Refresh and report a bug', async () => {
        await page.reload()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Report a bug')
        // Core dump and refresh magic number timeout
        await page.waitForTimeout(7000)
        await homePage.projectsLoaded()
      })
      await test.step('Home.Help.Reset onboarding', async () => {
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
    }
  )
  test(
    'Modeling page all in one test but uses steps',
    { tag: ['@electron'] },
    async ({ tronApp, cmdBar, page, homePage, scene }) => {
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
        await cmdBar.toBeOpened()
        await cmdBar.expectArgValue('untitled')
      })
      await test.step('Modeling.File.Open project', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Open project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open project')
      })
      await test.step('Modeling.File.Add file to project', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Add file to project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Add file to project')
      })
      await test.step('Modeling.File.Export current part', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Export current part')
        await cmdBar.toBeOpened()
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

      // test.step('Modeling.Edit.Modify with Zoo Text-To-CAD', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Edit.Modify with Zoo Text-To-CAD'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Prompt-to-edit')
      // })
      // test.step('Modeling.Edit.Edit parameter', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Edit.Edit parameter')
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Edit parameter')
      // })
      // test.step('Modeling.Edit.Format code', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Edit.Format code')
      // })
      // test.step('Modeling.Edit.Rename project', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Edit.Rename project')
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Rename project')
      // })
      // test.step('Modeling.Edit.Delete project', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Edit.Delete project')
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Delete project')
      // })
      // test.step('Modeling.Edit.Change project directory', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Edit.Change project directory'
      //   )
      //   await openSettingsExpectLocator(page, '#projectDirectory')
      // })
      // test.step('Modeling.View.Command Palette...', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.settled(cmdBar)
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Command Palette...')
      //   // Check the placeholder project name exists
      //   const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
      //   await expect(actual).toBeVisible()
      // })
      // test.step('Modeling.View.Orthographic view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Orthographic view')
      //   const textToCheck =
      //     'Set camera projection to "orthographic" as a user default'
      //   const toast = page.locator('#_rht_toaster')
      //   await expect(toast).toHaveText(textToCheck)
      // })
      // test.step('Modeling.View.Perspective view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Perspective view')
      //   const textToCheck =
      //     'Set camera projection to "perspective" as a user default'
      //   const toast = page.locator('#_rht_toaster')
      //   await expect(toast).toHaveText(textToCheck)
      // })
      // test.step('Modeling.View.Standard views.Right view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Right view'
      //   )
      //   // TODO: Make all of these screenshot E2E tests.
      //   // Wait for camera to move
      //   // await page.waitForTimeout(5000)

      //   // const locator = page.getByTestId('gizmo').locator('canvas')
      //   // const image = await locator.screenshot({ path: 'Modeling.View.Standard-views.Right-view.png' });
      //   // expect(image).toMatchSnapshot('Modeling.View.Standard-views.Right-view')
      // })
      // test.step('Modeling.View.Standard views.Back view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Back view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Top view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Top view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Left view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Left view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Front view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Front view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Bottom view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Bottom view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Reset view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Reset view'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Center view on selection', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Standard views.Center view on selection'
      //   )
      // })
      // test.step('Modeling.View.Standard views.Refresh', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await findElectronNativeMenuById(tronApp, 'View.Standard views.Refresh')
      // })
      // test.step('Modeling.View.Named views.Create named view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Named views.Create named view'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Create named view')
      // })
      // test.step('Modeling.View.Named views.Load named view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Named views.Load named view'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Load named view')
      // })
      // test.step('Modeling.View.Named views.Delete named view', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'View.Named views.Delete named view'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Delete named view')
      // })
      // test.step('Modeling.View.Panes.Feature tree', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Panes.Feature tree')
      //   const button = page.getByTestId('feature-tree-pane-button')
      //   const isPressed = await button.getAttribute('aria-pressed')
      //   expect(isPressed).toBe('true')
      // })
      // test.step('Modeling.View.Panes.KCL code', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Panes.KCL code')
      //   const button = page.getByTestId('code-pane-button')
      //   const isPressed = await button.getAttribute('aria-pressed')
      //   expect(isPressed).toBe('true')
      // })
      // test.step('Modeling.View.Panes.Project files', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Panes.Project files')
      //   const button = page.getByTestId('files-pane-button')
      //   const isPressed = await button.getAttribute('aria-pressed')
      //   expect(isPressed).toBe('true')
      // })
      // test.step('Modeling.View.Panes.Variables', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Panes.Variables')
      //   const button = page.getByTestId('variables-pane-button')
      //   const isPressed = await button.getAttribute('aria-pressed')
      //   expect(isPressed).toBe('true')
      // })
      // test.step('Modeling.View.Panes.Logs', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'View.Panes.Logs')
      //   const button = page.getByTestId('logs-pane-button')
      //   const isPressed = await button.getAttribute('aria-pressed')
      //   expect(isPressed).toBe('true')
      // })
      // // TODO Start sketch
      // test.step('Modeling.Design.Create an offset plane', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create an offset plane'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Offset plane')
      // })
      // test.step('Modeling.Design.Create a helix', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Design.Create a helix')
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Helix')
      // })
      // test.step('Modeling.Design.Create a parameter', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Design.Create a parameter')
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Create parameter')
      // })

      // test.step('Modeling.Design.Create an additive feature.Extrude', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create an additive feature.Extrude'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Extrude')
      // })
      // test.step('Modeling.Design.Create an additive feature.Revolve', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create an additive feature.Revolve'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Revolve')
      // })
      // test.step('Modeling.Design.Create an additive feature.Sweep', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create an additive feature.Sweep'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Sweep')
      // })
      // test.step('Modeling.Design.Create an additive feature.Loft', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create an additive feature.Loft'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Loft')
      // })
      // test.step('Modeling.Design.Apply modification feature.Fillet', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Apply modification feature.Fillet'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Fillet')
      // })
      // test.step('Modeling.Design.Apply modification feature.Chamfer', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Apply modification feature.Chamfer'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Chamfer')
      // })

      // test.step('Modeling.Design.Apply modification feature.Shell', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Apply modification feature.Shell'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Shell')
      // })

      // test.step('Modeling.Design.Create with Zoo Text-To-CAD', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Create with Zoo Text-To-CAD'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Text-to-CAD')
      // })

      // test.step('Modeling.Design.Modify with Zoo Text-To-CAD', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(
      //     tronApp,
      //     'Design.Modify with Zoo Text-To-CAD'
      //   )
      //   await cmdBar.toBeOpened()
      //   await cmdBar.expectCommandName('Prompt-to-edit')
      // })

      // test.step('Modeling.Help.Show all commands', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await clickElectronNativeMenuById(tronApp, 'Help.Show all commands')
      //   // Check the placeholder project name exists
      //   const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
      //   await expect(actual).toBeVisible()
      // })
      // test.step('Modeling.Help.KCL code samples', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await findElectronNativeMenuById(tronApp, 'Help.KCL code samples')
      // })
      // test.step('Modeling.Help.Refresh and report a bug', async ({
      //   tronApp,
      //   cmdBar,
      //   page,
      //   homePage,
      //   scene,
      //   toolbar,
      // }) => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.settled(cmdBar)
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await findElectronNativeMenuById(
      //     tronApp,
      //     'Help.Refresh and report a bug'
      //   )
      // })
      // test.step('Modeling.Help.Reset onboarding', async () => {
      //   if (!tronApp) {
      //     throwTronAppMissing()
      //     return
      //   }
      //   await homePage.goToModelingScene()
      //   await scene.connectionEstablished()
      //   await scene.isNativeFileMenuCreated()
      //   await findElectronNativeMenuById(tronApp, 'Help.Reset onboarding')
      // })

      await test.step('Modeling.File.Preferences.Sign out', async () => {
        await clickElectronNativeMenuById(tronApp, 'File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    }
  )
})
