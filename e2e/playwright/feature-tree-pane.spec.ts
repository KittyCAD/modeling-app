import { join } from 'path'
import * as fsp from 'fs/promises'

import { expect, test } from '@e2e/playwright/zoo-test'

const FEATURE_TREE_EXAMPLE_CODE = `export fn timesFive(@x) {
  return 5 * x
}
export fn triangle() {
  return startSketchOn(XZ)
    |> startProfile(at = [0, 0])
    |> xLine(length = 10)
    |> line(end = [-10, -5])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

length001 = timesFive(1) * 5
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [20, 10])
  |> line(end = [10, 10])
  |> angledLine(angle = -45, length = length001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(sketch001, axis = X)
triangle()
  |> extrude(length = 30)
plane001 = offsetPlane(XY, offset = 10)
sketch002 = startSketchOn(plane001)
  |> startProfile(at = [-20, 0])
  |> line(end = [5, -15])
  |> xLine(length = -10)
  |> line(endAbsolute = [-40, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch002, length = 10)
`

const FEATURE_TREE_SKETCH_CODE = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 0, length = 4, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 2, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close(%)
extrude001 = extrude(sketch001, length = 10)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentB001)
  |> circle(
       center = [-1, 2],
       radius = .5
     )
plane001 = offsetPlane(XZ, offset = -5)
sketch003 = startSketchOn(plane001)
  |> circle(center = [0, 0], radius = 5)
