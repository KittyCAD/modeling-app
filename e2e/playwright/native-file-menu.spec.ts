import { test, expect } from './zoo-test'

test.describe('Native file menu', { tag: ['@electron'] }, () => {
  test.describe('File role', () => {
    test('File.Create project', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Open project', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Preferences.User settings', async ({
      tronApp,
      cmdBar,
      page,
    }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
      const actualText = settings.getByText('The overall appearance of the app')
      await expect(actualText).toBeVisible()
    })
    test('File.Preferences.Keybindings', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Preferences.User default units', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Preferences.Theme', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Preferences.Theme color', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
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
    test('File.Preferences.Sign out', async ({ tronApp, cmdBar, page }) => {
      if (!tronApp) fail()
      // Run electron snippet to find the Menu!
      await tronApp.electron.evaluate(async ({ app }) => {
        if (!app || !app.applicationMenu) fail()
        const menu = app.applicationMenu.getMenuItemById(
          'File.Sign out'
        )
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
})
