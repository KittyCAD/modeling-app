import { expect, test } from '@e2e/playwright/zoo-test'

for (const command of ['Fillet', 'Chamfer'] as const) {
  test(
    `edits a tagged ${command} without breaking its annotation`,
    { tag: '@web' },
    async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
      const name = command.toLowerCase()
      const parameter = command === 'Fillet' ? 'radius' : 'length'
      const code = `@settings(kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [30mm, 0mm])
  right = line(start = [30mm, 0mm], end = [30mm, 20mm])
  top = line(start = [30mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
region001 = region(point = [15mm, 10mm], sketch = profile)
body = extrude(region001, length = 12mm, tagEnd = $topCap)
chamfer001 = chamfer(body, edges = [{ sideFaces = [region001.tags.left, body.faces.topCap] }], length = 2mm)
${name}002 = ${name}(chamfer001, edges = [{ sideFaces = [region001.tags.right, body.faces.topCap] }], ${parameter} = 2mm, tag = $treatmentFace)
hide(profile)
gdt::annotation(faces = [treatmentFace], annotation = "yoyo", fontSize = 1.54mm)`
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await editor.openPane()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      await scene.settled()
      await toolbar.openFeatureTreePane()
      const treatment = toolbar.featureTreePane
        .getByRole('button', { name: new RegExp(`${name}002`) })
        .first()
      for (const size of ['1mm', '1.5mm']) {
        await treatment.dblclick()
        await expect
          .poll(() => cmdBar.getState())
          .toMatchObject({
            stage: 'arguments',
            commandName: command,
            currentArgKey: parameter,
          })
        await page.keyboard.insertText(size)
        await cmdBar.progressCmdBar()
        await expect
          .poll(() => cmdBar.getState())
          .toMatchObject({ stage: 'review' })
        await scene.waitForExecutionDoneAfter(() => cmdBar.progressCmdBar())
        await scene.settled()
        const source = await page.evaluate(
          () => window.app.singletons.kclManager.code
        )
        expect(source).toContain('tag = $treatmentFace')
        expect(source).not.toContain('$$')
        expect(source).toContain('faces = [treatmentFace]')
        expect(source).toContain(`${parameter} = ${size}`)
        expect(
          await page.evaluate(() => window.app.singletons.kclManager.errors)
        ).toEqual([])
      }
    }
  )
}
