import { expect, test } from '@e2e/playwright/zoo-test'

/**
 * Test KCL code - creates a scene with solid3d, surface, and split edges
 */
const testCode = `@settings(kclVersion = "3.0-preview")
sketch001 = startSketchOn(YZ)
    profile001 = startProfile(sketch001, at = [-21.99, 8.01])
    |> angledLine(angle = 0deg, length = 8.96, tag = $rectangleSegmentA001)
    |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 9.8)
    |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile002 = startProfile(sketch001, at = [6.83, -2.24])
    |> line(end = [8.24, 12.65])
    |> line(end = [6.49, -12.52])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile003 = startProfile(sketch001, at = [6.11, -13.2])
    |> angledLine(angle = 0deg, length = 10.71, tag = $rectangleSegmentA002)
    |> angledLine(angle = segAng(rectangleSegmentA002) - 90deg, length = 9.54)
    |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    profile004 = circle(sketch001, center = [-1.16, -28.94], radius = 3.16)
    profile005 = circle(sketch001, center = [-7.82, 13.15], radius = 2.64)
    extrude001 = extrude(profile002, length = 15)
    extrude002 = extrude(profile003, length = 20, bodyType = SURFACE)
    sketch002 = startSketchOn(XZ)
    profile006 = startProfile(sketch002, at = [4.61, 11.1])
    |> line(end = [3.52, -1.94])
    |> line(end = [4.03, 1.84])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    extrude003 = extrude(profile006, length = -100)
    solid001 = subtract(extrude001, tools = extrude003)
`

/**
 * Tests for edge selection using the global index API.
 *
 * These tests verify that we can correctly select edges in different scenarios:
 * - Solid3D edges (from extrude001, solid001)
 * - Surface edges (from extrude002 with bodyType = SURFACE)
 * - Split edges (edges created by boolean operations like subtract)
 */
