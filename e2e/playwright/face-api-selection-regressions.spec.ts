import { expect, test } from '@e2e/playwright/zoo-test'

const edgeTreatmentCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(region001, length = 12, tagEnd = $endCap)
chamfer001 = chamfer(
  body001,
  edges = [{ sideFaces = [endCap, region001.tags.left] }],
  length = 3,
)

hide(sketch001)`

const shellCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 22])
  top = line(start = [30, 22], end = [0, 22])
  left = line(start = [0, 22], end = [0, 0])
}
region001 = region(point = [15, 11], sketch = sketch001)
body001 = extrude(region001, length = 14, tagEnd = $endCap)
shell001 = shell(body001, faces = endCap, thickness = 2)

hide(sketch001)`

const csgSurfaceExtrudeCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseSketch = sketch(on = XY) {
  b1 = line(start = [0, 0], end = [26, 0])
  b2 = line(start = [26, 0], end = [26, 18])
  b3 = line(start = [26, 18], end = [0, 18])
  b4 = line(start = [0, 18], end = [0, 0])
}
baseRegion = region(point = [13, 9], sketch = baseSketch)
baseBody = extrude(baseRegion, length = 10, tagEnd = $baseEnd)

toolSketch = sketch(on = YZ) {
  t1 = line(start = [-2, 4], end = [12, 4])
  t2 = line(start = [12, 4], end = [12, 14])
  t3 = line(start = [12, 14], end = [-2, 14])
  t4 = line(start = [-2, 14], end = [-2, 4])
}
toolRegion = region(point = [5, 9], sketch = toolSketch)
toolBody = extrude(toolRegion, length = 30, symmetric = true)
cutBody = subtract(baseBody, tools = toolBody)

hide(baseSketch)
hide(toolSketch)`

test.describe('Face API selection regressions', { tag: '@web' }, () => {
  test('2.9 fillets a generated Chamfer boundary edge', async ({
    context,
    page,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    if (tronApp) await tronApp.cleanProjectDir()
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, edgeTreatmentCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', edgeTreatmentCode)
    )
    await editor.closePane()
    await scene.moveCameraTo(
      { x: -3.14, y: -11, z: 16.25 },
      { x: 15, y: 10, z: 6 }
    )

    const [clickChamferBoundaryEdge] = scene.makeMouseHelpers(0.4091, 0.5557, {
      format: 'ratio',
    })
    await clickChamferBoundaryEdge()
    await expect(toolbar.selectionStatus).toContainText('1 edge')
    await toolbar.filletButton.click()
    await cmdBar.progressCmdBar()
    await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.3')
    await cmdBar.progressCmdBar()
    await cmdBar.submit()
    await scene.settled(cmdBar)

    await editor.expectEditor.toContain('tag = $')
    await editor.expectEditor.toContain('fillet001 = fillet(')
    await editor.expectEditor.toContain('edges = [')
    await editor.expectEditor.not.toContain('edgeId(')
  })

  test('2.10 fillets an outer Shell rim edge', async ({
    context,
    page,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    if (tronApp) await tronApp.cleanProjectDir()
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, shellCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', shellCode)
    )
    await editor.closePane()
    await scene.moveCameraTo({ x: 48, y: -38, z: 34 }, { x: 15, y: 11, z: 7 })

    const [clickShellRimEdge] = scene.makeMouseHelpers(0.3679, 0.3356, {
      format: 'ratio',
    })
    await clickShellRimEdge()
    await expect(toolbar.selectionStatus).toContainText('1 edge')
    await toolbar.filletButton.click()
    await cmdBar.progressCmdBar()

    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Fillet',
      currentArgKey: 'radius',
      currentArgValue: '5',
      headerArguments: {
        Selection: '1 edge',
        Radius: '',
      },
      highlightedHeaderArg: 'radius',
    })
    await cmdBar.currentArgumentInput.locator('.cm-content').fill('1')
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Fillet',
      headerArguments: {
        Selection: '1 edge',
        Radius: '1',
      },
      reviewValidationError: undefined,
    })
    await cmdBar.submit()
    await scene.settled(cmdBar)

    await editor.expectEditor.toContain('edgeId(body001')
    await editor.expectEditor.toContain('fillet001 = fillet(body001')
  })

  test('2.12 surface-extrudes an untouched outer CSG edge', async ({
    context,
    page,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    if (tronApp) await tronApp.cleanProjectDir()
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, csgSurfaceExtrudeCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', csgSurfaceExtrudeCode)
    )
    await editor.closePane()
    await scene.moveCameraTo({ x: 48, y: -42, z: 34 }, { x: 13, y: 9, z: 5 })

    const [clickOuterCsgEdge] = scene.makeMouseHelpers(0.6081, 0.4918, {
      format: 'ratio',
    })
    await clickOuterCsgEdge()
    await toolbar.extrudeButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'sketches',
      currentArgValue: '',
      headerArguments: {
        Profiles: '',
        Length: '5',
      },
      highlightedHeaderArg: 'Profiles',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: {
        Profiles: '1 edge',
        Length: '5',
      },
      highlightedHeaderArg: 'length',
    })
    await cmdBar.currentArgumentInput.locator('.cm-content').fill('6')
    await cmdBar.progressCmdBar()
    await cmdBar.selectOption({ name: 'Surface' }).click()
    await cmdBar.selectOption({ name: 'New' }).click()
    await cmdBar.submit()
    await scene.settled(cmdBar)

    await editor.expectEditor.toContain('sideFaces = [')
    await editor.expectEditor.toContain('method = NEW')
  })
})
