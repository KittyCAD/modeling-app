import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Local Drive picker', { tag: '@web' }, () => {
  test('adds local files without overwriting and keeps them after reload', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
  }) => {
    await homePage.createAndGoToProject('local-drive')
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await toolbar.openPane(DefaultLayoutPaneID.Files)

    const originalContent = 'Original model file'
    const duplicateContent = 'Another model file'
    const fileName = 'part.prt.23'
    const duplicateFileName = 'part-1.prt.23'
    const readFile = (name: string) =>
      page.evaluate(async (name) => {
        const project = window.app.project
        if (!project) throw new Error('No project is open')
        const path = window.fsZds.join(project.path, name)
        const content = await window.app.fileOperations.readFile(path)
        return new TextDecoder().decode(content)
      }, name)

    const imports = [
      { content: originalContent, expectedName: fileName },
      { content: duplicateContent, expectedName: duplicateFileName },
    ]
    for (const { content, expectedName } of imports) {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Add file to project')
      await cmdBar.expectCommandName('Add file to project')
      await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
      await expect(page.getByTestId('cmd-bar-arg-name')).toContainText('files')

      const chooserPromise = page.waitForEvent('filechooser')
      await page.getByRole('button', { name: 'Open file', exact: true }).click()
      const chooser = await chooserPromise
      // Opening the picker must not also submit the argument's form.
      await expect(page.getByTestId('cmd-bar-arg-name')).toContainText('files')
      await chooser.setFiles({
        name: fileName,
        mimeType: 'application/octet-stream',
        buffer: Buffer.from(content),
      })
      await expect(cmdBar.currentArgumentInput).toHaveValue(fileName)
      await cmdBar.progressCmdBar()
      await cmdBar.toBeClosed()

      await expect.poll(() => readFile(expectedName)).toBe(content)
      await expect(
        page.getByRole('treeitem', { name: expectedName, exact: true })
      ).toBeVisible()
    }

    await expect.poll(() => readFile(fileName)).toBe(originalContent)
    await page.reload()
    await expect(toolbar.loadButton).toBeVisible()
    await expect.poll(() => readFile(fileName)).toBe(originalContent)
    await expect.poll(() => readFile(duplicateFileName)).toBe(duplicateContent)
  })

  test('handles cancel, reselects the same file, and opens added KCL files', async ({
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
    await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
    await page.locator('input[type="file"]').setInputFiles([])
    await cmdBar.continue()
    await expect(page.getByTestId('cmd-bar-arg-name')).toContainText('files')

    const file = {
      name: 'picked.kcl',
      mimeType: 'text/plain',
      buffer: Buffer.from(code),
    }
    await page.locator('input[type="file"]').setInputFiles(file)
    await page.locator('input[type="file"]').setInputFiles([])
    await expect(cmdBar.currentArgumentInput).toHaveValue('picked.kcl')
    await page.locator('input[type="file"]').setInputFiles(file)
    await cmdBar.progressCmdBar()
    await expect(page).toHaveURL(/picked\.kcl$/)
    await editor.expectEditor.toContain('Selected from Local Drive')

    await toolbar.loadButton.click()
    await cmdBar.selectOption({ name: 'Local Drive', exact: true }).click()
    await page.locator('input[type="file"]').setInputFiles(file)
    await cmdBar.progressCmdBar()
    await expect(page).toHaveURL(/picked-1\.kcl$/)
    await editor.expectEditor.toContain('Selected from Local Drive')

    // KCL Samples should still be the initially highlighted source.
    await toolbar.loadButton.click()
    await expect(cmdBar.currentArgumentInput).toHaveAttribute(
      'placeholder',
      'KCL Samples'
    )
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('cmd-bar-arg-name')).toHaveText('sample')
  })
})