test.describe('Face API edge selection', { tag: '@web' }, () => {
  test('Can select Solid3D edges and Surface edges for revolve', async ({
    context,
    scene,
    modelingDialog,
    page,
    toolbar,
    editor,
    homePage,
  }) => {
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, testCode)

    await homePage.goToModelingScene()
    await scene.settled()
    if ((await editor.getCurrentCode()).trim() !== testCode.trim()) {
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', testCode)
      )
    }
    await editor.expectEditor.toContain('solid001 = subtract')

    // Set camera so that we can select what we need to.
    await scene.moveCameraTo(
      { x: -25.47, y: -19, z: -11 },
      { x: -2.5, y: -3.7, z: -19.5 }
    )

    await test.step('First revolve: profile and edge using ratio clicks', async () => {
      const [clickProfile] = scene.makeMouseHelpers(0.4671, 0.75, {
        format: 'ratio',
      })
      const [clickEdge, mv] = scene.makeMouseHelpers(0.0625, 0.422, {
        format: 'ratio',
        steps: 5,
      })

      await toolbar.revolveButton.click()
      await scene.settled()

      await toolbar.expectSelection('No selection')
      await clickProfile()
      await expect(modelingDialog.selection('Profiles')).toHaveText('1 profile')

      // Select Edge option
      await modelingDialog
        .options(/^axis or edge\b/i)
        .selectOption({ label: 'Edge' })
      await modelingDialog.selection('Edge').click()

      // select edge
      await expect(modelingDialog.selection('Profiles')).toHaveText('1 profile')
      await mv()
      await clickEdge()
      await toolbar.expectSelection('1 edge')

      await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())

      // Assert code contains revolve
      await editor.expectEditor.toContain(`revolve`)
      await editor.expectEditor.toContain(`sideFaces = [seg01]`)
      await editor.expectEditor.toContain(
        `endFaces = [rectangleSegmentA002, seg02]`
      )
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    })

    await test.step('Second revolve: profile and edge using ratio clicks', async () => {
      const [clickProfile2] = scene.makeMouseHelpers(0.3816, 0.4, {
        format: 'ratio',
      })
      const [clickEdge2] = scene.makeMouseHelpers(0.6748, 0.6455, {
        format: 'ratio',
      })

      // Set camera position for second revolve
      await scene.moveCameraTo(
        { x: -23.6, y: -21.18, z: 9.66 },
        { x: 11.16, y: -10.1, z: 10.71 }
      )

      // Click revolve tool again
      await toolbar.revolveButton.click()
      await scene.settled()

      await toolbar.expectSelection('1 edge')
      await clickProfile2()
      await expect(modelingDialog.selection('Profiles')).toHaveText('1 profile')
      await page.waitForTimeout(500)

      // Select Edge option
      await modelingDialog
        .options(/^axis or edge\b/i)
        .selectOption({ label: 'Edge' })
      await modelingDialog.selection('Edge').click()

      // Click edge using ratio clicks
      await expect(modelingDialog.selection('Profiles')).toHaveText('1 profile')
      await modelingDialog.moveTo({ x: 0, y: 80 })
      await clickEdge2()
      await toolbar.expectSelection('1 edge')

      const codeBeforeSecondRevolveSubmit = await editor.getCurrentCode()
      const revolveCountBeforeSecondSubmit = (
        codeBeforeSecondRevolveSubmit.match(/\brevolve\(/g) ?? []
      ).length

      await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())

      const codeAfterSecondRevolveSubmit = await editor.getCurrentCode()
      const revolveCountAfterSecondSubmit = (
        codeAfterSecondRevolveSubmit.match(/\brevolve\(/g) ?? []
      ).length

      expect(revolveCountAfterSecondSubmit).toBe(
        revolveCountBeforeSecondSubmit + 1
      )
      expect(codeAfterSecondRevolveSubmit).toContain('axis = seg03')
      expect(codeAfterSecondRevolveSubmit).toContain('revolve002 = revolve')
      await editor.expectEditor.toContain(`axis = seg03`)
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

      // Final sanity check: assert no errors in code pane
      await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
    })
  })

  test('Can select split edges for fillet', async ({
    context,
    scene,
    modelingDialog,
    page,
    toolbar,
    editor,
    homePage,
  }) => {
    const [clickEdge] = scene.makeMouseHelpers(0.1709, 0.4864, {
      format: 'ratio',
    })
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, testCode)

    await homePage.goToModelingScene()
    await scene.settled()
    if ((await editor.getCurrentCode()).trim() !== testCode.trim()) {
      await scene.waitForExecutionDoneAfter(() =>
        editor.replaceCode('', testCode)
      )
    }
    await editor.expectEditor.toContain('solid001 = subtract')

    // Set camera position for optimal edge viewing
    await scene.moveCameraTo(
      { x: 5.06, y: 25.19, z: 21.78 },
      { x: 7.72, y: 11.81, z: 8.2 }
    )

    // Click on the split edge using ratio clicks to select it first
    await clickEdge()

    // Click fillet tool - the edge should already be selected
    await toolbar.filletButton.click()

    // Set radius to 0.75mm
    await expect(modelingDialog.selection('Selection')).toHaveText('1 edge')
    await modelingDialog.input(/^radius\b/i).fill('0.75')

    await modelingDialog.submit()

    // Assert code contains fillet
    await editor.expectEditor.toContain('fillet')

    // Final sanity check: assert no errors in code pane
    await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
  })

  test('Can use an edge-extruded surface boundary as a Helix axis', async ({
    context,
    page,
    scene,
    modelingDialog,
    editor,
    toolbar,
    homePage,
  }) => {
    const code = `@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  line1 = line(start = [0, 0], end = [20, 0])
  line2 = line(start = [20, 0], end = [20, 12])
}
surface001 = extrude(
  sketch001.line1,
  length = 10,
  bodyType = SURFACE,
  method = NEW,
)
hide(sketch001)`

    await context.addInitScript(
      ({ initialCode }) => {
        localStorage.setItem('persistCode', initialCode)
      },
      {
        initialCode: code,
      }
    )
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    if ((await editor.getCurrentCode()).trim() !== code.trim()) {
      await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    }
    await editor.expectEditor.toContain('surface001 = extrude')
    await editor.closePane()

    const [clickSurfaceEdge] = scene.makeMouseHelpers(0.7513, 0.3071, {
      format: 'ratio',
    })
    await clickSurfaceEdge()
    await expect(toolbar.selectionStatus).toContainText('1 edge')

    const [clearSelection] = scene.makeMouseHelpers(0.3, 0.5, {
      format: 'ratio',
    })
    await clearSelection()
    await expect(toolbar.selectionStatus).not.toContainText('edge')
    await toolbar.helixButton.click()
    await modelingDialog.options(/^mode\b/i).selectOption({ label: 'Edge' })
    await modelingDialog.selection('Edge').click()
    await modelingDialog.moveTo({ x: 0, y: 80 })
    await clickSurfaceEdge()
    await expect(modelingDialog.selection('Edge')).toHaveText('1 edge')
    await expect(modelingDialog.input(/^revolutions\b/i)).toHaveText('1')
  })
})
