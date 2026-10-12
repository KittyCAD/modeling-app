import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'GDT Note rejects unsupported quotes before review and accepts corrected text',
  { tag: '@web' },
  async ({ page, homePage, scene, cmdBar }) => {
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await cmdBar.openCmdBar()
    await cmdBar.cmdSearchInput.fill('GDT Note')
    await cmdBar.chooseCommand('GDT Note')
    await cmdBar.argumentInput.fill('Use "datum A" after polish')
    await cmdBar.continue()
    await expect(
      page.getByText(
        'Double quotes are not supported in GD&T text. Remove them to continue.',
        { exact: true }
      )
    ).toBeVisible()
    await expect(cmdBar.argumentInput).toHaveValue('Use "datum A" after polish')
    await expect(page.getByTestId('command-bar-submit')).not.toBeVisible()
    await expect(page.getByText('bad ast', { exact: false })).not.toBeVisible()

    await cmdBar.argumentInput.fill('Use datum A after polish')
    await cmdBar.continue()
    await cmdBar.submit()
    await expect(page.locator('.cm-content')).toContainText(
      'gdt::note(note = "Use datum A after polish")'
    )
    await expect(page.getByText('bad ast', { exact: false })).not.toBeVisible()
  }
)
