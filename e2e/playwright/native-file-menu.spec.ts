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
  })
})
