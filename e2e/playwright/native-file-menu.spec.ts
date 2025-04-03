import {
  throwAppOrApplicationMenuMissing,
  throwMissingMenuItemById,
  throwTronAppMissing,
} from '@e2e/playwright/lib/electron-helpers'
import { expect, test } from '@e2e/playwright/zoo-test'

/**
 * Not all menu actions are tested. Some are default electron menu actions.
 * Test file menu actions that trigger something in the frontend
 */
test.describe('Native file menu', { tag: ['@electron'] }, () => {
  test.describe('Home page', () => {
    test.describe('File role', () => {
      test('Home.File.Create project', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const newProject =
            app.applicationMenu.getMenuItemById('File.New project')
          if (!newProject) fail()
          newProject.click()
        })
        // Check that the command bar is opened
        await expect(cmdBar.cmdBarElement).toBeVisible()
        // Check the placeholder project name exists
        const actualArgument = await cmdBar.cmdBarElement
          .getByTestId('cmd-bar-arg-value')
          .inputValue()
        const expectedArgument = 'project-$nnn'
        expect(actualArgument).toBe(expectedArgument)
      })
      test('Home.File.Open project', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const openProject =
            app.applicationMenu.getMenuItemById('File.Open project')
          if (!openProject) fail()
          openProject.click()
        })
        // Check that the command bar is opened
        await expect(cmdBar.cmdBarElement).toBeVisible()
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Open project'
        expect(actual).toBe(expected)
      })
      test('Home.File.Preferences.User settings', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const userSettings = app.applicationMenu.getMenuItemById(
            'File.Preferences.User settings'
          )
          if (!userSettings) fail()
          userSettings.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        // You are viewing the user tab
        const actualText = settings.getByText(
          'The overall appearance of the app'
        )
        await expect(actualText).toBeVisible()
      })
      test('Home.File.Preferences.Keybindings', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const keybindings = app.applicationMenu.getMenuItemById(
            'File.Preferences.Keybindings'
          )
          if (!keybindings) fail()
          keybindings.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        // You are viewing the keybindings tab
        const enterSketchMode = settings.locator('#enter-sketch-mode')
        await expect(enterSketchMode).toBeVisible()
      })
      test('Home.File.Preferences.User default units', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.User default units'
          )
          if (!menu) fail()
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const defaultUnit = settings.locator('#defaultUnit')
        await expect(defaultUnit).toBeVisible()
      })
      test('Home.File.Preferences.Theme', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.Theme'
          )
          if (!menu) fail()
          menu.click()
        })
        // Check that the command bar is opened
        await expect(cmdBar.cmdBarElement).toBeVisible()
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Settings · app · theme'
        expect(actual).toBe(expected)
      })
      test('Home.File.Preferences.Theme color', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.Theme color'
          )
          if (!menu) fail()
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const defaultUnit = settings.locator('#themeColor')
        await expect(defaultUnit).toBeVisible()
      })
      test('Home.File.Preferences.Sign out', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById('File.Sign out')
          if (!menu) fail()
          // FIXME: Add back when you can actually sign out
          // menu.click()
        })
        // FIXME: When signing out during E2E the page is not bound correctly.
        // It cannot find the button
        // const signIn = page.getByTestId('sign-in-button')
        // await expect(signIn).toBeVisible()
      })
    })

    test.describe('Edit role', () => {
      test('Home.Edit.Rename project', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Rename project'
          )
          if (!menu) fail()
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Rename project'
        expect(actual).toBe(expected)
      })
      test('Home.Edit.Delete project', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Delete project'
          )
          if (!menu) fail()
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Delete project'
        expect(actual).toBe(expected)
      })
      test('Home.Edit.Change project directory', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Change project directory'
          )
          if (!menu) fail()
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const projectDirectory = settings.locator('#projectDirectory')
        await expect(projectDirectory).toBeVisible()
      })
    })
    test.describe('View role', () => {
      test('Home.View.Command Palette...', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'View.Command Palette...'
          )
          if (!menu) fail()
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
    })
    test.describe('Help role', () => {
      test('Home.Help.Show all commands', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Help.Show all commands'
          )
          if (!menu) fail()
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = cmdBar.cmdBarElement.getByTestId('cmd-bar-search')
        await expect(actual).toBeVisible()
      })
      test('Home.Help.KCL code samples', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Help.KCL code samples'
          )
          if (!menu) fail()
        })
      })
      test('Home.Help.Refresh and report a bug', async ({
        tronApp,
        cmdBar,
        page,
      }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Help.Refresh and report a bug'
          )
          if (!menu) fail()
          menu.click()
        })
        // Core dump and refresh magic number timeout
        await page.waitForTimeout(7000)
        const actual = page.getByText(
          'No Projects found, ready to make your first one?'
        )
        await expect(actual).toBeVisible()
      })
      test('Home.Help.Reset onboarding', async ({ tronApp, cmdBar, page }) => {
        if (!tronApp) fail()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const menu = app.applicationMenu.getMenuItemById(
            'Help.Reset onboarding'
          )
          if (!menu) fail()
          menu.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) fail()
          const newProject =
            app.applicationMenu.getMenuItemById('File.New project')
          if (!newProject) fail()
          newProject.click()
        })
        // Check that the command bar is opened
        await expect(cmdBar.cmdBarElement).toBeVisible()
        // Check the placeholder project name exists
        const actualArgument = await cmdBar.cmdBarElement
          .getByTestId('cmd-bar-arg-value')
          .inputValue()
        const expectedArgument = 'project-$nnn'
        expect(actualArgument).toBe(expectedArgument)
      })
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
      await scene.waitForExecutionDone()

      // Run electron snippet to find the Menu!
      await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
      await tronApp.electron.evaluate(async ({ app }) => {
        if (!app || !app.applicationMenu) {
          throwAppOrApplicationMenuMissing()
          return
        }
        const openProject =
          app.applicationMenu.getMenuItemById('File.Open project')
        if (!openProject) {
          throwMissingMenuItemById('File.Open project')
          return
        }
        openProject.click()
      })
      // Check that the command bar is opened
      await expect(cmdBar.cmdBarElement).toBeVisible()
      // Check the placeholder project name exists
      const actual = await cmdBar.cmdBarElement
        .getByTestId('command-name')
        .textContent()
      const expected = 'Open project'
      expect(actual).toBe(expected)
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
      await scene.waitForExecutionDone()

      // Run electron snippet to find the Menu!
      await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
      await tronApp.electron.evaluate(async ({ app }) => {
        if (!app || !app.applicationMenu) {
          throwAppOrApplicationMenuMissing()
          return
        }
        const openProject = app.applicationMenu.getMenuItemById(
          'File.Load a sample model'
        )
        if (!openProject) {
          throwMissingMenuItemById('File.Load a sample model')
          return
        }
        openProject.click()
      })
      // Check that the command bar is opened
      await expect(cmdBar.cmdBarElement).toBeVisible()
      // Check the placeholder project name exists
      const actual = await cmdBar.cmdBarElement
        .getByTestId('command-name')
        .textContent()
      const expected = 'Open sample'
      expect(actual).toBe(expected)
    })
  })
})
