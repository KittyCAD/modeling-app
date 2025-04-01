import { test, expect } from './zoo-test'

test.describe('Electron app header tests', () => {
  test(
    'Open Command Palette button has correct shortcut',
    { tag: '@electron' },
    async ({ page }, testInfo) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      // No space before the shortcut since it checks textContent.
      let text
      switch (process.platform) {
        case 'darwin':
          text = 'Commands⌘K'
          break
        case 'win32':
          text = 'CommandsCtrl+K'
          break
        default: // 'linux' etc.
          text = 'CommandsCtrl+K'
          break
      }
      const commandsButton = page.getByRole('button', { name: 'Commands' })
      await expect(commandsButton).toBeVisible()
      await expect(commandsButton).toHaveText(text)
    }
  )

  test(
    'User settings has correct shortcut',
    { tag: '@electron' },
    async ({ page }, testInfo) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      // Open the user sidebar menu.
      await page.getByTestId('user-sidebar-toggle').click()

      // No space after "User settings" since it's textContent.
      const text =
        process.platform === 'darwin' ? 'User settings⌘,' : 'User settingsCtrl,'
      const userSettingsButton = page.getByTestId('user-settings')
      await expect(userSettingsButton).toBeVisible()
      await expect(userSettingsButton).toHaveText(text)
    }
  )
})
