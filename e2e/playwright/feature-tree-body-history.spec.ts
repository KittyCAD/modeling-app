import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { closeOnboardingModalIfPresent } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout'

test(
  'Artificial Heart housing keeps contributing geometry and offset planes inside bodies',
  { tag: ['@web', '@localRenderer', '@demo'] },
  async ({ page, homePage, scene, editor, toolbar }, testInfo) => {
    const code = await readFile(
      path.join('public', 'kcl-samples', 'artificial-heart', 'housing.kcl'),
      'utf8'
    )
    await page.setBodyDimensions({ width: 1400, height: 1800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.openFeatureTreePane()
    await testInfo.attach('housing-artifacts.json', {
      body: JSON.stringify(
        await page.evaluate(() => ({
          artifacts: [
            ...window.app.singletons.kclManager.artifactGraph.values(),
          ],
          operations: window.app.singletons.kclManager.lastSuccessfulOperations,
        }))
      ),
      contentType: 'application/json',
    })
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(6)
    await toolbar.closePane(DefaultLayoutPaneID.Code)
    await toolbar.revealBodyFeatures()
    const rootFeatures = await toolbar.featureTreePane
      .getByTestId('feature-tree-operation-item')
      .evaluateAll((rows) =>
        rows
          .filter(
            (row) => !row.closest('[data-testid="feature-tree-body-branch"]')
          )
          .map((row) => row.querySelector('button')?.textContent?.trim())
      )
    expect(rootFeatures).toEqual([
      expect.stringMatching(/^Front plane/),
      expect.stringMatching(/^Top plane/),
      expect.stringMatching(/^Side plane/),
    ])
    await expect(
      toolbar.featureTreePane.getByRole('button', {
        name: 'Offset Plane',
        exact: true,
      })
    ).toHaveCount(3)
    await testInfo.attach('housing-body-tree.png', {
      body: await toolbar.featureTreePane.screenshot(),
      contentType: 'image/png',
    })
    expect(
      await page.evaluate(() => window.app.singletons.kclManager.errors)
    ).toEqual([])
  }
)

test(
  'retains body and sketch disclosure through editing and execution',
  { tag: ['@web', '@localRenderer', '@demo'] },
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
    await expect
      .poll(() =>
        sketchToggle
          .locator('svg')
          .evaluate((svg) =>
            Math.round(new DOMMatrix(getComputedStyle(svg).transform).b)
          )
      )
      .toBe(-1)
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
    const editedCode = await page.evaluate(
      () => window.app.singletons.kclManager.code
    )
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', `// Shift source offsets\n${editedCode}`)
    )
    await expect(bodyToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
  }
)

test(
  'PC Fan keeps part bodies and consumed Boolean inputs within their imports',
  { tag: ['@web', '@localRenderer', '@demo'] },
  async ({ page, homePage, scene, toolbar, fs, folderSetupFn }, testInfo) => {
    await page.setBodyDimensions({ width: 1400, height: 900 })
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
    await toolbar.closePane(DefaultLayoutPaneID.Code)
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
    const booleanBody = part.getByTestId('feature-tree-body-branch').filter({
      has: page.getByRole('button', { name: 'Subtract', exact: true }),
    })
    await expect(booleanBody).toHaveCount(1)
    for (const name of ['Extrude', 'Revolve']) {
      await expect(
        booleanBody.getByRole('button', { name, exact: true })
      ).toBeVisible()
    }
    await expect(
      part.getByRole('button', { name: 'Circular Pattern', exact: true })
    ).toBeVisible()
    await importToggle.click()
    await importToggle.click()
    await expect(
      part.getByRole('button', { name: 'Subtract', exact: true })
    ).toBeVisible()
    await testInfo.attach('pc-fan-body-tree.png', {
      body: await toolbar.featureTreePane.screenshot(),
      contentType: 'image/png',
    })
    await toolbar.viewSourceOnOperation('Revolve', 0)
    await scene.settled()
    await expect
      .poll(() => page.evaluate(() => window.app.singletons.kclManager.path))
      .toMatch(/fan-housing\.kcl$/)
    await toolbar.openFeatureTreePane()
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(3)
    await toolbar.revealBodyFeatures()
    for (const name of ['extrude001', 'revolve001', 'solid001', 'pattern001']) {
      await expect(
        toolbar.featureTreePane.getByRole('button', { name, exact: true })
      ).toBeVisible()
    }
    expect(
      await page.evaluate(() => window.app.singletons.kclManager.errors)
    ).toEqual([])
  }
)

test(
  'body visibility and deletion keep geometry actions in the unified tree',
  { tag: ['@web', '@localRenderer', '@demo'] },
  async ({ page, homePage, scene, editor, toolbar }, testInfo) => {
    await page.setBodyDimensions({ width: 1400, height: 900 })
    await homePage.goToModelingScene()
    await scene.settled()
    const code = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  first = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
  second = circle(start = [var 25mm, var 0mm], center = [var 20mm, var 0mm])
}
firstBody = extrude(region(segments = [profile.first]), length = 10mm)
secondBody = extrude(region(segments = [profile.second]), length = 10mm)`
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.openFeatureTreePane()
    await toolbar.closePane(DefaultLayoutPaneID.Code)
    await scene.moveCameraTo({ x: 50, y: -70, z: 50 }, { x: 10, y: 0, z: 5 })
    await page.evaluate(() =>
      window.app.singletons.kclManager.sceneInfra.camControls.zoomToFit({
        padding: 0.15,
      })
    )
    const rows = page.getByTestId('feature-tree-body')
    await expect(rows).toHaveCount(2)
    await rows
      .first()
      .getByRole('button', { name: 'Body 1', exact: true })
      .click()
    await expect
      .poll(() =>
        page.evaluate(() => {
          const bounds =
            window.app.singletons.kclManager.sceneInfra.localRenderer?.getSelectionBounds()
          return (
            !!bounds &&
            bounds.min.x < -4.8 &&
            bounds.max.x > 4.8 &&
            bounds.max.x < 5.2 &&
            bounds.min.z > -0.1 &&
            bounds.max.z > 9.9 &&
            bounds.max.z < 10.1
          )
        })
      )
      .toBe(true)
    const visibility = rows
      .first()
      .getByTestId('feature-tree-visibility-toggle')
    await rows.first().hover()
    await scene.waitForExecutionDoneAfter(() => visibility.click())
    await editor.expectEditor.toContain('hide(')
    await rows.first().hover()
    await scene.waitForExecutionDoneAfter(() => visibility.click())
    await rows
      .first()
      .getByRole('button', { name: 'Body 1', exact: true })
      .click({ button: 'right' })
    await expect(page.getByTestId('context-menu-delete')).toBeVisible()
    await page.mouse.move(400, 55)
    await testInfo.attach('body-delete-before.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    await scene.waitForExecutionDoneAfter(() =>
      page.getByTestId('context-menu-delete').click()
    )
    await expect(rows).toHaveCount(1)
    await editor.expectEditor.toContain('delete(')
    await page.mouse.move(400, 55)
    await testInfo.attach('body-delete-after.png', {
      body: await page.screenshot(),
      contentType: 'image/png',
    })
    expect(
      await page.evaluate(() => window.app.singletons.kclManager.errors)
    ).toEqual([])
  }
)