`

test.describe('Feature Tree pane', () => {
  test(
    'User can go to definition and go to function definition',
    { tag: '@desktop' },
    async ({ context, homePage, scene, editor, toolbar, cmdBar, page }) => {
      await context.folderSetupFn(async (dir) => {
        const bracketDir = join(dir, 'test-sample')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.writeFile(
          join(bracketDir, 'main.kcl'),
          FEATURE_TREE_EXAMPLE_CODE,
          'utf-8'
        )
      })

      await test.step('setup test', async () => {
        await homePage.expectState({
          projectCards: [
            {
              title: 'test-sample',
              fileCount: 1,
            },
          ],
          sortBy: 'last-modified-desc',
        })
        await homePage.openProject('test-sample')
        await scene.connectionEstablished()
        await scene.settled(cmdBar)

        await toolbar.openFeatureTreePane()
        await expect
          .poll(() => page.getByText('Feature tree').count())
          .toBeGreaterThan(1)
      })

      async function testViewSource({
        operationName,
        operationIndex,
        expectedActiveLine,
      }: {
        operationName: string
        operationIndex: number
        expectedActiveLine: string
      }) {
        await test.step(`Go to definition of the ${operationName}`, async () => {
          await toolbar.viewSourceOnOperation(operationName, operationIndex)
          await editor.expectState({
            highlightedCode: '',
            diagnostics: [],
            activeLines: [expectedActiveLine],
          })
          await expect(
            editor.activeLine.first(),
            `${operationName} code should be scrolled into view`
          ).toBeVisible()
        })
      }

      await testViewSource({
        operationName: 'Offset Plane',
        operationIndex: 0,
        expectedActiveLine: 'plane001 = offsetPlane(XY, offset = 10)',
      })
      await testViewSource({
        operationName: 'Extrude',
        operationIndex: 1,
        expectedActiveLine: 'extrude001 = extrude(sketch002, length = 10)',
      })
      await testViewSource({
        operationName: 'Revolve',
        operationIndex: 0,
        expectedActiveLine: 'revolve001 = revolve(sketch001, axis = X)',
      })
      await testViewSource({
        operationName: 'Triangle',
        operationIndex: 0,
        expectedActiveLine: 'triangle()',
      })

      await test.step('Go to definition on the triangle function', async () => {
        await toolbar.goToDefinitionOnOperation('Triangle', 0)
        await editor.expectState({
          highlightedCode: '',
          diagnostics: [],
          activeLines: ['export fn triangle() {'],
        })
        await expect(
          editor.activeLine.first(),
          'Triangle function definition should be scrolled into view'
        ).toBeVisible()
      })
    }
  )

  test(
    `User can edit sketch (but not on offset plane yet) from the feature tree`,
    { tag: '@desktop' },
    async ({ context, homePage, scene, editor, toolbar, page }) => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, FEATURE_TREE_SKETCH_CODE)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      await test.step('force re-exe', async () => {
        await page.waitForTimeout(1000)
        await editor.replaceCode('90', '91')
        await page.waitForTimeout(1500)
      })

      await test.step('On a default plane should work', async () => {
        await (await toolbar.getFeatureTreeOperation('Sketch', 0)).dblclick()
        await expect(
          toolbar.exitSketchBtn,
          'We should be in sketch mode now'
        ).toBeVisible()
        await editor.expectState({
          highlightedCode: '',
          diagnostics: [],
          activeLines: ['sketch001 = startSketchOn(XZ)'],
        })
        await toolbar.exitSketchBtn.click()
      })

      await test.step('On an extrude face should *not* work', async () => {
        // Tooltip is getting in the way of clicking, so I'm first closing the pane
        await toolbar.closeFeatureTreePane()
        await page.waitForTimeout(1000)
        await editor.replaceCode('91', '90')
        await page.waitForTimeout(2000)
        await (await toolbar.getFeatureTreeOperation('Sketch', 1)).dblclick()

        await expect(
          toolbar.exitSketchBtn,
          'We should be in sketch mode now'
        ).toBeVisible()
        await editor.expectState({
          highlightedCode: '',
          diagnostics: [],
          activeLines: [
            'sketch002=startSketchOn(extrude001,face=rectangleSegmentB001)',
          ],
        })
        await toolbar.exitSketchBtn.click()
      })

      await test.step('On an offset plane should work', async () => {
        // Tooltip is getting in the way of clicking, so I'm first closing the pane
        await toolbar.closeFeatureTreePane()
        await (await toolbar.getFeatureTreeOperation('Sketch', 2)).dblclick()
        await editor.expectState({
          highlightedCode: '',
          diagnostics: [],
          activeLines: ['sketch003=startSketchOn(plane001)'],
        })
        await expect(
          toolbar.exitSketchBtn,
          'We should be in sketch mode now'
        ).toBeVisible()
      })
    }
  )
  test(`User can edit an extrude operation from the feature tree`, async ({
    context,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    page,
  }) => {
    const initialInput = '23'
    const initialCode = `sketch001 = startSketchOn(XZ)
      |> circle(center = [0, 0], radius = 5)
      renamedExtrude = extrude(sketch001, length = ${initialInput})`
    const newParameterName = 'length001'
    const expectedCode = `${newParameterName} = 23
    sketch001 = startSketchOn(XZ)
      |> circle(center = [0, 0], radius = 5)
            renamedExtrude = extrude(sketch001, length = ${newParameterName})`
    const editedParameterValue = '23 * 2'

    await context.folderSetupFn(async (dir) => {
      const testDir = join(dir, 'test-sample')
      await fsp.mkdir(testDir, { recursive: true })
      await fsp.writeFile(join(testDir, 'main.kcl'), initialCode, 'utf-8')
    })

    await test.step('setup test', async () => {
      await homePage.expectState({
        projectCards: [
          {
            title: 'test-sample',
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
      await homePage.openProject('test-sample')
      await scene.settled(cmdBar)
      await toolbar.openFeatureTreePane()
    })

    await test.step('Double click on the extrude operation', async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 0))
        .first()
        .dblclick()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [
          `renamedExtrude = extrude(sketch001, length = ${initialInput})`,
        ],
      })
      await cmdBar.expectState({
        commandName: 'Extrude',
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: initialInput,
        headerArguments: {
          Length: initialInput,
        },
        highlightedHeaderArg: 'length',
      })
    })

    await test.step('Add a parameter for distance argument and submit', async () => {
      await expect(cmdBar.currentArgumentInput).toBeVisible()
      await cmdBar.variableCheckbox.click()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          // The calculated value is shown in the argument summary
          Length: initialInput,
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [
          `renamedExtrude = extrude(sketch001, length = ${newParameterName})`,
        ],
      })
      await editor.expectEditor.toContain(expectedCode, {
        shouldNormalise: true,
      })
    })

    await test.step('Edit the parameter via the feature tree', async () => {
      const parameter = await toolbar.getFeatureTreeOperation('Parameter', 0)
      await parameter.dblclick()
      await cmdBar.expectState({
        commandName: 'Edit parameter',
        currentArgKey: 'value',
        currentArgValue: '23',
        headerArguments: {
          Name: newParameterName,
          Value: '23',
        },
        stage: 'arguments',
        highlightedHeaderArg: 'value',
      })
      await cmdBar.argumentInput
        .locator('[contenteditable]')
        .fill(editedParameterValue)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Edit parameter',
        headerArguments: {
          Name: newParameterName,
          Value: '46', // Shows calculated result
        },
      })
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain(editedParameterValue)
    })

    await test.step('Edit the parameter value in the editor', async () => {
      await editor.replaceCode('23 * 2', '42')
      await editor.expectEditor.toContain('= 42')
      // Wait for the code to be executed.
      await page.waitForTimeout(2000)
      // The parameter value should be updated in the feature tree.
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Parameter',
        0
      )
      await expect(operationButton.getByTestId('value-detail')).toHaveText('42')
    })
  })
  test(`User can edit an offset plane operation from the feature tree`, async ({
    context,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const testCode = (value: string) => `p = offsetPlane(XY, offset = ${value})`
    const initialInput = '10'
    const initialCode = testCode(initialInput)
    const newInput = '5 + 10'
    const expectedCode = testCode(newInput)
    await context.folderSetupFn(async (dir) => {
      const testDir = join(dir, 'test-sample')
      await fsp.mkdir(testDir, { recursive: true })
      await fsp.writeFile(join(testDir, 'main.kcl'), initialCode, 'utf-8')
    })

    await test.step('setup test', async () => {
      await homePage.expectState({
        projectCards: [
          {
            title: 'test-sample',
            fileCount: 1,
          },
        ],
        sortBy: 'last-modified-desc',
      })
      await homePage.openProject('test-sample')
      await scene.settled(cmdBar)
      await toolbar.openFeatureTreePane()
    })

    await test.step('Double click on the offset plane operation', async () => {
      await (await toolbar.getFeatureTreeOperation('Offset Plane', 0))
        .first()
        .dblclick()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [initialCode],
      })
      await cmdBar.expectState({
        commandName: 'Offset plane',
        stage: 'arguments',
        currentArgKey: 'distance',
        currentArgValue: initialInput,
        headerArguments: {
          Plane: '1 plane',
          Distance: initialInput,
        },
        highlightedHeaderArg: 'distance',
      })
    })

    await test.step('Edit the distance argument and submit', async () => {
      await expect(cmdBar.currentArgumentInput).toBeVisible()
      await cmdBar.currentArgumentInput.locator('.cm-content').fill(newInput)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Plane: '1 plane',
          // We show the calculated value in the argument summary
          Distance: '15',
        },
        commandName: 'Offset plane',
      })
      await cmdBar.progressCmdBar()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [expectedCode],
      })
    })
  })

  test(`Delete sketch on offset plane and all profiles from feature tree`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const beforeKclCode = `plane001 = offsetPlane(XY, offset = 5)
