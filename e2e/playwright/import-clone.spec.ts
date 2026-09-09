import path from 'path'
import * as fsp from 'fs/promises'
import { expect, test } from '@e2e/playwright/zoo-test'
import { executorInputPath, testsInputPath } from '@e2e/playwright/test-utils'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

for (const fileType of ['kcl', 'step']) {
  test(
    `Repeat ${fileType} import reuses the existing part through Clone`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({
      folderSetupFn,
      homePage,
      page,
      scene,
      toolbar,
      cmdBar,
      editor,
    }) => {
      const projectName = 'repeat-import'
      const filePath = fileType === 'kcl' ? 'parts/main.kcl' : 'cube.step'
      const code = `${fileType === 'step' ? '@(targetRepresentation = mesh)\n' : ''}import "./${filePath}" as originalPart`
      await folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, projectName)
        await fsp.mkdir(path.join(projectDir, 'parts'), { recursive: true })
        await Promise.all([
          fsp.copyFile(
            fileType === 'kcl'
              ? executorInputPath('cylinder.kcl')
              : testsInputPath('cube.step'),
            path.join(projectDir, filePath)
          ),
          fsp.writeFile(path.join(projectDir, 'main.kcl'), code),
        ])
      })
      await homePage.openProject(projectName)
      await scene.settled()

      await test.step('Open Clone with the imported part already selected', async () => {
        if (fileType === 'step') {
          // The file browser supplies a path without visiting the path argument.
          await toolbar.openPane(DefaultLayoutPaneID.Files)
          await toolbar.openFile(filePath)
          await page.getByText('Import into my current file').click()
        } else {
          await toolbar.insertButton.click()
          await cmdBar.selectOption({ name: filePath }).click()
        }
        await expect(page.getByTestId('command-name')).toHaveText('Clone')
        await expect(cmdBar.argumentInput).toHaveValue('clone001')
      })

      await test.step('Keep Clone name validation and review', async () => {
        await cmdBar.argumentInput.fill('originalPart')
        await cmdBar.progressCmdBar()
        await expect(
          page.getByText('This variable name is already in use.')
        ).toBeVisible()
        await cmdBar.argumentInput.fill('clone001')
        await cmdBar.progressCmdBar()
        await expect(page.locator('#review-form')).toBeVisible()
        await expect(
          page.getByTestId('cmd-bar-review-validation-error')
        ).not.toBeVisible()
        await cmdBar.progressCmdBar()
        await scene.settled()
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain('clone001 = clone(originalPart)')
        const result = await page.evaluate(() => ({
          code: window.app.singletons.kclManager.code,
          errors: window.app.singletons.kclManager.errors,
        }))
        expect(result.code.match(/import /g)).toHaveLength(1)
        expect(result.errors).toEqual([])
      })

      await test.step('Suggest the next unique clone name and allow cancellation', async () => {
        const before = await page.evaluate(
          () => window.app.singletons.kclManager.code
        )
        await toolbar.insertButton.click()
        await cmdBar.selectOption({ name: filePath }).click()
        await expect(page.getByTestId('command-name')).toHaveText('Clone')
        await expect(cmdBar.argumentInput).toHaveValue('clone002')
        await cmdBar.argumentInput.fill('clone001')
        await cmdBar.progressCmdBar()
        await expect(
          page.getByText('This variable name is already in use.')
        ).toBeVisible()
        await cmdBar.closeCmdBar()
        expect(
          await page.evaluate(() => window.app.singletons.kclManager.code)
        ).toBe(before)
      })

      await test.step('Create another clone from the same import', async () => {
        await toolbar.insertButton.click()
        await cmdBar.selectOption({ name: filePath }).click()
        await expect(cmdBar.argumentInput).toHaveValue('clone002')
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await scene.settled()
        await editor.expectEditor.toContain('clone002 = clone(originalPart)')
        const result = await page.evaluate(() => ({
          code: window.app.singletons.kclManager.code,
          errors: window.app.singletons.kclManager.errors,
        }))
        expect(result.code.match(/import /g)).toHaveLength(1)
        expect(result.errors).toEqual([])
      })
    }
  )
}
