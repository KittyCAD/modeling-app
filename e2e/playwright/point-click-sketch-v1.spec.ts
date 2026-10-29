import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  KCL_DEFAULT_INSTANCES,
  KCL_DEFAULT_LENGTH,
} from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// test file is for testing point an click code gen functionality that's not sketch mode related

test.describe('Point-and-click tests - sketch v1', { tag: '@desktop' }, () => {
  test.use({
    userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG],
  })

  test('Create an Extrude operation with a tag and edit it via Feature Tree', async ({
    context,
    editor,
    homePage,
    page,
    scene,
    toolbar,
    modelingDialog,
  }) => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, code)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Add extrude with tags', async () => {
      await test.step('Open extrude command from toolbar', async () => {
        await toolbar.extrudeButton.click()
      })
      await test.step('Select profile', async () => {
        await editor.selectText('circle')
      })
      await test.step('Set length', async () => {
        await expect(modelingDialog.input('length')).toHaveText('5')
        await modelingDialog.input('length').fill('4')

        await expect(modelingDialog.options('body type')).toBeVisible()
        await modelingDialog
          .options('body type')
          .selectOption({ label: 'Surface' })
        await expect(modelingDialog.submitButton).toBeEnabled()
      })
      await test.step('Set end tag', async () => {
        await modelingDialog.advanced.click()
        await expect(modelingDialog.input('tag end')).toBeVisible()
        await modelingDialog.input('tag end').fill('myEndTag')

        await expect(modelingDialog.submitButton).toBeEnabled()
      })
      await test.step('Submit and verify', async () => {
        await modelingDialog.submit()
        await editor.expectEditor.toContain('extrude(')
        await editor.expectEditor.toContain('profile001')
        await editor.expectEditor.toContain('length = 4')
        await editor.expectEditor.toContain('tagEnd = $myEndTag')
        await editor.expectEditor.toContain('bodyType = SURFACE')
      })
    })

    await test.step(`Edit first extrude via feature tree`, async () => {
      await test.step('Open extrude operation from feature tree', async () => {
        await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
      })
      await test.step('Edit length argument', async () => {
        await expect(modelingDialog.input('length')).toHaveText('4')
        await modelingDialog.input('length').fill('3')
        await expect(modelingDialog.input('length')).toHaveText('3')

        await expect(modelingDialog.submitButton).toBeEnabled()
      })
      await test.step('Submit and verify', async () => {
        await modelingDialog.submit()
        await editor.expectEditor.toContain('extrude(')
        await editor.expectEditor.toContain('profile001')
        await editor.expectEditor.toContain('length = 3')
        await editor.expectEditor.toContain('tagEnd = $myEndTag')
        await editor.expectEditor.toContain('bodyType = SURFACE')
      })
    })
  })

  test.describe('verify sketch on chamfer works', () => {
    const _sketchOnAChamfer =
      (
        page: Page,
        editor: EditorFixture,
        toolbar: ToolbarFixture,
        scene: SceneFixture
      ) =>
      async ({
        clickCoords,
        cameraPos,
        cameraTarget,
        beforeChamferSnippet,
        afterChamferSelectSnippet,
        afterRectangle1stClickSnippet,
        afterRectangle2ndClickSnippet,
        beforeChamferSnippetEnd,
      }: {
        clickCoords: { x: number; y: number }
        cameraPos: { x: number; y: number; z: number }
        cameraTarget: { x: number; y: number; z: number }
        beforeChamferSnippet: string
        afterChamferSelectSnippet: string
        afterRectangle1stClickSnippet: string
        afterRectangle2ndClickSnippet: string
        beforeChamferSnippetEnd?: string
      }) => {
        const [clickChamfer] = scene.makeMouseHelpers(
          clickCoords.x,
          clickCoords.y
        )
        const [rectangle1stClick] = scene.makeMouseHelpers(573, 149)
        const [rectangle2ndClick, rectangle2ndMove] = scene.makeMouseHelpers(
          598,
          380,
          { steps: 5 }
        )

        await scene.moveCameraTo(cameraPos, cameraTarget)

        await test.step('check chamfer selection changes cursor position', async () => {
          await toolbar.waitForFeatureTreeToBeBuilt()
          await expect(async () => {
            // sometimes initial click doesn't register
            await clickChamfer()
            // await editor.expectActiveLinesToBe([beforeChamferSnippet.slice(-5)])
            await editor.expectActiveLinesToBe([
              beforeChamferSnippetEnd || beforeChamferSnippet.slice(-5),
            ])
          }).toPass({ timeout: 15_000, intervals: [500] })
        })

        await test.step('starting a new and selecting a chamfer should animate to the new sketch and possible break up the initial chamfer if it had one than more tag', async () => {
          await toolbar.startSketchPlaneSelection()
          await clickChamfer()
          // timeout wait for engine animation is unavoidable
          await page.waitForTimeout(1000)
          await editor.expectEditor.toContain(afterChamferSelectSnippet)
        })
        await test.step('make sure a basic sketch can be added', async () => {
          await toolbar.rectangleBtn.click()
          await rectangle1stClick()
          await editor.expectEditor.toContain(afterRectangle1stClickSnippet)
          await rectangle2ndMove({
            pixelDiff: 50,
          })
          await rectangle2ndClick()
          await editor.expectEditor.toContain(afterRectangle2ndClickSnippet, {
            shouldNormalise: true,
          })
        })

        await test.step('Clean up so that `_sketchOnAChamfer` util can be called again', async () => {
          await toolbar.exitSketch()
        })
        await test.step('Check there is no errors after code created in previous steps executes', async () => {
          await editor.expectState({
            activeLines: ['@settings(defaultLengthUnit = in)'],
            highlightedCode: '',
            diagnostics: [],
          })
          await toolbar.waitForFeatureTreeToBeBuilt()
        })
      }
  })

  test(`Offset plane point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const expectedOutput = `plane001 = offsetPlane(XZ, offset = 5)`
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step(`Fill the modeling dialog`, async () => {
      await toolbar.offsetPlaneButton.click()
      await modelingDialog.selection('Plane').click()
      await toolbar.selectDefaultPlane('Front plane')

      await expect(modelingDialog.input('offset')).toHaveText('5')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await editor.expectEditor.toContain(expectedOutput)
      await editor.expectState({
        diagnostics: [],
        activeLines: [expectedOutput],
        highlightedCode: '',
      })
    })

    await test.step('Delete offset plane via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'plane001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
    })
  })

  test(`Helix point-and-click around sweepEdge with edit and delete flows`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
|> yLine(length = 100)
|> line(endAbsolute = [100, 0])
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
extrude001 = extrude(profile001, length = 100)`

    // One dumb hardcoded screen pixel value to click on the sweepEdge, can't think of another way?
    const testPoint = { x: 564, y: 371 }
    const [clickOnEdge, moveToEdge] = scene.makeMouseHelpers(
      testPoint.x,
      testPoint.y
    )

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step(`Fill the modeling dialog`, async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.helixButton.click()
      await modelingDialog.options('mode').selectOption({ label: 'Edge' })
      await modelingDialog.selection('Edge').click()
      await moveToEdge()
      await clickOnEdge()
      await expect(modelingDialog.selection('Edge')).toHaveText('1 edge')
      await modelingDialog.fillInput('revolutions', '20')
      await modelingDialog.fillInput('angle start', '0')
      await modelingDialog.fillInput('radius', '1')
      await modelingDialog.fillInput('length', '')
      await expect(modelingDialog.submitButton).toBeEnabled()

      await modelingDialog
        .options('counterclockwise')
        .selectOption({ label: 'On' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `
        helix001 = helix(
          axis = {
            sideFaces = [seg01,capEnd001]
          },
          revolutions = 20,
          angleStart = 0,
          radius = 1,
          ccw = true,
        )`,
        { shouldNormalise: true }
      )
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step(`Edit helix through the feature tree`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.dblclick()
      const initialInput = '1'
      const newInput = '5'
      await expect(modelingDialog.input('radius')).toHaveText(initialInput)
      await modelingDialog.fillInput('radius', newInput)

      await expect(modelingDialog.submitButton).toBeEnabled()

      await expect(modelingDialog.options('counterclockwise')).toBeVisible()
      await modelingDialog
        .options('counterclockwise')
        .selectOption({ label: 'Off' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `
        helix001 = helix(
          axis = {
            sideFaces = [seg01,capEnd001]
          },
          revolutions = 20,
          angleStart = 0,
          radius = 5,
          ccw = false,
        )`,
        { shouldNormalise: true }
      )
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Delete helix via feature tree selection', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.click({ button: 'left' })
      await toolbar.expectSelection('1 helix')
      await page.keyboard.press('Delete')
      await editor.expectEditor.not.toContain('helix')
      await expect(
        await toolbar.getFeatureTreeOperation('Helix', 0)
      ).not.toBeVisible()
    })
  })

  test(`Loft point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const circleCode1 = `circle(center = [0, 0], radius = 30)`
    const circleCode2 = `circle(center = [0, 0], radius = 20)`
    const initialCode = `offset001 = 50
sketch001 = startSketchOn(XZ)
  |> ${circleCode1}
plane001 = offsetPlane(XZ, offset = offset001)
sketch002 = startSketchOn(plane001)
  |> ${circleCode2}
      `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1500, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()

    const loftDeclaration =
      'loft001 = loft([sketch001, sketch002], bodyType = SURFACE)'
    const editedLoftDeclaration =
      'loft001 = loft([sketch001, sketch002], vDegree = 3, bodyType = SURFACE)'

    async function selectSketches() {
      const multiCursorKey = process.platform === 'linux' ? 'Control' : 'Meta'
      await editor.selectText(circleCode1)
      await page.keyboard.down(multiCursorKey)
      await page.getByText(circleCode2).click()
      await page.keyboard.up(multiCursorKey)
    }

    await test.step(`Fill the modeling dialog without preselected sketches`, async () => {
      await toolbar.loftButton.click()
      await modelingDialog.selection('Profiles').click()
      await selectSketches()

      await expect(modelingDialog.options('body type')).toBeVisible()
      await modelingDialog
        .options('body type')
        .selectOption({ label: 'Surface' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
      await editor.expectEditor.toContain(loftDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [loftDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Go through the edit flow via feature tree', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const op = await toolbar.getFeatureTreeOperation('Loft', 0)
      await op.dblclick()
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.advanced.click()
      await expect(modelingDialog.input('v degree')).toBeVisible()
      await modelingDialog.input('v degree').fill('3')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
      await editor.expectEditor.toContain(editedLoftDeclaration)
    })

    await test.step('Delete loft via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Loft', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(editedLoftDeclaration)
    })
  })

  // Note: testing the helix case here for sweep as it's the only one we can't
  // test in src\lang\modifyAst\sweeps.test.ts
  test(`Sweep point-and-click helix`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const circleCode = `circle(sketch001, center = [0, -1], radius = .1)`
    const initialCode = `helix001 = helix(
  axis = X,
  radius = 1,
  length = 10,
  revolutions = 10,
  angleStart = 0,
  ccw = false,
)
sketch001 = startSketchOn(XZ)
profile001 = ${circleCode}`
    const sweepDeclaration = `sweep001 = sweep(
  profile001,
  path = helix001,
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`
    const editedSweepDeclaration = `sweep001 = sweep(
  profile001,
  path = helix001,
  sectional = true,
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step(`Add sweep through the modeling dialog`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.sweepButton.click()
      await modelingDialog.selection('Profiles').click()
      await editor.scrollToText(circleCode)
      await page.getByText(circleCode).click()

      await modelingDialog.selection('Path').click()
      const helix = await toolbar.getFeatureTreeOperation('Helix', 0)
      await helix.click()
      await modelingDialog.selection('Path').click()

      await expect(modelingDialog.options('body type')).toBeVisible()
      await modelingDialog
        .options('body type')
        .selectOption({ label: 'Surface' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await editor.expectEditor.toContain(sweepDeclaration, {
        shouldNormalise: true,
      })
    })

    await test.step('Go through the edit flow via feature tree', async () => {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const op = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await op.dblclick()
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.advanced.click()
      await expect(modelingDialog.options('sectional')).toBeVisible()
      await modelingDialog.options('sectional').selectOption({ label: 'On' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await editor.expectEditor.toContain(editedSweepDeclaration, {
        shouldNormalise: true,
      })
    })

    await test.step('Delete sweep via feature tree selection', async () => {
      await scene.settled()
      const sweep = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await sweep.click()
      await page.keyboard.press('Delete')
      await editor.expectEditor.not.toContain(editedSweepDeclaration, {
        shouldNormalise: true,
      })
    })
  })

  test(`Fillet point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    // Code samples
    const initialCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -12)
`
    const firstFilletDeclaration = `fillet001 = fillet(extrude001, edges=[{sideFaces=[seg01,extrude001.faces.capEnd001]}], radius=5`

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    // Test 1: Modeling dialog with preselected edges
    await test.step(`Select first edge`, async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      // Aim at the original sketch-plane edge: for this negative extrusion,
      // the solid edge at Z = 0 borders capEnd, not capStart.
      await scene.moveCameraTo({ x: 36, y: -48, z: 36 }, { x: 0, y: -6, z: 0 })
      const [clickOnFirstEdge] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })
      await clickOnFirstEdge()
      await expect(toolbar.selectionStatus).toContainText('1 edge')
    })

    await test.step(`Apply fillet to the preselected edge`, async () => {
      await page.waitForTimeout(100)
      await toolbar.filletButton.click()
      await modelingDialog.selection('Selection').click()

      await expect(modelingDialog.input('radius')).toHaveText('5')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(firstFilletDeclaration, {
        shouldNormalise: true,
      })
    })

    // Test 1.1: Edit the existing viewport-selected fillet
    async function editFillet(
      featureTreeIndex: number,
      oldValue: string,
      newValue: string
    ) {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Fillet',
        featureTreeIndex
      )
      await operationButton.dblclick({ button: 'left' })
      await expect(modelingDialog.input('radius')).toHaveText(oldValue)
      await modelingDialog.input('radius').fill(newValue)

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
    }

    await test.step('Edit fillet via feature tree selection works', async () => {
      const firstFilletFeatureTreeIndex = 0
      const editedRadius = '1'
      await editFillet(firstFilletFeatureTreeIndex, '5', editedRadius)
      await editor.expectEditor.toContain(
        firstFilletDeclaration.replace('radius=5', 'radius=' + editedRadius),
        { shouldNormalise: true }
      )

      // Edit back to original radius
      await editFillet(firstFilletFeatureTreeIndex, editedRadius, '5')
      await editor.expectEditor.toContain(firstFilletDeclaration, {
        shouldNormalise: true,
      })
    })
  })

  test(`Fillet point-and-click edit standalone expression`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 100,
  tag = $seg01,
)
extrude001 = extrude(profile001, length = 100)
fillet001 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
`
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })
    await test.step('Edit fillet', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      const operationButton = await toolbar.getFeatureTreeOperation('Fillet', 0)
      await operationButton.dblclick({ button: 'left' })
      await expect(modelingDialog.input('radius')).toHaveText('5')
      await modelingDialog.input('radius').fill('20')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })
    await test.step('Confirm changes', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await editor.expectEditor.toContain('radius = 20')
    })
  })

  test(`Shell point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
