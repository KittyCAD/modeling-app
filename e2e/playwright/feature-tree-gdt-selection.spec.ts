import { expect, test } from '@e2e/playwright/zoo-test'

for (const treatment of ['fillet', 'chamfer'] as const) {
  test(
    `annotates a ${treatment} face selected in the feature tree`,
    { tag: '@web' },
    async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
      const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [10mm, 0mm])
  right = line(start = [10mm, 0mm], end = [10mm, 10mm])
  top = line(start = [10mm, 10mm], end = [0mm, 10mm])
  left = line(start = [0mm, 10mm], end = [0mm, 0mm])
}
box = region(point = [5mm, 5mm], sketch = profile)
extrude001 = extrude(box, length = 10mm, tagEnd = $capEnd001)
${treatment}001 = ${treatment}(
  extrude001,
  ${treatment === 'fillet' ? 'radius' : 'length'} = 1mm,
  edges = [{ sideFaces = [extrude001.sketch.tags.bottom, extrude001.faces.capEnd001] }],
)`
      await page.setBodyDimensions({ width: 1200, height: 800 })
      await homePage.goToModelingScene()
      await scene.settled()
      await editor.openPane()
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
      await scene.settled()
      await toolbar.openFeatureTreePane()
      await toolbar.featureTreePane
        .getByRole('button', { name: new RegExp(`${treatment}001`) })
        .first()
        .click()
      await expect(toolbar.selectionStatus).toContainText('1 face')
      await cmdBar.openCmdBar()
      await page.getByPlaceholder('Search commands').fill('GDT Annotation')
      await page.keyboard.press('Enter')
      await cmdBar.continue()
      await page
        .getByRole('textbox', { name: 'annotation', exact: true })
        .fill('Treatment face')
      await cmdBar.continue()
      await expect(page.getByTestId('command-bar-submit')).toBeVisible()
      await scene.waitForExecutionDoneAfter(() => cmdBar.submit())
      await scene.settled()
      await editor.expectEditor.toContain('gdt::annotation(')
      const source = await page.evaluate(
        () => window.app.singletons.kclManager.code
      )
      expect(source.slice(source.indexOf('gdt::annotation('))).toContain(
        'faces = ['
      )
      expect(
        await page.evaluate(() => window.app.singletons.kclManager.errors)
      ).toEqual([])
    }
  )
}
