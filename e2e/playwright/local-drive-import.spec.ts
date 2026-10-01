import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Local Drive picker', { tag: '@web' }, () => {
  test('adds a local model file only from an open project', async ({
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
