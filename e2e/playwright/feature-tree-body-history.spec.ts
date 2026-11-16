import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { closeOnboardingModalIfPresent } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'retains body and sketch disclosure through editing and execution',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 10mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
body001 = extrude(region001, length = 5mm)`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.openFeatureTreePane()
    const branch = page.getByTestId('feature-tree-body-branch').first()
    const bodyToggle = branch.getByRole('button', {
      name: 'Toggle Body 1 features',
      exact: true,
    })
    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'false')
    await bodyToggle.click()
    const sketchToggle = branch.getByTestId('operation-group-caret').first()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
    await sketchToggle.click()
    await branch
      .getByRole('button', { name: 'sketch001', exact: true })
      .dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.exitSketch()
    await scene.settled()
    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'true')
    await sketchToggle.click()
    await bodyToggle.click()
    await bodyToggle.click()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(code, `// Shift source offsets\n${code}`)
    )
    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
  }
)

test(
  'PC Fan keeps part bodies and consumed Boolean inputs within their imports',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, toolbar, fs, folderSetupFn }) => {
    await folderSetupFn(async (dir) => {
      const project = await fs.join(dir, 'PC Fan')
      await fs.mkdir(project, { recursive: true })
      for (const name of [
        'main.kcl',
        'fan-housing.kcl',
        'motor.kcl',
        'fan.kcl',
        'parameters.kcl',
      ]) {
        await fs.writeFile(
          await fs.join(project, name),
          new Uint8Array(
            await readFile(
              path.join('public', 'kcl-samples', 'axial-fan', name)
            )
          )
        )
      }
    })
    await homePage.openProject('PC Fan')
    await closeOnboardingModalIfPresent(page)
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await expect(page.locator('#bodies-list-pane')).toHaveCount(0)
    const importRow = toolbar.featureTreePane
      .locator('[data-module-branch]')
      .filter({ hasText: 'fanHousing' })
      .first()
    const part = importRow.locator('..')
    const importToggle = importRow.getByTestId('operation-group-caret')
    await expect(importToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(part.getByTestId('feature-tree-body')).toHaveCount(0)
    await importToggle.click()
    await expect(part.getByTestId('feature-tree-body')).toHaveCount(3)
    for (const toggle of await part
      .getByRole('button', { name: /^Toggle Body \d+ features$/ })
      .all()) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
    }
    const booleanBody = part
      .getByTestId('feature-tree-body-branch')
      .filter({
        has: page.getByRole('button', { name: 'solid001', exact: true }),
      })
    await expect(booleanBody).toHaveCount(1)
    for (const name of ['extrude001', 'revolve001']) {
      await expect(
        booleanBody.getByRole('button', { name, exact: true })
      ).toBeVisible()
    }
    await expect(
      part.getByRole('button', { name: 'pattern001', exact: true })
    ).toBeVisible()
    await importToggle.click()
    await importToggle.click()
    await expect(
      part.getByRole('button', { name: 'solid001', exact: true })
    ).toBeVisible()
    expect(
      await page.evaluate(() => window.app.singletons.kclManager.errors)
    ).toEqual([])
  }
)
