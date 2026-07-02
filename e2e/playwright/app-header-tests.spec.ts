import { join } from 'path'
import { expect, test } from '@e2e/playwright/zoo-test'
import * as fsp from 'fs/promises'

test.describe('Electron app header tests', { tag: '@desktop' }, () => {
  test('Open Command Palette button has correct shortcut', async ({
    page,
  }, testInfo) => {
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
  })

  test('User settings has correct shortcut', async ({
    page,
    toolbar,
  }, testInfo) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    // Open the user sidebar menu.
    await toolbar.userSidebarButton.click()

    // No space after "User settings" since it's textContent.
    const text =
      process.platform === 'darwin' ? 'User settings⌘,' : 'User settingsCtrl,'
    const userSettingsButton = page.getByTestId('user-settings')
    await expect(userSettingsButton).toBeVisible()
    await expect(userSettingsButton).toHaveText(text)
  })

  test('Publish button is disabled until code is valid', async ({
    page,
    homePage,
    editor,
    scene,
    cmdBar,
    folderSetupFn,
  }) => {
    const projectName = 'publish-disabled-until-code'
    await folderSetupFn(async (dir) => {
      const testDir = join(dir, projectName)
      await fsp.mkdir(testDir, { recursive: true })
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.openProject(projectName)
    await scene.settled()

    const publishButton = page.getByTestId('publish-button')

    await test.step('Empty KCL', async () => {
      await expect(publishButton).toBeDisabled()
    })

    await test.step('Valid KCL', async () => {
      await editor.replaceCode('', 'x = 42')
      await scene.settled()
      await expect(publishButton).not.toBeDisabled()
    })

    await test.step('Invalid KCL', async () => {
      await editor.replaceCode('', '(')
      await scene.settled()
      await expect(publishButton).toBeDisabled()
    })
  })
})
