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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'File.Export current part'
          )
          if (!openProject) {
            throwMissingMenuItemById('File.Export current part')
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
        const expected = 'Export'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'File.Share current part (via Zoo link)'
          )
          if (!openProject) {
            throwMissingMenuItemById('File.Share current part (via Zoo link)')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'File.Preferences.Project settings'
          )
          if (!openProject) {
            throwMissingMenuItemById('File.Preferences.Project settings')
            return
          }
          openProject.click()
        })

        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        // You are viewing the user tab
        const actualText = settings.getByText(
          'The hue of the primary theme color for the app'
        )
        await expect(actualText).toBeVisible()
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const userSettings = app.applicationMenu.getMenuItemById(
            'File.Preferences.User settings'
          )
          if (!userSettings) {
            throwMissingMenuItemById('File.Preferences.User settings')
            return
          }
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const keybindings = app.applicationMenu.getMenuItemById(
            'File.Preferences.Keybindings'
          )
          if (!keybindings) {
            throwMissingMenuItemById('File.Preferences.Keybindings')
            return
          }
          keybindings.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        // You are viewing the keybindings tab
        const enterSketchMode = settings.locator('#enter-sketch-mode')
        await expect(enterSketchMode).toBeVisible()
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.User default units'
          )
          if (!menu) {
            throwMissingMenuItemById('File.Preferences.User default units')
            return
          }
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const defaultUnit = settings.locator('#defaultUnit')
        await expect(defaultUnit).toBeVisible()
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.Theme'
          )
          if (!menu) {
            throwMissingMenuItemById('File.Preferences.Theme')
            return
          }
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'File.Preferences.Theme color'
          )
          if (!menu) {
            throwMissingMenuItemById('File.Preferences.Theme color')
            return
          }
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const defaultUnit = settings.locator('#themeColor')
        await expect(defaultUnit).toBeVisible()
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById('File.Sign out')
          if (!menu) {
            throwMissingMenuItemById('File.Sign out')
            return
          }
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Modify with Zoo Text-To-CAD'
          )
          if (!menu) {
            throwMissingMenuItemById('Edit.Modify with Zoo Text-To-CAD')
            return
          }
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Prompt-to-edit'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Edit parameter'
          )
          if (!menu) {
            throwMissingMenuItemById('Edit.Edit parameter')
            return
          }
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Edit parameter'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById('Edit.Format code')
          if (!menu) {
            throwMissingMenuItemById('Edit.Format code')
            return
          }
          // NO OP: Do not test that the code mirror will actually format the code.
          // The format code happens, there is no UI.
          // The actual business logic to test this feature should be in another E2E test.
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Rename project'
          )
          if (!menu) {
            throwMissingMenuItemById('Edit.Rename project')
            return
          }
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Rename project'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Delete project'
          )
          if (!menu) {
            throwMissingMenuItemById('Edit.Delete project')
            return
          }
          menu.click()
        })
        // Check the placeholder project name exists
        const actual = await cmdBar.cmdBarElement
          .getByTestId('command-name')
          .textContent()
        const expected = 'Delete project'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()
        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'Edit.Change project directory'
          )
          if (!menu) {
            throwMissingMenuItemById('Edit.Change project directory')
            return
          }
          menu.click()
        })
        const settings = page.getByTestId('settings-dialog-panel')
        await expect(settings).toBeVisible()
        const projectDirectory = settings.locator('#projectDirectory')
        await expect(projectDirectory).toBeVisible()
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Command Palette...'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Command Palette...')
            return
          }
          menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Orthographic view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Orthographic view')
            return
          }
          menu.click()
        })

        const textToCheck =
          'Set camera projection to "orthographic" as a user default'
        // Check if text appears anywhere in the page
        const isTextVisible = page.getByText(textToCheck)

        await expect(isTextVisible).toBeVisible({ timeout: 10000 })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Perspective view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Perspective view')
            return
          }
          menu.click()
        })

        const textToCheck =
          'Set camera projection to "perspective" as a user default'
        // Check if text appears anywhere in the page
        const isTextVisible = page.getByText(textToCheck)

        await expect(isTextVisible).toBeVisible({ timeout: 10000 })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Right view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Right view')
            return
          }
          // menu.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Back view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Back view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Top view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Top view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Left view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Left view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Front view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Front view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Bottom view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Bottom view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Reset view'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Reset view')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Center view on selection'
          )
          if (!menu) {
            throwMissingMenuItemById(
              'View.Standard views.Center view on selection'
            )
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const menu = app.applicationMenu.getMenuItemById(
            'View.Standard views.Refresh'
          )
          if (!menu) {
            throwMissingMenuItemById('View.Standard views.Refresh')
            return
          }
          // menu.click()
        })
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Named views.Create named view'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Named views.Create named view')
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
        const expected = 'Create named view'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Named views.Load named view'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Named views.Load named view')
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
        const expected = 'Load named view'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Named views.Delete named view'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Named views.Delete named view')
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
        const expected = 'Delete named view'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Panes.Feature tree'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Panes.Feature tree')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Panes.KCL code'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Panes.KCL code')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Panes.Project files'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Panes.Project files')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'View.Panes.Variables'
          )
          if (!openProject) {
            throwMissingMenuItemById('View.Panes.Variables')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject =
            app.applicationMenu.getMenuItemById('View.Panes.Logs')
          if (!openProject) {
            throwMissingMenuItemById('View.Panes.Logs')
            return
          }
          openProject.click()
        })

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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create an offset plane'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create an offset plane')
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
        const expected = 'Offset plane'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create a helix'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create a helix')
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
        const expected = 'Helix'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create a parameter'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create a parameter')
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
        const expected = 'Create parameter'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create an additive feature.Extrude'
          )
          if (!openProject) {
            throwMissingMenuItemById(
              'Design.Create an additive feature.Extrude'
            )
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
        const expected = 'Extrude'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create an additive feature.Revolve'
          )
          if (!openProject) {
            throwMissingMenuItemById(
              'Design.Create an additive feature.Revolve'
            )
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
        const expected = 'Revolve'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create an additive feature.Sweep'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create an additive feature.Sweep')
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
        const expected = 'Sweep'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create an additive feature.Loft'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create an additive feature.Loft')
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
        const expected = 'Loft'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Apply modification feature.Fillet'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Apply modification feature.Fillet')
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
        const expected = 'Fillet'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Apply modification feature.Chamfer'
          )
          if (!openProject) {
            throwMissingMenuItemById(
              'Design.Apply modification feature.Chamfer'
            )
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
        const expected = 'Chamfer'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Apply modification feature.Shell'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Apply modification feature.Shell')
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
        const expected = 'Shell'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Create with Zoo Text-To-CAD'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Create with Zoo Text-To-CAD')
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
        const expected = 'Text-to-CAD'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

        // Run electron snippet to find the Menu!
        await page.waitForTimeout(100) // wait for createModelingPageMenu() to run
        await tronApp.electron.evaluate(async ({ app }) => {
          if (!app || !app.applicationMenu) {
            throwAppOrApplicationMenuMissing()
            return
          }
          const openProject = app.applicationMenu.getMenuItemById(
            'Design.Modify with Zoo Text-To-CAD'
          )
          if (!openProject) {
            throwMissingMenuItemById('Design.Modify with Zoo Text-To-CAD')
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
        const expected = 'Prompt-to-edit'
        expect(actual).toBe(expected)
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
        await scene.waitForExecutionDone()

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
        await scene.waitForExecutionDone()

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
        await scene.waitForExecutionDone()

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
        await scene.waitForExecutionDone()
        await expect(toolbar.startSketchBtn).toBeVisible()
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
        await scene.waitForExecutionDone()

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
})
