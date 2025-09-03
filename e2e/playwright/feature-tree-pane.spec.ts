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
        currentArgKey: 'offset',
        currentArgValue: initialInput,
        headerArguments: {
          Offset: initialInput,
        },
        highlightedHeaderArg: 'offset',
      })
    })

    await test.step('Edit the offset argument and submit', async () => {
      await expect(cmdBar.currentArgumentInput).toBeVisible()
      await cmdBar.currentArgumentInput.locator('.cm-content').fill(newInput)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Offset: '15',
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

  test('User can edit a Pattern Circular 3D operation from the feature tree', async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
    editor,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)

solid001 = extrude(sketch001, length = 5)
pattern001 = patternCircular3d(
  solid001,
  instances = 4,
  axis = [0, 0, 1],
  center = [0, 0, 0],
)`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step('Find and click on pattern operation to edit it', async () => {
      // Open the feature tree pane and find the pattern operation
      await toolbar.openPane('feature-tree')

      // Try different possible names for the pattern operation and click on it
      const possibleNames = [
        'Pattern',
        'Circular Pattern',
        'Pattern Circular 3D', 
        'patternCircular3d'
      ]
      
      let patternOperation = null
      for (const name of possibleNames) {
        try {
          const candidate = await toolbar.getFeatureTreeOperation(name, 0)
          if (await candidate.isVisible()) {
            patternOperation = candidate
            break
          }
        } catch (error) {
          // Continue to next name if this one doesn't exist
        }
      }
      
      if (!patternOperation) {
        throw new Error('Could not find pattern operation to click')
      }
      
      await patternOperation.dblclick()

      // Should open the command bar in edit mode
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Pattern Circular 3D',
        currentArgKey: 'center',
        currentArgValue: '[0, 0, 0]',
        headerArguments: {
          Instances: '4',
          Axis: '[0, 0, 1]',
          Center: '[0, 0, 0]',
        },
        highlightedHeaderArg: 'center',
      })
    })

    await test.step('Edit the pattern parameters', async () => {
      await test.step('Edit center parameter', async () => {
        // Feature tree editing starts on the center parameter step
        // Update center from [0, 0, 0] to [5, 0, 0]
        await cmdBar.currentArgumentInput.locator('.cm-content').fill('[5, 0, 0]')
        await cmdBar.progressCmdBar()
      })

      await test.step('Edit instances parameter', async () => {
        // Navigate back to edit the instances parameter
        await page.getByRole('button', { name: 'Instances' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'instances',
          currentArgValue: '4',
          headerArguments: {
            Instances: '4',
            Axis: '[0, 0, 1]',
            Center: '[5, 0, 0]',
          },
          highlightedHeaderArg: 'instances',
        })

        // Update instances from 4 to 6
        await cmdBar.currentArgumentInput.locator('.cm-content').fill('6')
        await cmdBar.progressCmdBar()
      })

      await test.step('Edit axis parameter', async () => {
        // Navigate back to edit the axis parameter
        await page.getByRole('button', { name: 'Axis' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'axis',
          currentArgValue: '',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[5, 0, 0]',
          },
          highlightedHeaderArg: 'axis',
        })

        // Update axis from Z-axis to Y-axis
        await cmdBar.selectOption({ name: 'Y-axis' }).click()
        await cmdBar.progressCmdBar()
      })
    })

    await test.step('Submit the edited pattern and verify changes', async () => {
      // Command is automatically submitted after the last parameter edit
      await scene.settled(cmdBar)

      // Verify the generated code contains all updated parameters
      await editor.expectEditor.toContain('patternCircular3d(')
      await editor.expectEditor.toContain('instances = 6') // Updated from 4 to 6
      await editor.expectEditor.toContain('axis = [0, 1, 0]') // Updated from [0, 0, 1] to [0, 1, 0]
      await editor.expectEditor.toContain('center = [5, 0, 0]') // Updated from [0, 0, 0] to [5, 0, 0]
    })
  })

  test('User can edit optional parameters of a Pattern Circular 3D operation from the feature tree', async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
    editor,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)

solid001 = extrude(sketch001, length = 5)
pattern001 = patternCircular3d(
  solid001,
  instances = 6,
  axis = [0, 0, 1],
  center = [0, 0, 0],
  arcDegrees = 180,
  rotateDuplicates = true,
  useOriginal = false,
)`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step('Find and click on pattern operation to edit it', async () => {
      await toolbar.openPane('feature-tree')

      const possibleNames = [
        'Pattern',
        'Circular Pattern',
        'Pattern Circular 3D', 
        'patternCircular3d'
      ]
      
      let patternOperation = null
      for (const name of possibleNames) {
        try {
          const candidate = await toolbar.getFeatureTreeOperation(name, 0)
          if (await candidate.isVisible()) {
            patternOperation = candidate
            break
          }
        } catch (error) {
          // Continue to next name if this one doesn't exist
        }
      }
      
      if (!patternOperation) {
        throw new Error('Could not find pattern operation to click')
      }
      
      await patternOperation.dblclick()

      // Feature tree editing shows different header format for optional parameters
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Pattern Circular 3D',
        currentArgKey: 'center',
        currentArgValue: '[0, 0, 0]',
        headerArguments: {
          Instances: '6',
          Axis: '[0, 0, 1]',
          Center: '[0, 0, 0]',
          ArcDegrees: '180',
          RotateDuplicates: '',
        },
        highlightedHeaderArg: 'center',
      })
    })

    await test.step('Edit the optional parameters', async () => {
      await test.step('Edit arcDegrees parameter', async () => {
        // Update arcDegrees from 180 to 270
        await page.getByRole('button', { name: 'ArcDegrees' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'arcDegrees',
          currentArgValue: '180',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[0, 0, 0]',
            ArcDegrees: '180',
            RotateDuplicates: '',
          },
          highlightedHeaderArg: 'arcDegrees',
        })

        await cmdBar.currentArgumentInput.locator('.cm-content').fill('270')
        await cmdBar.progressCmdBar()
      })

      await test.step('Edit rotateDuplicates parameter', async () => {
        // Update rotateDuplicates from true to false
        await page.getByRole('button', { name: 'RotateDuplicates' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'rotateDuplicates',
          currentArgValue: '',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[0, 0, 0]',
            ArcDegrees: '270',
            RotateDuplicates: '',
          },
          highlightedHeaderArg: 'rotateDuplicates',
        })

        // Set rotateDuplicates to false - boolean selections auto-accept and return to review
        await cmdBar.selectOption({ name: 'false' }).click()

        // Verify we're back at review stage with updated parameters
        await cmdBar.expectState({
          stage: 'review',
          commandName: 'Pattern Circular 3D',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[0, 0, 0]',
            ArcDegrees: '270',
            // Boolean parameters don't show their values in the header
          },
        })
      })

      await test.step('Edit useOriginal parameter', async () => {
        // Update useOriginal from false to true
        await page.getByRole('button', { name: 'UseOriginal' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'useOriginal',
          currentArgValue: '',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[0, 0, 0]',
            ArcDegrees: '270',
            UseOriginal: '',
          },
          highlightedHeaderArg: 'useOriginal',
        })

        // Set useOriginal to true - boolean selections auto-accept and return to review
        await cmdBar.selectOption({ name: 'true' }).click()

        // Verify we're at review stage after boolean parameter edit
        await cmdBar.expectState({
          stage: 'review',
          commandName: 'Pattern Circular 3D',
          headerArguments: {
            Instances: '6',
            Axis: '[0, 0, 1]',
            Center: '[0, 0, 0]',
            ArcDegrees: '270',
            UseOriginal: '',
            // Boolean parameters may not display values in the header after editing
          },
        })
      })
    })

    await test.step('Submit the edited pattern and verify changes', async () => {
      // Submit the command
      await cmdBar.progressCmdBar()

      // Wait for command bar to close after submission
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })

      // Allow time for code execution and updates
      await page.waitForTimeout(2000)

      // Verify the generated code contains all updated parameters
      await editor.expectEditor.toContain('patternCircular3d(')
      await editor.expectEditor.toContain('instances = 6')
      await editor.expectEditor.toContain('axis = [0, 0, 1]')
      await editor.expectEditor.toContain('center = [0, 0, 0]')
      await editor.expectEditor.toContain('arcDegrees = 270') // Updated from 180 to 270
      await editor.expectEditor.toContain('rotateDuplicates = false') // Updated from true to false
      await editor.expectEditor.toContain('useOriginal = true') // Updated from false to true
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