sketch001 = startSketchOn(plane001)
profile001 = circle(sketch001, center = [0, 20], radius = 12)
profile002 = startProfile(sketch001, at = [0, 7.25])
  |> xLine(length = 13.3)
profile003 = startProfile(sketch001, at = [0, -4.93])
  |> line(endAbsolute = [-5.56, 0])`
    await context.folderSetupFn(async (dir) => {
      const testProject = join(dir, 'test-sample')
      await fsp.mkdir(testProject, { recursive: true })
      await fsp.writeFile(join(testProject, 'main.kcl'), beforeKclCode, 'utf-8')
    })
    // One dumb hardcoded screen pixel value
    const testPoint = { x: 650, y: 250 }
    const sketchColor: [number, number, number] = [149, 149, 149]
    const planeColor: [number, number, number] = [74, 74, 74]

    await homePage.openProject('test-sample')
    await scene.settled(cmdBar)

    await test.step(`Verify we see the sketch`, async () => {
      await scene.expectPixelColor(sketchColor, testPoint, 10)
    })

    await test.step('Delete sketch via feature tree selection', async () => {
      const operationButton = await toolbar.getFeatureTreeOperation('Sketch', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.expectPixelColor(planeColor, testPoint, 10)
    })

    await test.step(`Verify the code changed`, async () => {
      await editor.expectEditor.toContain('plane001 =')
      await editor.expectEditor.not.toContain('sketch001 =')
      await editor.expectEditor.not.toContain('profile002 = ')
    })

    await test.step(`Delete the remaining plane via feature tree`, async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Offset Plane',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')

      // Verify the plane code is gone, and https://github.com/KittyCAD/modeling-app/issues/5988 is fixed.
      await editor.expectEditor.not.toContain('plane001 =')
    })
  })
})
