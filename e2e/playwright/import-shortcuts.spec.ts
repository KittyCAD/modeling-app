import path from 'path'
import * as fsp from 'fs/promises'
import { expect, test } from '@e2e/playwright/zoo-test'
import { KEYMAP_FILE_NAME } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

for (const disabled of [false, true]) {
  test(
    `Saved Insert shortcut ${disabled ? 'unbinding' : 'override'} survives the Import rename`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({ folderSetupFn, homePage, page, scene, toolbar, cmdBar }) => {
      const projectName = 'import-shortcuts'
      await folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, projectName)
        await fsp.mkdir(projectDir, { recursive: true })
        await fsp.writeFile(path.join(projectDir, 'main.kcl'), '')
        await fsp.writeFile(
          path.join(dir, '..', KEYMAP_FILE_NAME),
          `version = 2
[[bindings]]
command = "${disabled ? '-code:Insert' : 'code:Insert'}"
keystrokes = ["${disabled ? 'i' : 'mod+shift+i'}"]
`
        )
      })
      // Reload so the keymap is read from disk, as it is when upgrading the app.
      await page.reload()
      await homePage.openProject(projectName)
      await scene.settled()
      await toolbar.closePane(DefaultLayoutPaneID.Code)

      if (disabled) {
        await page.keyboard.press('i')
        await expect(page.getByTestId('command-name')).not.toBeVisible()
        await toolbar.insertButton.click()
      } else {
        await page.keyboard.press('ControlOrMeta+Shift+i')
      }
      await expect(page.getByTestId('command-name')).toHaveText('Import')
      await cmdBar.closeCmdBar()
    }
  )
}
