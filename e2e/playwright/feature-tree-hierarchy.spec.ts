import { expect, test } from '@e2e/playwright/zoo-test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test(
  'PC Fan imports own their bodies and consumed Boolean histories',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, toolbar, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      const project = join(dir, 'body-history-fan')
      await fs.mkdir(project, { recursive: true })
      for (const file of [
        'main.kcl',
        'fan-housing.kcl',
        'motor.kcl',
        'fan.kcl',
        'parameters.kcl',
      ]) {
        await fs.writeFile(
          join(project, file),
          new Uint8Array(
            await readFile(join('public/kcl-samples/axial-fan', file))
          )
        )
      }
    })
    await homePage.openProject('body-history-fan')
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(0)
    const housing = toolbar.featureTreePane
      .locator('[data-module-branch]')
      .filter({ has: page.getByRole('button', { name: /fanHousing/ }) })
    const importToggle = housing.getByTestId('operation-group-caret')
    await expect(importToggle).toHaveAttribute('aria-expanded', 'false')
    await importToggle.click()
    const panelId = await importToggle.getAttribute('aria-controls')
    const part = page.locator(`[id="${panelId}"]`)
    await expect(part.getByTestId('feature-tree-body')).toHaveCount(3)
    for (const toggle of await part
      .getByRole('button', { name: 'Toggle body features', exact: true })
      .all()) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
      await toggle.click()
    }
    const booleanBody = part
      .getByTestId('feature-tree-body-branch')
      .filter({ has: page.getByRole('button', { name: /solid001/ }) })
    await expect(
      booleanBody.getByRole('button', { name: /extrude001/ })
    ).toBeVisible()
    await expect(
      booleanBody.getByRole('button', { name: /revolve001/ })
    ).toBeVisible()
    await expect(
      booleanBody.getByRole('button', { name: /sketch001/ })
    ).toBeVisible()
    await expect(
      booleanBody.getByRole('button', { name: /sketch002/ })
    ).toBeVisible()
    await testInfo.attach('pc-fan-body-hierarchy', {
      body: await toolbar.featureTreePane.screenshot(),
      contentType: 'image/png',
    })
    await importToggle.click()
    await importToggle.click()
    for (const toggle of await part
      .getByRole('button', { name: 'Toggle body features', exact: true })
      .all()) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    }
  }
)

test(
  'body and sketch disclosure choices survive editing and rebuilding',
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
    const toggle = branch.getByRole('button', {
      name: 'Toggle body features',
      exact: true,
    })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.click()
    const sketchToggle = branch.getByTestId('operation-group-caret').first()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
    await sketchToggle.click()

    await branch.getByRole('button', { name: 'Sketch', exact: true }).dblclick()
    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await toolbar.exitSketch()
    await scene.settled()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'true')

    await sketchToggle.click()
    await toggle.click()
    await toggle.click()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', `// Rebuild with shifted offsets\n${code}`)
    )
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
  }
)

test(
  'body context menu deletes only the selected body',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }, testInfo) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode(
        '',
        `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
body001 = extrude(region(segments = [profile.circle1]), length = 10mm)
keptBody = clone(body001)
  |> translate(x = 15mm)`
      )
    )
    await toolbar.openFeatureTreePane()
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(2)
    const source = page.getByRole('button', { name: 'Body 1', exact: true })
    await source.click({ button: 'right' })
    await expect(page.getByTestId('context-menu-delete')).toBeVisible()
    await testInfo.attach('body-before-delete', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await scene.waitForExecutionDoneAfter(() =>
      page.getByTestId('context-menu-delete').click()
    )
    await scene.settled()
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(1)
    await editor.expectEditor.toContain('delete(body001)')
    await testInfo.attach('body-after-delete', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
  }
)
