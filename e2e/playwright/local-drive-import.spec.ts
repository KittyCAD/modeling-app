import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Local Drive picker', { tag: '@web' }, () => {
  test('opens the picker and adds a local model file', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
    fs,
  }) => {
    await homePage.createAndGoToProject('local-drive')
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await toolbar.openPane(DefaultLayoutPaneID.Files)

    const fileName = 'part.step'
    const content = 'Imported model file'
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
    const code = '@settings(kclVersion = 2.0)\n// Selected from Local Drive\n'

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
