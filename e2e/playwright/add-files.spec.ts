import { writeFile } from 'node:fs/promises'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test(
  'Home: creates a sample project from the command palette',
  { tag: ['@web'] },
  async ({ page, homePage, cmdBar, editor, toolbar }) => {
    await homePage.projectsLoaded()
    await page.keyboard.press('ControlOrMeta+k')
    await expect(
      cmdBar.cmdOptions.getByText('Add file to project')
    ).toHaveCount(0)
    await cmdBar.chooseCommand('Create a sample')
    await cmdBar.selectOption({ name: 'Angle Gauge', exact: true }).click()
    await cmdBar.toBeClosed()
    await expect(page).toHaveURL(/angle-gauge/)
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await editor.expectEditor.toContain('Angle Gauge')
  }
)

test.describe('Local Drive picker', () => {
  test(
    'Web: opens the picker and adds a local file',
    { tag: '@web' },
    async ({ page, homePage, toolbar, cmdBar, fs }) => {
      await homePage.createAndGoToProject('local-drive')
      await page.waitForFunction(() =>
        window.app.systemIOActor
          .getSnapshot()
          .context.folders?.some(
            (project) => project.name === window.app.project?.name
          )
      )
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Files)

      const fileName = 'notes.txt'
      const content = 'Imported local file'
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Add file to project')
      const chooserPromise = page.waitForEvent('filechooser')
      await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: fileName,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(content),
      })
      await expect(cmdBar.currentArgumentInput).toHaveValue(fileName)
      await cmdBar.progressCmdBar()
      await cmdBar.toBeClosed()

      await expect(
        page.getByRole('treeitem', { name: fileName, exact: true })
      ).toBeVisible()
      const projectPath = await page.evaluate(() => window.app.project?.path)
      if (!projectPath) throw new Error('No project is open')
      const filePath = await fs.join(projectPath, fileName)
      await expect.poll(() => fs.readFile(filePath, 'utf8')).toBe(content)
    }
  )

  test(
    'Web: opens a local KCL file in the editor',
    { tag: '@web' },
    async ({ page, homePage, toolbar, cmdBar, editor }) => {
      await homePage.createAndGoToProject('local-kcl')
      await page.waitForFunction(() =>
        window.app.systemIOActor
          .getSnapshot()
          .context.folders?.some(
            (project) => project.name === window.app.project?.name
          )
      )
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      const code = '@settings(kclVersion = 3.0)\n// Selected from Local Drive\n'

      await toolbar.loadButton.click()
      const chooserPromise = page.waitForEvent('filechooser')
      await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
      const chooser = await chooserPromise
      await chooser.setFiles({
        name: 'picked.kcl',
        mimeType: 'text/plain',
        buffer: Buffer.from(code),
      })
      await expect(cmdBar.currentArgumentInput).toHaveValue('picked.kcl')
      await cmdBar.progressCmdBar()
      await expect(page).toHaveURL(/picked\.kcl$/, { timeout: 15_000 })
      await editor.expectEditor.toContain('Selected from Local Drive')
    }
  )

  test(
    'Desktop: adds a local file through the picker',
    { tag: '@desktop' },
    async ({ page, homePage, toolbar, cmdBar, fs, tronApp }, testInfo) => {
      if (!tronApp) throw new Error('Desktop app is required')
      const fileName = 'notes.txt'
      const content = 'Imported local file'
      const sourcePath = testInfo.outputPath(fileName)
      await writeFile(sourcePath, content)
      await homePage.createAndGoToProject('local-drive')
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.Files)

      await page.keyboard.press('ControlOrMeta+k')
      await cmdBar.chooseCommand('Add file to project')
      await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
      await tronApp.electron.evaluate(({ dialog }, selectedPath) => {
        const originalOpenDialog = dialog.showOpenDialog.bind(dialog)
        dialog.showOpenDialog = async () => {
          dialog.showOpenDialog = originalOpenDialog
          return { canceled: false, filePaths: [selectedPath] }
        }
      }, sourcePath)
      await page.getByTestId('cmd-bar-arg-file-button').click()
      await expect(cmdBar.currentArgumentInput).toHaveValue(sourcePath)
      await cmdBar.progressCmdBar()
      await cmdBar.toBeClosed()

      await expect(
        page.getByRole('treeitem', { name: fileName, exact: true })
      ).toBeVisible()
      const projectPath = await page.evaluate(() => window.app.project?.path)
      if (!projectPath) throw new Error('No project is open')
      const filePath = await fs.join(projectPath, fileName)
      await expect.poll(() => fs.readFile(filePath, 'utf8')).toBe(content)
    }
  )
})
