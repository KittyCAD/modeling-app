import { expect, test } from '@e2e/playwright/zoo-test'
import { join } from 'path'
import * as fsp from 'fs/promises'

test.describe('Electron app header tests', () => {
  test(
    'Open Command Palette button has correct shortcut',
    { tag: '@desktop' },
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
    { tag: '@desktop' },
    async ({ page, toolbar }, testInfo) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      // Open the user sidebar menu.
      await toolbar.userSidebarButton.click()

      // No space after "User settings" since it's textContent.
      const text =
        process.platform === 'darwin' ? 'User settings⌘,' : 'User settingsCtrl,'
      const userSettingsButton = page.getByTestId('user-settings')
      await expect(userSettingsButton).toBeVisible()
      await expect(userSettingsButton).toHaveText(text)
    }
  )

  test('Share button is disabled when imports are present', async ({
    page,
    context,
    homePage,
    toolbar,
  }) => {
    const projectName = 'share-disabled-for-imports'
    await context.folderSetupFn(async (dir) => {
      const testDir = join(dir, projectName)
      await fsp.mkdir(testDir, { recursive: true })

      await fsp.writeFile(join(testDir, 'deps.kcl'), 'export x = 42')
      await fsp.writeFile(join(testDir, 'main.kcl'), 'import x from "deps.kcl"')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.openProject(projectName)
    const shareButton = page.getByTestId('share-button')

    // Open deps.kcl (which has no imports) and verify share button is enabled
    await toolbar.fileTreeBtn.click()
    await toolbar.openFile('deps.kcl')
    await expect(shareButton).not.toBeDisabled()

    // Open main.kcl (which has an import) and verify share button is disabled
    await toolbar.openFile('main.kcl')
    await expect(shareButton).toBeDisabled()
  })
})
