import { expect, test } from '@e2e/playwright/zoo-test'

const code = `@settings(kclVersion = 3.0)
a = 1
  |> abs(%)
  |> round(%)
b = 2
c = a + 1
`

test.describe('Feature tree history controls', { tag: '@web' }, () => {
  test('reorders stages, blocks dependencies, persists rollback, and supports undo', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode('', code)
    await scene.settled()
    await toolbar.openFeatureTreePane()
    const bar = page.getByRole('slider', { name: 'Rollback bar' })
    await expect(bar).toHaveAttribute('aria-valuenow', '5')

    await page
      .getByRole('button', { name: 'Move round', exact: true })
      .dragTo(page.getByTestId('feature-tree-boundary-1'))
    await editor.expectEditor.toContain('a = 1\n  |> round(%)\n  |> abs(%)')
    await scene.settled()

    await page
      .getByRole('button', { name: 'Move c', exact: true })
      .dragTo(page.getByTestId('feature-tree-boundary-0'))
    await expect(
      page.getByText('Cannot move this feature across a dependency.')
    ).toBeVisible()
    await editor.expectEditor.toContain('b = 2\nc = a + 1')

    const originalTree = await page
      .getByTestId('feature-tree-history')
      .elementHandle()
    const originalHandle = await page
      .getByRole('button', { name: 'Move a', exact: true })
      .elementHandle()
    await bar.dragTo(page.getByTestId('feature-tree-boundary-2'))
    await editor.expectEditor.toContain('|> exit() // zds:rollback')
    await scene.settled()
    await expect(bar).toHaveAttribute('aria-valuenow', '2')
    expect(
      await page.evaluate(
        (element) =>
          element ===
          document.querySelector('[data-testid="feature-tree-history"]'),
        originalTree
      )
    ).toBe(true)
    expect(
      await page.evaluate((element) => element?.isConnected, originalHandle)
    ).toBe(true)
    await expect(
      page
        .getByTestId('feature-tree-history')
        .getByRole('button', { name: /^Move / })
    ).toHaveCount(5)

    await page.reload()
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await expect(bar).toHaveAttribute('aria-valuenow', '2')
    await bar.focus()
    await page.keyboard.press('End')
    await editor.expectEditor.not.toContain('zds:rollback')
    await scene.settled()

    await editor.codeContent.focus()
    await page.keyboard.press('ControlOrMeta+z')
    await editor.expectEditor.toContain('zds:rollback')
    await scene.settled()
    await page.keyboard.press('ControlOrMeta+Shift+z')
    await editor.expectEditor.not.toContain('zds:rollback')
  })

  test('pauses automatic regeneration, explains disabled tools, and executes once', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await editor.replaceCode('', code)
    await scene.settled()
    const controls = page.getByTestId('code-execution-controls')
    await controls.getByRole('button', { name: 'Pause execution' }).click()
    await editor.replaceCode('b = 2', 'b = 3')
    await expect(controls.getByRole('status')).toContainText(
      'You can still rotate, zoom, and pan.'
    )
    await expect(toolbar.startSketchBtn).toBeDisabled()
    await controls.getByRole('button', { name: 'Execute', exact: true }).click()
    await scene.settled()
    await expect(controls.getByRole('status')).not.toBeVisible()
    await expect(controls.getByText('Execution paused')).toBeVisible()
    await expect(toolbar.startSketchBtn).toBeEnabled()
    await controls
      .getByRole('button', { name: 'Resume automatic execution' })
      .click()
    await expect(
      controls.getByRole('button', { name: 'Pause execution' })
    ).toBeVisible()
  })
})