extrude001 = extrude(sketch001, length = 30)`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

    // One dumb hardcoded screen pixel value
    // Any idea here how to select a cap without clicking in the scene?
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const shellDeclaration =
      'shell001 = shell(extrude001, faces = capEnd001, thickness = 5)'
    const editedShellDeclaration =
      'shell001 = shell(extrude001, faces = capEnd001, thickness = 2)'

    await test.step(`Fill the modeling dialog without preselected faces`, async () => {
      await editor.closePane()
      await toolbar.shellButton.click()
      await modelingDialog.selection('Faces').click()
      await clickOnCap()
      await toolbar.expectSelection('1 face')

      await expect(modelingDialog.input('thickness')).toHaveText('5')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
      await editor.expectEditor.toContain(shellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [],
        highlightedCode: '',
      })
    })

    await test.step('Edit shell via feature tree selection works', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
      await operationButton.dblclick()
      await expect(modelingDialog.input('thickness')).toHaveText('5')
      await modelingDialog.input('thickness').fill('2')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(editedShellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [editedShellDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Delete shell via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(shellDeclaration)
    })
  })

  test(`Delete Face point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
extrude001 = extrude(sketch001, length = 30)`
    const deleteDeclaration = `surface001 = deleteFace(extrude001, faces = capEnd001)`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled()

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

    await test.step(`Fill the modeling dialog`, async () => {
      await toolbar.selectSurface('delete-face')
      await modelingDialog.selection('Faces').click()
      await clickOnCap()
      await toolbar.expectSelection('1 face')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
      await editor.expectEditor.toContain(deleteDeclaration)
    })

    await test.step('Delete delete face via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(deleteDeclaration)
    })
  })

  test('Revolve point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [-102.57, 101.72])
  |> angledLine(angle = 0deg, length = 202.6, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 202.6, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentA001)
  |> circle(center = [-11.34, 10.0], radius = 8.69)`
    const newCodeToFind =
      'revolve001 = revolve(  sketch002,  angle = 360deg,  axis = rectangleSegmentA001,  bodyType = SURFACE,)'

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step('Add revolve feature via point-and-click', async () => {
      // select line of code
      const codeToSelection = `center = [-11.34, 10.0]`
      // revolve
      await editor.scrollToText(codeToSelection)
      await page.getByText(codeToSelection).click()
      await toolbar.revolveButton.click()
      await modelingDialog.selection('Profiles').click()

      await expect(modelingDialog.options('axis or edge')).toBeVisible()
      await modelingDialog
        .options('axis or edge')
        .selectOption({ label: 'Edge' })
      await modelingDialog.selection('Edge').click()
      const lineCodeToSelection = `angledLine(angle = 0deg, length = 202.6, tag = $rectangleSegmentA001)`
      await editor.selectText(lineCodeToSelection)

      await expect(modelingDialog.input('angle')).toHaveText('360deg')

      await expect(modelingDialog.options('body type')).toBeVisible()
      await modelingDialog
        .options('body type')
        .selectOption({ label: 'Surface' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()

      await editor.expectEditor.toContain(newCodeToFind)
    })

    await test.step('Edit revolve feature via feature tree selection', async () => {
      const newAngle = '180deg'
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Revolve',
        0
      )
      await operationButton.dblclick({ button: 'left' })
      await expect(modelingDialog.input('angle')).toHaveText('360deg')
      await modelingDialog.input('angle').fill(newAngle)
      await modelingDialog.variableCheckbox('angle').check()
      await expect(page.getByPlaceholder('Variable name')).toHaveValue(
        'angle001'
      )

      await expect(modelingDialog.submitButton).toBeEnabled()

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await editor.expectEditor.toContain('angle001 = ' + newAngle)
      await editor.expectEditor.toContain(
        newCodeToFind.replace('angle = 360deg', 'angle = angle001')
      )
    })
  })

  test('Flip Surface point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-6.79, 0])
  |> line(end = [11.46, 10.74])
  |> line(endAbsolute = [7.24, 0])
extrude001 = extrude(profile001, length = 5, bodyType = SURFACE)`
    const flipSurfaceDeclaration = `surface001 = flipSurface(extrude001)`

    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Start Flip Surface and select extrude001 in the feature tree', async () => {
      await toolbar.selectSurface('flip-surface')
      await modelingDialog.selection('Surface').click()

      const operationButton = await toolbar.getFeatureTreeOperation(
        'extrude001',
        0
      )
      await operationButton.click({ button: 'left' })
      await modelingDialog.selection('Surface').click()
    })

    await test.step('Review and submit', async () => {
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
    })

    await test.step('Verify code was added', async () => {
      await editor.expectEditor.toContain(flipSurfaceDeclaration)
    })

    await test.step('Delete flip surface via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(flipSurfaceDeclaration)
    })
  })

  test('Join Surfaces point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const firstSurface = `extrude001 = extrude(profile001, length = 5, bodyType = SURFACE)`
    const secondSurface = `extrude002 = extrude(profile002, length = 5, bodyType = SURFACE)`
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [6.07, 1.66])
  |> yLine(length = -5.33)
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [-2, -3.87])
  |> line(endAbsolute = [0, 0])
${firstSurface}
${secondSurface}`
    const joinDeclaration = `surface001 = joinSurfaces([extrude001, extrude002])`

    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Start Join and select two surfaces', async () => {
      await toolbar.selectSurface('join-surfaces')
      await modelingDialog.selection('Selection').click()
      await page.keyboard.down('Shift')
      await (await toolbar.getFeatureTreeOperation('extrude001', 0)).click()
      await (await toolbar.getFeatureTreeOperation('extrude002', 0)).click()
      await page.keyboard.up('Shift')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step('Verify code was added', async () => {
      await scene.settled()
      await editor.expectEditor.toContain(joinDeclaration)
    })

    await test.step('Delete join via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(joinDeclaration)
    })
  })

  test(`Appearance point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const declaration = `appearance(extrude001, color = "#ff0000")`
    const editedDeclaration = `appearance(extrude001, color = "#00ff00")`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

    await test.step(`Go through the Set Appearance flow`, async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Extrude',
        0
      )
      await operationButton.click({ button: 'right' })
      const menuButton = page.getByTestId('context-menu-set-appearance')
      await menuButton.click()
      await modelingDialog.selection('Objects').click()

      await expect(modelingDialog.input('color')).toBeVisible()
      await modelingDialog.input('color').fill('#ff0000') // uppercase doesn't work here

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
      await editor.expectEditor.toContain(declaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [declaration],
        highlightedCode: '',
      })
    })

    await test.step('Edit appearance via feature tree selection works', async () => {
      const op = await toolbar.getFeatureTreeOperation('Appearance', 0)
      await op.dblclick({ button: 'left' })
      await expect(modelingDialog.input('color')).toBeVisible()
      await modelingDialog.input('color').fill('#00ff00')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
      await scene.settled()
      await editor.expectEditor.toContain(editedDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [editedDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Delete appearance via feature tree selection', async () => {
      await editor.closePane()
      const op = await toolbar.getFeatureTreeOperation('Appearance', 0)
      await op.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(declaration)
      await editor.expectEditor.not.toContain(editedDeclaration)
    })
  })

  test('Pattern Circular 3D point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)
solid001 = extrude(sketch001, length = 5)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Add Pattern Circular 3D to the scene', async () => {
      await test.step('Open Pattern Circular 3D command from toolbar', async () => {
        await toolbar.patternCircularButton.click()
        await modelingDialog.selection('Solids').click()
      })

      await test.step('Select solid and configure basic parameters', async () => {
        await test.step('Select solid', async () => {
          await modelingDialog.selection('Solids').click()
          await editor.selectText('extrude(sketch001, length = 5)')
        })

        await test.step('Configure instances', async () => {
          await expect(modelingDialog.input('instances')).toHaveText(
            KCL_DEFAULT_INSTANCES
          )
          // Update instances from DEFAULT to 8
          await modelingDialog.input('instances').fill('8')
        })

        await test.step('Configure axis', async () => {
          await expect(modelingDialog.options('axis')).toBeVisible()
          // Select Y-axis
          await modelingDialog.options('axis').selectOption({ label: 'Y-axis' })
        })

        await test.step('Configure center', async () => {
          await expect(modelingDialog.input('center')).toHaveValue('[0, 0, 0]')
          // Update center from [0, 0, 0] to [5, 0, 0]
          await modelingDialog.input('center').fill('[5, 0, 0]')
        })

        await test.step('Review basic parameters', async () => {
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure arc degrees', async () => {
          await expect(modelingDialog.input('arc degrees')).toHaveAttribute(
            'aria-placeholder',
            'Use defaults'
          )
          // Update arc degrees from 360deg to 180
          await modelingDialog.input('arc degrees').fill('180')

          // Review changes to arc degrees
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure rotate duplicates', async () => {
          await expect(
            modelingDialog.options('rotate duplicates')
          ).toBeVisible()
          // Select On option
          await modelingDialog
            .options('rotate duplicates')
            .selectOption({ label: 'On' })
          // Review changes to rotate duplicates
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure use original', async () => {
          await expect(modelingDialog.options('use original')).toBeVisible()
          // Select Off option
          await modelingDialog
            .options('use original')
            .selectOption({ label: 'Off' })
          // Review changes to use original
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('patternCircular3d(')
        await editor.expectEditor.toContain('instances = 8')
        await editor.expectEditor.toContain('axis = Y')
        await editor.expectEditor.toContain('center = [5, 0, 0]')
        await editor.expectEditor.toContain('arcDegrees = 180')
        await editor.expectEditor.toContain('rotateDuplicates = true')
        await editor.expectEditor.toContain('useOriginal = false')
      })
    })

    await test.step('Edit Pattern Circular 3D', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const patternOperation = await toolbar.getFeatureTreeOperation(
          'pattern001',
          0
        )
        await patternOperation.dblclick()
        // Should open the modeling dialog in edit mode
        await expect(modelingDialog.input('center')).toHaveValue('[5, 0, 0]')
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit center', async () => {
          await expect(modelingDialog.input('center')).toHaveValue('[5, 0, 0]')
          // Update center from [5, 0, 0] to [5, 3+4, 0]
          await modelingDialog.input('center').fill('[5, 3+4, 0]')

          // Review changes to center
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit instances', async () => {
          await expect(modelingDialog.input('instances')).toHaveText('8')
          // Update instances from 8 to 12
          await modelingDialog.input('instances').fill('12')

          // Review changes to instances
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit axis', async () => {
          await expect(modelingDialog.options('axis')).toBeVisible()
          // Update axis from Y-axis to Z-axis
          await modelingDialog.options('axis').selectOption({ label: 'Z-axis' })
          // Review changes to axis
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit arc degrees', async () => {
          await expect(modelingDialog.input('arc degrees')).toHaveText('180')
          // Update arc degrees from 180 to 270
          await modelingDialog.input('arc degrees').fill('270')

          // Review changes to arc degrees
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit rotate duplicates', async () => {
          await expect(
            modelingDialog.options('rotate duplicates')
          ).toBeVisible()
          // Update rotate duplicates from On to Off
          await modelingDialog
            .options('rotate duplicates')
            .selectOption({ label: 'Off' })
          // Review changes to rotate duplicates
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit use original', async () => {
          await expect(modelingDialog.options('use original')).toBeVisible()
          // Update use original from Off to On
          await modelingDialog
            .options('use original')
            .selectOption({ label: 'On' })
          // Review changes to use original
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('patternCircular3d(')
        await editor.expectEditor.toContain('instances = 12')
        await editor.expectEditor.toContain('axis = Z')
        await editor.expectEditor.toContain('center = [5, 3 + 4, 0]')
        await editor.expectEditor.toContain('arcDegrees = 270')
        await editor.expectEditor.toContain('rotateDuplicates = false')
        await editor.expectEditor.toContain('useOriginal = true')
      })
    })

    await test.step('Delete Pattern Circular 3D', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const patternOperation = await toolbar.getFeatureTreeOperation(
        'pattern001',
        0
      )
      // Delete the pattern operation
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('patternCircular3d(')
    })
  })

  test('Pattern Linear 3D point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)
solid001 = extrude(sketch001, length = 5)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
      // await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Add Pattern Linear 3D to the scene', async () => {
      await test.step('Open Pattern Linear 3D command from toolbar', async () => {
        await page
          .getByRole('button', { name: 'caret down pattern: open menu' })
          .click()
        await expect(
          page.getByTestId('dropdown-pattern-linear-3d')
        ).toBeVisible()
        await page.getByTestId('dropdown-pattern-linear-3d').click()
        await modelingDialog.selection('Solids').click()
      })

      await test.step('Select solid and configure parameters', async () => {
        await test.step('Select solid', async () => {
          await modelingDialog.selection('Solids').click()
          await editor.selectText('extrude(sketch001, length = 5)')
        })

        await test.step('Configure instances', async () => {
          await expect(modelingDialog.input('instances')).toHaveText(
            KCL_DEFAULT_INSTANCES
          )
          // Update instances from DEFAULT to 6
          await modelingDialog.input('instances').fill('6')
        })

        await test.step('Configure distance', async () => {
          await expect(modelingDialog.input('distance')).toHaveText(
            KCL_DEFAULT_LENGTH
          )
          // Update distance from KCL_DEFAULT_LENGTH to 8
          await modelingDialog.input('distance').fill('8')
        })

        await test.step('Configure axis', async () => {
          await expect(modelingDialog.options('axis')).toBeVisible()
          // Select Y-axis
          await modelingDialog.options('axis').selectOption({ label: 'Y-axis' })
        })

        await test.step('Configure use original', async () => {
          await expect(modelingDialog.options('use original')).toBeVisible()
          // Select On option
          await modelingDialog
            .options('use original')
            .selectOption({ label: 'On' })
          // Review changes to use original
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Review basic parameters', async () => {
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('patternLinear3d(')
        await editor.expectEditor.toContain('instances = 6')
        await editor.expectEditor.toContain('distance = 8')
        await editor.expectEditor.toContain('axis = Y')
        await editor.expectEditor.toContain('useOriginal = true')
      })
    })

    await test.step('Edit Pattern Linear 3D', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const patternOperation = await toolbar.getFeatureTreeOperation(
          'pattern001',
          0
        )
        await patternOperation.dblclick()
        // Should open the modeling dialog in edit mode
        await expect(modelingDialog.options('axis')).toBeVisible()
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit axis parameter', async () => {
          // Select Z-axis
          await modelingDialog.options('axis').selectOption({ label: 'Z-axis' })
          // Review changes to axis
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit instances parameter', async () => {
          await expect(modelingDialog.input('instances')).toHaveText('6')
          // Update instances from 6 to 4
          await modelingDialog.input('instances').fill('4')

          // Review changes to instances
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit distance parameter', async () => {
          await expect(modelingDialog.input('distance')).toHaveText('8')
          // Update distance from 8 to 12
          await modelingDialog.input('distance').fill('12')

          // Review changes to distance
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit use original parameter', async () => {
          await expect(modelingDialog.options('use original')).toBeVisible()
          // Update use original from On to Off
          await modelingDialog
            .options('use original')
            .selectOption({ label: 'Off' })
          // Review changes to use original
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify edited parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('patternLinear3d(')
        await editor.expectEditor.toContain('instances = 4')
        await editor.expectEditor.toContain('distance = 12')
        await editor.expectEditor.toContain('axis = Z')
        await editor.expectEditor.toContain('useOriginal = false')
      })
    })

    await test.step('Delete Pattern Linear 3D', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

      const patternOperation = await toolbar.getFeatureTreeOperation(
        'pattern001',
        0
      )
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')

      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await editor.expectEditor.not.toContain('patternLinear3d(')
    })
  })

  test('GDT Flatness from modeling dialog', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
extrude001 = extrude(sketch001, length = 30)
    `
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    // Adjusted coordinates to center screen for clicking on cap
    const testPoint = { x: 500, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    await test.step('Add GDT Flatness to the scene', async () => {
      await test.step('Open GDT Flatness command from toolbar', async () => {
        await toolbar.selectGdtFlatness()
        await modelingDialog.selection('Faces').click()
      })

      await test.step('Select face and configure basic parameters', async () => {
        await test.step('Select face', async () => {
          await modelingDialog.selection('Faces').click()
          await clickOnCap()
          await toolbar.expectSelection('1 face')
        })

        await test.step('Configure tolerance', async () => {
          await expect(modelingDialog.input('tolerance')).toHaveText('0.1in')
          // Set tolerance to 0.1in
          await modelingDialog.input('tolerance').fill('0.1in')
        })

        await test.step('Review basic parameters', async () => {
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure precision', async () => {
          await expect(modelingDialog.input('precision')).toHaveAttribute(
            'aria-placeholder',
            'Use defaults'
          )
          // Update precision from 3 to 5
          await modelingDialog.input('precision').fill('5')

          // Review changes to precision
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure frame position', async () => {
          await expect(modelingDialog.input('frame position')).toHaveValue('')
          // Update frame position from [0, 0] to [10, 10]
          await modelingDialog.input('frame position').fill('[10, 10]')

          // Review changes to frame position
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure frame plane', async () => {
          await expect(modelingDialog.options('frame plane')).toBeVisible()
          // Select XY plane
          await modelingDialog
            .options('frame plane')
            .selectOption({ label: 'XY Plane' })
          // Review changes to frame plane
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure font size', async () => {
          await expect(modelingDialog.input('font size')).toHaveAttribute(
            'aria-placeholder',
            'Use defaults'
          )
          // Update font size to 12mm
          await modelingDialog.input('font size').fill('12mm')

          // Review changes to font size
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.not.toContain('experimentalFeatures = allow')
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.1in')
        await editor.expectEditor.toContain('precision = 5')
        await editor.expectEditor.toContain('framePosition = [10, 10]')
        await editor.expectEditor.toContain('framePlane = XY')
        await editor.expectEditor.toContain('fontSize = 12mm')
      })
    })

    await test.step('Edit GDT Flatness', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const gdtOperation = await toolbar.getFeatureTreeOperation('note001', 0)
        await gdtOperation.dblclick()
        // Should open the modeling dialog in edit mode
        await expect(modelingDialog.input('tolerance')).toHaveText('0.1in')
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit tolerance', async () => {
          await expect(modelingDialog.input('tolerance')).toHaveText('0.1in')
          // Update tolerance from 0.1in to 0.2in
          await modelingDialog.input('tolerance').fill('0.2in')

          // Review changes to tolerance
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit precision', async () => {
          await expect(modelingDialog.input('precision')).toHaveText('5')
          // Update precision from 5 to 3
          await modelingDialog.input('precision').fill('3')

          // Review changes to precision
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit frame position', async () => {
          await expect(modelingDialog.input('frame position')).toHaveValue(
            '[10, 10]'
          )
          // Update frame position from [10, 10] to [20, 30]
          await modelingDialog.input('frame position').fill('[20, 30]')

          // Review changes to frame position
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit frame plane', async () => {
          await expect(modelingDialog.options('frame plane')).toBeVisible()
          // Update frame plane from XY to XZ
          await modelingDialog
            .options('frame plane')
            .selectOption({ label: 'XZ Plane' })
          // Review changes to frame plane
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit font size', async () => {
          await expect(modelingDialog.input('font size')).toHaveText('12mm')
          // Update font size from 48 to 24
          await modelingDialog.input('font size').fill('24')

          // Review changes to font size
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.2in')
        await editor.expectEditor.toContain('precision = 3')
        await editor.expectEditor.toContain('framePosition = [20, 30]')
        await editor.expectEditor.toContain('framePlane = XZ')
        await editor.expectEditor.toContain('fontSize = 24')
      })
    })

    await test.step('Delete GDT Flatness', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const gdtOperation = await toolbar.getFeatureTreeOperation('note001', 0)
      // Delete the GDT operation
      await gdtOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('gdt::flatness(')
    })
  })

  test('GDT Datum from modeling dialog', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
extrude001 = extrude(sketch001, length = 30)
    `
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    // Adjusted coordinates to center screen for clicking on cap
    const testPoint = { x: 500, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    await test.step('Add GDT Datum to the scene', async () => {
      await test.step('Open GDT Datum command from toolbar', async () => {
        await page
          .getByRole('button', { name: 'caret down gdt: open menu' })
          .click()
        await expect(page.getByTestId('dropdown-gdt-datum')).toBeVisible()
        await page.getByTestId('dropdown-gdt-datum').click()
        await modelingDialog.selection('Faces').click()
      })

      await test.step('Select face and configure basic parameters', async () => {
        await test.step('Select face', async () => {
          await modelingDialog.selection('Faces').click()
          await clickOnCap()
          await toolbar.expectSelection('1 face')
        })

        await test.step('Configure name', async () => {
          await expect(modelingDialog.input('name')).toBeVisible()
          // Keep default name 'A'
        })

        await test.step('Review basic parameters', async () => {
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure frame position', async () => {
          await expect(modelingDialog.input('frame position')).toHaveValue('')
          // Update frame position from [0, 0] to [5, 0]
          await modelingDialog.input('frame position').fill('[5, 0]')

          // Review changes to frame position
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure frame plane', async () => {
          await expect(modelingDialog.options('frame plane')).toBeVisible()
          // Select XZ plane
          await modelingDialog
            .options('frame plane')
            .selectOption({ label: 'XZ Plane' })
          // Review changes to frame plane
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Configure font size', async () => {
          await expect(modelingDialog.input('font size')).toHaveAttribute(
            'aria-placeholder',
            'Use defaults'
          )
          // Update font size to 12mm
          await modelingDialog.input('font size').fill('12mm')

          // Review changes to font size
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.not.toContain('experimentalFeatures = allow')
        await editor.expectEditor.toContain('gdt::datum(')
        await editor.expectEditor.toContain('face = capEnd001')
        await editor.expectEditor.toContain('name = "A"')
        await editor.expectEditor.toContain('framePosition = [5, 0]')
        await editor.expectEditor.toContain('framePlane = XZ')
        await editor.expectEditor.toContain('fontSize = 12mm')
      })
    })

    await test.step('Edit GDT Datum', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const gdtOperation = await toolbar.getFeatureTreeOperation('Datum', 0)
        await gdtOperation.dblclick()
        // Should open the modeling dialog in edit mode
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit name from A to B', async () => {
          await expect(modelingDialog.input('name')).toBeVisible()
          // Update name from A to B
          await expect(modelingDialog.input('name')).toBeVisible()
          await modelingDialog.input('name').fill('B')

          // Review changes to name
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit frame position', async () => {
          await expect(modelingDialog.input('frame position')).toHaveValue(
            '[5, 0]'
          )
          // Update frame position from [5, 0] to [10, 5]
          await modelingDialog.input('frame position').fill('[10, 5]')

          // Review changes to frame position
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit frame plane', async () => {
          await expect(modelingDialog.options('frame plane')).toBeVisible()
          // Update frame plane from XZ to YZ
          await modelingDialog
            .options('frame plane')
            .selectOption({ label: 'YZ Plane' })
          // Review changes to frame plane
          await expect(modelingDialog.submitButton).toBeEnabled()
        })

        await test.step('Edit font size', async () => {
          await expect(modelingDialog.input('font size')).toHaveText('12mm')
          // Update font size from 48 to 32
          await modelingDialog.input('font size').fill('32')

          // Review changes to font size
          await expect(modelingDialog.submitButton).toBeEnabled()
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await modelingDialog.submit()
        await scene.settled()
        await editor.expectEditor.toContain('gdt::datum(')
        await editor.expectEditor.toContain('face = capEnd001')
        await editor.expectEditor.toContain('name = "B"')
        await editor.expectEditor.toContain('framePosition = [10, 5]')
        await editor.expectEditor.toContain('framePlane = YZ')
        await editor.expectEditor.toContain('fontSize = 32')
      })
    })

    await test.step('Delete GDT Datum', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const gdtOperation = await toolbar.getFeatureTreeOperation('Datum', 0)
      // Delete the GDT operation
      await gdtOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('gdt::datum(')
    })
  })

  test('Hole point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> angledLine(angle = 0deg, length = 10, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 10)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Add the hole through the command flow', async () => {
      await toolbar.holeButton.click()
      const testPoint = { x: 600, y: 250 }
      const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
      await modelingDialog.selection('Face').click()
      await clickOnCap()
      await toolbar.expectSelection('1 face')

      await expect(modelingDialog.input('cut at')).toHaveText('[0, 0]')

      await expect(modelingDialog.options('hole body')).toBeVisible()
      await modelingDialog.options('hole body').selectOption({ label: 'Blind' })
      await expect(modelingDialog.input('blind depth')).toHaveText('2')

      await expect(modelingDialog.input('blind diameter')).toHaveText('1')

      await expect(modelingDialog.options('hole type')).toBeVisible()
      await modelingDialog
        .options('hole type')
        .selectOption({ label: 'Simple' })
      await expect(modelingDialog.options('hole bottom')).toBeVisible()
      await modelingDialog
        .options('hole bottom')
        .selectOption({ label: 'Flat' })
      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step('Expect hole call added to the editor', async () => {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> angledLine(angle = 0deg, length = 10, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 10)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
hole001 = hole::hole(
  extrude001,
  face = capEnd001,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 2, diameter = 1),
  holeType =   hole::simple(),
)`,
        { shouldNormalise: true }
      )
    })

    await test.step('Edit the hole from the feature-tree', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const holeOperation = await toolbar.getFeatureTreeOperation('Hole', 0)
      await holeOperation.dblclick()
      await expect(modelingDialog.submitButton).toBeEnabled()

      await expect(modelingDialog.input('cut at')).toHaveText('[0, 0]')
      // Update cut at from [0, 0] to [2, 2]
      await modelingDialog.input('cut at').fill('[2, 2]')

      await expect(modelingDialog.submitButton).toBeEnabled()

      await expect(modelingDialog.options('hole type')).toBeVisible()
      await modelingDialog
        .options('hole type')
        .selectOption({ label: 'Countersink' })
      await expect(modelingDialog.input('countersink angle')).toBeVisible()
      await modelingDialog.input('countersink angle').fill('80deg')

      await expect(modelingDialog.input('countersink diameter')).toBeVisible()
      await modelingDialog.input('countersink diameter').fill('3')

      await expect(modelingDialog.submitButton).toBeEnabled()
      await modelingDialog.submit()
    })

    await test.step('Expect hole call updated in the editor', async () => {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `hole001 = hole::hole(
  extrude001,
  face = capEnd001,
  cutAt = [2, 2],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 2, diameter = 1),
  holeType =   hole::countersink(angle = 80deg, diameter = 3),
)`,
        { shouldNormalise: true }
      )
    })
  })
})
