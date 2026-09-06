import fsp from 'fs/promises'
import path from 'path'

import { getPlaywrightDownloadDir } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe(
  'Modeling dialog export',
  { tag: ['@desktop', '@macos', '@windows', '@skipLocalEngine'] },
  () => {
    test.use({ userFeatures: ['modeling_dialogs'] })

    test('Exports STL after changing format from glTF', async ({
      page,
      scene,
      tronApp,
      folderSetupFn,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      await folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, 'dialog-export')
        await fsp.mkdir(projectDir, { recursive: true })
        await fsp.writeFile(
          path.join(projectDir, 'main.kcl'),
          `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 12mm)`
        )
      })
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await page.getByText('dialog-export', { exact: true }).click()
      await scene.settled()

      await page.getByTestId('export-pane-button').click()
      const dialog = page.getByTestId('modeling-dialog')
      const storage = dialog.getByRole('combobox', { name: /^Storage/ })
      await expect(storage.locator('option:checked')).toHaveText('embedded')
      await dialog
        .getByRole('combobox', { name: /^Type/ })
        .selectOption({ label: 'STL' })
      await expect(storage.locator('option:checked')).toHaveText('ascii')
      await dialog.getByRole('button', { name: 'Submit', exact: true }).click()

      await expect(dialog).not.toBeAttached()
      await expect(
        page.getByText('Exported successfully').first()
      ).toBeVisible()
      const exportedFile = path.join(
        getPlaywrightDownloadDir(tronApp.projectDirName),
        'dialog-export.stl'
      )
      await expect
        .poll(() => fsp.readFile(exportedFile, 'utf8').catch(() => ''), {
          timeout: 15_000,
        })
        .toMatch(/^solid\b[\s\S]*facet normal/)
    })
  }
)
