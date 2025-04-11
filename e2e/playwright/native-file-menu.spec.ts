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
  test.describe('Home page', () => {
    test.describe('File role', () => {
      test('Home.File.Create project', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.New project')
        await cmdBar.toBeOpened()
        await cmdBar.expectArgValue('untitled')
      })
      test('Home.File.Open project', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Open project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open project')
      })
      test('Home.File.Preferences.User settings', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User settings'
        )
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      test('Home.File.Preferences.Keybindings', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) {
          fail()
        }
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Keybindings'
        )
        await openSettingsExpectLocator(page, '#enter-sketch-mode')
      })
      test('Home.File.Preferences.User default units', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) {
          fail()
        }
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User default units'
        )
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      test('Home.File.Preferences.Theme', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Preferences.Theme')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Settings · app · theme')
      })
      test('Home.File.Preferences.Theme color', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Theme color'
        )
        await openSettingsExpectLocator(page, '#themeColor')
      })
      test('Home.File.Preferences.Sign out', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })

    test.describe('Edit role', () => {
      test('Home.Edit.Rename project', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Edit.Rename project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Rename project')
      })
      test('Home.Edit.Delete project', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Edit.Delete project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete project')
      })
      test('Home.Edit.Change project directory', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Change project directory'
        )
        await openSettingsExpectLocator(page, '#projectDirectory')
      })
    })
    test.describe('View role', () => {
      test('Home.View.Command Palette...', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Command Palette...')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
    })
    test.describe('Help role', () => {
      test('Home.Help.Show all commands', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Show all commands')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      test('Home.Help.KCL code samples', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.KCL code samples')
      })
      test('Home.Help.Refresh and report a bug', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'Help.Refresh and report a bug'
        )
        // Core dump and refresh magic number timeout
        await page.waitForTimeout(7000)
        await homePage.projectsLoaded()
      })
      test('Home.Help.Reset onboarding', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
      }) => {
        if (!tronApp) fail()
        await homePage.projectsLoaded()
        await homePage.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Reset onboarding')
        const actual = page.getByText(
          `This is a hardware design tool that lets you edit visually, with code, or both. It's powered by the KittyCAD Design API, the first API created for anyone to build hardware design tools.`
        )
        await expect(actual).toBeVisible()
      })
    })
  })
  test.describe('Modeling page', () => {
    test.describe('File Role', () => {
      test('Modeling.File.Create project', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
        scene,
      }) => {
        if (!tronApp) fail()
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.New project')
        await cmdBar.toBeOpened()
        await cmdBar.expectArgValue('untitled')
      })
      test('Modeling.File.Open project', async ({
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
        await clickElectronNativeMenuById(tronApp, 'File.Open project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open project')
      })
      test('Modeling.File.Load a sample model', async ({
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
        await clickElectronNativeMenuById(tronApp, 'File.Load a sample model')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Open sample')
      })
      test('Modeling.File.Insert from project file', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'File.Insert from project file'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Insert')
      })
      test('Modeling.File.Export current part', async ({
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
        await clickElectronNativeMenuById(tronApp, 'File.Export current part')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Export')
      })
      test('Modeling.File.Share current part (via Zoo link)', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'File.Share current part (via Zoo link)'
        )
        const textToCheck =
          'Link copied to clipboard. Anyone who clicks this link will get a copy of this file. Share carefully!'
        // Check if text appears anywhere in the page
        const isTextVisible = page.getByText(textToCheck)

        await expect(isTextVisible).toBeVisible({ timeout: 10000 })
      })
      test('Modeling.File.Preferences.Project settings', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Project settings'
        )
        await openSettingsExpectText(
          page,
          'The hue of the primary theme color for the app'
        )
      })
      test('Modeling.File.Preferences.User settings', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User settings'
        )
        await openSettingsExpectText(page, 'The overall appearance of the app')
      })
      test('Modeling.File.Preferences.Keybindings', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Keybindings'
        )
        await openSettingsExpectLocator(page, '#enter-sketch-mode')
      })
      test('Modeling.File.Preferences.User default units', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.User default units'
        )
        await openSettingsExpectLocator(page, '#defaultUnit')
      })
      test('Modeling.File.Preferences.Theme', async ({
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
        await clickElectronNativeMenuById(tronApp, 'File.Preferences.Theme')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Settings · app · theme')
      })
      test('Modeling.File.Preferences.Theme color', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'File.Preferences.Theme color'
        )
        await openSettingsExpectLocator(page, '#themeColor')
      })
      test('Modeling.File.Preferences.Sign out', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'File.Sign out')
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })
    test.describe('Edit role', () => {
      test('Modeling.Edit.Modify with Zoo Text-To-CAD', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Modify with Zoo Text-To-CAD'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Prompt-to-edit')
      })
      test('Modeling.Edit.Edit parameter', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Edit.Edit parameter')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Edit parameter')
      })
      test('Modeling.Edit.Format code', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Edit.Format code')
      })
      test('Modeling.Edit.Rename project', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Edit.Rename project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Rename project')
      })
      test('Modeling.Edit.Delete project', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Edit.Delete project')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete project')
      })
      test('Modeling.Edit.Change project directory', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'Edit.Change project directory'
        )
        await openSettingsExpectLocator(page, '#projectDirectory')
      })
    })
    test.describe('View role', () => {
      test('Modeling.View.Command Palette...', async ({
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
        await scene.connectionEstablished()
        await scene.settled(cmdBar)
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Command Palette...')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      test('Modeling.View.Orthographic view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Orthographic view')
        const textToCheck =
          'Set camera projection to "orthographic" as a user default'
        await expect
          .poll(async () => {
            const isTextVisible = page.getByText(textToCheck)
            await expect(isTextVisible).toBeVisible({ timeout: 10000 })
            return true
          })
          .toBe(true)
      })
      test('Modeling.View.Perspective view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Perspective view')
        const textToCheck =
          'Set camera projection to "perspective" as a user default'
        await expect
          .poll(async () => {
            const isTextVisible = page.getByText(textToCheck)
            await expect(isTextVisible).toBeVisible({ timeout: 10000 })
            return true
          })
          .toBe(true)
      })
      test('Modeling.View.Standard views.Right view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Right view'
        )
        // TODO: Make all of these screenshot E2E tests.
        // Wait for camera to move
        // await page.waitForTimeout(5000)

        // const locator = page.getByTestId('gizmo').locator('canvas')
        // const image = await locator.screenshot({ path: 'Modeling.View.Standard-views.Right-view.png' });
        // expect(image).toMatchSnapshot('Modeling.View.Standard-views.Right-view')
      })
      test('Modeling.View.Standard views.Back view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Back view'
        )
      })
      test('Modeling.View.Standard views.Top view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Top view'
        )
      })
      test('Modeling.View.Standard views.Left view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Left view'
        )
      })
      test('Modeling.View.Standard views.Front view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Front view'
        )
      })
      test('Modeling.View.Standard views.Bottom view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Bottom view'
        )
      })
      test('Modeling.View.Standard views.Reset view', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Reset view'
        )
      })
      test('Modeling.View.Standard views.Center view on selection', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(
          tronApp,
          'View.Standard views.Center view on selection'
        )
      })
      test('Modeling.View.Standard views.Refresh', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await findElectronNativeMenuById(tronApp, 'View.Standard views.Refresh')
      })
      test('Modeling.View.Named views.Create named view', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Create named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Create named view')
      })
      test('Modeling.View.Named views.Load named view', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Load named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Load named view')
      })
      test('Modeling.View.Named views.Delete named view', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'View.Named views.Delete named view'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Delete named view')
      })
      test('Modeling.View.Panes.Feature tree', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Feature tree')
        const button = page.getByTestId('feature-tree-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      test('Modeling.View.Panes.KCL code', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Panes.KCL code')
        const button = page.getByTestId('code-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      test('Modeling.View.Panes.Project files', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Project files')
        const button = page.getByTestId('files-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      test('Modeling.View.Panes.Variables', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Variables')
        const button = page.getByTestId('variables-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
      test('Modeling.View.Panes.Logs', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'View.Panes.Logs')
        const button = page.getByTestId('logs-pane-button')
        const isPressed = await button.getAttribute('aria-pressed')
        expect(isPressed).toBe('true')
      })
    })
    test.describe('Design role', () => {
      // TODO Start sketch
      test('Modeling.Design.Create an offset plane', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an offset plane'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Offset plane')
      })
      test('Modeling.Design.Create a helix', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Design.Create a helix')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Helix')
      })
      test('Modeling.Design.Create a parameter', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Design.Create a parameter')
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Create parameter')
      })

      test('Modeling.Design.Create an additive feature.Extrude', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Extrude'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Extrude')
      })
      test('Modeling.Design.Create an additive feature.Revolve', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Revolve'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Revolve')
      })
      test('Modeling.Design.Create an additive feature.Sweep', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Sweep'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Sweep')
      })
      test('Modeling.Design.Create an additive feature.Loft', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create an additive feature.Loft'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Loft')
      })
      test('Modeling.Design.Apply modification feature.Fillet', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Fillet'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Fillet')
      })
      test('Modeling.Design.Apply modification feature.Chamfer', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Chamfer'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Chamfer')
      })

      test('Modeling.Design.Apply modification feature.Shell', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Apply modification feature.Shell'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Shell')
      })

      test('Modeling.Design.Create with Zoo Text-To-CAD', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Create with Zoo Text-To-CAD'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Text-to-CAD')
      })

      test('Modeling.Design.Modify with Zoo Text-To-CAD', async ({
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
        await clickElectronNativeMenuById(
          tronApp,
          'Design.Modify with Zoo Text-To-CAD'
        )
        await cmdBar.toBeOpened()
        await cmdBar.expectCommandName('Prompt-to-edit')
      })
    })
    test.describe('Help role', () => {
      test('Modeling.Help.Show all commands', async ({
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
        await clickElectronNativeMenuById(tronApp, 'Help.Show all commands')
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      test('Modeling.Help.KCL code samples', async ({
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
        await findElectronNativeMenuById(tronApp, 'Help.KCL code samples')
      })
      test('Modeling.Help.Refresh and report a bug', async ({
        tronApp,
        cmdBar,
        page,
        homePage,
        scene,
        toolbar,
      }) => {
        if (!tronApp) {
          throwTronAppMissing()
          return
        }
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await findElectronNativeMenuById(
          tronApp,
          'Help.Refresh and report a bug'
        )
      })
      test('Modeling.Help.Reset onboarding', async ({
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
        await scene.connectionEstablished()
        await scene.isNativeFileMenuCreated()
        await clickElectronNativeMenuById(tronApp, 'Help.Reset onboarding')
        const actual = page.getByText(
          `This is a hardware design tool that lets you edit visually, with code, or both. It's powered by the KittyCAD Design API, the first API created for anyone to build hardware design tools.`
        )
        await expect(actual).toBeVisible()
      })
    })
  })
})
