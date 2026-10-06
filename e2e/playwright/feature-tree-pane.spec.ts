import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout'
import * as fsp from 'fs/promises'
import { join } from 'path'

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

const FEATURE_TREE_FUNCTION_BODY_APPEARANCE_CODE = `export fn cylinder(d, l) {
  sketch001 = startSketchOn(XY)
  profile001 = circle(sketch001, center = [0, 0], diameter = d)
  extrude001 = extrude(profile001, length = l)
  return extrude001
}

test = cylinder(d = 2, l = 10)
`

const FEATURE_TREE_VISIBILITY_CODE = `myParameter001 = 12
// Hide a helix, leave its cylinder
cylinder = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2mm)

helix001 = helix(revolutions = 16, angleStart = 0, cylinder)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [2.96, 1.99])
  |> line(end = [0.92, -3.09])
  |> line(end = [-2.36, -0.96])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(YZ)
extrude001 = extrude(profile001, length = 5)
hidden001 = hide([cylinder, extrude001])
`

test.describe('Feature Tree pane', { tag: '@desktop' }, () => {
  test('User can go to definition and go to function definition', async ({
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    page,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
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
      await scene.settled()

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
      operationName: 'plane001',
      operationIndex: 0,
      expectedActiveLine: 'plane001 = offsetPlane(XY, offset = 10)',
    })
    await testViewSource({
      operationName: 'extrude001',
      operationIndex: 0,
      expectedActiveLine: 'extrude001 = extrude(sketch002, length = 10)',
    })
    await testViewSource({
      operationName: 'revolve001',
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
  })

  test('Set appearance menu works on function-created bodies', async ({
    homePage,
    scene,
    toolbar,
    cmdBar,
    page,
    editor,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const sampleDir = join(dir, 'test-sample')
      await fsp.mkdir(sampleDir, { recursive: true })
      await fsp.writeFile(
        join(sampleDir, 'main.kcl'),
        FEATURE_TREE_FUNCTION_BODY_APPEARANCE_CODE,
        'utf-8'
      )
    })

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
    await scene.settled()
    await toolbar.openFeatureTreePane()

    const cylinderOperation = toolbar.featureTreePane
      .getByRole('button', { name: /test/i })
      .first()
    await expect(cylinderOperation).toBeVisible()
    await cylinderOperation.click({ button: 'right' })

    const setAppearanceMenuItem = page.getByTestId(
      'context-menu-set-appearance'
    )
    await expect(setAppearanceMenuItem).toBeVisible()
    await expect(setAppearanceMenuItem).toBeEnabled()
    await setAppearanceMenuItem.click()

    await cmdBar.expectState({
      commandName: 'Appearance',
      currentArgKey: 'objects',
      currentArgValue: '',
      headerArguments: {
        Objects: '',
        Color: '',
      },
      highlightedHeaderArg: 'objects',
      stage: 'arguments',
    })

    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Appearance',
      currentArgKey: 'color',
      currentArgValue: '',
      headerArguments: {
        Objects: '1 other',
        Color: '',
      },
      highlightedHeaderArg: 'color',
      stage: 'arguments',
    })

    // Fill color, submit, and verify code updated
    await cmdBar.currentArgumentInput.fill('#00ff00')
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Appearance',
      headerArguments: {
        Objects: '1 other',
        Color: '#00ff00',
      },
      stage: 'review',
    })
    await cmdBar.submit()
    await scene.settled()
    await editor.expectEditor.toContain('appearance(test, color = "#00ff00")')
  })

  test('User can hide and unhide bodies and helix from panes', async ({
    context,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    page,
    fs,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const sampleDir = join(dir, 'test-sample')
      await fs.mkdir(sampleDir, { recursive: true })
      await fs.writeFile(
        join(sampleDir, 'main.kcl'),
        new TextEncoder().encode(FEATURE_TREE_VISIBILITY_CODE)
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
      await editor.expectEditor.toContain('hidden001 = hide', {
        timeout: 15_000,
      })
      await scene.settled()
      await toolbar.closePane(DefaultLayoutPaneID.Debug)
      await toolbar.openFeatureTreePane()
    })

    const bodiesPane = page.locator('#bodies-list-pane')

    await test.step('Verify both bodies are hidden', async () => {
      await expect(bodiesPane).toBeVisible({ timeout: 15_000 })
      const bodyToggles = bodiesPane.getByTestId(
        'feature-tree-visibility-toggle'
      )
      await expect(bodyToggles).toHaveCount(2, { timeout: 15_000 })
      for (let i = 0; i < 2; i++) {
        await expect(
          bodyToggles.nth(i).locator('svg[aria-label="eye crossed out"]')
        ).toBeVisible()
      }
    })

    await test.step('Unhide cylinder from the bodies pane', async () => {
      const bodyToggles = bodiesPane.getByTestId(
        'feature-tree-visibility-toggle'
      )
      await scene.waitForExecutionDoneAfter(() => bodyToggles.first().click())
    })

    await test.step('Verify extrude001 is still hidden via KCL', async () => {
      await editor.expectEditor.toContain(/hide\(\s*\[\s*extrude001\s*\]\s*\)/)
    })

    await test.step('Hide helix001 from the Feature Tree', async () => {
      const helixButton = await toolbar.getFeatureTreeOperation('helix001', 0)
      const helixRow = helixButton.locator('..')
      await helixRow.hover()
      await scene.waitForExecutionDoneAfter(() =>
        helixRow.getByTestId('feature-tree-visibility-toggle').click()
      )
    })

    await test.step('Verify helix001 is hidden via KCL', async () => {
      await editor.expectEditor.toContain(/hide\(\s*(?:\[\s*)?helix001/)
    })

    await test.step('Hide cylinder again from the bodies pane', async () => {
      const bodyRow = bodiesPane.getByRole('button', { name: 'Body 1' })
      const bodyToggle = bodyRow
        .locator('..')
        .getByTestId('feature-tree-visibility-toggle')
      await bodyRow.hover()
      await scene.waitForExecutionDoneAfter(() => bodyToggle.click())
      await scene.settled()
    })

    await test.step('Verify cylinder is hidden via standalone hide(cylinder)', async () => {
      await editor.expectEditor.toContain(/hide\(\s*cylinder\s*\)/)
    })
  })

  test(`User can edit an extrude operation from the feature tree`, async ({
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    page,
    folderSetupFn,
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

    await folderSetupFn(async (dir) => {
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
      await scene.settled()
      await toolbar.openFeatureTreePane()
    })

    await test.step('Double click on the extrude operation', async () => {
      await (await toolbar.getFeatureTreeOperation('renamedExtrude', 0))
        .first()
        .dblclick()
      await editor.expectState({
        highlightedCode: '',
        diagnostics: [],
        activeLines: [
          `renamedExtrude = extrude(sketch001, length = ${initialInput})`,
        ],
      })
      await cmdBar.clickHeaderArgument('length')
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
      await scene.waitForExecutionDoneAfter(() => cmdBar.progressCmdBar())
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
      const parameter = await toolbar.getFeatureTreeOperation('length001', 0)
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
      await page.evaluate(() =>
        window.app.singletons.kclManager.flushPendingEditorExecution()
      )
      // The parameter value should be updated in the feature tree.
      const operationButton = await toolbar.getFeatureTreeOperation(
        'length001',
        0
      )
      await expect(operationButton.getByTestId('value-detail')).toContainText(
        '42'
      )
    })
  })
  test(`User can edit an offset plane operation from the feature tree`, async ({
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    folderSetupFn,
  }) => {
    const testCode = (value: string) =>
      `p1 = offsetPlane(XY, offset = ${value})`
    const initialInput = '10'
    const initialCode = testCode(initialInput)
    const newInput = '5 + 10'
    const expectedCode = testCode(newInput)
    await folderSetupFn(async (dir) => {
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
      await scene.settled()
      await toolbar.openFeatureTreePane()
    })

    await test.step('Double click on the offset plane operation', async () => {
      const opButton = await toolbar.getFeatureTreeOperation('p1', 0)
      await opButton.dblclick()
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

  test(`Delete sketch on offset plane and all profiles from feature tree`, async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    folderSetupFn,
  }) => {
    const beforeKclCode = `plane001 = offsetPlane(XY, offset = 5)
sketch001 = startSketchOn(plane001)
profile001 = circle(sketch001, center = [0, 20], radius = 12)
profile002 = startProfile(sketch001, at = [0, 7.25])
  |> xLine(length = 13.3)
profile003 = startProfile(sketch001, at = [0, -4.93])
  |> line(endAbsolute = [-5.56, 0])`
    await folderSetupFn(async (dir) => {
      const testProject = join(dir, 'test-sample')
      await fsp.mkdir(testProject, { recursive: true })
      await fsp.writeFile(join(testProject, 'main.kcl'), beforeKclCode, 'utf-8')
    })
    // One dumb hardcoded screen pixel value
    const pointOnSketch = { x: 650, y: 250 }
    const pointOnPlane = { x: 650, y: 350 }
    const sketchColor: [number, number, number] = [149, 149, 149]
    const planeColor: [number, number, number] = [74, 74, 74]

    await homePage.openProject('test-sample')
    await scene.settled()

    await test.step(`Verify we see the sketch`, async () => {
      await scene.expectPixelColor(sketchColor, pointOnSketch, 10)
    })

    await test.step('Delete sketch via feature tree selection', async () => {
      const operationButton = await toolbar.getFeatureTreeOperation('Sketch', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.expectPixelColor(planeColor, pointOnPlane, 10)
    })

    await test.step(`Verify the code changed`, async () => {
      await editor.expectEditor.toContain('plane001 =')
      await editor.expectEditor.not.toContain('sketch001 =')
      await editor.expectEditor.not.toContain('profile002 = ')
    })

    await test.step(`Delete the remaining plane via feature tree`, async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'plane001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')

      // Verify the plane code is gone, and https://github.com/KittyCAD/modeling-app/issues/5988 is fixed.
      await editor.expectEditor.not.toContain('plane001 =')
    })
  })
})
