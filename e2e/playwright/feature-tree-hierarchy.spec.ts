import { expect, test } from '@e2e/playwright/zoo-test'
import { resetView } from '@e2e/playwright/test-utils'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import { isArray } from '@src/lib/utils'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

test(
  'pump housing has no contributing features above its bodies',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }, testInfo) => {
    await page.setBodyDimensions({ width: 1440, height: 1000 })
    const code = await readFile(
      'public/kcl-samples/artificial-heart/housing.kcl',
      'utf8'
    )
    await homePage.goToModelingScene()
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.closePane(DefaultLayoutPaneID.Code)
    await expect(page.getByTestId('feature-tree-body')).toHaveCount(6)
    const bodyToggles = page.getByRole('button', {
      name: 'Toggle body features',
      exact: true,
    })
    await expect(bodyToggles.first()).toHaveAttribute('aria-expanded', 'true')
    for (const toggle of (await bodyToggles.all()).slice(1)) {
      await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    }
    await bodyToggles.first().click()
    // With bodies collapsed, only six body rows and three planes remain.
    await expect(
      toolbar.featureTreePane.getByTestId('feature-tree-operation-item')
    ).toHaveCount(9)
    await toolbar.expandFeatureTreeBodies()
    // Inline offset planes use the same variable label as their sketch.
    for (const [index, name] of [
      'sketch004',
      'sketch006',
      'sketch008',
    ].entries()) {
      await expect(
        page
          .getByTestId('feature-tree-body-features')
          .nth(index + 3)
          .getByRole('button', { name, exact: true })
      ).toHaveCount(2)
    }
    await testInfo.attach('pump-housing-body-hierarchy', {
      body: await toolbar.featureTreePane.screenshot(),
      contentType: 'image/png',
    })
  }
)

test(
  'PC Fan imports own their bodies and consumed Boolean histories',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, toolbar, fs, folderSetupFn }, testInfo) => {
    await page.setBodyDimensions({ width: 1440, height: 1000 })
    await folderSetupFn(async (dir) => {
      const project = await fs.join(dir, 'body-history-fan')
      await fs.mkdir(project, { recursive: true })
      for (const file of [
        'main.kcl',
        'fan-housing.kcl',
        'motor.kcl',
        'fan.kcl',
        'parameters.kcl',
      ]) {
        await fs.writeFile(
          await fs.join(project, file),
          new Uint8Array(
            await readFile(join('public/kcl-samples/axial-fan', file))
          )
        )
      }
    })
    await homePage.openProject('body-history-fan')
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await toolbar.closePane(DefaultLayoutPaneID.Code)
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
    for (const [index, toggle] of (
      await part
        .getByRole('button', { name: 'Toggle body features', exact: true })
        .all()
    ).entries()) {
      await expect(toggle).toHaveAttribute(
        'aria-expanded',
        index === 0 ? 'true' : 'false'
      )
      if (index !== 0) await toggle.click()
    }
    const booleanBody = part.getByTestId('feature-tree-body-branch').filter({
      has: page.getByRole('button', { name: 'Subtract', exact: true }),
    })
    await expect(
      booleanBody.getByRole('button', { name: 'Extrude', exact: true })
    ).toBeVisible()
    await expect(
      booleanBody.getByRole('button', { name: 'Revolve', exact: true })
    ).toBeVisible()
    await expect(
      booleanBody.getByRole('button', { name: 'Sketch', exact: true })
    ).toHaveCount(2)
    await importToggle.scrollIntoViewIfNeeded()
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
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const sketchToggle = branch.getByTestId('operation-group-caret').first()
    await expect(sketchToggle).toHaveAttribute('aria-expanded', 'false')
    await sketchToggle.click()

    await branch
      .getByRole('button', { name: 'sketch001', exact: true })
      .dblclick()
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
  'body context menu fits and deletes only the selected body',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage, scene, editor, toolbar }, testInfo) => {
    await page.setBodyDimensions({ width: 1440, height: 1000 })
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
    await resetView(scene)
    const cameraDistance = () =>
      page.evaluate(() => {
        const controls = window.app.singletons.kclManager.sceneInfra.camControls
        return controls.camera.position.distanceTo(controls.target)
      })
    const modelDistance = await cameraDistance()
    const source = page.getByRole('button', { name: 'Body 1', exact: true })
    await source.click()
    const bodyId = await page.evaluate(() => {
      const body = window.app.singletons.kclManager.variables.body001
      if (body?.type !== 'Solid') throw new Error('Expected body001')
      return body.value.id
    })
    await expect
      .poll(async () => {
        const response = await page.evaluate(() =>
          window.app.singletons.kclManager.engineCommandManager.sendSceneCommand(
            {
              type: 'modeling_cmd_req',
              cmd_id: crypto.randomUUID(),
              cmd: { type: 'select_get' },
            }
          )
        )
        const reply = isArray(response) ? response[0] : response
        if (!reply?.success || !('resp' in reply)) return []
        if (reply.resp.type !== 'modeling') return []
        const result = reply.resp.data.modeling_response
        return result.type === 'select_get' ? result.data.entity_ids : []
      })
      .toEqual([bodyId])
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const bounds =
            await window.app.singletons.kclManager.sceneInfra.localRenderer?.getSelectionBounds()
          return (
            !!bounds &&
            bounds.min.x < -4.9 &&
            bounds.max.x > 4.9 &&
            bounds.max.x < 5.1 &&
            bounds.max.z - bounds.min.z > 9.9
          )
        })
      )
      .toBe(true)
    await source.click({ button: 'right' })
    await page.getByRole('button', { name: 'Center on body' }).click()
    await expect
      .poll(() =>
        page.evaluate(
          () => window.app.singletons.kclManager.sceneInfra.camControls.target.z
        )
      )
      .toBeCloseTo(5)
    await expect.poll(cameraDistance).toBeLessThan(modelDistance * 0.8)
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
