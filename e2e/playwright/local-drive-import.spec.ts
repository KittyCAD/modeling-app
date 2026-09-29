import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Local Drive picker', { tag: '@web' }, () => {
  test('adds binary files without overwriting and keeps them after reload', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
  }) => {
    await homePage.createAndGoToProject('local-drive')
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await toolbar.openPane(DefaultLayoutPaneID.Files)

    const originalBytes = [0, 255, 128, 1, 13, 10]
    const nextBytes = [1, 0, 254, 129]
    const fileName = 'part.prt.23'
    const readBytes = (name: string) =>
      page.evaluate(async (name) => {
        const project = window.app.project
        if (!project) throw new Error('No project is open')
        const path = window.fsZds.join(project.path, name)
        return Array.from(await window.app.fileOperations.readFile(path))
      }, name)

    for (const bytes of [originalBytes, nextBytes]) {
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
        buffer: Buffer.from(bytes),
      })
      await expect(cmdBar.currentArgumentInput).toHaveValue(fileName)
      await cmdBar.progressCmdBar()
      await cmdBar.toBeClosed()

      const expectedName = bytes === originalBytes ? fileName : 'part-1.prt.23'
      await expect.poll(() => readBytes(expectedName)).toEqual(bytes)
      await expect(
        page.getByRole('treeitem', { name: expectedName, exact: true })
      ).toBeVisible()
    }

    await expect.poll(() => readBytes(fileName)).toEqual(originalBytes)
    await page.reload()
    await expect(toolbar.loadButton).toBeVisible()
    await expect.poll(() => readBytes(fileName)).toEqual(originalBytes)
    await expect.poll(() => readBytes('part-1.prt.23')).toEqual(nextBytes)
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
