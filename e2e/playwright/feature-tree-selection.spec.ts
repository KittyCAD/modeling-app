import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'feature tree highlights follow selection without changing the program',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `@settings(kclVersion = 3.0)
first = 1
second = 2
third = 3
`
      )
    )
    await toolbar.openFeatureTreePane()

    const row = (name: string) =>
      toolbar.featureTreePane
        .getByTestId('feature-tree-operation-item')
        .filter({ has: page.getByText(name, { exact: true }) })
    const first = row('first')
    const second = row('second')
    const selected = /bg-primary\/25/

    await first.getByRole('button').first().click()
    await expect(first).toHaveClass(selected)
    await expect(second).not.toHaveClass(selected)

    await second.getByRole('button').first().click()
    await expect(second).toHaveClass(selected)
    await expect(first).not.toHaveClass(selected)

    await editor.codeContent.getByText('1', { exact: true }).click()
    await expect(first).toHaveClass(selected)
    await expect(second).not.toHaveClass(selected)
  }
)
