import { expect, test } from '@e2e/playwright/zoo-test'

const cubeCode = `@settings(kclVersion = 3.0)
cubeProfile = sketch(on = XY) {
  bottomEdge = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
  rightEdge = line(start = [var 20mm, var 0mm], end = [var 20mm, var 20mm])
  topEdge = line(start = [var 20mm, var 20mm], end = [var 0mm, var 20mm])
  leftEdge = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])
  coincident([bottomEdge.end, rightEdge.start])
  coincident([rightEdge.end, topEdge.start])
  coincident([topEdge.end, leftEdge.start])
  coincident([leftEdge.end, bottomEdge.start])
}
cubeRegion = region(segments = [cubeProfile.bottomEdge, cubeProfile.rightEdge], direction = CCW)
originalCube = extrude(cubeRegion, length = 20mm, tagEnd = $capEnd001)
hide(cubeProfile)
`

test.describe(
  'Annotations on original and copied edges',
  { tag: '@web' },
  () => {
    for (const example of [
      {
        name: 'clone',
        code: 'copiedCube = clone(originalCube) |> translate(x = 30mm, global = true)',
        x: 40,
        expected: 'copiedCube',
      },
      {
        name: 'mirror',
        code: 'copiedCubes = mirror3d([originalCube], across = YZ)',
        x: -10,
        expected: 'copiedCubes[0]',
      },
      {
        name: 'linear pattern',
        code: 'copiedCubes = patternLinear3d([originalCube], instances = 3, distance = 30mm, axis = X)',
        x: 70,
        expected: 'copiedCubes[2]',
      },
    ]) {
      for (const target of [
        { x: 10, expected: 'originalCube' },
        { x: example.x, expected: example.expected },
      ]) {
        test(`selects ${target.expected} edge after ${example.name}`, async ({
          context,
          page,
          homePage,
          scene,
          editor,
          toolbar,
          cmdBar,
        }) => {
          const code = cubeCode + example.code
          await context.addInitScript(
            (code) => localStorage.setItem('persistCode', code),
            code
          )
          await page.setBodyDimensions({ width: 1200, height: 800 })
          await homePage.goToModelingScene()
          await scene.settled()
          await editor.openPane()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', code)
          )
          await scene.settled()
          await editor.closePane()
          // Aim at the midpoint of the top front edge so the selected edge is
          // at the stream's center regardless of which copy is being tested.
          await scene.moveCameraTo(
            { x: target.x + 25, y: -45, z: 55 },
            { x: target.x, y: 0, z: 20 }
          )
          const [clickEdge] = scene.makeMouseHelpers(0.5, 0.5, {
            format: 'ratio',
          })
          await clickEdge()
          await expect(toolbar.selectionStatus).toContainText('1 edge')
          await cmdBar.openCmdBar()
          await page.getByPlaceholder('Search commands').fill('GDT Annotation')
          await page.keyboard.press('Enter')
          await expect(page.getByTestId('command-bar-continue')).toBeVisible()
          await cmdBar.continue()
          await page
            .getByRole('textbox', { name: 'annotation', exact: true })
            .fill('Selected edge')
          await cmdBar.continue()
          await expect(page.getByTestId('command-bar-submit')).toBeVisible()
          await scene.waitForExecutionDoneAfter(() => cmdBar.submit())
          await scene.settled()
          await editor.expectEditor.toContain('gdt::annotation(')
          const source = await page.evaluate(
            () => window.app.singletons.kclManager.code
          )
          const annotation = source.slice(source.indexOf('gdt::annotation('))
          expect(annotation).toContain(target.expected)
          expect(annotation).toContain(
            `${target.expected}.sketch.tags.bottomEdge`
          )
          expect(annotation).toContain(`${target.expected}.faces.capEnd001`)
          expect(annotation).not.toContain('edgeId(')
          expect(
            await page.evaluate(() => window.app.singletons.kclManager.errors)
          ).toEqual([])
        })
      }
    }
  }
)
