import { writeFile } from 'node:fs/promises'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Add files', { tag: '@web' }, () => {
  test('adds a local file only from an open project', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
    fs,
  }) => {
    await homePage.projectsLoaded()
    await cmdBar.openCmdBar()
    await cmdBar.cmdSearchInput.fill('Add file to project')
    await expect(
      cmdBar.selectOption({ name: 'Add file to project' })
    ).toHaveCount(0)
    await cmdBar.closeCmdBar()
    await page.goto(
      page.url() +
        '?cmd=add-kcl-file-to-project&groupId=application&source=local&projectName=browser'
    )
    await expect(page).not.toHaveURL(/[?&]cmd=/)
    await cmdBar.toBeClosed()
    await homePage.createAndGoToProject('local-drive')
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
  })

  test('opens a local KCL file in the editor', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
    editor,
  }) => {
    await homePage.createAndGoToProject('local-kcl')
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
    await cmdBar.progressCmdBar()
    await expect(page).toHaveURL(/picked\.kcl$/)
    await editor.expectEditor.toContain('Selected from Local Drive')
  })
})

test(
  'adds a local file through the desktop picker',
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

    await toolbar.loadButton.click()
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
